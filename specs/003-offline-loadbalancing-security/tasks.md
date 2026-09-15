# Tasks: Offline Mode, Load Balancing, Dashboard Security and Header/Path Rewriting

**Input**: Design documents from `specs/003-offline-loadbalancing-security/` (`spec.md`, `plan.md`)

## Phase 1: User Story 1 - Modo Mock / Offline (Record & Playback) (Priority: P1)
- [x] T001 Implementar flags `--record [dir]` y `--offline [dir]` / `--replay [dir]`
- [x] T002 Implementar `RecordPlaybackManager` para serializar y servir fixtures con `X-Cache: REPLAY`

## Phase 2: User Story 2 - Load Balancing con Failover (Priority: P1)
- [x] T003 Permitir múltiples orígenes separados por coma en `--origin`
- [x] T004 Implementar clase `LoadBalancer` con distribución Round-Robin y conmutación automática (*failover*)

## Phase 3: User Story 3 - Autenticación y Seguridad en Dashboard (Priority: P2)
- [x] T005 Añadir flag `--dashboard-auth <user:pass>`
- [x] T006 Implementar middleware de HTTP Basic Authentication para `/__cachy` y sus APIs

## Phase 4: User Story 4 - Inyección de Cabeceras y Reescritura de Rutas (Priority: P2)
- [x] T007 Añadir flags `--set-header <Header:Valor>` y `--rewrite <patrón:reemplazo>`
- [x] T008 Aplicar reescritura de URL entrante e inyección de encabezados salientes hacia el origen

## Phase 5: Automated Testing & Polish
- [x] T009 Crear suite de pruebas en `test/advanced.test.js` cubriendo las 4 capacidades
- [x] T010 Actualizar `package.json` para ejecutar las 3 suites (`npm test`) y verificar 100% de éxito
- [x] T011 Actualizar `README.md` con la documentación completa de las nuevas funcionalidades
