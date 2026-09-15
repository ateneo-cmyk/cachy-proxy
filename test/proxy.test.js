const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const axios = require('axios');

const ORIGIN_PORT = 5011;
const PROXY_PORT = 5012;
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
const ORIGIN_URL = `http://localhost:${ORIGIN_PORT}`;

let originServer;
let proxyProc;
let serverCounter = 0;
let etagVersion = 1;

test.before(async () => {
    // 1. Iniciar servidor de prueba origen
    originServer = http.createServer((req, res) => {
        serverCounter++;
        const url = req.url;

        // Soporte de ETag y 304
        if (url === '/etag-resource') {
            const currentEtag = `"v${etagVersion}"`;
            if (req.headers['if-none-match'] === currentEtag) {
                res.writeHead(304, { 'ETag': currentEtag });
                return res.end();
            }
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'ETag': currentEtag
            });
            return res.end(JSON.stringify({ etagVersion }));
        }

        // Soporte de Cache-Control: no-store
        if (url === '/no-store') {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            });
            return res.end(JSON.stringify({ counter: serverCounter }));
        }

        // Endpoint general
        if (req.method === 'POST') {
            res.writeHead(201, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ created: true }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ counter: serverCounter, path: url }));
    });

    await new Promise(resolve => originServer.listen(ORIGIN_PORT, resolve));

    // 2. Iniciar instancia del proxy con TTL=1s, max-entries=3 y exclude=/private/*
    proxyProc = spawn('node', [
        'index.js',
        '--port', String(PROXY_PORT),
        '--origin', ORIGIN_URL,
        '--ttl', '1',
        '--max-entries', '3',
        '--exclude', '/private/*',
        '--no-persist'
    ], { stdio: 'inherit' });

    // Esperar a que el proxy esté listo
    await new Promise(resolve => setTimeout(resolve, 1500));
});

test.after(async () => {
    if (proxyProc) proxyProc.kill();
    if (originServer) originServer.close();
});

test('1. Flujo Básico HIT / MISS', async () => {
    const res1 = await axios.get(`${PROXY_URL}/users`);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers['x-cache'], 'MISS');

    const res2 = await axios.get(`${PROXY_URL}/users`);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers['x-cache'], 'HIT');
    assert.strictEqual(res1.data.counter, res2.data.counter);
});

test('2. Métodos POST devuelven BYPASS e invalidan ruta', async () => {
    const postRes = await axios.post(`${PROXY_URL}/users`, { name: 'Juan' });
    assert.strictEqual(postRes.status, 201);
    assert.strictEqual(postRes.headers['x-cache'], 'BYPASS');

    const getRes = await axios.get(`${PROXY_URL}/users`);
    assert.strictEqual(getRes.headers['x-cache'], 'MISS');
});

test('3. Respeto a Cache-Control: no-store', async () => {
    const res1 = await axios.get(`${PROXY_URL}/no-store`);
    assert.strictEqual(res1.headers['x-cache'], 'BYPASS');

    const res2 = await axios.get(`${PROXY_URL}/no-store`);
    assert.strictEqual(res2.headers['x-cache'], 'BYPASS');
});

test('4. Revalidación condicional con ETag y 304 Not Modified', async () => {
    // Primera petición: MISS y se cachea con ETag
    const res1 = await axios.get(`${PROXY_URL}/etag-resource`);
    assert.strictEqual(res1.headers['x-cache'], 'MISS');

    // Esperar a que venza el TTL de 1 segundo
    await new Promise(r => setTimeout(r, 1200));

    // Segunda petición: el proxy consulta origen con If-None-Match, recibe 304 y responde REVALIDATED
    const res2 = await axios.get(`${PROXY_URL}/etag-resource`);
    assert.strictEqual(res2.headers['x-cache'], 'REVALIDATED');
    assert.deepStrictEqual(res2.data, { etagVersion: 1 });
});

test('5. Desalojo LRU cuando se supera --max-entries (límite 3)', async () => {
    // Llenar con A, B, C
    await axios.get(`${PROXY_URL}/lru-a`);
    await axios.get(`${PROXY_URL}/lru-b`);
    await axios.get(`${PROXY_URL}/lru-c`);

    // Acceder a A para refrescar su uso reciente (ahora el más antiguo es B)
    await axios.get(`${PROXY_URL}/lru-a`);

    // Insertar D (supera el límite de 3)
    await axios.get(`${PROXY_URL}/lru-d`);

    // B debe haber sido desalojado (debe dar MISS al pedirse)
    const resB = await axios.get(`${PROXY_URL}/lru-b`);
    assert.strictEqual(resB.headers['x-cache'], 'MISS');

    // A debe seguir en caché (HIT)
    const resA = await axios.get(`${PROXY_URL}/lru-a`);
    assert.strictEqual(resA.headers['x-cache'], 'HIT');
});

test('6. Filtro de exclusión con --exclude', async () => {
    const res1 = await axios.get(`${PROXY_URL}/private/secret`);
    assert.strictEqual(res1.headers['x-cache'], 'BYPASS');

    const res2 = await axios.get(`${PROXY_URL}/private/secret`);
    assert.strictEqual(res2.headers['x-cache'], 'BYPASS');
});

test('7. Endpoints de Métricas y Purga de Caché', async () => {
    const statsRes = await axios.get(`${PROXY_URL}/__cachy/api/stats`);
    assert.strictEqual(statsRes.status, 200);
    assert.ok(statsRes.data.totalRequests > 0);
    assert.ok(statsRes.data.hitRatePercent >= 0);

    const delRes = await axios.delete(`${PROXY_URL}/__cachy/api/cache`);
    assert.strictEqual(delRes.data.success, true);

    const statsAfter = await axios.get(`${PROXY_URL}/__cachy/api/stats`);
    assert.strictEqual(statsAfter.data.activeCacheEntries, 0);
});
