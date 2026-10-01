import { toPreviewResponse } from '../../shared/db/sp-runner.js';
import { resumenIgtfQuerySchema } from './resumen-igtf.schema.js';
import { generarResumenIgtf } from './resumen-igtf.service.js';
import { getResumenIgtf } from './resumen-igtf.repository.js';
export default async function resumenIgtfRoutes(fastify) {
    fastify.get('/api/reportes/resumen-igtf', { schema: { querystring: resumenIgtfQuerySchema } }, async (req, reply) => {
        const buffer = await generarResumenIgtf(req.user.bd, req.query);
        reply
            .header('Content-Disposition', `attachment; filename="ResumenIGTF_${req.query.desde}_${req.query.hasta}.xlsx"`)
            .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .send(buffer);
    });
    fastify.get('/api/reportes/resumen-igtf/preview', { schema: { querystring: resumenIgtfQuerySchema } }, async (req) => {
        const result = await getResumenIgtf(req.user.bd, {
            desde: req.query.desde,
            hasta: req.query.hasta,
            codEmpresa: req.query.empresa,
            codSucursal: req.query.sucursal ?? '',
        });
        return toPreviewResponse(result);
    });
}
//# sourceMappingURL=resumen-igtf.routes.js.map