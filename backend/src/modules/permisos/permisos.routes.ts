import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { esSupervisor, requireAdminPermisos, requireSupervisor } from '../../shared/auth/permisos.js';
import { MODULO_CAJAS, MODULOS } from '../../shared/auth/modulos.js';
import { ActivacionError, estadoModulos, guardarActivacion, modulosActivos } from '../../shared/auth/activacion.js';
import { updatePermisosBodySchema, type UpdatePermisosBody } from './permisos.schema.js';
import {
  listUsuariosConPermisos,
  updatePermisos,
  ModuloInvalidoError,
  PermisoDenegadoError,
  type Administrador,
} from './permisos.repository.js';

const administrador = (req: FastifyRequest): Administrador => ({
  codUsuario: req.user!.codUsuario,
  esSupervisor: esSupervisor(req.user!.codUsuario),
});

/**
 * Administración de permisos: el SUPERVISOR (la consultora) y los supervisores internos
 * del cliente, tanto leer como escribir. Lo que el interno no puede hacer (ver o tocar al
 * SUPERVISOR, nombrar supervisores internos) lo controla el repositorio.
 *
 * Los módulos activos de la instalación son solo del SUPERVISOR.
 */
export default async function permisosRoutes(fastify: FastifyInstance) {
  const soloSupervisor = { preHandler: requireSupervisor };
  const administradores = { preHandler: requireAdminPermisos };

  fastify.get('/api/config/permisos', administradores, async (req) => listUsuariosConPermisos(administrador(req)));

  /** Módulos asignables (solo los activos en la instalación) y si el cierre está activo. */
  fastify.get('/api/config/modulos', administradores, async () => {
    const activos = await modulosActivos();
    return { modulos: MODULOS.filter((m) => activos.has(m.id)), cajasActivo: activos.has(MODULO_CAJAS) };
  });

  /** Módulos de la instalación (grupo económico): qué existe en este cliente. */
  fastify.get('/api/config/modulos-activos', soloSupervisor, async () => estadoModulos());

  // Auditoría: "Módulos de la instalación", con los cambios (antes → después).
  fastify.put<{ Body: { items: { id: string; activo: boolean }[] } }>(
    '/api/config/modulos-activos',
    {
      ...soloSupervisor,
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              maxItems: 100,
              items: {
                type: 'object',
                required: ['id', 'activo'],
                properties: { id: { type: 'string', maxLength: 50 }, activo: { type: 'boolean' } },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const cambios = await guardarActivacion(req.body.items, req.user!.usuario ?? null);
        return { ok: true, cambios };
      } catch (err) {
        if (err instanceof ActivacionError) return reply.status(400).send({ error: 'BadRequest', message: err.message });
        throw err;
      }
    },
  );

  fastify.put<{ Body: UpdatePermisosBody }>(
    '/api/config/permisos',
    { ...administradores, schema: { body: updatePermisosBodySchema } },
    async (req, reply) => {
      try {
        await updatePermisos(req.body.items, administrador(req));
        return { ok: true };
      } catch (err) {
        if (err instanceof ModuloInvalidoError) {
          return reply.status(400).send({ error: 'BadRequest', message: err.message });
        }
        if (err instanceof PermisoDenegadoError) {
          return reply.status(403).send({ error: 'Forbidden', message: err.message });
        }
        throw err;
      }
    },
  );
}
