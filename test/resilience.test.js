const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const axios = require('axios');

const ORIGIN_PORT = 5013;
const PROXY_PORT = 5014;
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
const ORIGIN_URL = `http://localhost:${ORIGIN_PORT}`;

let originServer;
let proxyProc;
let slowEndpointHits = 0;
let versionCount = 1;

test.before(async () => {
    originServer = http.createServer(async (req, res) => {
        const url = req.url;

        // Endpoint lento para probar Request Collapsing (200ms de retraso)
        if (url === '/slow-data') {
            slowEndpointHits++;
            await new Promise(r => setTimeout(r, 200));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ hits: slowEndpointHits, timestamp: Date.now() }));
        }

        // Endpoint para probar SWR
        if (url === '/swr-data') {
            versionCount++;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ version: versionCount }));
        }

        // Endpoint general
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    });

    await new Promise(resolve => originServer.listen(ORIGIN_PORT, resolve));

    // Proxy con: rate-limit=5 req/min, ttl=1s, swr=3s
    proxyProc = spawn('node', [
        'index.js',
        '--port', String(PROXY_PORT),
        '--origin', ORIGIN_URL,
        '--ttl', '1',
        '--swr', '3',
        '--rate-limit', '5',
        '--no-persist'
    ], { stdio: 'inherit' });

    await new Promise(resolve => setTimeout(resolve, 1500));
});

test.after(async () => {
    if (proxyProc) proxyProc.kill();
    if (originServer) originServer.close();
});

test('1. Request Collapsing (Anti Cache-Stampede): 20 peticiones simultáneas generan solo 1 llamada al origen', async () => {
    const promises = [];
    for (let i = 0; i < 20; i++) {
        promises.push(axios.get(`${PROXY_URL}/slow-data`));
    }

    const responses = await Promise.all(promises);
    assert.strictEqual(responses.length, 20);

    for (const res of responses) {
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.hits, 1);
    }
    assert.strictEqual(slowEndpointHits, 1, 'El servidor de origen solo debió recibir 1 llamada');
});

test('2. Stale-While-Revalidate: Sirve STALE de inmediato y actualiza en background', async () => {
    // 1. Primera llamada: MISS
    const res1 = await axios.get(`${PROXY_URL}/swr-data`);
    assert.strictEqual(res1.headers['x-cache'], 'MISS');
    const initialVersion = res1.data.version;

    // 2. Esperar 1.2 segundos (expira el TTL de 1s pero está dentro de la ventana SWR de 3s)
    await new Promise(r => setTimeout(r, 1200));

    // 3. Segunda llamada: Debe responder STALE instantáneo con la versión anterior
    const start = Date.now();
    const res2 = await axios.get(`${PROXY_URL}/swr-data`);
    const elapsed = Date.now() - start;
    assert.strictEqual(res2.headers['x-cache'], 'STALE');
    assert.strictEqual(res2.data.version, initialVersion);
    assert.ok(elapsed < 20, 'La respuesta STALE debe servirse de forma casi instantánea');

    // 4. Esperar a que la revalidación en background se complete
    await new Promise(r => setTimeout(r, 500));

    // 5. Tercera llamada: Ahora debe ser un HIT con la nueva versión
    const res3 = await axios.get(`${PROXY_URL}/swr-data`);
    assert.strictEqual(res3.headers['x-cache'], 'HIT');
    assert.ok(res3.data.version > initialVersion, 'La caché en background debe haberse actualizado');
});

test('3. Rate Limiting: Bloquea con 429 peticiones al origen que superan el límite (5 req/min)', async () => {
    // Hemos hecho algunas peticiones a /slow-data y /swr-data (aprox 2 consumos).
    // Disparamos peticiones con URLs aleatorias para forzar consumo hacia el origen
    const results = [];
    for (let i = 0; i < 6; i++) {
        try {
            const r = await axios.get(`${PROXY_URL}/rate-test-${i}`, { validateStatus: () => true });
            results.push(r.status);
        } catch (e) {
            results.push(e.response ? e.response.status : 500);
        }
    }

    assert.ok(results.includes(429), 'Al menos una petición debió ser bloqueada con 429 Too Many Requests');
});

test('4. Rate Limiting: Peticiones servidas desde caché (HIT o STALE) no son bloqueadas', async () => {
    // Hacemos 15 peticiones a un recurso ya en caché (/slow-data)
    for (let i = 0; i < 15; i++) {
        const res = await axios.get(`${PROXY_URL}/slow-data`);
        assert.strictEqual(res.status, 200);
        assert.ok(res.headers['x-cache'] === 'HIT' || res.headers['x-cache'] === 'STALE');
    }
});
