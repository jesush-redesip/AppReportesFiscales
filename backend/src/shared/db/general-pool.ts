import sql from 'mssql';
import { env } from '../../config/env.js';

/**
 * Separate pool targeting the ICG platform's shared `GENERAL` database
 * (USUARIOS/EMPRESAS/EMPRESASUSUARIO), distinct from the per-tenant report DB pool
 * in `pool.ts`. Both databases live on the same SQL Server instance, but auth and
 * report queries are kept on separate connections for now rather than relying on
 * cross-database qualified queries — simpler to reason about and to reconfigure
 * independently if auth ever moves to its own server.
 */
const config: sql.config = {
  server: env.db.host,
  port: env.db.port,
  database: env.db.generalDatabase,
  user: env.db.user,
  password: env.db.password,
  options: {
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

export const generalPool = new sql.ConnectionPool(config);
export const generalPoolConnect = generalPool.connect();

generalPoolConnect.catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to connect to GENERAL database', err);
});
