import { toPreviewResponse } from '../../shared/db/sp-runner.js';
import { reportConfig } from '../../shared/config/report-config.js';
import { libroVentaQuerySchema } from './libro-venta.schema.js';
import { generarLibroVenta } from './libro-venta.service.js';
import { getLibroVenta } from './libro-venta.repository.js';
export default async function libroVentaRoutes(fastify) {
    fastify.get('/api/reportes/libro-venta', { schema: { querystring: libroVentaQuerySchema } }, async (req, reply) => {
        const buffer = await generarLibroVenta(req.user.bd, req.query);
        reply
            .header('Content-Disposition', `attachment; filename="LibroVenta_${req.query.desde}_${req.query.hasta}.xlsx"`)
            .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .send(buffer);
    });
    // Preview shows only the main SP (`MR_LIBRO_VENTA`) rows — the "retenciones
    // rezagadas" second dataset is appended in the Excel download but omitted here to
    // keep the preview a single, simple table.
    fastify.get('/api/reportes/libro-venta/preview', { schema: { querystring: libroVentaQuerySchema } }, async (req) => {
        const result = await getLibroVenta(req.user.bd, {
            desde: req.query.desde,
            hasta: req.query.hasta,
            codEmpresa: req.query.empresa,
            codSucursal: req.query.sucursal ?? '',
            serialImpresora: '',
            codFormaPagoRetencion: reportConfig.codFormaPagoIva,
            codMoneda: req.query.moneda,
            areaEmpresas: reportConfig.areaEmpresas,
        });
        return toPreviewResponse(result);
    });
}
//# sourceMappingURL=libro-venta.routes.js.map