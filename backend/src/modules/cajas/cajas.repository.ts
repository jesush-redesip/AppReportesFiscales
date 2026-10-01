import sql from 'mssql';
import { assertSafeDatabaseIdentifier, queryTenantRaw } from '../../shared/db/tenant-pool.js';
import { parseYyyyMMdd } from '../../shared/util/date-format.js';
import { getConfiguracionCuentas } from '../configuracion-cuentas/configuracion-cuentas.repository.js';
import type { AsientoPreview, CierreCajaLinea, DepositoLinea, FormaPagoDisponible, Tienda } from './cajas.schema.js';

/**
 * Port of `pages/ajax/tiendas.php` (reportesicg). `SERIE` is 2-3 chars, excludes the
 * internal 'Z%' series. `BD` there was built as `"<accountingDbName>.dbo."` — a string
 * meant to be concatenated as a cross-database table prefix in the same connection.
 * We only need the bare accounting DB name (see resolveTiendaContable below), so it's
 * kept internal and never returned to the frontend — the client only ever needs
 * `serie` to identify a store; the accounting DB is re-resolved server-side on every
 * mutating request, never trusted from the client (closing the hole where the legacy
 * app took `bd` straight from the POST body and glued it into SQL as an identifier).
 */
export async function getTiendas(bd: string): Promise<Tienda[]> {
  const rows = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT DISTINCT
        S.SERIE SERIE,
        S.DESCRIPCION + ' (' + S.SERIE + ')' DESCRIPCION,
        SCL.CODCLIENTE CODCLIENTE,
        CAJA.IDFRONT
     FROM SERIES S
       INNER JOIN GENERAL.dbo.EMPRESASCONTABLES EC
         ON EC.CODIGO = CAST(SUBSTRING(S.CONTABILIDADB, 6, 3) AS INT)
        AND EC.EJERCICIO = CAST(SUBSTRING(S.CONTABILIDADB, 2, 4) AS INT)
       INNER JOIN SERIESCAMPOSLIBRES SCL ON S.SERIE = SCL.SERIE
       INNER JOIN (
         SELECT RC.IDFRONT, SUBSTRING(RC.SERIEINVENTARIO, 1, 2) COLLATE Latin1_General_CS_AI SERIE
         FROM REM_CAJASFRONT RC WHERE CAJAFRONT = 1
         UNION ALL
         SELECT CF.IDFRONT, CF.CAJAMANAGER FROM REM_CAJASFRONT CF
       ) CAJA ON S.SERIE = CAJA.SERIE
     WHERE (S.SERIE LIKE '__' OR S.SERIE LIKE '___') AND S.SERIE NOT LIKE 'Z%'`,
  );
  return rows.map((r) => ({
    serie: String(r.SERIE ?? '').trim(),
    descripcion: String(r.DESCRIPCION ?? '').trim(),
    codCliente: Number(r.CODCLIENTE ?? 0),
    idFront: Number(r.IDFRONT ?? 0),
  }));
}

/**
 * Resolves the accounting database name for a store (SERIE), for internal use only by
 * the mutation endpoints — never accept this from the client. Port of the
 * `EC.PATHBD` join in `tiendas.php`; returns just the database name (the part after
 * the host), matching how `auth.repository.ts` already strips `EMPRESAS.PATHBD`.
 */
export async function resolveBdContable(bd: string, serie: string): Promise<string> {
  const rows = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT TOP 1 EC.PATHBD
     FROM SERIES S
       INNER JOIN GENERAL.dbo.EMPRESASCONTABLES EC
         ON EC.CODIGO = CAST(SUBSTRING(S.CONTABILIDADB, 6, 3) AS INT)
        AND EC.EJERCICIO = CAST(SUBSTRING(S.CONTABILIDADB, 2, 4) AS INT)
     WHERE S.SERIE = @SERIE`,
    { SERIE: { type: () => sql.NVarChar(4), value: serie } },
  );
  const pathbd = String(rows[0]?.PATHBD ?? '');
  const bdContable = pathbd.split(':').slice(1).join(':').trim();
  if (!bdContable) throw new Error(`No se pudo resolver la BD contable para la tienda "${serie}".`);
  return bdContable;
}

