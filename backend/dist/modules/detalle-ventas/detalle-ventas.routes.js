import { DetalleVentasError, buscarArticulos, catalogos, clasificacion, lineasTicket, porDia, porTicket, porTienda, } from './detalle-ventas.repository.js';
const FECHA = { type: 'string', pattern: '^[0-9]{8}$' };
const ENTERO = { type: 'integer' };
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
};
const esquema = (extra = {}, requeridos = []) => ({
    querystring: {
        type: 'object',
        required: ['desde', 'hasta', 'moneda', ...requeridos],
        properties: { ...PROPIEDADES_FILTROS, ...extra },
    },
});
function aFiltros(q) {
    if (q.desde > q.hasta)
        throw new DetalleVentasError('La fecha "desde" es posterior a "hasta".');
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
async function manejar(reply, fn) {
    try {
        return await fn();
    }
    catch (err) {
        if (err instanceof DetalleVentasError)
            return reply.status(400).send({ error: 'BadRequest', message: err.message });
        throw err;
    }
}
export default async function detalleVentasRoutes(fastify) {
    const base = '/api/reportes/detalle-ventas';
    fastify.get(`${base}/catalogos`, async (req) => catalogos(req.user.bd));
    fastify.get(`${base}/clasificacion`, {
        schema: {
            querystring: {
                type: 'object',
                required: ['nivel'],
                properties: { nivel: { type: 'string', enum: ['seccion', 'familia', 'subfamilia', 'linea'] }, dpto: ENTERO, seccion: ENTERO, familia: ENTERO, marca: ENTERO },
            },
        },
    }, async (req) => clasificacion(req.user.bd, req.query.nivel, req.query));
    fastify.get(`${base}/articulos`, { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 60 } } } } }, async (req) => buscarArticulos(req.user.bd, req.query.q));
    fastify.get(`${base}/tiendas`, { schema: esquema() }, async (req, reply) => manejar(reply, () => porTienda(req.user.bd, aFiltros(req.query))));
    fastify.get(`${base}/dias`, { schema: esquema({ tienda: { type: 'string', minLength: 1, maxLength: 2 } }, ['tienda']) }, async (req, reply) => manejar(reply, () => porDia(req.user.bd, aFiltros(req.query), req.query.tienda)));
    fastify.get(`${base}/tickets`, { schema: esquema({ tienda: { type: 'string', minLength: 1, maxLength: 2 }, fecha: FECHA }, ['tienda', 'fecha']) }, async (req, reply) => manejar(reply, () => porTicket(req.user.bd, aFiltros(req.query), req.query.tienda, req.query.fecha)));
    fastify.get(`${base}/lineas`, {
        schema: esquema({ numSerie: { type: 'string', minLength: 1, maxLength: 4 }, numAlbaran: ENTERO, n: { type: 'string', minLength: 1, maxLength: 1 } }, ['numSerie', 'numAlbaran', 'n']),
    }, async (req, reply) => manejar(reply, () => lineasTicket(req.user.bd, aFiltros(req.query), { numSerie: req.query.numSerie, numAlbaran: req.query.numAlbaran, n: req.query.n })));
}
//# sourceMappingURL=detalle-ventas.routes.js.map