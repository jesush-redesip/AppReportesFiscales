import sql from 'mssql';
import { env } from '../../config/env.js';
import type { SpColumnMeta, SpParam, SpResult } from './sp-runner.js';

/**
 * One connection pool per tenant database, created lazily and cached — mirrors the
 * legacy desktop app's model where `Login.BASEDEDATOS` (the `bd` extracted from
 * `GENERAL.dbo.EMPRESAS.PATHBD`) determines which database subsequent queries hit,
 * chosen by the user after password verification (see auth module). All tenant DBs
 * live on the same SQL Server instance, so only `database` changes between pools.
 */
const poolsByDatabase = new Map<string, sql.ConnectionPool>();

/**
 * Some stored procedures select the same column name twice (e.g. `rip.MR_LIBRO_COMPRA`
 * selects `FECHA` once for the invoice date and again — with a different value — for a
 * second date field; `rip.MR_LIBRO_VENTA_AGRUPADO` selects `ZFISCAL` twice). JDBC's
 * `ResultSet.getString(name)` (what the legacy Java app used) always resolves a
 * duplicate label to the FIRST occurrence; `mssql` instead merges same-named columns
 * into an array. Without this normalization every duplicate-named column would render
 * as `"30/04/2026,30/04/2026"` (joined by `String()`/Vue's default array interpolation)
 * instead of the single first value the desktop app always showed.
 */
function firstIfArray(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

function normalizeRow<T>(record: Record<string, unknown>): T {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[key] = firstIfArray(value);
  }
  return normalized as T;
}

/**
 * Los nombres de base de datos (tenant de gestión, base contable) terminan interpolados
 * en el SQL como identificadores — `mssql`/tedious no tiene placeholder para
 * identificadores, solo para valores. Este chequeo es defensa en profundidad: quien
 * llame debe además validar el nombre contra su origen legítimo (GENERAL.dbo.EMPRESAS /
 * EMPRESASCONTABLES), nunca aceptarlo tal cual desde el cliente.
 */
export function assertSafeDatabaseIdentifier(name: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Nombre de base de datos con formato inesperado: "${name}".`);
  }
}

export class TenantUnavailableError extends Error {
  constructor(public readonly database: string, cause: unknown) {
    super(`No se pudo conectar a la base de datos "${database}". Verifique que exista en el servidor o contacte al administrador.`);
    this.name = 'TenantUnavailableError';
    this.cause = cause;
  }
}

async function getConnectedPool(database: string): Promise<sql.ConnectionPool> {
  const cached = poolsByDatabase.get(database);
  if (cached?.connected) return cached;
  if (cached?.connecting) {
    // A connection attempt is already in flight for this tenant — ride it out
    // rather than racing a second `.connect()` against the same pool object
    // (some driver versions leave a pool permanently unusable — "Connection is
    // closed" — if you call `.connect()` again after the first attempt fails).
    try {
      await cached.connect();
      return cached;
    } catch (err) {
      poolsByDatabase.delete(database);
      throw new TenantUnavailableError(database, err);
    }
  }

  const pool = new sql.ConnectionPool({
    server: env.db.host,
    port: env.db.port,
    database,
    user: env.db.user,
    password: env.db.password,
    options: { trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  });
  poolsByDatabase.set(database, pool);
  try {
    await pool.connect();
    return pool;
  } catch (err) {
    poolsByDatabase.delete(database);
    throw new TenantUnavailableError(database, err);
  }
}

export async function execTenantSP<T = Record<string, unknown>>(
  database: string,
  spName: string,
  params: Record<string, SpParam> = {},
): Promise<SpResult<T>> {
  const pool = await getConnectedPool(database);
  const request = pool.request();
  for (const [name, { type, value }] of Object.entries(params)) {
    request.input(name, type() as sql.ISqlType, value);
  }
  const result = await request.execute(spName);
  const recordset = result.recordset;
  const columns: SpColumnMeta[] = recordset?.columns
    ? Object.entries(recordset.columns).map(([name, meta]) => ({
        // `column.type` IS the mssql type constructor itself (e.g. `sql.Float`), so
        // `.name` gives the real type name ("Float"). `.constructor.name` is a trap —
        // every function's constructor is `Function`, so that always returned
        // "Function" and silently misclassified every column as text.
        name,
        sqlType: (meta as { type: { name?: string } }).type?.name ?? 'NVarChar',
      }))
    : [];
  const rows = (recordset ?? []).map((record) => normalizeRow<T>(record as Record<string, unknown>));
  return { rows, columns };
}

/**
 * Runs a raw parameterized SELECT against a tenant database (as opposed to a stored
 * procedure call). Used for the one-off inline query in LibroVenta that lists
 * sucursales for the header block (`SERIES` table, not wrapped in a stored proc in
 * the legacy app).
 */
export async function queryTenantRaw<T = Record<string, unknown>>(
  database: string,
  sqlText: string,
  params: Record<string, SpParam> = {},
): Promise<T[]> {
  const pool = await getConnectedPool(database);
  const request = pool.request();
  for (const [name, { type, value }] of Object.entries(params)) {
    request.input(name, type() as sql.ISqlType, value);
  }
  const result = await request.query(sqlText);
  return (result.recordset ?? []).map((record) => normalizeRow<T>(record as Record<string, unknown>));
}

/**
 * Runs `fn` inside a real SQL Server transaction against `database`, committing on
 * success and rolling back on any thrown error (then rethrowing). Introduced for the
 * Cajas contabilizar/descontabilizar/traspasar flows, which the legacy PHP app only
 * wrapped in a TRY/CATCH around a single batch (or, for descontabilizar, not at all)
 * rather than a proper transaction — every prior module in this backend is read-only
 * and never needed one. `fn` receives a `sql.Request` bound to the transaction; build
 * fresh `request.input(...)` calls off of it for each statement (a `Request` can only
 * be executed once).
 */
export async function withTenantTransaction<T>(
  database: string,
  fn: (makeRequest: () => sql.Request) => Promise<T>,
): Promise<T> {
  const pool = await getConnectedPool(database);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await fn(() => new sql.Request(transaction));
    await transaction.commit();
    return result;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
