# 🚀 Caching Proxy CLI

Un servidor proxy inverso ligero y profesional basado en **Node.js**, **Express** y **Axios** que intercepta peticiones HTTP, las reenvía a un servidor de origen y almacena las respuestas seguras en una caché inteligente (con soporte en memoria y persistencia en disco) para acelerar drásticamente peticiones subsiguientes.

Permite inspeccionar el rendimiento y estado del almacenamiento mediante cabeceras de diagnóstico (`X-Cache: HIT` / `X-Cache: MISS` / `X-Cache: BYPASS`).

---

## ✨ Características y Mejoras

* 🔄 **Soporte Completo de Métodos HTTP:**
  * Métodos seguros (`GET`, `HEAD`) se cachean de forma inteligente.
  * Métodos mutantes (`POST`, `PUT`, `DELETE`, `PATCH`) se reenvían directamente al origen (`BYPASS`) e **invalidan automáticamente la caché** de la ruta afectada.
* ⚡ **Caché con Expiración (TTL):** Configurable mediante `--ttl <segundos>`. Las entradas caducadas se purgan de forma transparente.
* 💾 **Persistencia en Disco:** Guarda la caché en `.cachy-cache.json` permitiendo que el comando `--clear-cache` funcione de manera real y desacoplada desde cualquier terminal. (Opcionalmente desactivable con `--no-persist`).
* 📦 **Soporte de Cargas Crudas y Binarios:** Permite reenviar imágenes, archivos binarios, `multipart/form-data`, JSON y texto sin corromper los payloads ni las cabeceras.
* 📊 **Logs en Tiempo Real con Latencia:** Muestra cada petición con el método, código HTTP devuelto, estado de caché y el tiempo de respuesta en milisegundos (`ms`).
* 💻 **Ejecutable CLI Global:** Preparado como binario para ejecutar con `npx` o instalar con `npm link` / `npm install -g .`.

---

## 📦 Instalación

1. Clona este repositorio o sitúate en la carpeta del proyecto:
   ```bash
   cd cachy-proxy
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. (Opcional) Enlaza el comando para usarlo globalmente en tu terminal:
   ```bash
   npm link
   ```

---

## 🚀 Uso y Configuración

Puedes iniciar el proxy utilizando `node index.js` o directamente `cachy-proxy` si ejecutaste `npm link`:

```bash
node index.js --origin <URL_DEL_ORIGEN> [opciones]
```

### Opciones Disponibles (Flags)

| Opción corto | Opción largo | Descripción | Por defecto |
| :--- | :--- | :--- | :--- |
| `-o` | `--origin <url>` | **(Obligatorio para iniciar)** URL del servidor real de origen. | *Ninguno* |
| `-p` | `--port <number>` | Puerto local en el que escuchará el servidor proxy. | `3000` |
| `-t` | `--ttl <seconds>` | Tiempo de expiración de las entradas en segundos (`0` para infinito). | `60` |
| | `--clear-cache` | Limpia el archivo de caché almacenado y finaliza el proceso inmediatamente. | *Desactivado* |
| | `--no-persist` | Desactiva el guardado en disco y usa únicamente la memoria RAM. | *Desactivado* |
| `-h` | `--help` | Muestra la ayuda interactiva con todas las opciones. | |

---

## 💡 Ejemplos Prácticos

### 1. Iniciar el proxy apuntando a una API externa
```bash
node index.js --origin https://dummyjson.com
```

### 2. Iniciar con puerto personalizado y TTL de 30 segundos
```bash
node index.js --port 8080 --origin https://dummyjson.com --ttl 30
```

### 3. Limpiar la caché desde cualquier terminal
```bash
node index.js --clear-cache
```
*(No requiere especificar `--origin`)*

### 4. Diagnóstico de respuestas (`X-Cache` y Logs)

Al realizar peticiones al proxy (`http://localhost:3000/products`):

* **Primera petición (`MISS`):**
  ```http
  X-Cache: MISS
  ```
  *Consola:* `[GET] /products -> 200 (MISS) [152ms]`

* **Segunda petición inmediata (`HIT`):**
  ```http
  X-Cache: HIT
  ```
  *Consola:* `[GET] /products -> 200 (HIT) [0ms]`

* **Petición mutante (`BYPASS` e invalidación):**
  Al hacer `POST /products`, la petición se reenvía sin cachear y purga la ruta en la caché:
  ```http
  X-Cache: BYPASS
  ```
  *Consola:* `[POST] /products -> 201 (BYPASS) [85ms]`