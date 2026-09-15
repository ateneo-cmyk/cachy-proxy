# Feature Specification: Advanced Caching Proxy Enhancements

**Feature Branch**: `001-caching-proxy-enhancements`

**Created**: 2026-09-15

**Status**: Ready for Planning

**Input**: User description: "Suite integral de mejoras: Métricas en tiempo real, cumplimiento de Cache-Control y ETag/304, desalojo LRU con límite de entradas, filtros de exclusión/inclusión, dashboard web embebido y suite de tests nativa."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Observabilidad y Gestión de Métricas en Vivo (Priority: P1)

Como operador de sistemas o desarrollador, quiero consultar estadísticas en tiempo real sobre el proxy y purgar la caché sin detener el servicio, para verificar el ahorro de ancho de banda y la tasa de aciertos de mis APIs.

**Why this priority**: Proporciona visibilidad operativa inmediata para comprobar la efectividad del proxy y permite la administración remota de la memoria de caché.

**Independent Test**: Puede probarse consultando `GET /__cachy/api/stats` y enviando `DELETE /__cachy/api/cache` para verificar el reseteo de las entradas.

**Acceptance Scenarios**:
1. **Given** un proxy en ejecución con 10 peticiones atendidas (6 aciertos y 4 fallos), **When** se consulta `GET /__cachy/api/stats`, **Then** la respuesta debe devolver un JSON con total de peticiones = 10, hits = 6, misses = 4, ratio de aciertos = 60%, y latencias medias calculadas.
2. **Given** entradas cacheadas activas, **When** se envía una petición `DELETE /__cachy/api/cache`, **Then** todas las entradas se eliminan tanto en memoria como en disco y las estadísticas se actualizan.

---

### User Story 2 - Conformidad HTTP con Cache-Control y ETag / 304 (Priority: P1)

Como consumidor de APIs, quiero que el proxy respete las directivas del servidor de origen (`no-store`, `private`, `max-age`) y utilice revalidación condicional (`ETag`, `304 Not Modified`), para nunca servir datos prohibidos y ahorrar ancho de banda renovando el tiempo de vida sin retransmitir cuerpos intactos.

**Why this priority**: Evita cachear información confidencial o sensible por error y cumple el estándar internacional de la web (RFC 9111).

**Independent Test**: Enviar una petición a un recurso con `Cache-Control: no-store` y verificar que subsiguientes peticiones nunca devuelvan `HIT`. Luego enviar un recurso con `ETag` vencido y verificar renovación ante un `304`.

**Acceptance Scenarios**:
1. **Given** una respuesta del origen con `Cache-Control: no-store`, **When** se solicita la misma URL por segunda vez, **Then** el proxy debe reenviar al origen con `X-Cache: BYPASS` (o `MISS`) sin almacenarla.
2. **Given** una respuesta del origen con `Cache-Control: max-age=120`, **When** se almacena en el proxy, **Then** el tiempo de expiración asignado es de 120 segundos independientemente del default global.
3. **Given** una entrada vencida que contiene un `ETag`, **When** el cliente la solicita, el proxy envía `If-None-Match` al origen; **If** el origen responde `304 Not Modified`, **Then** el proxy sirve el cuerpo existente con `X-Cache: REVALIDATED` y renueva su expiración.

---

### User Story 3 - Límite de Memoria y Desalojo LRU (Priority: P2)

Como administrador del sistema, quiero establecer un límite máximo de entradas (`--max-entries`) para que el proxy no agote la memoria RAM ni crezca descontroladamente en el disco.

**Why this priority**: Garantiza la estabilidad del proceso y previene caídas por falta de memoria (*Out of Memory*).

**Independent Test**: Configurar el proxy con `--max-entries 3`, consultar 4 URLs distintas y verificar que la URL menos consultada recientemente se expulse.

**Acceptance Scenarios**:
1. **Given** un proxy con `--max-entries 3` que almacena `URL_A`, `URL_B` y `URL_C`, **When** se accede de nuevo a `URL_A` y luego entra una nueva `URL_D`, **Then** `URL_B` (la menos usada) es expulsada y la caché almacena únicamente `URL_A`, `URL_C` y `URL_D`.

---

### User Story 4 - Reglas de Inclusión y Exclusión de Rutas (Priority: P2)

Como desarrollador, quiero especificar patrones de exclusión (`--exclude`) para que rutas sensibles (ej: `/auth/*`, `/checkout/*`) nunca pasen por el almacén de caché.

