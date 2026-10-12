import sql from 'mssql';
import { generalPool, generalPoolConnect } from '../../shared/db/general-pool.js';
import { assertSafeDatabaseIdentifier, queryTenantRaw } from '../../shared/db/tenant-pool.js';
import { buscarCuentas } from '../../shared/db/plan-cuentas.js';
import type { BaseContable, ConfiguracionCuentas, CuentaContable } from './configuracion-cuentas.schema.js';

export class BaseContableInvalidaError extends Error {
  constructor(bd: string) {
    super(`La base de datos contable "${bd}" no está registrada en GENERAL.dbo.EMPRESASCONTABLES.`);
    this.name = 'BaseContableInvalidaError';
  }
}

/** Una cuenta configurada no existe en la base contable elegida. */
export class CuentaInexistenteError extends Error {
  constructor(bd: string, cuentas: string[]) {
    super(`Estas cuentas no existen (o son "Cuenta indefinida") en la base contable ${bd}: ${cuentas.join(', ')}.`);
    this.name = 'CuentaInexistenteError';
  }
}

/** Extrae el nombre de BD de un PATHBD "host:BD" (igual criterio que auth.repository). */
function bdDesdePathbd(pathbd: unknown): string {
  return String(pathbd ?? '')
    .split(':')
    .slice(1)
    .join(':')
    .trim();
}

/**
 * Bases contables disponibles, para el desplegable de la ventana de configuración.
 * `EMPRESASCONTABLES` tiene una fila por (CODIGO, EJERCICIO) y varias pueden apuntar a
 * la MISMA base de datos (verificado en vivo: cFRANCELINA_2021 aparece con dos
 * combinaciones distintas), así que se deduplica por nombre de base — lo que se elige
 * acá es un plan de cuentas, no un ejercicio contable.
 */
export async function listarBasesContables(): Promise<BaseContable[]> {
  await generalPoolConnect;
  const result = await generalPool
    .request()
    .query(`SELECT CODIGO, EJERCICIO, DESCRIPCION, PATHBD FROM dbo.EMPRESASCONTABLES ORDER BY DESCRIPCION, EJERCICIO`);

  const porBd = new Map<string, BaseContable>();
  for (const row of result.recordset) {
    const bd = bdDesdePathbd(row.PATHBD);
    if (!bd) continue;
    const existente = porBd.get(bd);
    if (existente) {
      if (!existente.ejercicios.includes(row.EJERCICIO)) existente.ejercicios.push(row.EJERCICIO);
    } else {
      porBd.set(bd, { bd, descripcion: String(row.DESCRIPCION ?? '').trim() || bd, ejercicios: [row.EJERCICIO] });
    }
  }
  return [...porBd.values()];
}

/**
 * Valida `bd` contra la lista real de bases contables antes de usarlo. El nombre llega
 * del cliente y termina interpolado como identificador de base de datos (`mssql` no
 * tiene placeholder para identificadores), así que una allowlist contra
 * EMPRESASCONTABLES es la única validación aceptable — no basta un regex de forma.
 */
async function assertBaseContablePermitida(bd: string): Promise<void> {
  const permitidas = await listarBasesContables();
  if (!permitidas.some((b) => b.bd.toLowerCase() === bd.toLowerCase())) throw new BaseContableInvalidaError(bd);
  assertSafeDatabaseIdentifier(bd);
}

/**
 * Busca en el plan de cuentas de la base contable elegida: por código o por nombre
 * (`q`), o las cuentas indicadas (`codigos`, para mostrar el título de las ya
 * configuradas). Cualquier grupo de cuentas: no se asume que sobrantes y faltantes
 * estén en el 7 (hay clientes que usan el 6 u otras).
 */
export async function listarCuentasContables(bdContable: string, q = '', codigos: string[] = []): Promise<CuentaContable[]> {
  await assertBaseContablePermitida(bdContable);
  return buscarCuentas(bdContable, q, codigos);
}

