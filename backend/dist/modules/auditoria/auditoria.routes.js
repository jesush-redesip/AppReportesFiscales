import { requireSupervisor } from '../../shared/auth/permisos.js';
import { accionesRegistradas, consultarAuditoria } from '../../shared/auditoria/auditoria.js';
const fecha = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
/** Consulta del registro de auditoría: solo SUPERVISOR. */
export default async function auditoriaRoutes(fastify) {
    const soloSupervisor = { preHandler: requireSupervisor };
    fastify.get('/api/auditoria', {
        ...soloSupervisor,
        schema: {
            querystring: {
                type: 'object',
                required: ['desde', 'hasta'],
                properties: {
                    desde: fecha,
                    hasta: fecha,
                    usuario: { type: 'string', maxLength: 100 },
                    accion: { type: 'string', maxLength: 80 },
                    resultado: { type: 'string', enum: ['', 'OK', 'ERROR', 'RECHAZADO'] },
                },
            },
        },
    }, async (req) => consultarAuditoria(req.query));
    fastify.get('/api/auditoria/acciones', soloSupervisor, async () => accionesRegistradas());
}
//# sourceMappingURL=auditoria.routes.js.map