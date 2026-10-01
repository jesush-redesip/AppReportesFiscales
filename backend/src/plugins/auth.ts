import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifySessionToken, type SessionTokenPayload } from '../modules/auth/auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionTokenPayload;
  }
}

const PUBLIC_PREFIXES = ['/api/auth/login', '/api/auth/select-empresa'];

/**
 * Requires a valid session JWT (issued by POST /api/auth/select-empresa, the second
 * step of the password-only login — see auth module) on every /api/* route except
 * the two login-flow endpoints themselves. Decorates `request.user` with the
 * decoded payload (codUsuario, usuario, codEmpresa, bd) so routes/services know
 * which tenant database to query without threading it through query params.
 *
 * Wrapped with `fastify-plugin` — a plain plugin's hooks are encapsulated to its own
 * context by default and would NOT apply to sibling route plugins registered in
 * app.ts otherwise.
 */
async function authPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (PUBLIC_PREFIXES.some((p) => request.url.startsWith(p))) return;

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }
    try {
      request.user = verifySessionToken(token);
    } catch {
      reply.status(401).send({ error: 'Unauthorized', message: 'Token inválido o expirado.' });
    }
  });
}

export default fp(authPlugin);
