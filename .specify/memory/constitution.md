# Cachy-Proxy Constitution

## Core Principles

### I. Spec-Driven & Deterministic Development
Every architectural change and feature addition begins with an unambiguous specification before implementation. Code is an executable artifact derived from the specification contract.

### II. HTTP Standards Compliance First
The proxy must adhere strictly to HTTP standards (RFC 7234, RFC 9111):
- Only safe, idempotent methods (`GET`, `HEAD`) may be served from or stored in cache by default.
- Mutating methods (`POST`, `PUT`, `DELETE`, `PATCH`) must bypass the cache and invalidate existing cache entries for the target resource.
- Origin cache directives (`Cache-Control: no-store, no-cache, max-age`, `ETag`, `Last-Modified`, 304 revalidations) take precedence over generic proxy defaults.

### III. Zero Payload Corruption & Binary Transparency
The proxy acts as a transparent forwarder:
- Request and response bodies must support raw streams/buffers without destructive JSON or UTF-8 parsing.
- Binary media (images, videos, compressed streams, archives) and arbitrary payloads (`multipart/form-data`) must pass through intact.
- Hop-by-hop headers must be safely stripped according to HTTP specifications.

### IV. Resource Boundedness & Resilience
The proxy must never crash due to memory leaks or unbounded growth:
- Cache eviction algorithms (LRU) and maximum storage limits must be strictly enforced.
- Persistence must be atomic and gracefully handle crashes, corrupted cache files, or disk failures.

### V. Operational Observability
- All proxy operations must emit structured diagnostic indicators (`X-Cache` status: `HIT`, `MISS`, `BYPASS`, `REVALIDATED`).
- Real-time performance metrics (hit rate, latency in ms, bandwidth saved) and management endpoints must be available without degrading proxy throughput.

## Technical Stack & Constraints
- Runtime: Node.js (v18+) CommonJS.
- CLI: Commander.js with POSIX/GNU flag compliance.
- HTTP Server: Express.js.
- Upstream HTTP Client: Axios with raw buffer / stream support.
- Testing: Native `node:test` and `node:assert` runner (no heavy testing frameworks required).

## Governance
This Constitution establishes the foundational architectural rules for `cachy-proxy`. Any deviations, breaking changes, or principle updates must be documented, validated against the specification, and covered by automated tests.

**Version**: 1.0.0 | **Ratified**: 2026-09-15 | **Last Amended**: 2026-09-15
