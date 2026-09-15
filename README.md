# 🚀 Caching Proxy CLI

Un servidor proxy inverso de alto rendimiento y resiliencia empresarial basado en **Node.js**, **Express** y **Axios**, desarrollado bajo la metodología **Spec-Driven Development ([GitHub Spec Kit](https://github.com/github/spec-kit))**.

Intercepta peticiones HTTP, las reenvía al origen y gestiona una caché inteligente con soporte de **protección contra Cache-Stampede (Request Collapsing)**, **Rate Limiting inteligente**, **Stale-While-Revalidate (RFC 5861)**, **revalidación condicional (ETag / 304)**, **desalojo LRU**, **panel de control Web interactivo** y **métricas en vivo**.

---

## ✨ Características Principales

* 🔄 **Protección contra Cache-Stampede (Request Collapsing / Coalescing):**
  * Ante ráfagas simultáneas de decenas o cientos de peticiones hacia una misma URL no cacheada, el proxy **sólo realiza 1 petición de red al servidor de origen**. Las peticiones concurrentes se colapsan y responden al unísono, protegiendo al backend de saturaciones (*thundering herd*).
* 🚦 **Throttling y Rate Limiting Inteligente (`-r, --rate-limit <req/min>`):**
  * Limita el tráfico hacia el servidor origen por IP de cliente.
  * **Trato preferencial para la caché:** Las peticiones resueltas como `HIT` o `STALE` **no consumen cupo de rate limit**, incentivando el consumo eficiente.
  * Respuestas estándar `429 Too Many Requests` con cabeceras `Retry-After`, `X-RateLimit-Limit` y `X-RateLimit-Remaining`.
* ⚡ **Stale-While-Revalidate (RFC 5861) (`--swr <segundos>`):**
  * Cuando un recurso vence su TTL pero está dentro de la ventana SWR, el proxy responde de inmediato con el dato caducado (`X-Cache: STALE`) con latencia casi nula (<2ms) y dispara una actualización asíncrona no bloqueante en background hacia el origen.
* 🧠 **Conformidad HTTP Estricta (RFC 9111) & Revalidación 304:**
  * Métodos seguros (`GET`, `HEAD`) son evaluados para caché.
  * Mutaciones (`POST`, `PUT`, `DELETE`, `PATCH`) se reenvían al origen (`BYPASS`) e invalidan automáticamente la ruta afectada.
  * Respeta directivas del origen: `Cache-Control: no-store, private` nunca se cachean, y `max-age=N` prevalece sobre el TTL por defecto.
  * Revalidación condicional `ETag` y `304 Not Modified` con entrega de `X-Cache: REVALIDATED` sin retransmitir el cuerpo.
* 🛡️ **Límite de Memoria y Desalojo LRU:**
  * Configurable con `--max-entries <n>`. Al superarse el límite, las claves menos consultadas se purgan de inmediato.
* 🔀 **Filtros de Rutas (`--exclude` e `--include`):**
  * Omitir rutas sensibles mediante patrones comodín (ej: `--exclude "/auth/*,/checkout/*"`).
* 📊 **Métricas en Tiempo Real:**
  * Seguimiento en vivo de `hits`, `misses`, `revalidations`, `staleHits`, `coalescedRequests` y `rateLimitedRequests`.
  * Endpoints JSON: `GET /__cachy/api/stats`, `GET /__cachy/api/entries` y `DELETE /__cachy/api/cache`.
* 🎛️ **Dashboard Web Visual Embebido:**
  * Interfaz gráfica en `http://localhost:<puerto>/__cachy` con tarjetas KPI en vivo, tabla de entradas y purga con un clic.
* 💾 **Persistencia Híbrida:**
  * Guarda las entradas en `.cachy-cache.json` para que el comando `--clear-cache` funcione entre terminales. (Desactivable con `--no-persist`).
* 🧪 **Suite de Pruebas Automatizadas:**
  * 11 tests automatizados con el runner nativo de Node.js ejecutables mediante `npm test`.

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

## 🚀 Uso y Opciones CLI

```bash
node index.js --origin <URL_DEL_ORIGEN> [opciones]
```

### Tabla de Opciones (Flags)

| Flag corto | Flag largo | Descripción | Por defecto |
| :--- | :--- | :--- | :--- |
| `-o` | `--origin <url>` | **(Obligatorio para iniciar)** URL del servidor real de origen. | *Ninguno* |
| `-p` | `--port <number>` | Puerto local en el que escuchará el servidor proxy. | `3000` |
| `-t` | `--ttl <seconds>` | Tiempo de expiración por defecto en segundos (`0` para infinito). | `60` |
| `-r` | `--rate-limit <n>` | Peticiones hacia el origen permitidas por minuto por IP (`0` para desactivar). | `0` |
| | `--swr <seconds>` | Ventana de stale-while-revalidate en segundos. | `0` |
| `-m` | `--max-entries <n>`| Límite máximo de entradas en caché antes de desalojo LRU. | `500` |
| | `--exclude <patrones>` | Rutas a excluir de caché separadas por coma (ej: `/auth/*,/login`). | *Ninguno* |
| | `--include <patrones>` | Rutas exclusivas a cachear separadas por coma. | *Ninguno* |
| | `--clear-cache` | Limpia el archivo de caché almacenado y sale inmediatamente. | *Desactivado* |
| | `--no-persist` | Desactiva el guardado en disco y opera solo en memoria RAM. | *Desactivado* |
| `-h` | `--help` | Muestra la ayuda interactiva de la CLI. | |

---

## 💡 Ejemplos Prácticos

### 1. Iniciar con SWR (Stale-While-Revalidate) y Rate Limiting
```bash
node index.js --origin https://dummyjson.com --ttl 30 --swr 60 --rate-limit 100
```
* Las peticiones en caché responden al instante (<2ms).
* Durante la ventana de 60s tras expirar, los clientes reciben `STALE` sin demoras mientras el proxy revalida en background.
* Cada IP solo puede enviar hasta 100 peticiones no cacheadas por minuto hacia el origen.

### 2. Monitoreo en Vivo (Dashboard)
Abre en tu navegador: **`http://localhost:3000/__cachy`** para inspeccionar las métricas de peticiones coalescidas, aciertos SWR, bloqueos por rate limit y purga de caché.

### 3. Limpiar la Caché
```bash
node index.js --clear-cache
```

---

## 🧪 Pruebas Automatizadas

```bash
npm test
```

Ejecuta secuencialmente ambas suites de prueba:
1. `test/proxy.test.js`: Flujo HIT/MISS, POST bypass e invalidación, `Cache-Control: no-store`, revalidación 304, LRU eviction y filtros de exclusión.
2. `test/resilience.test.js`: Request Collapsing (20 peticiones simultáneas = 1 llamada al origen), Stale-While-Revalidate en background y Rate Limiting por IP (bloqueo 429 y exención de HIT/STALE).

---

## 📐 Metodología Spec Kit

Este proyecto sigue la metodología **Spec-Driven Development** de [GitHub Spec Kit](https://github.com/github/spec-kit):
* Constitución del proyecto: [.specify/memory/constitution.md](.specify/memory/constitution.md)
* Feature 001 (Mejoras Base): [specs/001-caching-proxy-enhancements/spec.md](specs/001-caching-proxy-enhancements/spec.md)
* Feature 002 (Resiliencia y Rendimiento): [specs/002-resilience-and-performance/spec.md](specs/002-resilience-and-performance/spec.md)