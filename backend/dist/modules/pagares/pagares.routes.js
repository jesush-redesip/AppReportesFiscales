import { empresasDeSesion } from '../auth/auth.service.js';
import { PagaresError, catalogos, detalle } from './pagares.repository.js';
import { COLUMNAS_DETALLE, VISTAS, consultar, excel, excelDetalle } from './pagares.service.js';
const FECHA = { type: 'string', pattern: '^[0-9]{8}$' };
const esquemaVista = {
    querystring: {
        type: 'object',
        required: ['vista', 'desde', 'hasta'],
        properties: {
            vista: { type: 'string', enum: VISTAS },
            desde: FECHA,
            hasta: FECHA,
            series: { type: 'string', pattern: '^[A-Za-z0-9,]*$', maxLength: 300 },
            banco: { type: 'string', maxLength: 200 },
            buscar: { type: 'string', maxLength: 40 },
        },
    },
};
const esquemaDetalle = {
    querystring: {
        type: 'object',
        required: ['cod', 'corte'],
        properties: { cod: { type: 'integer' }, corte: FECHA },
    },
};
function aConsulta(q) {
    if (q.desde > q.hasta)
        throw new PagaresError('La fecha "desde" es posterior a "hasta".');
    return {
        desde: q.desde,
        hasta: q.hasta,
        series: q.series ? q.series.split(',').filter(Boolean) : undefined,
        banco: q.banco || undefined,
        buscar: q.buscar || undefined,
    };
}
async function manejar(reply, fn) {
    try {
        return await fn();
    }
    catch (err) {
        if (err instanceof PagaresError)
            return reply.status(400).send({ error: 'BadRequest', message: err.message });
        throw err;
    }
}
async function nombreEmpresa(sesion) {
    const empresas = await empresasDeSesion(sesion).catch(() => []);
    return empresas.find((e) => e.actual)?.titulo?.trim() ?? '';
}
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export default async function pagaresRoutes(fastify) {
    const base = '/api/reportes/pagares';
    fastify.get(`${base}/catalogos`, async (req, reply) => manejar(reply, () => catalogos(req.user.bd)));
    fastify.get(`${base}/consulta`, { schema: esquemaVista }, async (req, reply) => manejar(reply, () => consultar(req.user.bd, req.query.vista, aConsulta(req.query))));
    fastify.get(`${base}/detalle`, { schema: esquemaDetalle }, async (req, reply) => manejar(reply, async () => ({ ...(await detalle(req.user.bd, req.query.cod, req.query.corte)), columnas: COLUMNAS_DETALLE })));
    fastify.get(`${base}/excel`, { schema: esquemaVista }, async (req, reply) => manejar(reply, async () => {
        const buffer = await excel(req.user.bd, req.query.vista, aConsulta(req.query), await nombreEmpresa(req.user));
        return reply.header('Content-Disposition', 'attachment; filename="Pagares.xlsx"').type(XLSX).send(buffer);
    }));
    fastify.get(`${base}/detalle/excel`, { schema: esquemaDetalle }, async (req, reply) => manejar(reply, async () => {
        const buffer = await excelDetalle(req.user.bd, req.query.cod, req.query.corte, await nombreEmpresa(req.user));
        return reply.header('Content-Disposition', 'attachment; filename="Pagare.xlsx"').type(XLSX).send(buffer);
    }));
}
//# sourceMappingURL=pagares.routes.js.map