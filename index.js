#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const axios = require('axios');
const express = require('express');

const program = new Command();
const CACHE_FILE = path.join(process.cwd(), '.cachy-cache.json');

program
    .name('cachy-proxy')
    .description('A feature-complete caching proxy CLI server with metrics, LRU eviction, Rate Limiting, Request Collapsing, and SWR')
    .option('-p, --port <number>', 'Puerto en el que escucha el proxy', '3000')
    .option('-o, --origin <url>', 'URL del servidor origen')
    .option('-t, --ttl <seconds>', 'Tiempo de vida de la caché por defecto en segundos (0 para infinito)', '60')
    .option('-m, --max-entries <number>', 'Número máximo de entradas en caché antes de desalojo LRU', '500')
    .option('-r, --rate-limit <req/min>', 'Límite de peticiones hacia el origen por minuto por IP (0 para desactivar)', '0')
    .option('--swr <seconds>', 'Ventana de stale-while-revalidate por defecto en segundos', '0')
    .option('--exclude <patterns>', 'Rutas a excluir de caché separadas por coma (ej: /auth/*,/login)')
    .option('--include <patterns>', 'Rutas exclusivas para cachear separadas por coma')
    .option('--clear-cache', 'Limpiar la caché y salir')
    .option('--force-cache', 'Forzar almacenamiento ignorando directivas no-store o private del origen')
    .option('--no-persist', 'Desactivar la persistencia en disco (solo caché en RAM)');

program.parse(process.argv);
const options = program.opts();

// --- Gestor de Métricas ---
class MetricsTracker {
    constructor() {
        this.reset();
    }

    reset() {
        this.totalRequests = 0;
        this.hits = 0;
        this.misses = 0;
        this.bypasses = 0;
        this.revalidations = 0;
        this.staleHits = 0;
        this.coalescedRequests = 0;
        this.rateLimitedRequests = 0;
        this.bytesCachedServed = 0;
        this.bytesOriginDownloaded = 0;
        this.latencies = [];
    }

    record(type, latencyMs, bytes = 0) {
        this.totalRequests++;
        if (type === 'HIT') this.hits++;
        else if (type === 'MISS') this.misses++;
        else if (type === 'BYPASS') this.bypasses++;
        else if (type === 'REVALIDATED') this.revalidations++;
        else if (type === 'STALE') this.staleHits++;

        if (type === 'HIT' || type === 'REVALIDATED' || type === 'STALE') {
            this.bytesCachedServed += bytes;
        } else {
            this.bytesOriginDownloaded += bytes;
        }

        this.latencies.push(latencyMs);
        if (this.latencies.length > 500) this.latencies.shift();
    }

    recordCoalesced() {
        this.coalescedRequests++;
    }

    recordRateLimited() {
        this.totalRequests++;
        this.rateLimitedRequests++;
    }

    getStats(activeEntriesCount = 0) {
        const avgLatency = this.latencies.length > 0
            ? Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length)
            : 0;

        const effectiveCacheRequests = this.hits + this.misses + this.revalidations + this.staleHits;
        const hitRate = effectiveCacheRequests > 0
            ? Number(((this.hits + this.revalidations + this.staleHits) / effectiveCacheRequests * 100).toFixed(1))
            : 0;

        return {
            totalRequests: this.totalRequests,
            hits: this.hits,
            misses: this.misses,
            bypasses: this.bypasses,
            revalidations: this.revalidations,
            staleHits: this.staleHits,
            coalescedRequests: this.coalescedRequests,
            rateLimitedRequests: this.rateLimitedRequests,
            hitRatePercent: hitRate,
            avgLatencyMs: avgLatency,
            bytesCachedServed: this.bytesCachedServed,
            bytesOriginDownloaded: this.bytesOriginDownloaded,
            activeCacheEntries: activeEntriesCount
        };
    }
}

// --- Gestor de Rate Limiting por IP (Ventana Deslizante) ---
class RateLimiter {
    constructor(limitPerMin) {
        this.limit = limitPerMin > 0 ? limitPerMin : 0;
        this.clients = new Map(); // IP -> { count, resetTime }
        if (this.limit > 0) {
            setInterval(() => this.cleanup(), 60000);
        }
    }

    cleanup() {
        const now = Date.now();
        for (const [ip, data] of this.clients.entries()) {
            if (now > data.resetTime) {
                this.clients.delete(ip);
            }
        }
    }

