import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  contextoPeticion,
  estaDebugActivo,
  eventosDesde,
  instrumentarMssql,
  limpiarEventos,
  recortarRespuesta,
  redactar,
  registrarEvento,
  setDebugActivo,
} from '../shared/debug/debug.js';
import { requireSupervisor } from '../shared/auth/permisos.js';

declare module 'fastify' {
  interface FastifyRequest {
    debugInicio?: number;
    debugRespuesta?: string | null;
  }
}

/** Las propias consultas del panel no se registran: lo inundarían cada segundo. */
const RUTAS_DEBUG = '/api/debug/';

/** Solo la API: instalado como servicio, el backend sirve también los archivos del frontend. */
const noSeRegistra = (url: string) => !url.startsWith('/api/') || url.startsWith(RUTAS_DEBUG);

/**
 * Modo debug (ver `shared/debug/debug.ts`): siempre instalado, pero solo registra
 * mientras está activo. El SUPERVISOR lo enciende y apaga desde el botón del header.
 * Se registra antes que el plugin de auth para que el contexto de la petición exista
 * cuando corran las consultas de login. Las rutas /api/debug/* son solo del SUPERVISOR:
 * el panel muestra consultas y datos de todos los usuarios.
 */
async function debugPlugin(fastify: FastifyInstance) {
  instrumentarMssql();
  if (estaDebugActivo()) {
    fastify.log.warn('MODO DEBUG ACTIVO — se registran todas las consultas SQL y llamadas a la API (logs/debug-*.log)');
  }

  // `run(..., done)` (y no `enterWith`) para que el handler y todo lo que llame
  // hereden el contexto: así cada consulta SQL queda asociada a su petición.
  fastify.addHook('onRequest', (request, _reply, done) => {
    request.debugInicio = Date.now();
    contextoPeticion.run({ reqId: String(request.id) }, done);
  });

  fastify.addHook('onSend', async (request, _reply, payload) => {
    if (estaDebugActivo() && !noSeRegistra(request.url)) request.debugRespuesta = recortarRespuesta(payload);
    return payload;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (!estaDebugActivo() || noSeRegistra(request.url) || request.method === 'OPTIONS') return;
    const estado = reply.statusCode;
    registrarEvento({
      tipo: 'api',
      reqId: String(request.id),
      metodo: request.method,
      url: request.url,
      estado,
      ms: Date.now() - (request.debugInicio ?? Date.now()),
      usuario: request.user?.usuario ?? null,
      bd: request.user?.bd ?? null,
      cuerpo: request.body === undefined ? null : redactar(request.body),
      respuesta: request.debugRespuesta ?? null,
      error: estado >= 400 ? extraerMensaje(request.debugRespuesta) : null,
    });
  });

  const soloSupervisor = { preHandler: requireSupervisor };

  fastify.get('/api/debug/estado', soloSupervisor, async () => ({ debug: estaDebugActivo() }));

  // El cambio queda en la auditoría (plugins/auditoria.ts: "Modo debug activado/desactivado").
  fastify.post<{ Body: { activo: boolean } }>(
    '/api/debug/estado',
    {
      ...soloSupervisor,
      schema: { body: { type: 'object', required: ['activo'], properties: { activo: { type: 'boolean' } } } },
    },
    async (request) => {
      setDebugActivo(request.body.activo);
      return { debug: estaDebugActivo() };
    },
  );

  fastify.get<{ Querystring: { desde?: string } }>('/api/debug/eventos', soloSupervisor, async (request) =>
    eventosDesde(Number(request.query.desde ?? 0) || 0),
  );

  fastify.delete('/api/debug/eventos', soloSupervisor, async () => {
    limpiarEventos();
    return { ok: true };
  });
}

function extraerMensaje(respuesta: string | null | undefined): string {
  if (!respuesta) return 'Error';
  try {
    const cuerpo = JSON.parse(respuesta) as { message?: string; error?: string };
    return cuerpo.message ?? cuerpo.error ?? respuesta;
  } catch {
    return respuesta;
  }
}

export default fp(debugPlugin);
