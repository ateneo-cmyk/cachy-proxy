# 🚀 Caching Proxy CLI

Un servidor proxy inverso ligero basado en **Node.js**, **Express** y **Axios** que intercepta peticiones HTTP, las reenvía a un servidor de origen y almacena las respuestas en una caché en memoria para acelerar peticiones subsiguientes.

Permite inspeccionar de forma sencilla el rendimiento del almacenamiento mediante cabeceras personalizadas (`X-Cache: HIT` / `X-Cache: MISS`).

---

## ✨ Características

* 🔄 **Soporte Universal:** Captura cualquier método HTTP (`GET`, `POST`, `PUT`, `DELETE`, etc.) y cualquier jerarquía de rutas dinámicamente.
* ⚡ **Caché en Memoria:** Almacena respuestas previas asociadas de forma única por método y URL de la petición.
* 🏷️ **Cabeceras de Diagnóstico:** Inyecta la cabecera `X-Cache` para determinar el estado de la respuesta.
* 💻 **Interfaz de Línea de Comandos (CLI):** Configurable fácilmente mediante flags en la terminal gracias a `commander`.

---

## 📦 Instalación

1. Clona este repositorio en tu máquina local:
   ```bash
   git clone <URL_DE_TU_REPOSITORIO>
   cd cachy-proxy
   ```

2. Instala las dependencias necesarias:
   ```bash
   npm install
   ```

---

## 🚀 Uso y Configuración

Puedes iniciar el proxy utilizando comandos en tu terminal. El único parámetro **obligatorio** es especificar la URL del servidor de origen (`--origin`).

### Estructura del Comando
```bash
node index.js --origin <URL_DEL_ORIGEN> [opciones]
```

### Opciones Disponibles (Flags)

| Opción corto | Opción largo | Descripción | Por defecto |
| :--- | :--- | :--- | :--- |
| `-o` | `--origin <url>` | **(Obligatorio)** URL del servidor real al que se redirigen las peticiones. | *Ninguno* |
| `-p` | `--port <number>` | Puerto local en el que escuchará el servidor proxy. | `3000` |
| | `--clear-cache` | Vacía la caché del proxy y finaliza el proceso inmediatamente. | *Desactivado* |

---

## 💡 Ejemplos Prácticos

### 1. Levantar el proxy apuntando a una API externa
Si deseas redirigir todo el tráfico local hacia la API de prueba *DummyJSON* en el puerto por defecto:
```bash
node index.js --origin https://dummyjson.com
```

### 2. Cambiar el puerto local de escucha
Si deseas levantar el proxy en el puerto `8080`:
```bash
node index.js --port 8080 --origin https://dummyjson.com
```

### 3. Verificar el estado de la Caché
Al realizar peticiones a tu proxy local (ej: `http://localhost:3000/products`), podrás inspeccionar las cabeceras de respuesta (Headers):

* **Primera petición (`MISS`):** El proxy no tiene la ruta guardada. Va al origen, guarda la respuesta y devuelve:
  ```http
  X-Cache: MISS
  ```
* **Segunda petición (`HIT`):** El proxy intercepta la ruta desde la memoria instantáneamente sin tocar el servidor origen:
  ```http
  X-Cache: HIT
  ```

---

## 🛠️ Tecnologías Utilizadas

* **Node.js** (v24+)
* **Express.js** (Manejo de rutas dinámicas mediante `*any`)
* **Axios** (Cliente HTTP para reenvío al servidor origen)
* **Commander.js** (Gestión y parseo de opciones por consola)

---