    consume(ip) {
        if (this.limit <= 0) return { allowed: true, remaining: 9999, resetSec: 0 };

        const now = Date.now();
        let client = this.clients.get(ip);

        if (!client || now > client.resetTime) {
            client = {
                count: 1,
                resetTime: now + 60000
            };
            this.clients.set(ip, client);
            return {
                allowed: true,
                remaining: this.limit - 1,
                resetSec: 60
            };
        }

        if (client.count >= this.limit) {
            const resetSec = Math.max(1, Math.ceil((client.resetTime - now) / 1000));
            return {
                allowed: false,
                remaining: 0,
                resetSec
            };
        }

        client.count++;
        const resetSec = Math.max(1, Math.ceil((client.resetTime - now) / 1000));
        return {
            allowed: true,
            remaining: this.limit - client.count,
            resetSec
        };
    }

    getStatus(ip) {
        if (this.limit <= 0) return { remaining: 9999, resetSec: 0 };
        const now = Date.now();
        const client = this.clients.get(ip);
        if (!client || now > client.resetTime) {
            return { remaining: this.limit, resetSec: 60 };
        }
        return {
            remaining: Math.max(0, this.limit - client.count),
            resetSec: Math.max(1, Math.ceil((client.resetTime - now) / 1000))
        };
    }
}

// --- Request Coalescer (Anti Cache-Stampede) ---
class RequestCoalescer {
    constructor() {
        this.inFlight = new Map(); // key -> Promise
    }

    has(key) {
        return this.inFlight.has(key);
    }

    execute(key, taskFn) {
        if (this.inFlight.has(key)) {
            return { promise: this.inFlight.get(key), isCoalesced: true };
        }

        const promise = (async () => {
            try {
                return await taskFn();
            } finally {
                this.inFlight.delete(key);
            }
        })();

        this.inFlight.set(key, promise);
        return { promise, isCoalesced: false };
    }
}

// --- Gestor de Caché LRU con Persistencia, TTL y SWR ---
class LRUCacheManager {
    constructor(persist, filePath, defaultTtlSeconds, maxEntries, defaultSwrSeconds) {
        this.persist = persist;
        this.filePath = filePath;
        this.defaultTtlMs = defaultTtlSeconds > 0 ? defaultTtlSeconds * 1000 : 0;
        this.defaultSwrMs = defaultSwrSeconds > 0 ? defaultSwrSeconds * 1000 : 0;
        this.maxEntries = maxEntries > 0 ? maxEntries : 500;
        this.cache = new Map();
        if (this.persist) {
            this.loadFromDisk();
        }
    }

