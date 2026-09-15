# Tasks: Advanced Caching Proxy Enhancements

**Input**: Design documents from `specs/001-caching-proxy-enhancements/` (`spec.md`, `plan.md`)

## Phase 1: Setup & Foundational Infrastructure

- [x] T001 Initialize Spec Kit infrastructure (`.specify/memory/constitution.md`, `specs/001-caching-proxy-enhancements/`)
- [ ] T002 Update `package.json` with `"test": "node --test"` script
- [ ] T003 Implement `MetricsTracker` class in `index.js` to record hits, misses, bypasses, revalidations, bytes, and latencies

## Phase 2: User Story 1 - Observabilidad y Gestión de Métricas (Priority: P1)

- [ ] T004 Implement `GET /__cachy/api/stats` endpoint in `index.js` returning JSON metrics
- [ ] T005 Implement `DELETE /__cachy/api/cache` endpoint in `index.js` for full or key-specific cache purging

## Phase 3: User Story 2 - Conformidad HTTP con Cache-Control y ETag/304 (Priority: P1)

- [ ] T006 Parse origin `Cache-Control` header in `index.js` to honor `no-store`, `private`, and specific `max-age` values
- [ ] T007 Implement conditional revalidation using `If-None-Match` (`ETag`) and `If-Modified-Since` for expired cache entries in `index.js`
- [ ] T008 Handle `304 Not Modified` responses by refreshing TTL and serving existing cached body with `X-Cache: REVALIDATED`

## Phase 4: User Story 3 & 4 - LRU Eviction & Path Filtering (Priority: P2)

- [ ] T009 Implement `LRUCache` eviction in `index.js` with `--max-entries <n>` flag
- [ ] T010 Implement `--exclude <patterns>` and `--include <patterns>` routing filter in `index.js`

## Phase 5: User Story 5 - Panel de Control Web Visual (Priority: P3)

- [ ] T011 Serve interactive embedded Dashboard at `GET /__cachy` in `index.js` displaying live KPIs, cached entries, and purge buttons

## Phase 6: Automated Test Suite & Polish

- [ ] T012 Implement test suite in `test/proxy.test.js` covering HIT/MISS, Cache-Control, ETag/304 revalidation, LRU eviction, and exclusion filters
- [ ] T013 Update `README.md` with new flags, HTTP conformance details, and dashboard instructions
