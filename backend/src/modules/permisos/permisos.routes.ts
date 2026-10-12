import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { esSupervisor, requireAdminPermisos, requireSupervisor } from '../../shared/auth/permisos.js';
import { MODULO_CAJAS, MODULOS } from '../../shared/auth/modulos.js';
import {
  ActivacionError,
  estadoModulos,
  excepcionesPorEmpresa,
  guardarActivacion,
  modulosActivosEnAlguna,
} from '../../shared/auth/activacion.js';
import { generalPool, generalPoolConnect } from '../../shared/db/general-pool.js';
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

  /**
   * Módulos asignables (los activos en al menos una empresa: lo general o una excepción)
   * y si el cierre está activo en alguna.
   */
  fastify.get('/api/config/modulos', administradores, async () => {
    const activos = await modulosActivosEnAlguna();
    return { modulos: MODULOS.filter((m) => activos.has(m.id)), cajasActivo: activos.has(MODULO_CAJAS) };
  });

  /**
   * Módulos de la instalación: lo general, o con `codEmpresa` lo que vale para esa
   * empresa (con sus excepciones).
   */
  fastify.get<{ Querystring: { codEmpresa?: number } }>(
    '/api/config/modulos-activos',
    { ...soloSupervisor, schema: { querystring: { type: 'object', properties: { codEmpresa: { type: 'integer' } } } } },
    async (req) => estadoModulos(req.query.codEmpresa),
  );

  /** Empresas de la instalación, con cuántas excepciones de módulos tiene cada una. */
  fastify.get('/api/config/modulos-empresas', soloSupervisor, async () => {
    await generalPoolConnect;
    const [r, excepciones] = await Promise.all([
      generalPool.request().query('SELECT CODEMPRESA, TITULO FROM dbo.EMPRESAS ORDER BY TITULO'),
      excepcionesPorEmpresa(),
    ]);
    return r.recordset.map((f) => ({
      codEmpresa: Number(f.CODEMPRESA),
      titulo: String(f.TITULO ?? '').trim(),
      excepciones: excepciones[Number(f.CODEMPRESA)] ?? 0,
    }));
  });

  // Auditoría: "Módulos de la instalación", con los cambios (antes → después) y la empresa.
  fastify.put<{ Body: { codEmpresa?: number; items: { id: string; activo: boolean | null }[] } }>(
    '/api/config/modulos-activos',
    {
      ...soloSupervisor,
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            /** Sin empresa: lo general. Con empresa: sus excepciones (activo null = hereda). */
            codEmpresa: { type: 'integer' },
            items: {
              type: 'array',
              maxItems: 100,
              items: {
                type: 'object',
                required: ['id', 'activo'],
                properties: { id: { type: 'string', maxLength: 50 }, activo: { type: ['boolean', 'null'] } },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const cambios = await guardarActivacion(req.body.items, req.user!.usuario ?? null, req.body.codEmpresa);
        return { ok: true, codEmpresa: req.body.codEmpresa ?? null, cambios };
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
