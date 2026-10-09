import * as ventas from '../detalle-ventas/detalle-ventas.repository.js';
import { DetalleComprasError, lineasDocumento, porDocumento, porProveedor, porTienda, tiposDocumento, } from './detalle-compras.repository.js';
const FECHA = { type: 'string', pattern: '^[0-9]{8}$' };
const ENTERO = { type: 'integer' };
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
};
const esquema = (extra = {}, requeridos = []) => ({
    querystring: { type: 'object', required: ['desde', 'hasta', 'moneda', ...requeridos], properties: { ...PROPIEDADES, ...extra } },
});
function aFiltros(q) {
    if (q.desde > q.hasta)
        throw new DetalleComprasError('La fecha "desde" es posterior a "hasta".');
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
async function manejar(reply, fn) {
    try {
        return await fn();
    }
    catch (err) {
        if (err instanceof DetalleComprasError)
            return reply.status(400).send({ error: 'BadRequest', message: err.message });
        throw err;
    }
}
export default async function detalleComprasRoutes(fastify) {
    const base = '/api/reportes/detalle-compras';
    fastify.get(`${base}/catalogos`, async (req) => {
        const [tipos, comunes] = await Promise.all([tiposDocumento(req.user.bd), ventas.catalogos(req.user.bd)]);
        return { tipos, departamentos: comunes.departamentos, marcas: comunes.marcas, monedaDefecto: comunes.monedaDefecto };
    });
    fastify.get(`${base}/clasificacion`, {
        schema: {
            querystring: {
                type: 'object',
                required: ['nivel'],
                properties: { nivel: { type: 'string', enum: ['seccion', 'familia', 'subfamilia', 'linea'] }, dpto: ENTERO, seccion: ENTERO, familia: ENTERO, marca: ENTERO },
            },
        },
    }, async (req) => ventas.clasificacion(req.user.bd, req.query.nivel, req.query));
    fastify.get(`${base}/articulos`, { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 60 } } } } }, async (req) => ventas.buscarArticulos(req.user.bd, req.query.q));
    fastify.get(`${base}/tiendas`, { schema: esquema() }, async (req, reply) => manejar(reply, () => porTienda(req.user.bd, aFiltros(req.query))));
    fastify.get(`${base}/proveedores`, { schema: esquema({ tienda: { type: 'string', minLength: 1, maxLength: 2 } }, ['tienda']) }, async (req, reply) => manejar(reply, () => porProveedor(req.user.bd, aFiltros(req.query), req.query.tienda)));
    fastify.get(`${base}/documentos`, { schema: esquema({ tienda: { type: 'string', minLength: 1, maxLength: 2 }, proveedor: ENTERO }, ['tienda', 'proveedor']) }, async (req, reply) => manejar(reply, () => porDocumento(req.user.bd, aFiltros(req.query), req.query.tienda, req.query.proveedor)));
    fastify.get(`${base}/lineas`, {
        schema: esquema({ numSerie: { type: 'string', minLength: 1, maxLength: 4 }, numFactura: ENTERO, n: { type: 'string', minLength: 1, maxLength: 1 } }, ['numSerie', 'numFactura', 'n']),
    }, async (req, reply) => manejar(reply, () => lineasDocumento(req.user.bd, aFiltros(req.query), { numSerie: req.query.numSerie, numFactura: req.query.numFactura, n: req.query.n })));
}
//# sourceMappingURL=detalle-compras.routes.js.map