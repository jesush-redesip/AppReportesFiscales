import type { FastifyInstance } from 'fastify';
import { requireSupervisor } from '../../shared/auth/permisos.js';
import { ActualizadorError, consultarEstado, iniciarActualizacion } from './actualizador.service.js';

/** Actualizaciones del aplicativo desde los Releases de GitHub. Solo el SUPERVISOR. */
export default async function actualizadorRoutes(fastify: FastifyInstance) {
  const soloSupervisor = { preHandler: requireSupervisor };

  fastify.get<{ Querystring: { forzar?: string } }>('/api/actualizador/estado', soloSupervisor, async (req) =>
    consultarEstado(req.query.forzar === '1'),
  );

  // Queda en la auditoría: "Actualización del aplicativo" (desde → hasta).
  fastify.post('/api/actualizador/actualizar', soloSupervisor, async (_req, reply) => {
    try {
      const r = await iniciarActualizacion();
      return { ok: true, ...r, cambios: [{ antes: r.desde, despues: r.hasta }] };
    } catch (err) {
      if (err instanceof ActualizadorError) return reply.status(400).send({ error: 'BadRequest', message: err.message });
      throw err;
    }
  });
}
