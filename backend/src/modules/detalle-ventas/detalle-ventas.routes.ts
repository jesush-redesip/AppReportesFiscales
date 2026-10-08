import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  DetalleVentasError,
  buscarArticulos,
  catalogos,
  clasificacion,
  lineasTicket,
  porDia,
  porTicket,
  porTienda,
  type FiltrosVentas,
} from './detalle-ventas.repository.js';

/**
 * Detalle de Ventas. Todo bajo /api/reportes/detalle-ventas: el plugin de módulos exige
 * el módulo "detalle-ventas" activo en la instalación y asignado al usuario.
 */
interface QueryFiltros {
  desde: string;
  hasta: string;
  moneda: number;
  grupo?: string;
  promocion?: number;
  /** Referencias separadas por coma. */
  refs?: string;
  dpto?: number;
  seccion?: number;
  familia?: number;
  subfamilia?: number;
  marca?: number;
  linea?: number;
}

const FECHA = { type: 'string', pattern: '^[0-9]{8}$' } as const;
const ENTERO = { type: 'integer' } as const;
const PROPIEDADES_FILTROS = {
  desde: FECHA,
  hasta: FECHA,
  moneda: ENTERO,
  grupo: { type: 'string', pattern: '^[A-Za-z0-9]$' },
  promocion: ENTERO,
  refs: { type: 'string', maxLength: 4000 },
  dpto: ENTERO,
  seccion: ENTERO,
  familia: ENTERO,
  subfamilia: ENTERO,
  marca: ENTERO,
  linea: ENTERO,
} as const;
const esquema = (extra: Record<string, unknown> = {}, requeridos: string[] = []) => ({
  querystring: {
    type: 'object',
    required: ['desde', 'hasta', 'moneda', ...requeridos],
    properties: { ...PROPIEDADES_FILTROS, ...extra },
  },
});

function aFiltros(q: QueryFiltros): FiltrosVentas {
  if (q.desde > q.hasta) throw new DetalleVentasError('La fecha "desde" es posterior a "hasta".');
  return {
    desde: q.desde,
    hasta: q.hasta,
    moneda: q.moneda,
    grupo: q.grupo || undefined,
    promocion: q.promocion,
    referencias: q.refs ? q.refs.split(',') : undefined,
    dpto: q.dpto,
    seccion: q.seccion,
    familia: q.familia,
    subfamilia: q.subfamilia,
    marca: q.marca,
    linea: q.linea,
  };
}

async function manejar<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DetalleVentasError) return reply.status(400).send({ error: 'BadRequest', message: err.message });
    throw err;
  }
}

export default async function detalleVentasRoutes(fastify: FastifyInstance) {
  const base = '/api/reportes/detalle-ventas';

  fastify.get(`${base}/catalogos`, async (req) => catalogos(req.user!.bd));

  fastify.get<{ Querystring: { nivel: 'seccion' | 'familia' | 'subfamilia' | 'linea'; dpto?: number; seccion?: number; familia?: number; marca?: number } }>(
    `${base}/clasificacion`,
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['nivel'],
          properties: { nivel: { type: 'string', enum: ['seccion', 'familia', 'subfamilia', 'linea'] }, dpto: ENTERO, seccion: ENTERO, familia: ENTERO, marca: ENTERO },
        },
      },
    },
    async (req) => clasificacion(req.user!.bd, req.query.nivel, req.query),
  );

  fastify.get<{ Querystring: { q: string } }>(
    `${base}/articulos`,
    { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 60 } } } } },
    async (req) => buscarArticulos(req.user!.bd, req.query.q),
  );

  fastify.get<{ Querystring: QueryFiltros }>(`${base}/tiendas`, { schema: esquema() }, async (req, reply) =>
    manejar(reply, () => porTienda(req.user!.bd, aFiltros(req.query))),
  );

  fastify.get<{ Querystring: QueryFiltros & { tienda: string } }>(
    `${base}/dias`,
    { schema: esquema({ tienda: { type: 'string', minLength: 1, maxLength: 2 } }, ['tienda']) },
    async (req, reply) => manejar(reply, () => porDia(req.user!.bd, aFiltros(req.query), req.query.tienda)),
  );

  fastify.get<{ Querystring: QueryFiltros & { tienda: string; fecha: string } }>(
    `${base}/tickets`,
    { schema: esquema({ tienda: { type: 'string', minLength: 1, maxLength: 2 }, fecha: FECHA }, ['tienda', 'fecha']) },
    async (req, reply) => manejar(reply, () => porTicket(req.user!.bd, aFiltros(req.query), req.query.tienda, req.query.fecha)),
  );

  fastify.get<{ Querystring: QueryFiltros & { numSerie: string; numAlbaran: number; n: string } }>(
    `${base}/lineas`,
    {
      schema: esquema(
        { numSerie: { type: 'string', minLength: 1, maxLength: 4 }, numAlbaran: ENTERO, n: { type: 'string', minLength: 1, maxLength: 1 } },
        ['numSerie', 'numAlbaran', 'n'],
      ),
    },
    async (req, reply) =>
      manejar(reply, () =>
        lineasTicket(req.user!.bd, aFiltros(req.query), { numSerie: req.query.numSerie, numAlbaran: req.query.numAlbaran, n: req.query.n }),
      ),
  );
}
