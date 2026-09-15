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
    .description('A caching proxy CLI server that forwards requests and caches responses')
    .option('-p, --port <number>', 'Puerto en el que escucha el proxy', '3000')
    .option('-o, --origin <url>', 'URL del servidor origen')
    .option('-t, --ttl <seconds>', 'Tiempo de vida de la caché en segundos (0 para infinito)', '60')
    .option('--clear-cache', 'Limpiar la caché y salir')
    .option('--no-persist', 'Desactivar la persistencia en disco (solo caché en RAM)');

program.parse(process.argv);
const options = program.opts();

// --- Gestor de Caché ---
class CacheManager {
    constructor(persist, filePath, ttlSeconds) {
        this.persist = persist;
        this.filePath = filePath;
        this.ttlMs = ttlSeconds > 0 ? ttlSeconds * 1000 : 0;
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
                    // Solo cargar entradas que aún no hayan expirado
                    if (!this.ttlMs || (Date.now() - val.timestamp < this.ttlMs)) {
                        this.cache.set(key, val);
                    }
                }
            }
        } catch (err) {
            console.warn('⚠️ No se pudo cargar la caché existente de disco:', err.message);
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
            console.error('⚠️ Error al guardar la caché en disco:', err.message);
        }
    }

    static clearDisk(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return true;
        } catch (err) {
            console.error('⚠️ Error al eliminar el archivo de caché:', err.message);
            return false;
        }
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        // Comprobación de TTL
        if (this.ttlMs && (Date.now() - item.timestamp > this.ttlMs)) {
            this.cache.delete(key);
            this.saveToDisk();
            return null;
        }

        return item;
    }

    set(key, data) {
        this.cache.set(key, {
            ...data,
            timestamp: Date.now()
        });
        this.saveToDisk();
    }

    invalidatePath(urlPath) {
        let deleted = false;
        for (const key of this.cache.keys()) {
            // Claves en formato METHOD:URL (ej: GET:/products?page=1)
            const parts = key.split(':');
            const cachedUrl = parts.slice(1).join(':');
            if (cachedUrl.split('?')[0] === urlPath.split('?')[0]) {
                this.cache.delete(key);
                deleted = true;
            }
        }
        if (deleted) {
            this.saveToDisk();
        }
    }
}

// --- Manejo del comando --clear-cache ---
if (options.clearCache) {
    CacheManager.clearDisk(CACHE_FILE);
    console.log('🧹 Cache cleared successfully.');
    process.exit(0);
}

// Validar que se especifique el origen si se va a correr el servidor
if (!options.origin) {
    console.error('❌ Error: Debes especificar la URL del servidor origen con --origin <url>');
    process.exit(1);
}

// Normalizar URL origen (sin trailing slash)
const originUrlBase = options.origin.replace(/\/+$/, '');
const ttl = parseInt(options.ttl, 10);
const cacheManager = new CacheManager(options.persist, CACHE_FILE, isNaN(ttl) ? 60 : ttl);

const app = express();

// Aceptar cualquier tipo de body en formato crudo (Buffer) para preservar binarios, JSON, urlencoded, etc.
app.use(express.raw({ type: '*/*', limit: '50mb' }));

// En Express 5 (path-to-regexp >= 8), los wildcards deben nombrarse: '{*any}' o usar app.use
app.all('{*any}', async (req, res) => {
    const startTime = Date.now();
    const method = req.method.toUpperCase();
    const requestUrl = req.url;
    const cacheKey = `${method}:${requestUrl}`;
    const targetUrl = `${originUrlBase}${requestUrl}`;

    // Solo peticiones seguras e idempotentes (GET y HEAD) se sirven o almacenan en caché
    const isCacheable = method === 'GET' || method === 'HEAD';

    if (isCacheable) {
        const cached = cacheManager.get(cacheKey);
        if (cached) {
            const elapsed = Date.now() - startTime;
            console.log(`[${method}] ${requestUrl} -> ${cached.status} (HIT) [${elapsed}ms]`);

            res.setHeader('X-Cache', 'HIT');
            if (cached.headers) {
                // Reenviar encabezados cacheados evitando headers hop-by-hop
                for (const [hKey, hVal] of Object.entries(cached.headers)) {
                    if (!['content-length', 'connection', 'transfer-encoding'].includes(hKey.toLowerCase())) {
                        res.setHeader(hKey, hVal);
                    }
                }
            }

            const bodyBuffer = cached.body ? Buffer.from(cached.body, 'base64') : Buffer.alloc(0);
            return res.status(cached.status).send(bodyBuffer);
        }
    }

    try {
        // Filtrar headers del cliente que puedan interferir con la petición de axios al origen
        const forwardHeaders = { ...req.headers };
        delete forwardHeaders.host;
        delete forwardHeaders['content-length'];
        delete forwardHeaders['accept-encoding']; // Dejar que Axios/Node maneje la compresión

        const originHost = new URL(originUrlBase).host;
        forwardHeaders.host = originHost;

        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined,
            headers: forwardHeaders,
            responseType: 'arraybuffer',
            validateStatus: () => true
        });

        const elapsed = Date.now() - startTime;
        console.log(`[${method}] ${requestUrl} -> ${response.status} (${isCacheable ? 'MISS' : 'BYPASS'}) [${elapsed}ms]`);

        // Si es cacheable y la respuesta es exitosa (2xx o 304), almacenar en caché
        if (isCacheable && ((response.status >= 200 && response.status < 300) || response.status === 304)) {
            const responseData = response.data ? Buffer.from(response.data).toString('base64') : '';
            cacheManager.set(cacheKey, {
                status: response.status,
                headers: response.headers,
                body: responseData
            });
        }

        // Si es un método de mutación (POST, PUT, DELETE, PATCH) exitoso, invalidar entradas asociadas a la ruta
        if (!isCacheable && response.status >= 200 && response.status < 400) {
            cacheManager.invalidatePath(requestUrl);
        }

        // Reenviar cabeceras del origen al cliente
        for (const [hKey, hVal] of Object.entries(response.headers)) {
            if (!['content-length', 'connection', 'transfer-encoding'].includes(hKey.toLowerCase())) {
                res.setHeader(hKey, hVal);
            }
        }

        res.setHeader('X-Cache', isCacheable ? 'MISS' : 'BYPASS');
        return res.status(response.status).send(response.data);
    } catch (err) {
        const elapsed = Date.now() - startTime;
        console.error(`[${method}] ${requestUrl} -> ERROR [${elapsed}ms]:`, err.message);
        return res.status(502).send('Bad Gateway: Error al comunicar con el servidor origen.');
    }
});

const server = app.listen(options.port, () => {
    console.log(`🚀 Proxy escuchando en http://localhost:${options.port}`);
    console.log(`🎯 Redirigiendo peticiones a: ${originUrlBase}`);
    console.log(`⏱️  TTL de caché: ${ttl > 0 ? `${ttl} segundos` : 'Desactivado (infinito)'}`);
    console.log(`💾 Persistencia: ${options.persist ? `Activada (${CACHE_FILE})` : 'Desactivada (RAM)'}`);
});
