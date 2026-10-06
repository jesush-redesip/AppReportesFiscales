import { retencionesIslrQuerySchema } from './retenciones-islr.schema.js';
import { generarRetencionesIslr, NICE_LABELS } from './retenciones-islr.service.js';
import { getRetencionesIslr } from './retenciones-islr.repository.js';
export default async function retencionesIslrRoutes(fastify) {
    fastify.get('/api/reportes/retenciones-islr', { schema: { querystring: retencionesIslrQuerySchema } }, async (req, reply) => {
        const buffer = await generarRetencionesIslr(req.user.bd, req.query);
        return reply
            .header('Content-Disposition', `attachment; filename="RetencionesISLR_${req.query.desde}_${req.query.hasta}.xlsx"`)
            .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .send(buffer);
    });
    fastify.get('/api/reportes/retenciones-islr/preview', { schema: { querystring: retencionesIslrQuerySchema } }, async (req) => {
        const result = await getRetencionesIslr(req.user.bd, {
            desde: req.query.desde,
            hasta: req.query.hasta,
            codEmpresa: req.query.empresa,
            codSucursal: req.query.sucursal ?? '',
        });
        return {
            columns: result.columns.map((c) => NICE_LABELS[c.name] ?? c.name),
            rows: result.rows.map((r) => {
                const record = r;
                const mapped = {};
                for (const col of result.columns) {
                    mapped[NICE_LABELS[col.name] ?? col.name] = record[col.name];
                }
                return mapped;
            }),
        };
    });
}
//# sourceMappingURL=retenciones-islr.routes.js.map