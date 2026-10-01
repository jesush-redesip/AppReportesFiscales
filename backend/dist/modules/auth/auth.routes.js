import { loginWithPassword, selectEmpresa, LoginError } from './auth.service.js';
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