import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { esModuloReporte } from '../shared/auth/modulos.js';
import { getModulosUsuario } from '../shared/auth/permisos.js';

const PREFIJO = '/api/reportes/';

/**
 * Deriva el módulo del path: `/api/reportes/libro-venta/preview` -> `libro-venta`.
 * Devuelve null si la ruta no es de un reporte.
 */
function moduloDeLaUrl(url: string): string | null {
  if (!url.startsWith(PREFIJO)) return null;
  const resto = url.slice(PREFIJO.length);
  const id = resto.split(/[/?]/)[0];
  return id || null;
}

/**
 * Exige el permiso de módulo en TODA ruta `/api/reportes/*`, en vez de recordar
 * agregar un preHandler en cada archivo de rutas (son 2 por reporte y es exactamente
 * el tipo de cosa que se olvida al sumar un reporte nuevo — y olvidarla significa un
 * reporte accesible por URL directa aunque el menú lo esconda).
 *
 * Un id que no esté en el catálogo de módulos se rechaza en vez de dejarse pasar: si
 * aparece un reporte nuevo sin registrar, falla de forma visible y segura durante el
 * desarrollo, no queda abierto en producción.
 *
 * Se engancha en `preHandler` y no en `onRequest` para correr después del plugin de
 * auth, que es el que decora `request.user`.
 */
async function modulosPlugin(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const modulo = moduloDeLaUrl(request.url);
    if (!modulo) return;

    const codUsuario = request.user?.codUsuario;
    if (codUsuario == null) return; // el plugin de auth ya respondió 401
    // Sin excepción para el SUPERVISOR: también respeta los módulos que tenga asignados.

    if (!esModuloReporte(modulo)) {
      reply.status(403).send({
        error: 'Forbidden',
        message: `El módulo "${modulo}" no está registrado en el catálogo de permisos.`,
      });
      return;
    }

    const modulos = await getModulosUsuario(codUsuario);
    if (!modulos.includes(modulo)) {
      reply.status(403).send({ error: 'Forbidden', message: 'No tiene acceso a este módulo.' });
    }
  });
}

export default fp(modulosPlugin);
