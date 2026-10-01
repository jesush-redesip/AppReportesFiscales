import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { RAIZ_APP } from '../shared/app-info.js';

/**
 * Instalado como servicio (NODE_ENV=production) el backend sirve también el frontend
 * compilado (frontend/dist), así todo queda en un solo puerto y el actualizador reemplaza
 * ambos a la vez. En desarrollo no hace nada: el frontend lo sirve Vite.
 *
 * Cualquier GET que no sea /api ni un archivo existente devuelve index.html (rutas del
 * router de Vue como /cajas/configuracion).
 */
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

export default fp(async function frontendEstatico(fastify: FastifyInstance) {
  const dirDist = path.join(RAIZ_APP, 'frontend', 'dist');
  const indice = path.join(dirDist, 'index.html');
  if (!fs.existsSync(indice)) {
    fastify.log.warn(`No se encontró ${indice}: el frontend no se servirá desde el backend.`);
    return;
  }

  fastify.setNotFoundHandler((request, reply) => {
    const ruta = decodeURIComponent((request.raw.url ?? '/').split('?')[0]);
    if ((request.method !== 'GET' && request.method !== 'HEAD') || ruta.startsWith('/api/')) {
      return reply.status(404).send({ error: 'NotFound', message: `Ruta ${request.method} ${ruta} no encontrada` });
    }
    // Sin salir de frontend/dist (nada de ../).
    const archivo = path.resolve(dirDist, '.' + path.posix.normalize('/' + ruta));
    const dentro = archivo.startsWith(dirDist + path.sep);
    const existe = dentro && fs.existsSync(archivo) && fs.statSync(archivo).isFile();
    const servir = existe ? archivo : indice;
    const ext = path.extname(servir).toLowerCase();
    // index.html nunca en caché (así toma la versión nueva tras actualizar); los assets de
    // Vite llevan hash en el nombre y pueden cachearse para siempre.
    const cache = servir === indice ? 'no-cache' : ruta.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    return reply
      .header('Content-Type', TIPOS[ext] ?? 'application/octet-stream')
      .header('Cache-Control', cache)
      .send(fs.createReadStream(servir));
  });
});
