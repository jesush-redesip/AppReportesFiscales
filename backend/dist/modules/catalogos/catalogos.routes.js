import * as repo from './catalogos.repository.js';
// Default matches the legacy `Util.AREA_ADMINISTRATIVA` fallback ("Z%") — should
// eventually come from the `app_config` table (see migrations) instead of a constant.
const DEFAULT_AREA = 'Z%';
export default async function catalogosRoutes(fastify) {
    fastify.get('/api/catalogos/empresas', async (req) => {
        return repo.getEmpresas(req.user.bd, req.query.area ?? DEFAULT_AREA);
    });
    fastify.get('/api/catalogos/sucursales', { schema: { querystring: { type: 'object', required: ['empresa'], properties: { empresa: { type: 'string' } } } } }, async (req) => repo.getSucursales(req.user.bd, req.query.empresa));
    fastify.get('/api/catalogos/almacenes', async (req) => repo.getAlmacenes(req.user.bd));
    fastify.get('/api/catalogos/monedas', async (req) => repo.getMonedas(req.user.bd));
    fastify.get('/api/catalogos/proveedores', async (req) => repo.getProveedores(req.user.bd));
    fastify.get('/api/catalogos/impresoras', { schema: { querystring: { type: 'object', required: ['empresa'], properties: { empresa: { type: 'string' }, sucursal: { type: 'string' }, almacen: { type: 'string' } } } } }, async (req) => repo.getImpresoras(req.user.bd, req.query.empresa, req.query.sucursal, req.query.almacen));
}
//# sourceMappingURL=catalogos.routes.js.map