/**
 * Seeds a `0`-declared row in DECLARADOZ for every open Z-arqueo of this store/date
 * that doesn't have one yet — same auto-seed `tabla_resultado_cajas.php` runs on every
 * page load (so the UI always has a row to edit for "declarado"). Kept as its own
 * named step (called once before reading the cierre) instead of a silent side effect
 * buried inside a GET handler.
 */
async function seedDeclaradoZFaltantes(bd: string, cajaLike: string, fecha: string): Promise<void> {
  const fechaDate = parseYyyyMMdd(fecha);
  const arqueos = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT CAJA, NUMERO FROM ARQUEOS WHERE ARQUEO = 'Z' AND CAJA LIKE @CAJA AND FECHA = @FECHA`,
    {
      CAJA: { type: () => sql.NVarChar(10), value: cajaLike },
      FECHA: { type: () => sql.Date, value: fechaDate },
    },
  );
  for (const arqueo of arqueos) {
    const caja = String(arqueo.CAJA ?? '');
    const numero = arqueo.NUMERO;
    const existentes = await queryTenantRaw<Record<string, unknown>>(
      bd,
      `SELECT TOP 1 1 AS X FROM DECLARADOZ WHERE CAJA = @CAJA AND NUMZ = @NUMZ AND CODMEDIOPAGO = 1`,
      { CAJA: { type: () => sql.NVarChar(10), value: caja }, NUMZ: { type: () => sql.Int, value: numero } },
    );
    if (existentes.length === 0) {
      await queryTenantRaw(
        bd,
        `INSERT INTO DECLARADOZ (TIPO, CAJA, NUMZ, CODMONEDA, IMPORTE, CODMEDIOPAGO, OBSERVACIONES, IDMOTIVO, AUTO)
         VALUES ('0', @CAJA, @NUMZ, '1', 0, '1', '', '0', '0')`,
        { CAJA: { type: () => sql.NVarChar(10), value: caja }, NUMZ: { type: () => sql.Int, value: numero } },
      );
    }
  }
}

function cierreSelectSql(incluirColumnasBs: boolean): string {
  // La moneda sale de RDW.CODMONEDA -> MONEDAS.INICIALES, que es donde ICG guarda el
  // ISO de cada moneda; va en el mismo bloque condicional porque CODMONEDA solo existe
  // en las versiones de la función que también traen las columnas en moneda local.
  const columnasBs = incluirColumnasBs
    ? `'Bs.' + FORMAT(RDW.IMPORTE_LOCAL, 'n', 'es-VE') AS IMPORTE_LOCAL,
       'Bs.' + FORMAT(RDW.DECLARADO_LOCAL, 'n', 'es-VE') AS DECLARADO_LOCAL,
       RDW.TASA_VES,
       ISNULL(MON.INICIALES, '') AS MONEDA,`
    : `NULL AS IMPORTE_LOCAL, NULL AS DECLARADO_LOCAL, NULL AS TASA_VES, '' AS MONEDA,`;
  const joinMoneda = incluirColumnasBs ? 'LEFT JOIN MONEDAS MON ON MON.CODMONEDA = RDW.CODMONEDA' : '';
  return `;WITH CTE_CAJEROS AS (
      SELECT FV.Z, FV.CAJA, V.NOMVENDEDOR, COUNT(*) CANTIDAD,
        ROW_NUMBER() OVER (PARTITION BY FV.Z, FV.CAJA ORDER BY COUNT(*) DESC) POS
      FROM FACTURASVENTA FV INNER JOIN VENDEDORES V ON FV.CODVENDEDOR = V.CODVENDEDOR
      WHERE FV.FECHA = @FECHA AND FV.CAJA LIKE @CAJA
      GROUP BY FV.Z, FV.CAJA, V.NOMVENDEDOR
    ),
    CTE_CAJERO AS (SELECT * FROM CTE_CAJEROS WHERE POS = 1),
    CTE_ESTADO AS (
      SELECT CAJA, Z,
        CASE WHEN SUM(CASE WHEN TRASPASADA = 'F' THEN 1 ELSE 0 END) > 0 OR COUNT(*) = 0 THEN 0 ELSE 1 END AS CONTABILIZADO
      FROM FACTURASVENTA WHERE FECHA = @FECHA AND CAJA LIKE @CAJA
      GROUP BY CAJA, Z
    )
    SELECT
      RDW.FECHA,
      RDW.CAJA + ' (' + ISNULL(C.NOMVENDEDOR, '') + ')' AS CAJA,
      RDW.SERIECAJA,
      RDW.Z,
      RDW.CODFORMAPAGO,
      RDW.DESCRIPCION,
      RDW.IMPORTE,
      ROUND(RDW.DECLARADO, 2) AS DECLARADO,
      RDW.GASTOS,
      RDW.FO,
      RDW.CERRADO,
      RDW.DIFERENCIA,
      (SELECT TOP 1 CODTIPOPAGO FROM VENCIMFPAGO VP WHERE VP.CODFORMAPAGO = RDW.CODFORMAPAGO) AS CODTIPOPAGO,
      ${columnasBs}
      ISNULL(E.CONTABILIZADO, 0) AS CONTABILIZADO
    FROM RIP_DIFERENCIAFRONT_WEB(@FECHA, @CAJA) RDW
      LEFT JOIN CTE_CAJERO C ON RDW.SERIECAJA = C.CAJA AND RDW.Z = C.Z
      LEFT JOIN CTE_ESTADO E ON RDW.SERIECAJA = E.CAJA AND RDW.Z = E.Z
      ${joinMoneda}
    ORDER BY RDW.CAJA, RDW.Z`;
}

/**
 * Port of the main SELECT in `tabla_resultado_cajas.php` (current variant, with the
 * `_LOCAL`/`TASA_VES` Bs. columns). `RIP_DIFERENCIAFRONT_WEB` is an opaque inline
 * table-valued function (business logic lives in SQL Server, not in this app) that
 * returns one row per caja/Z/forma-de-pago with system-computed IMPORTE vs.
 * cashier-declared DECLARADO. `CTE_CAJEROS` attaches the most common vendedor name
 * for that caja/Z purely for display.
 *
 * The 3 Bs./TASA_VES columns are a customization confirmed present on some ICG
 * clients' `RIP_DIFERENCIAFRONT_WEB` (e.g. the one this port was written against) but
 * NOT on others (confirmed live: absent on a different client's function) — this
 * isn't a version difference in this app, it's a per-client SQL Server customization.
 * Falls back to the columnless variant when the DB throws "Invalid column name" for
 * exactly those 3 names, instead of hard-failing every client that lacks them.
 */
export async function getCierre(bd: string, serie: string, fecha: string): Promise<CierreCajaLinea[]> {
  const cajaLike = `${serie.toUpperCase()}%`;
  await seedDeclaradoZFaltantes(bd, cajaLike, fecha);

  const params = {
    FECHA: { type: () => sql.Date, value: parseYyyyMMdd(fecha) },
    CAJA: { type: () => sql.NVarChar(10), value: cajaLike },
  };

  let rows: Record<string, unknown>[];
  try {
    rows = await queryTenantRaw<Record<string, unknown>>(bd, cierreSelectSql(true), params);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    const faltanColumnasBs = ['TASA_VES', 'IMPORTE_LOCAL', 'DECLARADO_LOCAL', 'CODMONEDA'].some((c) =>
      message.includes(`'${c}'`),
    );
    if (!faltanColumnasBs) throw err;
    rows = await queryTenantRaw<Record<string, unknown>>(bd, cierreSelectSql(false), params);
  }

  return rows.map((r) => ({
    fecha: String(r.FECHA ?? ''),
    caja: String(r.CAJA ?? '').trim(),
    serieCaja: String(r.SERIECAJA ?? '').trim(),
    z: Number(r.Z ?? 0),
    codFormaPago: String(r.CODFORMAPAGO ?? '').trim(),
    descripcion: String(r.DESCRIPCION ?? '').trim(),
    moneda: String(r.MONEDA ?? '').trim(),
    importe: Number(r.IMPORTE ?? 0),
    declarado: Number(r.DECLARADO ?? 0),
    gastos: Number(r.GASTOS ?? 0),
    fo: String(r.FO ?? '').trim(),
    cerrado: String(r.CERRADO ?? '').trim(),
    diferencia: Number(r.DIFERENCIA ?? 0),
    codTipoPago: r.CODTIPOPAGO == null ? null : Number(r.CODTIPOPAGO),
    importeLocal: String(r.IMPORTE_LOCAL ?? ''),
    declaradoLocal: String(r.DECLARADO_LOCAL ?? ''),
    tasaVes: Number(r.TASA_VES ?? 0),
    contabilizado: Number(r.CONTABILIZADO ?? 0) === 1,
  }));
}

/** Port of the deposits SELECT ($sql2) in `tabla_resultado_cajas.php`. */
export async function getDepositos(bd: string, serie: string, fecha: string): Promise<DepositoLinea[]> {
  const tiendaLike = `${serie.toUpperCase()}%`;
  const rows = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT
        SCL.SERIE,
        SCL.DESCRIPCION AS TIENDA,
        DEP.FECHA_VENTA,
        DEP.FECHA_DEPOSITO,
        DEP.DOCUMENTO,
        DEP.IMPORTE,
        BANCO.BANCO,
        CASE DEP.TIPO WHEN 1 THEN 'EFECTIVO' ELSE 'CHEQUE' END AS TIPO,
        DEP.CONTABILIZADO,
        DEP.CAJA AS FONDOCAJA,
        DEP.NUMERO AS FONDONUMERO,
        DEP.N AS FONDON
     FROM RIP_V_DEPOSITOS DEP
       LEFT JOIN SERIES SCL ON SUBSTRING(DEP.CAJA, 1, 2) = SCL.SERIE
       LEFT JOIN RIP_BANCO BANCO ON DEP.BANCO = BANCO.IDBANCO
     WHERE DEP.FECHA_VENTA = @FECHA AND DEP.CAJA LIKE @TIENDA`,
    {
      FECHA: { type: () => sql.Date, value: parseYyyyMMdd(fecha) },
      TIENDA: { type: () => sql.NVarChar(10), value: tiendaLike },
    },
  );
  return rows.map((r) => ({
    serie: String(r.SERIE ?? '').trim(),
    tienda: String(r.TIENDA ?? '').trim(),
    fechaVenta: String(r.FECHA_VENTA ?? ''),
    fechaDeposito: String(r.FECHA_DEPOSITO ?? ''),
    numeroDeposito: String(r.DOCUMENTO ?? '').trim(),
    importe: Number(r.IMPORTE ?? 0),
    banco: String(r.BANCO ?? '').trim(),
    tipo: (r.TIPO === 'EFECTIVO' ? 'EFECTIVO' : 'CHEQUE') as 'EFECTIVO' | 'CHEQUE',
    contabilizado: String(r.CONTABILIZADO ?? '').trim(),
    fondoCaja: String(r.FONDOCAJA ?? '').trim(),
    fondoNumero: Number(r.FONDONUMERO ?? 0),
    fondoN: String(r.FONDON ?? '').trim(),
  }));
}

