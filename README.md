# 🚀 Caching Proxy CLI

Un servidor proxy inverso de alto rendimiento basado en **Node.js**, **Express** y **Axios**, desarrollado bajo la metodología **Spec-Driven Development ([GitHub Spec Kit](https://github.com/github/spec-kit))**.

Intercepta peticiones HTTP, las reenvía al origen y gestiona una caché inteligente con soporte de **revalidación condicional (ETag / 304)**, **cumplimiento de `Cache-Control` (RFC 9111)**, **desalojo LRU**, **panel de control Web interactivo** y **métricas en vivo**.

---

## ✨ Características Principales

* 🔄 **Conformidad HTTP Estricta (RFC 9111):**
  * Métodos seguros (`GET`, `HEAD`) son evaluados para caché.
  * Mutaciones (`POST`, `PUT`, `DELETE`, `PATCH`) se reenvían al origen (`BYPASS`) e invalidan automáticamente la ruta afectada.
  * Respeta directivas del origen: `Cache-Control: no-store, private` nunca se cachean, y `max-age=N` prevalece sobre el TTL por defecto.
  * **Revalidación 304:** Cuando una entrada vence pero contiene `ETag` o `Last-Modified`, el proxy consulta con `If-None-Match`/`If-Modified-Since`. Si el origen responde `304 Not Modified`, el proxy renueva su vigencia sirviendo el contenido existente con cabecera `X-Cache: REVALIDATED` sin retransferir datos.
* 🛡️ **Límite de Memoria y Desalojo LRU (Least Recently Used):**
  * Configurable mediante `--max-entries <número>`. Al superarse el límite, las entradas menos consultadas se purgan de inmediato.
* 🔀 **Filtros de Rutas (`--exclude` e `--include`):**
  * Omitir rutas sensibles mediante patrones comodín (ej: `--exclude "/auth/*,/checkout/*"`).
* 📊 **Métricas en Tiempo Real:**
  * Conteo de peticiones, aciertos, fallos, revalidaciones, ratio de aciertos (*Hit Rate %*) y cálculo de latencia media en ms.
  * API JSON: `GET /__cachy/api/stats` y `GET /__cachy/api/entries`.
  * Purga remota: `DELETE /__cachy/api/cache` (vaciado total) o `DELETE /__cachy/api/cache?key=<clave>` (purga individual).
* 🎛️ **Dashboard Web Visual Embebido:**
  * Interfaz moderna accesible directamente en `http://localhost:<puerto>/__cachy` con tarjetas KPI, tabla de claves cacheadas y botones de purga con un clic.
* 💾 **Persistencia Híbrida:**
  * Almacena las entradas en `.cachy-cache.json` para que el comando `--clear-cache` funcione de forma desacoplada entre terminales. (Desactivable con `--no-persist`).
* 📦 **Soporte de Cargas Crudas y Binarios:**
  * Traspaso íntegro de buffers, imágenes, streams, JSON y `multipart/form-data`.
* 🧪 **Suite de Pruebas Automatizadas:**
  * Pruebas oficiales ejecutables con `npm test` basadas en el runner nativo `node:test`.

---

## 📦 Instalación

1. Clona este repositorio:
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd cachy-proxy
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. (Opcional) Instala o enlaza el comando de forma global:
   ```bash
   npm link
   ```

---

## 🚀 Uso y Configuración

Ejecuta el proxy mediante `node index.js` (o `cachy-proxy` si hiciste `npm link`):

```bash
node index.js --origin <URL_DEL_ORIGEN> [opciones]
```

### Opciones Disponibles (Flags)

| Flag corto | Flag largo | Descripción | Por defecto |
| :--- | :--- | :--- | :--- |
| `-o` | `--origin <url>` | **(Obligatorio para iniciar)** URL del servidor real de origen. | *Ninguno* |
| `-p` | `--port <number>` | Puerto local en el que escuchará el servidor proxy. | `3000` |
| `-t` | `--ttl <seconds>` | Tiempo de expiración por defecto en segundos (`0` para infinito). | `60` |
| `-m` | `--max-entries <n>`| Número máximo de entradas antes de aplicar desalojo LRU. | `500` |
| | `--exclude <patrones>` | Rutas a excluir de caché separadas por coma (ej: `/auth/*,/login`). | *Ninguno* |
| | `--include <patrones>` | Rutas exclusivas a cachear separadas por coma. | *Ninguno* |
| | `--clear-cache` | Limpia el archivo de caché almacenado y sale inmediatamente. | *Desactivado* |
| | `--no-persist` | Desactiva el guardado en disco y opera solo en memoria RAM. | *Desactivado* |
| `-h` | `--help` | Muestra la ayuda de la línea de comandos con todas las opciones. | |

---

## 💡 Ejemplos Prácticos

### 1. Iniciar con Dashboard y Límite de 100 Entradas
```bash
node index.js --origin https://dummyjson.com --port 3000 --max-entries 100
```
Visita en tu navegador: **`http://localhost:3000/__cachy`** para monitorear el proxy en vivo.

### 2. Iniciar con Rutas Sensibles Excluidas
```bash
node index.js --origin https://dummyjson.com --exclude "/auth/*,/users/add"
```

### 3. Limpiar la Caché desde la Terminal
```bash
node index.js --clear-cache
```

---

## 🧪 Pruebas Automatizadas

El proyecto cuenta con una suite completa de pruebas de integración usando el runner nativo de Node.js:

```bash
npm test
```

Valida automáticamente:
* Flujos básicos `HIT` y `MISS`.
* Bypass e invalidación de caché ante métodos `POST`.
* Cumplimiento de `Cache-Control: no-store`.
* Revalidación condicional `ETag` y respuestas `304 Not Modified`.
* Desalojo de memoria bajo algoritmo LRU.
* Filtros `--exclude`.
* Endpoints de métricas y purga en caliente.

---

## 📐 Metodología Spec Kit

Este proyecto sigue la metodología **Spec-Driven Development** de [GitHub Spec Kit](https://github.com/github/spec-kit):
* Constitución del proyecto: [.specify/memory/constitution.md](.specify/memory/constitution.md)
* Especificación formal: [specs/001-caching-proxy-enhancements/spec.md](specs/001-caching-proxy-enhancements/spec.md)
* Plan técnico de implementación: [specs/001-caching-proxy-enhancements/plan.md](specs/001-caching-proxy-enhancements/plan.md)
* Tareas de entrega por historias de usuario: [specs/001-caching-proxy-enhancements/tasks.md](specs/001-caching-proxy-enhancements/tasks.md)