    loadFromDisk() {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                for (const [key, val] of Object.entries(parsed)) {
                    const ttl = val.customTtlMs !== undefined ? val.customTtlMs : this.defaultTtlMs;
                    const swr = val.customSwrMs !== undefined ? val.customSwrMs : this.defaultSwrMs;
                    if (!ttl || (Date.now() - val.timestamp < (ttl + swr))) {
                        this.cache.set(key, val);
                    }
                }
            }
        } catch (err) {
            console.warn('⚠️ No se pudo cargar la caché de disco:', err.message);
        }
    }

    saveToDisk() {
        if (!this.persist) return;
        try {
            const obj = {};
            for (const [k, v] of this.cache.entries()) {
                obj[k] = v;
            }
            fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
        } catch (err) {
            console.error('⚠️ Error guardando caché en disco:', err.message);
        }
    }

    static clearDisk(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return true;
        } catch (err) {
            console.error('⚠️ Error al eliminar archivo de caché:', err.message);
            return false;
        }
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        const ttl = item.customTtlMs !== undefined ? item.customTtlMs : this.defaultTtlMs;
        const swr = item.customSwrMs !== undefined ? item.customSwrMs : this.defaultSwrMs;
        const age = Date.now() - item.timestamp;

        const isFresh = !ttl || (age <= ttl);
        const isStale = !isFresh && swr > 0 && (age <= ttl + swr);
        const isExpired = !isFresh && !isStale;

        // Actualizar LRU
        this.cache.delete(key);
        this.cache.set(key, item);

        return { item, isFresh, isStale, isExpired };
    }

    set(key, data, customTtlMs = undefined, customSwrMs = undefined) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            ...data,
            customTtlMs,
            customSwrMs,
            timestamp: Date.now()
        });
        this.saveToDisk();
    }

    touch(key) {
        const item = this.cache.get(key);
        if (item) {
            item.timestamp = Date.now();
            this.cache.delete(key);
            this.cache.set(key, item);
            this.saveToDisk();
        }
    }

    clear() {
        this.cache.clear();
        if (this.persist) {
            LRUCacheManager.clearDisk(this.filePath);
        }
    }

    delete(key) {
        const res = this.cache.delete(key);
        if (res) this.saveToDisk();
        return res;
    }

    invalidatePath(urlPath) {
        let deleted = false;
        const targetClean = urlPath.split('?')[0];
        for (const key of this.cache.keys()) {
            const parts = key.split(':');
            const cachedUrl = parts.slice(1).join(':');
            if (cachedUrl.split('?')[0] === targetClean) {
                this.cache.delete(key);
                deleted = true;
            }
        }
        if (deleted) this.saveToDisk();
    }

    entriesList() {
        const list = [];
        for (const [k, v] of this.cache.entries()) {
            const ttl = v.customTtlMs !== undefined ? v.customTtlMs : this.defaultTtlMs;
            const swr = v.customSwrMs !== undefined ? v.customSwrMs : this.defaultSwrMs;
            const ageMs = Date.now() - v.timestamp;
            let status = 'Vigente';
            if (ttl && ageMs > ttl) {
                status = (swr > 0 && ageMs <= ttl + swr) ? 'STALE' : 'Expirado';
            }

            const sizeBytes = v.body ? Buffer.from(v.body, 'base64').length : 0;
            list.push({
                key: k,
                status: v.status,
                state: status,
                sizeBytes,
                ageSec: Math.round(ageMs / 1000),
                remainingTtlSec: ttl ? Math.max(0, Math.round((ttl - ageMs) / 1000)) : 'Infinito',
                etag: v.headers ? (v.headers.etag || null) : null
            });
        }
        return list;
    }
}

// --- Manejo del comando --clear-cache ---
if (options.clearCache) {
    LRUCacheManager.clearDisk(CACHE_FILE);
    console.log('🧹 Cache cleared successfully.');
    process.exit(0);
}

// Validar que se especifique el origen si se va a arrancar el proxy
if (!options.origin) {
    console.error('❌ Error: Debes especificar la URL del servidor origen con --origin <url>');
    process.exit(1);
}

const originUrlBase = options.origin.replace(/\/+$/, '');
const ttlParsed = parseInt(options.ttl, 10);
const maxEntriesParsed = parseInt(options.maxEntries, 10);
const rateLimitParsed = parseInt(options.rateLimit, 10);
const swrParsed = parseInt(options.swr, 10);

const cacheManager = new LRUCacheManager(
    options.persist,
    CACHE_FILE,
    isNaN(ttlParsed) ? 60 : ttlParsed,
    isNaN(maxEntriesParsed) ? 500 : maxEntriesParsed,
    isNaN(swrParsed) ? 0 : swrParsed
);
const metrics = new MetricsTracker();
const rateLimiter = new RateLimiter(isNaN(rateLimitParsed) ? 0 : rateLimitParsed);
const coalescer = new RequestCoalescer();

// Parsear listas de inclusión y exclusión
const excludePatterns = options.exclude ? options.exclude.split(',').map(s => s.trim()).filter(Boolean) : [];
const includePatterns = options.include ? options.include.split(',').map(s => s.trim()).filter(Boolean) : [];

function matchesPattern(url, pattern) {
    if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        return url.startsWith(prefix);
    }
    return url === pattern;
}

function shouldCache(method, url) {
    if (method !== 'GET' && method !== 'HEAD') return false;
    for (const pat of excludePatterns) {
        if (matchesPattern(url, pat)) return false;
    }
    if (includePatterns.length > 0) {
        return includePatterns.some(pat => matchesPattern(url, pat));
    }
    return true;
}

