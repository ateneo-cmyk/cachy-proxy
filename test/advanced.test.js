const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const axios = require('axios');

const TEST_DIR = path.join(__dirname, 'fixtures_test');
const SRV1_PORT = 5031;
const SRV2_PORT = 5032;
const PROXY_PORT = 5030;
const PROXY_URL = `http://localhost:${PROXY_PORT}`;

let srv1, srv2;
let proxyProc;
let srv1Hits = 0;
let srv2Hits = 0;

test.before(async () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });

    // Servidor origen 1
    srv1 = http.createServer((req, res) => {
        srv1Hits++;
        if (req.url === '/fail') {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Server 1 unavailable' }));
        }
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Echo-Header': req.headers['x-injected-auth'] || 'none'
        });
        res.end(JSON.stringify({ srv: 1, url: req.url, hits: srv1Hits }));
    });
    await new Promise(r => srv1.listen(SRV1_PORT, r));

    // Servidor origen 2 (para balanceo y failover)
    srv2 = http.createServer((req, res) => {
        srv2Hits++;
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Echo-Header': req.headers['x-injected-auth'] || 'none'
        });
        res.end(JSON.stringify({ srv: 2, url: req.url, hits: srv2Hits }));
    });
    await new Promise(r => srv2.listen(SRV2_PORT, r));

    // Iniciar proxy con:
    // - Múltiples orígenes para balanceo y failover: srv1, srv2
    // - Modo Record activado
    // - Dashboard Auth: admin:secret456
    // - Set Header: X-Injected-Auth: SuperSecretToken
    // - Rewrite: ^/old-api/(.*):/new-api/$1
    proxyProc = spawn('node', [
        'index.js',
        '--port', String(PROXY_PORT),
        '--origin', `http://localhost:${SRV1_PORT},http://localhost:${SRV2_PORT}`,
        '--record', TEST_DIR,
        '--dashboard-auth', 'admin:secret456',
        '--set-header', 'X-Injected-Auth: SuperSecretToken',
        '--rewrite', '^/old-api/(.*):/new-api/$1',
        '--no-persist'
    ], { stdio: 'inherit' });

    await new Promise(r => setTimeout(r, 1500));
});

test.after(async () => {
    if (proxyProc) proxyProc.kill();
    if (srv1) srv1.close();
    if (srv2) srv2.close();
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test('1. Load Balancing (Round-Robin): Peticiones alternan entre orígenes configurados', async () => {
    const resA = await axios.get(`${PROXY_URL}/balance-test-1`);
    const resB = await axios.get(`${PROXY_URL}/balance-test-2`);
    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);
    assert.notStrictEqual(resA.data.srv, resB.data.srv, 'Las peticiones debieron distribuirse entre servidores diferentes');
});

test('2. Automatic Failover: Cuando un origen responde 503, conmuta al segundo origen de inmediato', async () => {
    // /fail en srv1 responde 503, por lo que el proxy conmuta automáticamente a srv2
    const res = await axios.get(`${PROXY_URL}/fail`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.srv, 2, 'El proxy debió conmutar con éxito a srv2');
});

test('3. Header Injection (--set-header): Inyecta cabecera saliente hacia el origen', async () => {
    const res = await axios.get(`${PROXY_URL}/header-test`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['x-echo-header'], 'SuperSecretToken');
});

test('4. URL Rewriting (--rewrite): Transforma la URL antes de consultar al origen', async () => {
    const res = await axios.get(`${PROXY_URL}/old-api/users`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.url, '/new-api/users');
});

test('5. Dashboard Security (--dashboard-auth): Exige HTTP Basic Auth para /__cachy', async () => {
    // Petición no autorizada
    try {
        await axios.get(`${PROXY_URL}/__cachy`);
        assert.fail('Debió rechazar con 401');
    } catch (err) {
        assert.strictEqual(err.response.status, 401);
        assert.ok(err.response.headers['www-authenticate'].includes('Basic'));
    }

    // Petición con credenciales correctas
    const authHeader = 'Basic ' + Buffer.from('admin:secret456').toString('base64');
    const authRes = await axios.get(`${PROXY_URL}/__cachy`, {
        headers: { 'Authorization': authHeader }
    });
    assert.strictEqual(authRes.status, 200);
});

test('6. Record & Offline Mocking Mode: Puede responder con origen apagado desde fixtures grabados', async () => {
    // 1. Grabamos una petición en TEST_DIR
    const liveRes = await axios.get(`${PROXY_URL}/record-test-item`);
    assert.strictEqual(liveRes.status, 200);

    // Verificamos que se creó al menos un archivo en TEST_DIR
    const files = fs.readdirSync(TEST_DIR);
    assert.ok(files.length > 0, 'Se debió grabar el fixture en disco');

    // 2. Cerramos el proxy actual y los servidores de prueba origen
    proxyProc.kill();
    srv1.close();
    srv2.close();
    await new Promise(r => setTimeout(r, 800));

    // 3. Arrancamos una nueva instancia del proxy en MODO OFFLINE sin orígenes en puerto 5035
    const OFFLINE_PORT = 5035;
    const offlineProc = spawn('node', [
        'index.js',
        '--port', String(OFFLINE_PORT),
        '--offline', TEST_DIR,
        '--no-persist'
    ], { stdio: 'inherit' });

    await new Promise(r => setTimeout(r, 1800));

    try {
        // Consultamos la URL con los orígenes APAGADOS
        const offlineRes = await axios.get(`http://localhost:${OFFLINE_PORT}/record-test-item`);
        assert.strictEqual(offlineRes.status, 200);
        assert.strictEqual(offlineRes.headers['x-cache'], 'REPLAY');
        assert.strictEqual(offlineRes.data.url, '/record-test-item');
    } finally {
        offlineProc.kill();
    }
});
