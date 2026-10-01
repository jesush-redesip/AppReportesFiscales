import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { TenantUnavailableError } from '../shared/db/tenant-pool.js';

/**
 * Replaces the legacy `libreriascomunes.Util.guardarError(ex, true)` pattern, which
 * showed a blocking Swing dialog and called `System.exit(0)` on any "grave" error.
 * A single request failing must never take the whole server down.
 *
 * Wrapped with `fastify-plugin` — `setErrorHandler` set inside a plain plugin only
 * applies to that plugin's own encapsulated context, not sibling-registered routes.
 */
async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled request error');

    if (error instanceof TenantUnavailableError) {
      reply.status(503).send({ error: 'TenantUnavailable', message: error.message });
      return;
    }

    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : error.name,
      message: error.message,
    });
  });
}

export default fp(errorHandlerPlugin);
