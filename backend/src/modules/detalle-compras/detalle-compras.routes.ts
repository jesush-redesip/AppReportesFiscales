import type { FastifyInstance, FastifyReply } from 'fastify';
import * as ventas from '../detalle-ventas/detalle-ventas.repository.js';
import {
  DetalleComprasError,
  lineasDocumento,
  porDocumento,
  porProveedor,
  porTienda,
  tiposDocumento,
  type FiltrosCompras,
} from './detalle-compras.repository.js';

/**
 * Detalle de Compras. Todo bajo /api/reportes/detalle-compras: el plugin de módulos exige
 * el módulo "detalle-compras" activo en la instalación y asignado al usuario.
 * Los filtros de clasificación y el buscador de artículos son los mismos del Detalle de
 * Ventas (mismas tablas de ICG).
 */
interface QueryFiltros {
  desde: string;
  hasta: string;
  moneda: number;
  /** TIPODOC separados por coma. */
  tipos?: string;
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
const PROPIEDADES = {
  desde: FECHA,
  hasta: FECHA,
  moneda: ENTERO,
  tipos: { type: 'string', pattern: '^[0-9,]*$', maxLength: 500 },
  refs: { type: 'string', maxLength: 4000 },
  dpto: ENTERO,
  seccion: ENTERO,
  familia: ENTERO,
  subfamilia: ENTERO,
  marca: ENTERO,
  linea: ENTERO,
} as const;
const esquema = (extra: Record<string, unknown> = {}, requeridos: string[] = []) => ({
  querystring: { type: 'object', required: ['desde', 'hasta', 'moneda', ...requeridos], properties: { ...PROPIEDADES, ...extra } },
});

function aFiltros(q: QueryFiltros): FiltrosCompras {
  if (q.desde > q.hasta) throw new DetalleComprasError('La fecha "desde" es posterior a "hasta".');
  return {
    desde: q.desde,
    hasta: q.hasta,
    moneda: q.moneda,
    tipos: q.tipos ? q.tipos.split(',').filter(Boolean).map(Number) : undefined,
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
    if (err instanceof DetalleComprasError) return reply.status(400).send({ error: 'BadRequest', message: err.message });
    throw err;
  }
}

export default async function detalleComprasRoutes(fastify: FastifyInstance) {
  const base = '/api/reportes/detalle-compras';

  fastify.get(`${base}/catalogos`, async (req) => {
    const [tipos, comunes] = await Promise.all([tiposDocumento(req.user!.bd), ventas.catalogos(req.user!.bd)]);
    return { tipos, departamentos: comunes.departamentos, marcas: comunes.marcas, monedaDefecto: comunes.monedaDefecto };
  });

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
    async (req) => ventas.clasificacion(req.user!.bd, req.query.nivel, req.query),
  );

  fastify.get<{ Querystring: { q: string } }>(
    `${base}/articulos`,
    { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 60 } } } } },
    async (req) => ventas.buscarArticulos(req.user!.bd, req.query.q),
  );

  fastify.get<{ Querystring: QueryFiltros }>(`${base}/tiendas`, { schema: esquema() }, async (req, reply) =>
    manejar(reply, () => porTienda(req.user!.bd, aFiltros(req.query))),
  );

  fastify.get<{ Querystring: QueryFiltros & { tienda: string } }>(
    `${base}/proveedores`,
    { schema: esquema({ tienda: { type: 'string', minLength: 1, maxLength: 2 } }, ['tienda']) },
    async (req, reply) => manejar(reply, () => porProveedor(req.user!.bd, aFiltros(req.query), req.query.tienda)),
  );

  fastify.get<{ Querystring: QueryFiltros & { tienda: string; proveedor: number } }>(
    `${base}/documentos`,
    { schema: esquema({ tienda: { type: 'string', minLength: 1, maxLength: 2 }, proveedor: ENTERO }, ['tienda', 'proveedor']) },
    async (req, reply) => manejar(reply, () => porDocumento(req.user!.bd, aFiltros(req.query), req.query.tienda, req.query.proveedor)),
  );

  fastify.get<{ Querystring: QueryFiltros & { numSerie: string; numFactura: number; n: string } }>(
    `${base}/lineas`,
    {
      schema: esquema(
        { numSerie: { type: 'string', minLength: 1, maxLength: 4 }, numFactura: ENTERO, n: { type: 'string', minLength: 1, maxLength: 1 } },
        ['numSerie', 'numFactura', 'n'],
      ),
    },
    async (req, reply) =>
      manejar(reply, () =>
        lineasDocumento(req.user!.bd, aFiltros(req.query), { numSerie: req.query.numSerie, numFactura: req.query.numFactura, n: req.query.n }),
      ),
  );
}
