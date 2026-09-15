# Implementation Plan: Advanced Caching Proxy Enhancements

**Branch**: `001-caching-proxy-enhancements` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-caching-proxy-enhancements/spec.md`

## Summary

Implementar la suite integral de mejoras para `cachy-proxy` cumpliendo con la Constitución del proyecto:
1. Rastreador de métricas y latencia en vivo (`MetricsTracker`) expuesto vía API JSON en `GET /__cachy/api/stats` y endpoints de purga en caliente (`DELETE /__cachy/api/cache`).
2. Conformidad HTTP (RFC 9111) interpretando `Cache-Control` (`no-store`, `private`, `max-age`), revalidación condicional `ETag` / `If-None-Match` e `If-Modified-Since` con soporte de respuestas `304 Not Modified`.
3. Algoritmo de desalojo LRU con límite `--max-entries` manteniendo persistencia atómica en `.cachy-cache.json`.
4. Filtros de rutas (`--exclude` e `--include`).
5. Panel de control Web visual embebido en `GET /__cachy` sin dependencias externas pesadas.
6. Suite oficial de tests con el runner nativo `node:test` en `npm test`.

## Technical Context

**Language/Version**: Node.js v18+ (CommonJS)
**Primary Dependencies**: `express` (^5.2.1), `axios` (^1.19.0), `commander` (^15.0.0)
**Storage**: JSON persistente en disco (`.cachy-cache.json`) + caché LRU en RAM
**Testing**: `node:test` y `node:assert` (nativo en Node.js, sin dependencias pesadas)
**Target Platform**: Multiplataforma (Linux, Windows, macOS)
**Project Type**: CLI / Reverse Proxy
**Performance Goals**: < 5ms en peticiones cacheadas (HIT), 0 bytes de transferencia de cuerpo en respuestas 304 (Revalidated).

## Constitution Check

- [x] **I. Spec-Driven & Deterministic:** Especificación formal creada en `specs/001-caching-proxy-enhancements/spec.md`.
- [x] **II. HTTP Standards Compliance:** Métodos seguros (`GET`/`HEAD`) cacheados, mutaciones con `BYPASS` e invalidación automática, `Cache-Control` y `ETag/304` implementados.
- [x] **III. Zero Payload Corruption:** Uso estricto de buffers crudos (`express.raw`, `arraybuffer` en axios) y filtrado de cabeceras de salto.
- [x] **IV. Resource Boundedness:** Desalojo LRU ante `--max-entries`.
- [x] **V. Operational Observability:** Endpoint de métricas en tiempo real, latencias en ms y Dashboard UI.

## Project Structure

```text
cachy-proxy/
├── .specify/
│   ├── memory/constitution.md
│   └── feature.json
├── specs/
│   └── 001-caching-proxy-enhancements/
│       ├── spec.md
│       ├── plan.md
│       ├── checklists/requirements.md
│       └── tasks.md
├── test/
│   └── proxy.test.js
├── index.js
├── package.json
└── README.md
```

## Structure Decision
Se mantiene la arquitectura limpia en `index.js` organizando internamente clases modulares de responsabilidad única:
- `MetricsTracker`: recolector de métricas de peticiones y latencia.
- `LRUCache`: estructura de datos con ordenamiento de uso reciente, TTL, serialización y límite de tamaño.
- Middleware de rutas reservadas (`/__cachy/*`): separación del dashboard y de la API administrativa respecto al tráfico reenviado al proxy.
- Reenvío al origen y lógica HTTP RFC 9111 con Axios.
