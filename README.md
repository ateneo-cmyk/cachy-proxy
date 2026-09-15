# 🚀 Caching Proxy CLI

Un servidor proxy inverso de alto rendimiento y resiliencia empresarial basado en **Node.js**, **Express** y **Axios**, desarrollado bajo la metodología **Spec-Driven Development ([GitHub Spec Kit](https://github.com/github/spec-kit))**.

---

## ✨ Características Principales

* 🔀 **Balanceo de Carga y Failover Automático:**
  * Configura múltiples orígenes con `--origin url1,url2,...`.
  * Distribución **Round-Robin** equitativa.
  * **Circuit Breaker / Failover:** Si un servidor de origen cae o responde con errores 502/503/504, el proxy conmuta automáticamente al siguiente origen disponible en la misma petición del cliente.
* 🎭 **Modo Mocking y Offline (Record & Playback):**
  * `--record [dir]`: Graba las respuestas reales exitosas con cuerpo (Base64) y cabeceras intactas.
  * `--offline [dir]` / `--replay [dir]`: Permite trabajar completamente desconectado sin depender del servidor de origen (sirve con `X-Cache: REPLAY`).
* 🔐 **Seguridad en Dashboard y APIs Administrativas:**
  * `--dashboard-auth <user:pass>`: Protege el panel web `/__cachy` y los endpoints de purga mediante HTTP Basic Authentication estándar.
* 🛠️ **Inyección de Cabeceras y Reescritura de Rutas:**
  * `--set-header "Header: Valor"`: Inyecta cabeceras salientes hacia el origen (ej: `Authorization: Bearer token`).
  * `--rewrite "regex:reemplazo"`: Transforma y adapta URLs antes de evaluar la caché o el backend.
* 🔄 **Protección contra Cache-Stampede (Request Collapsing / Coalescing):**
  * Colapsa ráfagas masivas concurrentes hacia la misma URL en una sola petición al origen (*anti thundering herd*).
* 🚦 **Throttling y Rate Limiting Inteligente (`-r, --rate-limit <req/min>`):**
  * Limita el tráfico hacia el origen por IP sin penalizar las peticiones servidas desde caché (`HIT` o `STALE`).
* ⚡ **Stale-While-Revalidate (RFC 5861) (`--swr <segundos>`):**
  * Entrega respuestas caducadas de inmediato (`X-Cache: STALE`) en <2ms mientras revalida en background sin bloquear al usuario.
* 🧠 **Conformidad HTTP Estricta (RFC 9111) & Revalidación 304:**
  * Respeta `Cache-Control: no-store, private`, `max-age` y revalidación `ETag` con respuestas `304 Not Modified` (`X-Cache: REVALIDATED`).
* 🛡️ **Límite de Memoria y Desalojo LRU (`-m, --max-entries <n>`):**
  * Evita fugas de memoria purgando automáticamente las entradas menos consultadas.
* 🎛️ **Dashboard Web Visual Embebido:**
  * Monitoreo en tiempo real de métricas, fallos, failovers, aciertos SWR y purga interactiva en `http://localhost:<puerto>/__cachy`.

---

## 📦 Instalación

```bash
git clone <URL_DEL_REPOSITORIO>
cd cachy-proxy
npm install

# (Opcional) Enlazar comando de forma global
npm link
```

---

## 🚀 Opciones CLI Disponibles

```bash
node index.js [opciones]
```

| Flag | Descripción | Por defecto |
| :--- | :--- | :--- |
| `-o, --origin <urls>` | URL(s) del origen separadas por coma (ej: `http://srv1,http://srv2`). | *Obligatorio (salvo en modo offline)* |
| `-p, --port <number>` | Puerto local en el que escucha el proxy. | `3000` |
| `-t, --ttl <seconds>` | TTL de caché por defecto en segundos (`0` para infinito). | `60` |
| `--swr <seconds>` | Ventana de stale-while-revalidate en segundos. | `0` |
| `-r, --rate-limit <n>` | Límite de peticiones al origen por minuto por IP. | `0` (desactivado) |
| `-m, --max-entries <n>` | Límite máximo de entradas antes de desalojo LRU. | `500` |
| `--record [dir]` | Graba respuestas en el directorio de fixtures. | `./fixtures` |
| `--offline [dir]` | Modo offline: responde solo desde fixtures grabados. | `./fixtures` |
| `--dashboard-auth <u:p>` | Protege el dashboard con usuario y contraseña (Basic Auth). | *Desactivado* |
| `--set-header <H:V...>` | Inyecta cabeceras salientes hacia el origen. | *Ninguno* |
| `--rewrite <R...>` | Reglas de reescritura de rutas (ej: `^/api/(.*):/$1`). | *Ninguno* |
| `--exclude <pats>` | Rutas a excluir de caché separadas por coma. | *Ninguno* |
| `--clear-cache` | Limpia la caché almacenada y sale. | *Desactivado* |
| `--force-cache` | Fuerza el guardado ignorando directivas `no-store` del origen. | *Desactivado* |
| `--no-persist` | Desactiva la persistencia en disco (solo RAM). | *Desactivado* |

---

## 💡 Ejemplos de Uso

### 1. Balanceo de Carga con Failover
```bash
node index.js --origin https://api1.example.com,https://api2.example.com --port 8080
```

### 2. Grabación y Reproducción Offline (Mocking)
```bash
# 1. Grabar respuestas reales
node index.js --origin https://dummyjson.com --record ./fixtures

# 2. Correr sin internet / con origen apagado
node index.js --offline ./fixtures
```

### 3. Proxy Seguro con Inyección de Token y Reescritura
```bash
node index.js \
  --origin https://api.internal.net \
  --dashboard-auth admin:secret123 \
  --set-header "Authorization: Bearer superSecretToken" \
  --rewrite "^/legacy/(.*):/v2/$1"
```

---

## 🧪 Pruebas Automatizadas

```bash
npm test
```

Ejecuta secuencialmente las 3 suites del proyecto:
1. `test/proxy.test.js`: Flujo HIT/MISS, POST bypass, `Cache-Control: no-store`, revalidación 304, LRU eviction y filtros de exclusión.
2. `test/resilience.test.js`: Request Collapsing (20 peticiones simultáneas = 1 llamada al origen), SWR y Rate Limiting inteligente.
3. `test/advanced.test.js`: Load Balancing Round-Robin, Failover automático, inyección de cabeceras, reescritura de URLs, seguridad Basic Auth en dashboard y modo Offline Mocking.

**Total:** 17 tests automatizados ejecutados con el runner nativo de Node.js (100% de éxito).

---

## 📐 Metodología Spec Kit

* Constitución: [.specify/memory/constitution.md](.specify/memory/constitution.md)
* Feature 001 (Mejoras Base): [specs/001-caching-proxy-enhancements/spec.md](specs/001-caching-proxy-enhancements/spec.md)
* Feature 002 (Resiliencia): [specs/002-resilience-and-performance/spec.md](specs/002-resilience-and-performance/spec.md)
* Feature 003 (Enterprise Suite): [specs/003-offline-loadbalancing-security/spec.md](specs/003-offline-loadbalancing-security/spec.md)