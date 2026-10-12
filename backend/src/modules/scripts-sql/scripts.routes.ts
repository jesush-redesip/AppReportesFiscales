import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireSupervisor } from '../../shared/auth/permisos.js';
import { analizarScript } from './scripts.validar.js';
import * as repo from './scripts.repository.js';

/**
 * Scripts SQL: catálogo de procedimientos por empresa, scripts oficiales, scripts
 * propios (probar / aplicar), historial y restauración. Solo el SUPERVISOR.
 */
async function manejar<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof repo.ScriptsError) return reply.status(400).send({ error: 'BadRequest', message: err.message });
    throw err;
  }
}

const ENT = { type: 'integer' } as const;
const EMPRESAS = { type: 'array', minItems: 1, maxItems: 100, items: ENT } as const;
const TEXTO = { type: 'string', minLength: 1, maxLength: 2_000_000 } as const;
const cuerpo = (properties: Record<string, unknown>, required: string[]) => ({
  body: { type: 'object', additionalProperties: false, required, properties },
});

export default async function scriptsRoutes(fastify: FastifyInstance) {
  const base = '/api/scripts';
  const s = { preHandler: requireSupervisor };
  const usuario = (u: { usuario?: string } | undefined) => u?.usuario ?? 'SUPERVISOR';

  fastify.get(`${base}/empresas`, s, async () => repo.empresas());

  fastify.get<{ Querystring: { codEmpresa: number } }>(
    `${base}/catalogo`,
    { ...s, schema: { querystring: { type: 'object', required: ['codEmpresa'], properties: { codEmpresa: ENT } } } },
    async (req, reply) => manejar(reply, async () => repo.catalogo(await repo.bdDeEmpresa(req.query.codEmpresa))),
  );

  fastify.get<{ Querystring: { codEmpresa: number; nombre: string } }>(
    `${base}/definicion`,
    {
      ...s,
      schema: { querystring: { type: 'object', required: ['codEmpresa', 'nombre'], properties: { codEmpresa: ENT, nombre: { type: 'string', maxLength: 260 } } } },
    },
    async (req, reply) => manejar(reply, async () => repo.definicion(await repo.bdDeEmpresa(req.query.codEmpresa), req.query.nombre)),
  );

  /** Valida un script sin ejecutarlo: lotes, objetos que toca y errores. */
  fastify.post<{ Body: { texto: string } }>(`${base}/analizar`, { ...s, schema: cuerpo({ texto: TEXTO }, ['texto']) }, async (req) => {
    const a = analizarScript(req.body.texto);
    return { ok: a.ok, errores: a.errores, lotes: a.lotes.length, objetos: a.objetos };
  });

  /** Prueba (revierte) o aplica un script propio en una o varias empresas. */
  for (const accion of ['probar', 'aplicar'] as const) {
    fastify.post<{ Body: { texto: string; nombre?: string; codEmpresas: number[] } }>(
      `${base}/${accion}`,
      { ...s, schema: cuerpo({ texto: TEXTO, nombre: { type: 'string', maxLength: 260 }, codEmpresas: EMPRESAS }, ['texto', 'codEmpresas']) },
      async (req, reply) =>
        manejar(reply, async () => {
          const todas = await repo.empresas();
          const resultados = [];
          for (const cod of [...new Set(req.body.codEmpresas)]) {
            const e = todas.find((x) => x.codEmpresa === cod);
            try {
              // eslint-disable-next-line no-await-in-loop
              const bd = await repo.bdDeEmpresa(cod);
              // eslint-disable-next-line no-await-in-loop
              const r = await repo.scriptPropio(bd, req.body.texto, req.body.nombre ?? '', usuario(req.user), accion === 'probar');
              resultados.push({ codEmpresa: cod, empresa: e?.titulo ?? String(cod), ...r });
            } catch (err) {
              resultados.push({ codEmpresa: cod, empresa: e?.titulo ?? String(cod), ok: false, mensaje: err instanceof Error ? err.message : String(err), idScript: null, objetos: [] });
            }
          }
          return { ok: resultados.every((r) => r.ok), resultados };
        }),
    );
  }

  /** Instala el script oficial de un objeto en una o varias empresas. */
  fastify.post<{ Body: { nombre: string; codEmpresas: number[] } }>(
    `${base}/instalar-oficial`,
    { ...s, schema: cuerpo({ nombre: { type: 'string', maxLength: 260 }, codEmpresas: EMPRESAS }, ['nombre', 'codEmpresas']) },
    async (req, reply) =>
      manejar(reply, async () => {
        const todas = await repo.empresas();
        const resultados = [];
        for (const cod of [...new Set(req.body.codEmpresas)]) {
          const e = todas.find((x) => x.codEmpresa === cod);
          try {
            // eslint-disable-next-line no-await-in-loop
            const r = await repo.instalarOficial(await repo.bdDeEmpresa(cod), req.body.nombre, usuario(req.user));
            resultados.push({ codEmpresa: cod, empresa: e?.titulo ?? String(cod), ...r });
          } catch (err) {
            resultados.push({ codEmpresa: cod, empresa: e?.titulo ?? String(cod), ok: false, mensaje: err instanceof Error ? err.message : String(err), idScript: null, objetos: [] });
          }
        }
        return { ok: resultados.every((r) => r.ok), resultados };
      }),
  );

  fastify.get<{ Querystring: { codEmpresa: number } }>(
    `${base}/historial`,
    { ...s, schema: { querystring: { type: 'object', required: ['codEmpresa'], properties: { codEmpresa: ENT } } } },
    async (req, reply) => manejar(reply, async () => repo.historial(await repo.bdDeEmpresa(req.query.codEmpresa))),
  );

  fastify.get<{ Querystring: { codEmpresa: number; id: number } }>(
    `${base}/texto`,
    { ...s, schema: { querystring: { type: 'object', required: ['codEmpresa', 'id'], properties: { codEmpresa: ENT, id: ENT } } } },
    async (req, reply) => manejar(reply, async () => ({ texto: await repo.textoScript(await repo.bdDeEmpresa(req.query.codEmpresa), req.query.id) })),
  );

  fastify.post<{ Body: { codEmpresa: number; idRespaldo: number } }>(
    `${base}/restaurar`,
    { ...s, schema: cuerpo({ codEmpresa: ENT, idRespaldo: ENT }, ['codEmpresa', 'idRespaldo']) },
    async (req, reply) =>
      manejar(reply, async () => repo.restaurar(await repo.bdDeEmpresa(req.body.codEmpresa), req.body.idRespaldo, usuario(req.user))),
  );
}
