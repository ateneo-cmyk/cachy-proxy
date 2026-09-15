# Feature Specification: Offline Mode, Load Balancing, Dashboard Security and Header/Path Rewriting

**Feature Branch**: `003-offline-loadbalancing-security`

**Created**: 2026-09-15

**Status**: Ready for Implementation

**Input**: User description: "Modo Offline / Mocking (Record & Playback), Balanceo de Carga con Failover y Circuit Breaker, Autenticación en Dashboard y Reescritura/Inyección de Cabeceras y Rutas."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Modo Mock / Offline (Record & Playback) (Priority: P1)

Como desarrollador de frontend o QA, quiero grabar las respuestas reales de una API externa (`--record`) y luego ejecutar el proxy en modo desconectado (`--offline`), para poder desarrollar y correr tests sin conexión a internet o sin depender de la disponibilidad del servidor de origen.

**Why this priority**: Permite trabajo autónomo sin red y desacoplamiento de servicios externos en entornos de CI y desarrollo local.

**Independent Test**: Iniciar con `--record`, realizar peticiones para generar fixtures, apagar el origen, reiniciar con `--offline` y verificar que las peticiones devuelven `200 OK` con cabecera `X-Cache: REPLAY`.

**Acceptance Scenarios**:
1. **Given** un proxy iniciado con `--record fixtures/`, **When** se consulta `GET /products`, **Then** la respuesta se devuelve al cliente y se guarda en un archivo de fixture local.
2. **Given** fixtures grabados y el servidor de origen completamente apagado, **When** el proxy arranca con `--offline fixtures/` y se solicita `GET /products`, **Then** devuelve el contenido íntegro y la cabecera `X-Cache: REPLAY`.

---

### User Story 2 - Balanceo de Carga con Failover y Circuit Breaker (Priority: P1)

Como ingeniero de confiabilidad (SRE), quiero configurar múltiples URLs de origen (`--origin url1,url2`), distribuyendo las peticiones en Round-Robin y conmutando automáticamente al siguiente servidor si uno cae o falla, para garantizar alta disponibilidad.

**Why this priority**: Garantiza resiliencia frente a caídas de servidores backend o microservicios individuales.

**Independent Test**: Configurar `--origin http://srv1,http://srv2`, apagar `srv1` y comprobar que todas las peticiones son redirigidas a `srv2` con éxito sin que el cliente reciba errores 5xx.

**Acceptance Scenarios**:
1. **Given** 2 servidores de origen saludables, **When** llegan peticiones consecutivas, **Then** se distribuyen de forma equitativa (Round-Robin).
2. **Given** un servidor caído y otro activo, **When** el cliente envía una petición que intenta dirigirse al servidor caído, **Then** el proxy detecta el fallo, conmuta en tiempo de ejecución al servidor activo y entrega la respuesta exitosa.

---

### User Story 3 - Autenticación y Seguridad en el Dashboard (Priority: P2)

Como administrador del sistema, quiero restringir el acceso al panel visual `/__cachy` y a los endpoints de purga mediante credenciales (`--dashboard-auth usuario:clave`), para evitar que usuarios no autorizados manipulen la caché o vean estadísticas.

**Why this priority**: Protege la seguridad de los controles administrativos y la visibilidad de los datos en entornos compartidos.

**Acceptance Scenarios**:
1. **Given** un proxy con `--dashboard-auth admin:secret123`, **When** se accede a `GET /__cachy` sin cabecera de autenticación, **Then** devuelve HTTP `401 Unauthorized` con cabecera `WWW-Authenticate: Basic realm="Cachy Dashboard"`.
2. **Given** credenciales correctas en la cabecera `Authorization: Basic ...`, **When** se solicita el Dashboard o una purga por API, **Then** se autoriza el acceso con HTTP `200 OK`.

---

### User Story 4 - Transformación de Cabeceras y Reescritura de Rutas (Priority: P2)

Como desarrollador integrador, quiero inyectar cabeceras en las peticiones hacia el origen (`--set-header "Authorization: Bearer myToken"`) y reescribir rutas entrantes (`--rewrite "regex:reemplazo"`), para adaptar el tráfico a las APIs requeridas sin alterar el código de mis clientes.

**Why this priority**: Permite desacoplar contratos de URL y centralizar credenciales o tokens de autenticación en el proxy.

**Acceptance Scenarios**:
1. **Given** el flag `--set-header "X-Api-Key: secret"`, **When** el cliente envía una petición sin esa cabecera, **Then** el servidor de origen recibe la petición con `X-Api-Key: secret`.
2. **Given** el flag `--rewrite "^/legacy/(.*):/v2/$1"`, **When** el cliente solicita `GET /legacy/users`, **Then** el proxy consulta al origen `GET /v2/users`.

---

## Requirements *(mandatory)*

- **FR-001**: El proxy DEBE admitir el flag `--record [directorio]` para almacenar en disco fixtures de respuestas exitosas con su estado, cabeceras y cuerpo.
- **FR-002**: El proxy DEBE admitir el flag `--offline [directorio]` (o `--replay [directorio]`) para responder únicamente desde fixtures locales con `X-Cache: REPLAY` sin requerir conectividad hacia el origen.
- **FR-003**: El proxy DEBE admitir múltiples URLs separadas por coma en `--origin` y aplicar distribución Round-Robin.
- **FR-004**: El proxy DEBE implementar Failover automático ante fallos de conexión o respuestas 502/503/504, reintentando con el siguiente origen disponible antes de devolver error al cliente.
- **FR-005**: El proxy DEBE admitir el flag `--dashboard-auth <usuario:contraseña>` y exigir HTTP Basic Authentication para `/__cachy` y sus APIs de purga/métricas.
- **FR-006**: El proxy DEBE admitir flags `--set-header <Nombre:Valor>` e inyectar dichos encabezados en las llamadas salientes hacia el origen.
- **FR-007**: El proxy DEBE admitir flags `--rewrite <patrón:reemplazo>` para transformar la URL de la petición antes de consultar la caché o el origen.

## Success Criteria *(mandatory)*

- **SC-001**: En modo offline, el 100% de las URLs con fixtures existentes deben responder con éxito sin tráfico de red saliente.
- **SC-002**: Ante la caída de un servidor de origen en un clúster balanceado, el 0% de las peticiones del cliente deben fallar si al menos un origen está saludable.
- **SC-003**: 100% de las suites de prueba ejecutadas con `npm test` deben pasar con éxito.
