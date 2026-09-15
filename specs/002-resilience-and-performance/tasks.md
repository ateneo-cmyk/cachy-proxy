# Tasks: Rate Limiting, Request Collapsing and SWR

**Input**: Design documents from `specs/002-resilience-and-performance/` (`spec.md`, `plan.md`)

## Phase 1: Setup & Métricas
- [x] T001 Actualizar `MetricsTracker` en `index.js` para contabilizar `staleHits`, `coalescedRequests` y `rateLimitedRequests`
- [x] T002 Actualizar el dashboard `/__cachy` y `/__cachy/api/stats` con las nuevas métricas

## Phase 2: User Story 1 - Request Collapsing (Priority: P1)
- [x] T003 Implementar clase `RequestCoalescer` en `index.js` gestionando `Map<string, Promise>`
- [x] T004 Integrar el coalescer en el handler principal del proxy para colapsar peticiones concurrentes

## Phase 3: User Story 2 - Throttling y Rate Limiting Inteligente (Priority: P1)
- [x] T005 Implementar clase `RateLimiter` en `index.js` con flags `-r, --rate-limit <req/min>`
- [x] T006 Eximir del consumo de rate limit a las peticiones resueltas como `HIT` o `STALE`
- [x] T007 Emitir respuestas `429 Too Many Requests` con cabeceras `Retry-After` y `X-RateLimit-*`

## Phase 4: User Story 3 - Stale-While-Revalidate (RFC 5861) (Priority: P2)
- [x] T008 Añadir flag `--swr <seconds>` y detección de directiva `stale-while-revalidate` en `Cache-Control`
- [x] T009 Extender `LRUCacheManager` para devolver estado `STALE` y disparar revalidación asíncrona no bloqueante en background

## Phase 5: Automated Testing & Polish
- [x] T010 Implementar suite de tests en `test/resilience.test.js` (probando 50 peticiones simultáneas, rate limiting 429 y SWR)
- [x] T011 Ejecutar `npm test` y verificar 100% de éxito en ambas suites de pruebas
- [x] T012 Actualizar `README.md` con los nuevos flags y casos de uso
