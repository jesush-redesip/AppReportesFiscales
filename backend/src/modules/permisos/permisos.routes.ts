import type { FastifyInstance } from 'fastify';
import { requireSupervisor } from '../../shared/auth/permisos.js';
import { MODULOS } from '../../shared/auth/modulos.js';
import { updatePermisosBodySchema, type UpdatePermisosBody } from './permisos.schema.js';
import { listUsuariosConPermisos, updatePermisos, ModuloInvalidoError } from './permisos.repository.js';

/**
 * Administración de permisos: reservada al SUPERVISOR, tanto leer como escribir. Ver
 * qué puede hacer cada usuario también es información de administración, así que el
 * listado va detrás del mismo gate — el frontend además esconde la pestaña, pero eso
 * es solo presentación.
 */
export default async function permisosRoutes(fastify: FastifyInstance) {
  const soloSupervisor = { preHandler: requireSupervisor };

  fastify.get('/api/config/permisos', soloSupervisor, async () => listUsuariosConPermisos());

  /** Catálogo de módulos asignables, para que la ventana de configuración lo pinte. */
  fastify.get('/api/config/modulos', soloSupervisor, async () => MODULOS);

  fastify.put<{ Body: UpdatePermisosBody }>(
    '/api/config/permisos',
    { ...soloSupervisor, schema: { body: updatePermisosBodySchema } },
    async (req, reply) => {
      try {
        await updatePermisos(req.body.items);
        return { ok: true };
      } catch (err) {
        if (err instanceof ModuloInvalidoError) {
          return reply.status(400).send({ error: 'BadRequest', message: err.message });
        }
        throw err;
      }
    },
  );
}
