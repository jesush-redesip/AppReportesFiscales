import { build } from './app.js';
import { env } from './config/env.js';
const fastify = await build();
fastify.listen({ port: env.port, host: '0.0.0.0' }, (err) => {
    if (err) {
        fastify.log.error(err);
        process.exit(1);
    }
});
//# sourceMappingURL=server.js.map