**Why this priority**: Protege datos sensibles y evita comportamientos inesperados en rutas transaccionales.

**Independent Test**: Iniciar con `--exclude "/auth/*,/login"`, consultar `GET /auth/session` y verificar que siempre se omita el guardado en caché.

**Acceptance Scenarios**:
1. **Given** un proxy con `--exclude "/auth/*"`, **When** se envía `GET /auth/token`, **Then** el proxy reenvía al origen devolviendo `X-Cache: BYPASS` y no guarda la respuesta.

---

### User Story 5 - Panel de Control Web Visual (Dashboard UI) (Priority: P3)

Como desarrollador visual, quiero acceder a `http://localhost:<puerto>/__cachy` en mi navegador para inspeccionar métricas con tarjetas interactivas, lista de URLs cacheadas y botones para purgar elementos individualmente.

**Why this priority**: Facilita la adopción del proyecto y simplifica la depuración durante el desarrollo local.

**Acceptance Scenarios**:
1. **Given** un navegador accediendo a `/__cachy`, **When** carga la página, **Then** se renderiza un dashboard con KPIs (Peticiones, Hit Rate %, Latencia), una tabla de URLs cacheadas con su TTL restante y un botón para purgar entradas.

---

### Edge Cases

- ¿Qué sucede si el origen responde con error 500/502/504? El proxy nunca debe cachear respuestas de error interno del origen salvo que el usuario lo habilite explícitamente.
- ¿Qué sucede si el cliente envía `Cache-Control: no-cache`? El proxy debe omitir la respuesta en caché y revalidar directamente con el origen.
- ¿Qué sucede si el archivo de disco `.cachy-cache.json` se corrompe externamente? El proxy debe capturar el error, inicializar un nuevo estado limpio e informar una advertencia sin interrumpir el servicio.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El proxy DEBE exponer un endpoint JSON en `GET /__cachy/api/stats` con métricas de peticiones, aciertos, fallos, revalidaciones, volumen transferido y tiempos de respuesta.
- **FR-002**: El proxy DEBE permitir el vaciado total de la caché mediante `DELETE /__cachy/api/cache` y la invalidación de URLs individuales mediante `DELETE /__cachy/api/cache?key=<clave>`.
- **FR-003**: El proxy DEBE evaluar las cabeceras `Cache-Control` del origen: ignorar el almacenamiento si incluye `no-store` o `private`, y adoptar `max-age=<segundos>` como TTL específico para esa ruta.
- **FR-004**: El proxy DEBE soportar revalidación condicional enviando `If-None-Match` (para `ETag`) e `If-Modified-Since` cuando un elemento haya vencido su TTL, procesando respuestas HTTP `304 Not Modified` sin volver a descargar el cuerpo.
- **FR-005**: El proxy DEBE soportar el flag `--max-entries <número>` (por defecto 500) y aplicar el algoritmo de desalojo LRU al sobrepasar la capacidad.
- **FR-006**: El proxy DEBE permitir banderas `--exclude <patrones>` e `--include <patrones>` basadas en prefijos o comodines para omitir o forzar el almacenamiento.
- **FR-007**: El proxy DEBE servir una interfaz gráfica en `GET /__cachy` con monitoreo visual y controles de purga.
- **FR-008**: El proyecto DEBE incluir una suite de pruebas ejecutable con `npm test` usando el módulo nativo `node:test` que valide todas las características anteriores.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una petición a un recurso en caché (`HIT`) debe responder en menos de 5 milisegundos en entorno local.
- **SC-002**: Las peticiones con `304 Not Modified` deben renovar la vigencia del recurso ahorrando el 100% de la transferencia de datos del cuerpo de la respuesta.
- **SC-003**: El proxy no debe superar el límite de memoria estipulado en `--max-entries` sin importar cuántas miles de URLs distintas reciba.
- **SC-004**: El comando `npm test` debe completar el 100% de las pruebas automatizadas con éxito en menos de 10 segundos.

## Assumptions

- Se mantiene compatibilidad con Node.js v18+.
- La suite de tests utiliza el módulo estándar `node:test` y `node:assert`, sin agregar dependencias pesadas adicionales a `package.json`.
- La interfaz visual del dashboard se entrega embebida de forma autónoma sin necesidad de servidores de frontend ni bundlers.