function sumarPreview(lineas: AsientoPreview['lineas']): AsientoPreview {
  const totalDebe = lineas.reduce((acc, r) => acc + r.debe, 0);
  const totalHaber = lineas.reduce((acc, r) => acc + r.haber, 0);
  return {
    lineas,
    totalDebe,
    totalHaber,
    cuadrado: Math.round(totalDebe * 100) === Math.round(totalHaber * 100),
    contabilizado: false,
  };
}

/**
 * `RIP_COSTOVENTA` siempre se llama con 4 parámetros `(@REDONDEO, @CAJA, @Z, @FECHA)`.
 * El método de costo (tarifa predeterminada o último costo a `@FECHA`) lo decide la
 * función dentro de cada base de gestión, no la app — una base con la versión vieja
 * de 3 parámetros debe actualizar su función. La consulta que la usa debe declarar
 * `@REDONDEO`, `@CAJA`, `@Z` y `@FECHA`.
 */
export const LLAMADA_COSTO_VENTA = 'RIP_COSTOVENTA(@REDONDEO, @CAJA, @Z, @FECHA)';

/**
 * Port of `tabla_resultado_contabilizar.php` (tipo=1, cierre de caja). The 4 SQL
 * functions that compute each accounting line (`RIP_COBROS_FRONT`, `RIP_VENTAS`,
 * `RIP_COSTOVENTA`, `RIP_IMPUESTOSFRONT`, `RIP_DIFERENCIAS_FRONT`) live in the TENANT
 * database (same one as FACTURASVENTA) — only `CUENTAS` (chart of accounts) lives in
 * the separate accounting database, so this stays a single cross-database query
 * (`<accountingDb>.dbo.CUENTAS`) run against the tenant connection, exactly like the
 * legacy app did — just with the accounting DB name resolved and validated
 * server-side (see `resolveBdContable`/`assertSafeDatabaseIdentifier`) instead of
 * accepted from the client's POST body.
 *
 * `C.CODIGO <> '214200004'` is a hardcoded excluded account from the legacy query —
 * kept as-is, not something to "fix" without knowing why it's there.
 */
