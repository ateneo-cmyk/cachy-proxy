# Implementation Plan: Offline Mode, Load Balancing, Dashboard Security and Header/Path Rewriting

**Branch**: `003-offline-loadbalancing-security` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-offline-loadbalancing-security/spec.md`

## Summary

Implementar cuatro capacidades avanzadas:
1. `RecordPlaybackManager`: grabación y reproducción offline mediante archivos JSON de fixtures.
2. `LoadBalancer`: soporte de clúster con múltiples orígenes, distribución Round-Robin y conmutación por error (*automatic failover/retry*).
3. Middleware `dashboardAuth`: protección Basic Auth de `/__cachy` y endpoints de purga.
4. `Transformer`: inyección de cabeceras (`--set-header`) y reescritura de URLs (`--rewrite`).

## Technical Context

**Language/Version**: Node.js v18+ (CommonJS)
**Primary Dependencies**: `express` (^5.2.1), `axios` (^1.19.0), `commander` (^15.0.0)
**Storage**: Fixtures en directorio (`fixtures/`) + `.cachy-cache.json`
**Testing**: `node:test` y `node:assert` en `test/advanced.test.js`

## Constitution Check

- [x] **I. Spec-Driven & Deterministic:** Especificación creada en `specs/003-offline-loadbalancing-security/spec.md`.
- [x] **II. HTTP Standards Compliance:** Autenticación Basic Auth estándar (RFC 7617), cabeceras seguras y failover transparente.
- [x] **III. Zero Payload Corruption:** Fixtures almacenan el cuerpo en Base64 para preservar integridad binaria exacta.
- [x] **IV. Resource Boundedness:** Manejo controlado de orígenes caídos evitando bucles infinitos de reintento.
- [x] **V. Operational Observability:** Nuevas métricas y logs de origen utilizado (`ORIGIN_FAILOVER`, `REPLAY`).
