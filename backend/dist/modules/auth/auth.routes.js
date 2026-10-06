import { cambiarEmpresa, empresasDeSesion, loginWithPassword, selectEmpresa, LoginError } from './auth.service.js';
import { accesoEfectivo } from '../../shared/auth/permisos.js';
const loginBodySchema = {
    type: 'object',
    required: ['password'],
    properties: {
        password: { type: 'string', minLength: 1 },
    },
};
const selectEmpresaBodySchema = {
    type: 'object',
    required: ['preAuthToken', 'codEmpresa'],
    properties: {
        preAuthToken: { type: 'string', minLength: 1 },
        codEmpresa: { type: 'integer' },
    },
};
export default async function authRoutes(fastify) {
    /**
     * Acceso actual del usuario de la sesión (permisos, módulos, supervisor interno). El
     * frontend lo pide al abrir y tras cambiar permisos o módulos activos: así el menú no
     * queda con lo que había al iniciar sesión.
     */
    fastify.get('/api/auth/acceso', async (req) => accesoEfectivo(req.user.codUsuario));
    /** Empresas del usuario, para el menú de cambio de empresa del encabezado. */
    fastify.get('/api/auth/empresas', async (req) => empresasDeSesion(req.user));
    // Auditoría: "Cambio de empresa" (de la empresa de la sesión a la elegida).
    fastify.post('/api/auth/cambiar-empresa', { schema: { body: { type: 'object', required: ['codEmpresa'], properties: { codEmpresa: { type: 'integer' } } } } }, async (req, reply) => {
        try {
            return await cambiarEmpresa(req.user, req.body.codEmpresa);
        }
        catch (err) {
            if (err instanceof LoginError)
                return reply.status(403).send({ error: 'Forbidden', message: err.message });
            throw err;
        }
    });
    fastify.post('/api/auth/login', { schema: { body: loginBodySchema } }, async (req, reply) => {
        try {
            return await loginWithPassword(req.body.password);
        }
        catch (err) {
            if (err instanceof LoginError) {
                return reply.status(401).send({ error: 'Unauthorized', message: err.message });
            }
            throw err;
        }
    });
    fastify.post('/api/auth/select-empresa', { schema: { body: selectEmpresaBodySchema } }, async (req, reply) => {
        try {
            return await selectEmpresa(req.body.preAuthToken, req.body.codEmpresa);
        }
        catch (err) {
            if (err instanceof LoginError) {
                return reply.status(401).send({ error: 'Unauthorized', message: err.message });
            }
            throw err;
        }
    });
}
//# sourceMappingURL=auth.routes.js.map