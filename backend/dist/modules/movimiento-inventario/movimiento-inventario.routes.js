import { toPreviewResponse } from '../../shared/db/sp-runner.js';
import { movimientoInventarioQuerySchema } from './movimiento-inventario.schema.js';
import { generarMovimientoInventario } from './movimiento-inventario.service.js';
import { getMovimientoInventario } from './movimiento-inventario.repository.js';
export default async function movimientoInventarioRoutes(fastify) {
    fastify.get('/api/reportes/movimiento-inventario', { schema: { querystring: movimientoInventarioQuerySchema } }, async (req, reply) => {
        const buffer = await generarMovimientoInventario(req.user.bd, req.query);
        return reply
            .header('Content-Disposition', `attachment; filename="MovimientoInventario_${req.query.desde}_${req.query.hasta}.xlsx"`)
            .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .send(buffer);
    });
    fastify.get('/api/reportes/movimiento-inventario/preview', { schema: { querystring: movimientoInventarioQuerySchema } }, async (req) => {
        const result = await getMovimientoInventario(req.user.bd, {
            desde: req.query.desde,
            hasta: req.query.hasta,
            codAlmacen: req.query.almacen,
        });
        return toPreviewResponse(result);
    });
}
//# sourceMappingURL=movimiento-inventario.routes.js.map