function parseCacheControl(header) {
    if (!header) return {};
    const directives = {};
    header.split(',').forEach(part => {
        const [k, v] = part.trim().split('=');
        directives[k.toLowerCase()] = v ? v.replace(/"/g, '') : true;
    });
    return directives;
}

// Función centralizada para consultar al servidor origen
async function fetchFromOrigin(method, requestUrl, headers, body) {
    const targetUrl = `${originUrlBase}${requestUrl}`;
    const forwardHeaders = { ...headers };
    delete forwardHeaders.host;
    delete forwardHeaders['content-length'];
    delete forwardHeaders['accept-encoding'];
    forwardHeaders.host = new URL(originUrlBase).host;

    return await axios({
        method,
        url: targetUrl,
        data: Buffer.isBuffer(body) && body.length > 0 ? body : undefined,
        headers: forwardHeaders,
        responseType: 'arraybuffer',
        validateStatus: () => true
    });
}

const app = express();
app.use(express.raw({ type: '*/*', limit: '50mb' }));

// --- API Administrativa y Dashboard Embebido (Rutas Reservadas: /__cachy/*) ---
app.get('/__cachy/api/stats', (req, res) => {
    res.json(metrics.getStats(cacheManager.cache.size));
});

app.get('/__cachy/api/entries', (req, res) => {
    res.json(cacheManager.entriesList());
});

app.delete('/__cachy/api/cache', (req, res) => {
    const key = req.query.key;
    if (key) {
        const deleted = cacheManager.delete(key);
        return res.json({ success: deleted, message: deleted ? `Clave ${key} eliminada` : 'Clave no encontrada' });
    }
    cacheManager.clear();
    metrics.reset();
    return res.json({ success: true, message: 'Caché y estadísticas vaciadas con éxito.' });
});

app.get('/__cachy', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cachy Proxy - Dashboard</title>
    <style>
        :root {
            --bg: #0d1117; --card-bg: #161b22; --border: #30363d;
            --text: #c9d1d9; --accent: #58a6ff; --green: #3fb950; --orange: #d29922; --red: #f85149; --purple: #bc8cff;
        }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
        .container { max-width: 1200px; margin: 0 auto; }
        header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }
        h1 { margin: 0; color: #fff; font-size: 1.5rem; display: flex; align-items: center; gap: 8px; }
        .badge { background: #238636; color: #fff; font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
        .card .title { font-size: 0.8rem; color: #8b949e; text-transform: uppercase; font-weight: 600; }
        .card .val { font-size: 1.6rem; font-weight: 700; color: #fff; margin-top: 8px; }
        table { width: 100%; border-collapse: collapse; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font-size: 0.85rem; }
        th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); }
        th { background: #21262d; color: #8b949e; font-weight: 600; }
        .btn { background: #21262d; border: 1px solid var(--border); color: #c9d1d9; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 500; }
        .btn:hover { background: #30363d; }
        .btn-danger { background: rgba(248, 81, 73, 0.15); color: var(--red); border-color: rgba(248, 81, 73, 0.4); }
        .btn-danger:hover { background: rgba(248, 81, 73, 0.3); }
        .tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
        .tag-hit { background: rgba(63, 185, 80, 0.2); color: var(--green); }
        .tag-stale { background: rgba(210, 153, 34, 0.2); color: var(--orange); }
        .actions-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 Cachy Proxy <span class="badge">En Vivo</span></h1>
            <div>
                <button class="btn btn-danger" onclick="clearAllCache()">🧹 Vaciar Toda la Caché</button>
            </div>
        </header>

        <div class="grid">
            <div class="card"><div class="title">Total Peticiones</div><div class="val" id="totalReq">0</div></div>
            <div class="card"><div class="title">Hit Rate</div><div class="val" id="hitRate">0%</div></div>
            <div class="card"><div class="title">Hits / Reval</div><div class="val" id="hits">0</div></div>
            <div class="card"><div class="title">SWR (Stale Hits)</div><div class="val" style="color: var(--orange);" id="staleHits">0</div></div>
            <div class="card"><div class="title">Peticiones Coalescidas</div><div class="val" style="color: var(--purple);" id="coalesced">0</div></div>
            <div class="card"><div class="title">Bloqueadas (Rate Limit)</div><div class="val" style="color: var(--red);" id="rateLimited">0</div></div>
            <div class="card"><div class="title">Latencia Media</div><div class="val" id="latency">0 ms</div></div>
            <div class="card"><div class="title">Entradas en RAM</div><div class="val" id="entries">0</div></div>
        </div>

        <div class="actions-bar">
            <h2 style="font-size: 1.1rem; margin: 0; color: #fff;">Entradas Almacenadas en Caché</h2>
            <button class="btn" onclick="fetchData()">🔄 Refrescar</button>
        </div>

        <table>
            <thead>
                <tr>
                    <th>Clave de Caché</th>
                    <th>Status</th>
                    <th>Estado</th>
                    <th>Tamaño</th>
                    <th>Edad</th>
                    <th>TTL Restante</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody id="entriesTable">
                <tr><td colspan="7" style="text-align: center; color: #8b949e;">Cargando...</td></tr>
            </tbody>
        </table>
    </div>

    <script>
        async function fetchData() {
            try {
                const sRes = await fetch('/__cachy/api/stats');
                const stats = await sRes.json();
                document.getElementById('totalReq').innerText = stats.totalRequests;
                document.getElementById('hitRate').innerText = stats.hitRatePercent + '%';
                document.getElementById('hits').innerText = (stats.hits + stats.revalidations);
                document.getElementById('staleHits').innerText = stats.staleHits;
                document.getElementById('coalesced').innerText = stats.coalescedRequests;
                document.getElementById('rateLimited').innerText = stats.rateLimitedRequests;
                document.getElementById('latency').innerText = stats.avgLatencyMs + ' ms';
                document.getElementById('entries').innerText = stats.activeCacheEntries;

                const eRes = await fetch('/__cachy/api/entries');
                const entries = await eRes.json();
                const tbody = document.getElementById('entriesTable');
                if (entries.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #8b949e;">No hay entradas almacenadas en caché actualmente.</td></tr>';
                    return;
                }
                tbody.innerHTML = entries.map(e => \`
                    <tr>
                        <td><code>\${e.key}</code></td>
                        <td><span class="tag tag-hit">\${e.status}</span></td>
                        <td><span class="tag \${e.state === 'STALE' ? 'tag-stale' : 'tag-hit'}">\${e.state}</span></td>
                        <td>\${(e.sizeBytes / 1024).toFixed(1)} KB</td>
                        <td>\${e.ageSec}s</td>
                        <td>\${typeof e.remainingTtlSec === 'number' ? e.remainingTtlSec + 's' : e.remainingTtlSec}</td>
                        <td>
                            <button class="btn btn-danger" style="padding: 2px 8px; font-size: 0.75rem;" onclick="deleteEntry('\${encodeURIComponent(e.key)}')">Purgar</button>
                        </td>
                    </tr>
                \`).join('');
            } catch (err) {
                console.error('Error fetching stats:', err);
            }
        }

        async function deleteEntry(key) {
            await fetch('/__cachy/api/cache?key=' + key, { method: 'DELETE' });
            fetchData();
        }

        async function clearAllCache() {
            if (confirm('¿Seguro que deseas vaciar toda la caché del proxy?')) {
                await fetch('/__cachy/api/cache', { method: 'DELETE' });
                fetchData();
            }
        }

        setInterval(fetchData, 3000);
        fetchData();
    </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

// --- Proxy Core ---
app.all('{*any}', async (req, res) => {
    const startTime = Date.now();
    const method = req.method.toUpperCase();
    const requestUrl = req.url;
    const cacheKey = `${method}:${requestUrl}`;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    // Evaluar si es elegible para caché
    const isCacheCandidate = shouldCache(method, requestUrl);
    const clientCC = parseCacheControl(req.headers['cache-control'] || req.headers['pragma']);
    const clientForcesReload = clientCC['no-cache'] || clientCC['no-store'];

    if (isCacheCandidate && !clientForcesReload) {
        const cachedLookup = cacheManager.get(cacheKey);

        if (cachedLookup) {
            const { item, isFresh, isStale } = cachedLookup;

            // CASO 1: HIT Fresco
            if (isFresh) {
                const elapsed = Date.now() - startTime;
                const bodyBuffer = item.body ? Buffer.from(item.body, 'base64') : Buffer.alloc(0);
                metrics.record('HIT', elapsed, bodyBuffer.length);

                console.log(`[${method}] ${requestUrl} -> ${item.status} (HIT) [${elapsed}ms]`);
                res.setHeader('X-Cache', 'HIT');
                if (item.headers) {
                    for (const [hKey, hVal] of Object.entries(item.headers)) {
                        if (!['content-length', 'connection', 'transfer-encoding'].includes(hKey.toLowerCase())) {
                            res.setHeader(hKey, hVal);
                        }
                    }
                }
                return res.status(item.status).send(bodyBuffer);
            }

            // CASO 2: STALE (Stale-While-Revalidate)
            if (isStale) {
                const elapsed = Date.now() - startTime;
                const bodyBuffer = item.body ? Buffer.from(item.body, 'base64') : Buffer.alloc(0);
                metrics.record('STALE', elapsed, bodyBuffer.length);

                console.log(`[${method}] ${requestUrl} -> ${item.status} (STALE) [${elapsed}ms]`);

                // Responder de inmediato con STALE
                res.setHeader('X-Cache', 'STALE');
                if (item.headers) {
                    for (const [hKey, hVal] of Object.entries(item.headers)) {
                        if (!['content-length', 'connection', 'transfer-encoding'].includes(hKey.toLowerCase())) {
                            res.setHeader(hKey, hVal);
                        }
                    }
                }
                res.status(item.status).send(bodyBuffer);

                // Disparar revalidación en segundo plano usando coalescer para no duplicar llamadas
                coalescer.execute(cacheKey, async () => {
                    try {
                        const bgResponse = await fetchFromOrigin(method, requestUrl, req.headers, req.body);
                        if (bgResponse.status >= 200 && bgResponse.status < 300) {
                            const bgData = bgResponse.data ? Buffer.from(bgResponse.data).toString('base64') : '';
                            const respCC = parseCacheControl(bgResponse.headers['cache-control']);
                            let customTtl = undefined;
                            let customSwr = undefined;
                            if (respCC['max-age']) customTtl = parseInt(respCC['max-age'], 10) * 1000;
                            if (respCC['stale-while-revalidate']) customSwr = parseInt(respCC['stale-while-revalidate'], 10) * 1000;

                            cacheManager.set(cacheKey, {
                                status: bgResponse.status,
                                headers: bgResponse.headers,
                                body: bgData
                            }, customTtl, customSwr);
                        }
                    } catch (bgErr) {
                        // Error silencioso en background
                    }
                });
                return;
            }

            // CASO 3: Expirado pero con ETag o Last-Modified (Revalidación Condicional)
            const etag = item.headers && (item.headers['etag'] || item.headers['ETag']);
            const lastModified = item.headers && (item.headers['last-modified'] || item.headers['Last-Modified']);

            if (etag || lastModified) {
                try {
                    const revalHeaders = { ...req.headers };
                    if (etag) revalHeaders['if-none-match'] = etag;
                    if (lastModified) revalHeaders['if-modified-since'] = lastModified;

                    const revalRes = await fetchFromOrigin(method, requestUrl, revalHeaders, req.body);

                    if (revalRes.status === 304) {
                        cacheManager.touch(cacheKey);
                        const elapsed = Date.now() - startTime;
                        const bodyBuffer = item.body ? Buffer.from(item.body, 'base64') : Buffer.alloc(0);
                        metrics.record('REVALIDATED', elapsed, bodyBuffer.length);

                        console.log(`[${method}] ${requestUrl} -> 304 (REVALIDATED) [${elapsed}ms]`);
                        res.setHeader('X-Cache', 'REVALIDATED');
                        if (item.headers) {
                            for (const [hKey, hVal] of Object.entries(item.headers)) {
                                if (!['content-length', 'connection', 'transfer-encoding'].includes(hKey.toLowerCase())) {
                                    res.setHeader(hKey, hVal);
                                }
                            }
                        }
                        return res.status(item.status).send(bodyBuffer);
                    }
                } catch (revalErr) {
                    // Continuar como MISS
                }
            }
        }
    }

    // --- Consulta al Origen con Request Collapsing (Anti Cache-Stampede) ---
    // Si la petición se puede coalescer (ya hay una idéntica en vuelo hacia el origen),
    // no consume cupo de rate limit adicional ya que el origen no recibirá otra llamada de red.
    const isAlreadyInFlight = coalescer.has(cacheKey);

    if (!isAlreadyInFlight) {
        // Solo la petición líder que realmente va a hablar con el origen consume token de rate limit
        const rlCheck = rateLimiter.consume(clientIp);
        if (!rlCheck.allowed) {
            metrics.recordRateLimited();
            const elapsed = Date.now() - startTime;
            console.warn(`[${method}] ${requestUrl} -> 429 Too Many Requests (Rate Limit Exceeded for ${clientIp}) [${elapsed}ms]`);

            res.setHeader('Retry-After', rlCheck.resetSec);
            res.setHeader('X-RateLimit-Limit', rateLimiter.limit);
            res.setHeader('X-RateLimit-Remaining', 0);
            res.setHeader('Content-Type', 'application/json');
            return res.status(429).json({
                error: 'Too Many Requests',
                message: `Has superado el límite de ${rateLimiter.limit} peticiones por minuto hacia el origen.`,
                retryAfterSeconds: rlCheck.resetSec
            });
        }
    }

    const { promise, isCoalesced } = coalescer.execute(cacheKey, () => {
        return fetchFromOrigin(method, requestUrl, req.headers, req.body);
    });

    if (isCoalesced) {
        metrics.recordCoalesced();
    }

    try {
        const response = await promise;
        const elapsed = Date.now() - startTime;
        const respCC = parseCacheControl(response.headers['cache-control']);
        const originAllowsCache = options.forceCache || (!respCC['no-store'] && !respCC['private']);

        let customTtlMs = undefined;
        let customSwrMs = undefined;
        if (respCC['max-age']) {
            const maxAgeSec = parseInt(respCC['max-age'], 10);
            if (!isNaN(maxAgeSec) && maxAgeSec >= 0) customTtlMs = maxAgeSec * 1000;
        }
        if (respCC['stale-while-revalidate']) {
            const swrSec = parseInt(respCC['stale-while-revalidate'], 10);
            if (!isNaN(swrSec) && swrSec >= 0) customSwrMs = swrSec * 1000;
        }

        const canBeCached = isCacheCandidate && originAllowsCache &&
            ((response.status >= 200 && response.status < 300) || response.status === 304);

        const cacheStatus = canBeCached ? 'MISS' : 'BYPASS';
        const responseBytes = response.data ? response.data.length : 0;
        metrics.record(cacheStatus, elapsed, responseBytes);

        console.log(`[${method}] ${requestUrl} -> ${response.status} (${cacheStatus}${isCoalesced ? ' - COALESCED' : ''}) [${elapsed}ms]`);

        if (canBeCached) {
            const responseData = response.data ? Buffer.from(response.data).toString('base64') : '';
            cacheManager.set(cacheKey, {
                status: response.status,
                headers: response.headers,
                body: responseData
            }, customTtlMs, customSwrMs);
        }

        // Mutaciones invalidan caché de la ruta
        if (!isCacheCandidate && response.status >= 200 && response.status < 400) {
            cacheManager.invalidatePath(requestUrl);
        }

        for (const [hKey, hVal] of Object.entries(response.headers)) {
            if (!['content-length', 'connection', 'transfer-encoding'].includes(hKey.toLowerCase())) {
                res.setHeader(hKey, hVal);
            }
        }

        const rlStatus = rateLimiter.getStatus(clientIp);
        if (rateLimiter.limit > 0) {
            res.setHeader('X-RateLimit-Limit', rateLimiter.limit);
            res.setHeader('X-RateLimit-Remaining', rlStatus.remaining);
        }

        res.setHeader('X-Cache', cacheStatus);
        return res.status(response.status).send(response.data);
    } catch (err) {
        const elapsed = Date.now() - startTime;
        console.error(`[${method}] ${requestUrl} -> ERROR [${elapsed}ms]:`, err.message);
        return res.status(502).send('Bad Gateway: Error de conexión con el origen.');
    }
});

const server = app.listen(options.port, () => {
    console.log(`🚀 Proxy escuchando en http://localhost:${options.port}`);
    console.log(`🎯 Redirigiendo peticiones a: ${originUrlBase}`);
    console.log(`⏱️  TTL por defecto: ${ttlParsed > 0 ? `${ttlParsed}s` : 'Desactivado (infinito)'}`);
    console.log(`🔄 SWR (stale-while-revalidate): ${swrParsed > 0 ? `${swrParsed}s` : 'Desactivado'}`);
    console.log(`🛡️  Límite LRU: ${maxEntriesParsed} entradas máximas`);
    console.log(`🚦 Rate Limit hacia origen: ${rateLimitParsed > 0 ? `${rateLimitParsed} req/min por IP` : 'Desactivado'}`);
    console.log(`📊 Dashboard interactivo: http://localhost:${options.port}/__cachy`);
    console.log(`💾 Persistencia: ${options.persist ? `Activada (${CACHE_FILE})` : 'Desactivada (RAM)'}`);
});