async function getAsientoCaja(bd: string, accountingDb: string, serieCaja: string, fecha: string, z: string): Promise<AsientoPreview> {
  const cuentas = await getConfiguracionCuentas(bd);
  const cajaLike = `${serieCaja.toUpperCase()}%`;
  const fechaDate = parseYyyyMMdd(fecha);

  const rows = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `DECLARE @REDONDEO AS INT = 2
     DECLARE @CC AS INT = 95
     DECLARE @CODMONEDA AS INT = (SELECT TOP 1 CODMONEDA FROM MONEDAS WHERE PRINCIPAL = 'T')
     DECLARE @DIFERENCIA AS FLOAT

     SET @DIFERENCIA = ISNULL((
       SELECT ROUND(SUM(A.DEBE - A.HABER), @REDONDEO)
       FROM (
         SELECT * FROM RIP_COBROS_FRONT(@REDONDEO, @FECHA, @CAJA, @Z, @SOBRANTEVENTA, @FALTANTEVENTA)
         UNION ALL SELECT *, @CODMONEDA FROM RIP_VENTAS(@REDONDEO, @CAJA, @Z)
         UNION ALL SELECT *, @CODMONEDA FROM ${LLAMADA_COSTO_VENTA} WHERE @INCLUIRCOSTO = 1
         UNION ALL SELECT *, @CODMONEDA FROM RIP_IMPUESTOSFRONT(@REDONDEO, @FECHA, @CAJA, @Z)
       ) A
       INNER JOIN ${accountingDb}.dbo.CUENTAS C ON A.CUENTA = C.CODIGO COLLATE Latin1_General_CS_AI
     ), 0)

     SELECT A.CUENTA, C.TITULO, A.COMENTARIO, A.DEBE, A.HABER, A.CENTROCOSTE
     FROM (
       SELECT 1 ORDEN, * FROM RIP_COBROS_FRONT(@REDONDEO, @FECHA, @CAJA, @Z, @SOBRANTEVENTA, @FALTANTEVENTA)
       UNION ALL SELECT 1 ORDEN, *, @CODMONEDA FROM RIP_DIFERENCIAS_FRONT(@REDONDEO, @FECHA, @CAJA, @Z, @SOBRANTEREDONDEO, @FALTANTEREDONDEO, @DIFERENCIA)
       UNION ALL SELECT 1 ORDEN, *, @CODMONEDA FROM RIP_VENTAS(@REDONDEO, @CAJA, @Z)
       UNION ALL SELECT 2 ORDEN, *, @CODMONEDA FROM ${LLAMADA_COSTO_VENTA} WHERE @INCLUIRCOSTO = 1
       UNION ALL SELECT 1 ORDEN, *, @CODMONEDA FROM RIP_IMPUESTOSFRONT(@REDONDEO, @FECHA, @CAJA, @Z)
     ) A
     INNER JOIN ${accountingDb}.dbo.CUENTAS C ON A.CUENTA = C.CODIGO COLLATE Latin1_General_CS_AI
     WHERE (DEBE - HABER) <> 0 AND C.CODIGO <> '214200004'
     ORDER BY ORDEN, DEBE DESC, HABER DESC`,
    {
      FECHA: { type: () => sql.Date, value: fechaDate },
      CAJA: { type: () => sql.NVarChar(10), value: cajaLike },
      Z: { type: () => sql.Int, value: Number(z) },
      SOBRANTEVENTA: { type: () => sql.NVarChar(20), value: cuentas.sobranteVenta },
      FALTANTEVENTA: { type: () => sql.NVarChar(20), value: cuentas.faltanteVenta },
      SOBRANTEREDONDEO: { type: () => sql.NVarChar(20), value: cuentas.sobranteRedondeo },
      FALTANTEREDONDEO: { type: () => sql.NVarChar(20), value: cuentas.faltanteRedondeo },
      INCLUIRCOSTO: { type: () => sql.Bit, value: cuentas.incluirCostoVenta },
    },
  );

  const lineas = rows.map((r) => ({
    cuenta: String(r.CUENTA ?? '').trim(),
    titulo: String(r.TITULO ?? '').trim(),
    comentario: String(r.COMENTARIO ?? '').trim(),
    debe: Number(r.DEBE ?? 0),
    haber: Number(r.HABER ?? 0),
    centroCoste: String(r.CENTROCOSTE ?? '').trim(),
  }));
  return { ...sumarPreview(lineas), incluyeCostoVenta: cuentas.incluirCostoVenta };
}

