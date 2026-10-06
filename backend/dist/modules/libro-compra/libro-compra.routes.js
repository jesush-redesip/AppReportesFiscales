import { toPreviewResponse } from '../../shared/db/sp-runner.js';
import { reportConfig } from '../../shared/config/report-config.js';
import { libroCompraQuerySchema } from './libro-compra.schema.js';
import { generarLibroCompra } from './libro-compra.service.js';
import { getLibroCompra } from './libro-compra.repository.js';
export default async function libroCompraRoutes(fastify) {
    fastify.get('/api/reportes/libro-compra', { schema: { querystring: libroCompraQuerySchema } }, async (req, reply) => {
        const buffer = await generarLibroCompra(req.user.bd, req.query);
        return reply
            .header('Content-Disposition', `attachment; filename="LibroCompra_${req.query.desde}_${req.query.hasta}.xlsx"`)
            .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .send(buffer);
    });
    fastify.get('/api/reportes/libro-compra/preview', { schema: { querystring: libroCompraQuerySchema } }, async (req) => {
        const result = await getLibroCompra(req.user.bd, {
            desde: req.query.desde,
            hasta: req.query.hasta,
            codEmpresa: req.query.empresa,
            codSucursal: req.query.sucursal ?? '',
            codMoneda: req.query.moneda,
            codRetencionConcepto: reportConfig.codRetencionConcepto,
            areaEmpresas: reportConfig.areaEmpresas,
            codAlmacen: req.query.almacen ?? '',
        });
        return toPreviewResponse(result);
    });
}
//# sourceMappingURL=libro-compra.routes.js.map