/**
 * La configuración vive ahora en la base de GESTIÓN (la del tenant, la misma de
 * FACTURASVENTA/DECLARADOZ), no en GENERAL: así cada empresa tiene su propio juego de
 * cuentas en vez de una única configuración compartida por toda la instalación. La
 * tabla no existe en las bases de gestión actuales, así que se crea en el primer uso
 * — idempotente, mismo enfoque que el legacy usaba para `RIP_ASIENTO`.
 */
async function ensureTabla(bd: string): Promise<void> {
  await queryTenantRaw(
    bd,
    `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RIP_CONFIGURACIONCUENTAS')
     BEGIN
       CREATE TABLE dbo.RIP_CONFIGURACIONCUENTAS (
         SOBRANTEVENTA    NVARCHAR(12) NULL,
         FALTANTEVENTA    NVARCHAR(12) NULL,
         SOBRANTEREDONDEO NVARCHAR(12) NULL,
         FALTANTEREDONDEO NVARCHAR(12) NULL,
         BDCONTABLE       NVARCHAR(128) NULL
       ) ON [PRIMARY]
     END
     -- Columna agregada después: las tablas ya creadas la reciben con DEFAULT 1 para
     -- que las empresas existentes sigan contabilizando el costo como hasta ahora.
     IF COL_LENGTH('dbo.RIP_CONFIGURACIONCUENTAS', 'INCLUIRCOSTOVENTA') IS NULL
       ALTER TABLE dbo.RIP_CONFIGURACIONCUENTAS
         ADD INCLUIRCOSTOVENTA BIT NOT NULL CONSTRAINT DF_RIP_CONFIGURACIONCUENTAS_INCLUIRCOSTOVENTA DEFAULT 1`,
  );
}

function mapRow(row: Record<string, unknown> | undefined): ConfiguracionCuentas {
  const s = (v: unknown) => String(v ?? '').trim();
  return {
    sobranteVenta: s(row?.SOBRANTEVENTA),
    faltanteVenta: s(row?.FALTANTEVENTA),
    sobranteRedondeo: s(row?.SOBRANTEREDONDEO),
    faltanteRedondeo: s(row?.FALTANTEREDONDEO),
    bdContable: s(row?.BDCONTABLE),
    // Sin fila guardada todavía → comportamiento legacy (con costo).
    incluirCostoVenta: row?.INCLUIRCOSTOVENTA === undefined || row?.INCLUIRCOSTOVENTA === null ? true : Boolean(row.INCLUIRCOSTOVENTA),
  };
}

/**
 * Base contable a la que apuntan las tiendas de esta base de gestión — se usa para
 * preseleccionar el desplegable la primera vez, en vez de dejar al usuario eligiendo a
 * ciegas entre los planes de cuentas de todas las empresas de la instalación. Mismo
 * join que usa `tiendas.php`/`resolveBdContable` (SERIES.CONTABILIDADB codifica el
 * ejercicio y el código de empresa contable). La consulta se repite acá en vez de
 * importar el módulo de cajas porque ese módulo ya depende de este.
 */
async function sugerirBaseContable(bd: string): Promise<string> {
  try {
    const rows = await queryTenantRaw<Record<string, unknown>>(
      bd,
      `SELECT TOP 1 EC.PATHBD
       FROM SERIES S
         INNER JOIN GENERAL.dbo.EMPRESASCONTABLES EC
           ON EC.CODIGO = CAST(SUBSTRING(S.CONTABILIDADB, 6, 3) AS INT)
          AND EC.EJERCICIO = CAST(SUBSTRING(S.CONTABILIDADB, 2, 4) AS INT)
       WHERE (S.SERIE LIKE '__' OR S.SERIE LIKE '___') AND S.SERIE NOT LIKE 'Z%'`,
    );
    return bdDesdePathbd(rows[0]?.PATHBD);
  } catch {
    // Una base de gestión sin SERIES utilizables no debe impedir abrir la ventana de
    // configuración; simplemente no hay sugerencia y el usuario elige a mano.
    return '';
  }
}

