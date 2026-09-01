const { Command } = require('commander');
const axios = require('axios');
const express = require('express');
const program = new Command();


program
    .option('-p, --port <number>', 'Puerto en el que escucha el proxy', '3000')
    .option('-o, --origin <url>', 'URL del servidor origen')
    .option('--clear-cache', 'Limpiar la caché al iniciar');

program.parse();

const options = program.opts();

if (!options.origin) {
    console.error('URL del servidor origen no especificada')
    process.exit(1)
}




const app = express();
app.use(express.json());
app.use(express.text());
let cache = {}

if (options.clearCache) {
    cache = {};
    console.log('🧹 Cache cleared.');
    process.exit(0);
}

app.all('*any', async (req, res) => {
    const key = `${req.method}:${req.url}`
    const originUrl = `${options.origin}${req.url}`

    if (cache[key]) {
        res.setHeader('X-cache', 'HIT');
        res.setHeader('Content-Type', cache[key].contentType);
        return res.status(cache[key].status).send(cache[key].body)
    }

    try {
        const response = await axios({
            method: req.method,
            url: originUrl,
            data: req.body,
            headers: { ...req.headers, host: new URL(options.origin).host },
            validateStatus: () => true
        })

        cache[key] = {
            status: response.status,
            headers: response.headers,
            body: response.data,
            contentType: response.headers['content-type'] || 'application/octet-stream',
        }

        res.set(response.headers)
        res.setHeader('X-cache', 'MISS');
        return res.status(response.status).send(response.data)
    } catch (err) {
        console.error(err);
        res.status(500).send('Error interno del proxy')
    }
})

app.listen(options.port, () => {
    console.log(`🚀 Proxy escuchando en el puerto ${options.port}`);
    console.log(`🎯 Redirigiendo peticiones a: ${options.origin}`);
});



console.log(options);


