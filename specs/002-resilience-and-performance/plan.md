# Implementation Plan: Rate Limiting, Request Collapsing and SWR

**Branch**: `002-resilience-and-performance` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-resilience-and-performance/spec.md`

## Summary

Implementar tres mecanismos clave de resiliencia y aceleración en `cachy-proxy`:
1. `RequestCoalescer`: deduplicación concurrente de peticiones idénticas en vuelo (Request Collapsing / Coalescing).
2. `RateLimiter`: algoritmo de ventana deslizante por IP de cliente con exención automática para peticiones resueltas desde la caché (`HIT` / `STALE`).
3. `stale-while-revalidate`: servir entradas recién caducadas de inmediato (`STALE`) con revalidación asíncrona no bloqueante en background.

## Technical Context

**Language/Version**: Node.js v18+ (CommonJS)
**Primary Dependencies**: `express` (^5.2.1), `axios` (^1.19.0), `commander` (^15.0.0)
**Storage**: En memoria para coalescer y rate-limiter + disco/RAM para `LRUCacheManager`
**Testing**: `node:test` y `node:assert` en `test/resilience.test.js`

## Constitution Check

- [x] **I. Spec-Driven & Deterministic:** Especificación formal creada en `specs/002-resilience-and-performance/spec.md`.
- [x] **II. HTTP Standards Compliance:** Cumple RFC 5861 (`stale-while-revalidate`) y directivas estándar HTTP 429 (`Retry-After`, `X-RateLimit-*`).
- [x] **III. Zero Payload Corruption:** Los buffers coalescidos se clonan de forma segura para cada cliente sin re-parseos.
- [x] **IV. Resource Boundedness:** La ventana de rate limit se purga periódicamente y las promesas del coalescer se eliminan tras resolver o fallar.
- [x] **V. Operational Observability:** Nuevas métricas en `MetricsTracker` (`staleHits`, `coalescedRequests`, `rateLimitedRequests`).

## Architecture & Components

1. **`RequestCoalescer`**:
   - Mantiene `Map<string, Promise>` con claves `METHOD:URL`.
   - Cuando llega una petición no cacheada, si ya existe una promesa activa, se acopla a ella incrementando el contador de coalesced.
   - Al resolverse o fallar, la entrada se elimina del mapa.

2. **`RateLimiter`**:
   - Estructura `Map<ip, { tokens, lastReset }>` o ventana de 60 segundos.
   - Consume 1 token solo para peticiones que requieren ir al origen (`MISS` o mutaciones).
   - `HIT` y `STALE` tienen costo 0.

3. **`stale-while-revalidate` (SWR)**:
   - Nuevo flag `--swr <segundos>` (default: 0).
   - En `LRUCacheManager.get(key)`:
     - Si `age < TTL`: `HIT` (vigente).
     - Si `TTL <= age < TTL + SWR`: `STALE` (retorna datos y dispara `revalidateInBackground(key)` si no está ya en curso).
     - Si `age >= TTL + SWR`: `EXPIRED` (pasa a revalidación condicional o MISS regular).