export async function getConfiguracionCuentas(bd: string): Promise<ConfiguracionCuentas> {
  await ensureTabla(bd);
  const rows = await queryTenantRaw<Record<string, unknown>>(bd, 'SELECT TOP 1 * FROM dbo.RIP_CONFIGURACIONCUENTAS');
  const config = mapRow(rows[0]);
  if (!config.bdContable) config.bdContable = await sugerirBaseContable(bd);
  return config;
}

/**
 * Una sola fila por base de gestión. Se comprueba el conteo antes de escribir: la
 * tabla no tiene clave primaria, así que un UPDATE sin WHERE sobre varias filas las
 * pisaría todas a ciegas (era el comportamiento del `guardar_configuracion_cuentas.php`
 * legacy). Si aparecen varias, se falla en vez de adivinar cuál es la buena.
 */
export async function updateConfiguracionCuentas(bd: string, data: ConfiguracionCuentas): Promise<void> {
  await ensureTabla(bd);
  if (data.bdContable) await assertBaseContablePermitida(data.bdContable);
  // Las cuentas elegidas deben existir en esa base contable (o quedar sin asignar).
  const elegidas = [data.sobranteVenta, data.faltanteVenta, data.sobranteRedondeo, data.faltanteRedondeo]
    .map((c) => (c ?? '').trim())
    .filter(Boolean);
  if (elegidas.length) {
    if (!data.bdContable) throw new CuentaInexistenteError('(sin elegir)', elegidas);
    const existen = new Set((await buscarCuentas(data.bdContable, '', elegidas)).map((c) => c.codigo));
    const faltan = [...new Set(elegidas.filter((c) => !existen.has(c)))];
    if (faltan.length) throw new CuentaInexistenteError(data.bdContable, faltan);
  }

  const conteo = await queryTenantRaw<{ N: number }>(bd, 'SELECT COUNT(*) AS N FROM dbo.RIP_CONFIGURACIONCUENTAS');
  const n = conteo[0]?.N ?? 0;
  if (n > 1) {
    throw new Error(
      `RIP_CONFIGURACIONCUENTAS de "${bd}" tiene ${n} filas — se requiere reconciliar manualmente antes de guardar desde la app.`,
    );
  }

  const params = {
    SOBRANTEVENTA: { type: () => sql.NVarChar(12), value: data.sobranteVenta },
    FALTANTEVENTA: { type: () => sql.NVarChar(12), value: data.faltanteVenta },
    SOBRANTEREDONDEO: { type: () => sql.NVarChar(12), value: data.sobranteRedondeo },
    FALTANTEREDONDEO: { type: () => sql.NVarChar(12), value: data.faltanteRedondeo },
    BDCONTABLE: { type: () => sql.NVarChar(128), value: data.bdContable },
    // Un cliente viejo que no manda el campo no debe apagar el costo sin querer.
    INCLUIRCOSTOVENTA: { type: () => sql.Bit, value: data.incluirCostoVenta !== false },
  };

  if (n === 1) {
    await queryTenantRaw(
      bd,
      `UPDATE dbo.RIP_CONFIGURACIONCUENTAS SET
         SOBRANTEVENTA = @SOBRANTEVENTA,
         FALTANTEVENTA = @FALTANTEVENTA,
         SOBRANTEREDONDEO = @SOBRANTEREDONDEO,
         FALTANTEREDONDEO = @FALTANTEREDONDEO,
         BDCONTABLE = @BDCONTABLE,
         INCLUIRCOSTOVENTA = @INCLUIRCOSTOVENTA`,
      params,
    );
  } else {
    await queryTenantRaw(
      bd,
      `INSERT INTO dbo.RIP_CONFIGURACIONCUENTAS
         (SOBRANTEVENTA, FALTANTEVENTA, SOBRANTEREDONDEO, FALTANTEREDONDEO, BDCONTABLE, INCLUIRCOSTOVENTA)
       VALUES (@SOBRANTEVENTA, @FALTANTEVENTA, @SOBRANTEREDONDEO, @FALTANTEREDONDEO, @BDCONTABLE, @INCLUIRCOSTOVENTA)`,
      params,
    );
  }
}