/** Port of `tabla_resultado_contabilizar.php` (tipo=2, depósito). */
async function getAsientoDeposito(bd: string, accountingDb: string, serie: string, fecha: string): Promise<AsientoPreview> {
  const tiendaLike = `${serie.toUpperCase()}%`;
  const fechaDate = parseYyyyMMdd(fecha);

  const rows = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT BANCO.CUENTACONTABLE AS CUENTA, C.TITULO, DEP.DOCUMENTO AS COMENTARIO, DEP.IMPORTE AS DEBE, 0 AS HABER, DEP.CONTABILIZADO
     FROM RIP_V_DEPOSITOS DEP
       INNER JOIN SERIES SCL ON SUBSTRING(DEP.CAJA, 1, 2) = SCL.SERIE
       INNER JOIN RIP_BANCO BANCO ON DEP.BANCO = BANCO.IDBANCO
       INNER JOIN ${accountingDb}.dbo.CUENTAS C ON BANCO.CUENTACONTABLE = C.CODIGO
     WHERE DEP.FECHA_VENTA = @FECHA AND DEP.CAJA LIKE @TIENDA AND LTRIM(RTRIM(ISNULL(BANCO.CUENTACONTABLE, ''))) <> ''
     UNION ALL
     SELECT BANCO.CONTRAPARTIDA AS CUENTA, C.TITULO, DEP.DOCUMENTO AS COMENTARIO, 0 AS DEBE, DEP.IMPORTE AS HABER, DEP.CONTABILIZADO
     FROM RIP_V_DEPOSITOS DEP
       INNER JOIN SERIES SCL ON SUBSTRING(DEP.CAJA, 1, 2) = SCL.SERIE
       INNER JOIN RIP_BANCO BANCO ON DEP.BANCO = BANCO.IDBANCO
       INNER JOIN ${accountingDb}.dbo.CUENTAS C ON BANCO.CONTRAPARTIDA = C.CODIGO
     WHERE DEP.FECHA_VENTA = @FECHA AND DEP.CAJA LIKE @TIENDA AND LTRIM(RTRIM(ISNULL(BANCO.CUENTACONTABLE, ''))) <> ''`,
    {
      FECHA: { type: () => sql.Date, value: fechaDate },
      TIENDA: { type: () => sql.NVarChar(10), value: tiendaLike },
    },
  );

  const lineas = rows.map((r) => ({
    cuenta: String(r.CUENTA ?? '').trim(),
    titulo: String(r.TITULO ?? '').trim(),
    comentario: String(r.COMENTARIO ?? '').trim(),
    debe: Number(r.DEBE ?? 0),
    haber: Number(r.HABER ?? 0),
    centroCoste: '',
  }));
  const preview = sumarPreview(lineas);
  preview.contabilizado = rows.length > 0 && String(rows[0]?.CONTABILIZADO ?? '').trim() !== '0';
  return preview;
}

export async function getAsiento(
  bd: string,
  tipo: '1' | '2',
  serie: string,
  serieCaja: string,
  fecha: string,
  z: string,
): Promise<AsientoPreview> {
  const accountingDb = await resolveBdContable(bd, serie);
  assertSafeDatabaseIdentifier(accountingDb);
  return tipo === '1'
    ? getAsientoCaja(bd, accountingDb, serieCaja, fecha, z)
    : getAsientoDeposito(bd, accountingDb, serie, fecha);
}

/** Port of `ajax/modal_resultado_formapago.php`. */
export async function getFormasPagoDisponibles(bd: string, caja: string, z: string): Promise<FormaPagoDisponible[]> {
  const rows = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT * FROM TIPOSPAGO
     WHERE NOT CODTIPOPAGO IN (
       SELECT CODMEDIOPAGO FROM DECLARADOZ WHERE CAJA = @CAJA AND NUMZ = @Z AND TIPO = 0 AND DECLARADOZ.IMPORTE <> 0
     )
     AND CODTIPOPAGO IN (
       SELECT DISTINCT VP.CODTIPOPAGO
       FROM FORMASPAGO RLF
         INNER JOIN VENCIMFPAGO VP ON RLF.CODFORMAPAGO = VP.CODFORMAPAGO COLLATE Latin1_General_CS_AI
       WHERE ISNULL(RLF.VISIBLEFRONT, 'F') = 'T'
     )`,
    {
      CAJA: { type: () => sql.NVarChar(10), value: caja },
      Z: { type: () => sql.Int, value: Number(z) },
    },
  );
  return rows.map((r) => ({
    codTipoPago: Number(r.CODTIPOPAGO ?? 0),
    descripcion: String(r.DESCRIPCION ?? '').trim(),
  }));
}

/** Port of `ajax/tablaCotizacion.php` — a real stored procedure, not an inline function. */
export async function getCotizacion(bd: string, fecha: string, importe: number): Promise<string[]> {
  const rows = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `EXEC [rip].[PROC_GETCOTIZACION] @FECHA = @FECHA, @IMPORTE = @IMPORTE`,
    {
      FECHA: { type: () => sql.Date, value: parseYyyyMMdd(fecha) },
      IMPORTE: { type: () => sql.Float, value: importe },
    },
  );
  return rows.map((r) => String(r.MENSAJE ?? '').trim());
}
