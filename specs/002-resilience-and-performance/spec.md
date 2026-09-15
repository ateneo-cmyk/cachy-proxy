# Feature Specification: Rate Limiting, Request Collapsing and Stale-While-Revalidate

**Feature Branch**: `002-resilience-and-performance`

**Created**: 2026-09-15

**Status**: Ready for Implementation

**Input**: User description: "Throttling / Rate Limiting Inteligente y Protección contra Cache-Stampede con Request Collapsing y Stale-While-Revalidate (RFC 5861)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Request Collapsing contra Cache-Stampede (Priority: P1)

Como operador de backend o infraestructura, cuando un recurso muy popular vence o sufre un tráfico masivo repentino (*thundering herd*), quiero que el proxy combine todas las peticiones entrantes concurrentes hacia la misma URL en una sola petición al origen, para proteger el servidor de saturaciones o caídas (*cache stampede*).

**Why this priority**: Evita que una ráfaga simultánea de usuarios tumbe el servidor de origen cuando expira una clave de caché caliente.

**Independent Test**: Lanzar 50 peticiones HTTP simultáneas al proxy hacia una misma URL no cacheada y verificar que el servidor de origen recibe exactamente **1 única petición**, y que los 50 clientes reciben la respuesta completa con estado 200.

**Acceptance Scenarios**:
1. **Given** 20 peticiones concurrentes a `GET /popular-data` que no está en caché, **When** el proxy procesa las solicitudes, **Then** solo se dispara una llamada de red hacia el servidor origen y las 20 peticiones del cliente se resuelven con el mismo cuerpo y cabeceras.

---

### User Story 2 - Throttling y Rate Limiting Inteligente (Priority: P1)

Como administrador de la API, quiero limitar el número de peticiones por minuto que un cliente/IP puede enviar hacia el servidor de origen (`--rate-limit <req/min>`), sin penalizar las peticiones que se resuelven de forma instantánea desde la caché (`HIT` o `STALE`).

**Why this priority**: Protege el origen de ataques de denegación de servicio o abusos, demostrando el beneficio directo del almacenamiento en caché al no consumir cupo.

**Independent Test**: Configurar `--rate-limit 5`, enviar 10 peticiones que generen `MISS` y comprobar que a partir de la 6ta devuelve `429 Too Many Requests`. Luego enviar 20 peticiones a un recurso ya en caché (`HIT`) y verificar que todas devuelven `200 OK`.

**Acceptance Scenarios**:
1. **Given** un proxy con `--rate-limit 10`, **When** una IP envía 15 peticiones no cacheadas en un lapso de 1 minuto, **Then** las primeras 10 se procesan y las 5 siguientes reciben `429 Too Many Requests` con cabeceras `Retry-After`, `X-RateLimit-Limit: 10` y `X-RateLimit-Remaining: 0`.
2. **Given** un proxy con `--rate-limit 5`, **When** un cliente envía 50 peticiones consecutivas a un recurso que ya está en caché (`HIT`), **Then** ninguna es rechazada por rate limit.

---

### User Story 3 - Stale-While-Revalidate (RFC 5861) (Priority: P2)

Como usuario consumidor de la API, quiero recibir respuestas de inmediato incluso si la información acaba de expirar (`X-Cache: STALE`), mientras el proxy actualiza la copia en segundo plano de manera transparente, para experimentar tiempos de respuesta inferiores a 2 milisegundos.

**Why this priority**: Elimina la penalización de latencia (*latency penalty*) que normalmente experimenta el primer usuario que pide un recurso tras expirar su TTL.

**Independent Test**: Configurar `--ttl 1` y `--swr 5`, solicitar un recurso, esperar 1.5 segundos (expira el TTL pero está en ventana SWR), consultar nuevamente y comprobar que devuelve `X-Cache: STALE` en <5ms, mientras que en segundo plano el proxy refresca la entrada.

**Acceptance Scenarios**:
1. **Given** un recurso en caché cuyo TTL venció pero aún está dentro de la ventana SWR, **When** el cliente lo solicita, **Then** el proxy responde de inmediato con los datos cacheados y cabecera `X-Cache: STALE`, despachando una revalidación en segundo plano hacia el servidor origen.

---

### Edge Cases

- ¿Qué pasa si la petición en background de SWR falla (origen 500 o caída)? La caché mantiene la versión previa y registra el error en consola sin afectar al cliente.
- ¿Qué pasa si una petición mutante (`POST`/`PUT`) ocurre mientras hay un request en vuelo en el coalescer? La entrada coalescida se completa y se invalida la ruta de inmediato.
- ¿Qué cabeceras inyecta el Rate Limiter ante 429? Debe devolver `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0` y `Content-Type: application/json`.

## Requirements *(mandatory)*

- **FR-001**: El proxy DEBE colapsar peticiones concurrentes idénticas (`GET`/`HEAD`) hacia una misma URL mediante una sola promesa en curso, evitando emitir múltiples sockets duplicados hacia el origen.
- **FR-002**: El proxy DEBE admitir el flag `-r, --rate-limit <n>` (peticiones por minuto permitidas por IP hacia el origen).
- **FR-003**: Las peticiones que resulten en `HIT` o `STALE` NO DEBEN consumir cupo del rate limit (o tener costo 0 para el origen).
- **FR-004**: Cuando un cliente supere el rate limit, el proxy DEBE responder inmediatamente con `429 Too Many Requests` y cabeceras `Retry-After`, `X-RateLimit-Limit` y `X-RateLimit-Remaining`.
- **FR-005**: El proxy DEBE admitir el flag `--swr <segundos>` (ventana de *stale-while-revalidate*) y respetar la directiva `stale-while-revalidate=N` en la cabecera `Cache-Control` del origen.
- **FR-006**: Si una entrada está dentro de la ventana SWR, el proxy DEBE servirla con `X-Cache: STALE` y disparar una actualización asíncrona no bloqueante hacia el origen.
- **FR-007**: El proxy DEBE registrar en las métricas (`/__cachy/api/stats`) los contadores de `staleHits`, `coalescedRequests` y `rateLimitedRequests`.

## Success Criteria *(mandatory)*

- **SC-001**: Ante 50 peticiones simultáneas no cacheadas a una misma URL, el servidor de origen debe recibir exactamente 1 llamada HTTP.
- **SC-002**: Las peticiones servidas bajo `stale-while-revalidate` (`STALE`) deben responder en menos de 5 milisegundos.
- **SC-003**: 100% de los tests de resiliencia automatizados deben ejecutarse exitosamente con `npm test`.
