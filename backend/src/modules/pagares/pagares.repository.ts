import sql from 'mssql';
import { queryTenantRaw } from '../../shared/db/tenant-pool.js';
import type { SpParam } from '../../shared/db/sp-runner.js';

/**
 * Pagarés (préstamos bancarios de la empresa documentados con pagarés). Reemplaza el
 * listado "DETALLES PAGARÉS" del PHP reportesicg. Esta fase SOLO LEE: las tablas propias
 * RIP_PAGARESCAB (cabecera) y RIP_PAGARESLIN (cuotas: una fila por vencimiento) que
 * llena el PHP en la base de gestión de la empresa.
 *
 *  - Cuota de capital pagada: PAGADO = 'T'. Intereses pagados: INTERESESPAGADOS = 'T'
 *    (o NOCOBRARINTERESES = 'T', meses de gracia).
 *  - "Empresa" de un pagaré: su SERIE (2 letras), ligada a la empresa contable por
 *    SERIES.CONTABILIDADB. Se agrupan por empresa contable, que reemplaza los grupos que
 *    el PHP tenía fijos en el código (BB = BB/BG/BJ...).
 *  - Banco: el título de la cuenta contable 110102* (CODBANCO), igual que en el PHP.
 *  - Importes tal como se registraron (sin conversión de moneda).
 */

export class PagaresError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PagaresError';
  }
}

export type Fila = Record<string, unknown>;

export interface FiltrosPagares {
  series?: string[];
  banco?: string;
  buscar?: string;
}

const p = (type: () => unknown, value: unknown): SpParam => ({ type, value });

/** Columnas que el PHP agregó con el tiempo: si una base no las tiene se usan valores neutros. */
interface Esquema {
  noCobrarIntereses: boolean;
  fechaContable: boolean;
  fechaContableInteres: boolean;
  frecuenciaIntereses: boolean;
  /** Existe RIP_PAGARESANULADOS (la crea el Aplicativo al anular el primero). */
  anulados: boolean;
}
const esquemas = new Map<string, { esquema: Esquema; hora: number }>();

async function esquema(bd: string): Promise<Esquema> {
  const cache = esquemas.get(bd);
  if (cache && Date.now() - cache.hora < 10 * 60_000) return cache.esquema;
  const filas = await queryTenantRaw<{ TABLA: string; COLUMNA: string | null }>(
    bd,
    `SELECT T.TABLA, C.name AS COLUMNA
     FROM (VALUES ('RIP_PAGARESCAB'), ('RIP_PAGARESLIN'), ('RIP_PAGARESANULADOS')) AS T(TABLA)
     LEFT JOIN sys.columns C ON C.object_id = OBJECT_ID(T.TABLA)`,
  );
  const cab = new Set(filas.filter((f) => f.TABLA === 'RIP_PAGARESCAB' && f.COLUMNA).map((f) => f.COLUMNA!.toUpperCase()));
  const lin = new Set(filas.filter((f) => f.TABLA === 'RIP_PAGARESLIN' && f.COLUMNA).map((f) => f.COLUMNA!.toUpperCase()));
  if (!cab.size || !lin.size) {
    throw new PagaresError('Esta empresa no lleva control de pagarés (no tiene las tablas RIP_PAGARESCAB y RIP_PAGARESLIN).');
  }
  const e: Esquema = {
    noCobrarIntereses: lin.has('NOCOBRARINTERESES'),
    fechaContable: lin.has('FECHACONTABLE'),
    fechaContableInteres: lin.has('FECHACONTABLEINTERES'),
    frecuenciaIntereses: cab.has('FRECUENCIAPAGOINTERESES'),
    anulados: filas.some((f) => f.TABLA === 'RIP_PAGARESANULADOS' && f.COLUMNA),
  };
  esquemas.set(bd, { esquema: e, hora: Date.now() });
  return e;
}

/** Después de crear RIP_PAGARESANULADOS. */
export function olvidarEsquema(bd: string) {
  esquemas.delete(bd);
}

/** Cuotas normalizadas: montos numéricos y banderas de pago 1/0. */
function cteLineas(e: Esquema) {
  const gracia = e.noCobrarIntereses ? " OR NOCOBRARINTERESES = 'T'" : '';
  return `L AS (
    SELECT NUMPAGARESCAB AS COD, MES, FECHAVENCIMIENTO AS FV,
           ROUND(CONVERT(DECIMAL(19, 4), ISNULL(PAGOSCAPITAL, 0)), 2) AS CAP,
           ROUND(CONVERT(DECIMAL(19, 4), ISNULL(PAGOSINTERESES, 0)), 2) AS INTE,
           CASE WHEN PAGADO = 'T' THEN 1 ELSE 0 END AS CAPPAG,
           CASE WHEN INTERESESPAGADOS = 'T'${gracia} THEN 1 ELSE 0 END AS INTPAG
    FROM RIP_PAGARESLIN WITH (NOLOCK))`;
}

/** Cabeceras con el nombre de la empresa contable y los filtros comunes. */
function cteCabecera(f: FiltrosPagares, params: Record<string, SpParam>, e: Esquema) {
  const condiciones: string[] = [];
  if (e.anulados) condiciones.push('NOT EXISTS (SELECT 1 FROM RIP_PAGARESANULADOS AN WHERE AN.CODPAGARES = C.CODPAGARES)');
  const series = [...new Set((f.series ?? []).map((s) => s.trim()).filter(Boolean))].slice(0, 50);
  if (series.length) {
    condiciones.push(`C.EMPRESA COLLATE DATABASE_DEFAULT IN (${series.map((_, i) => `@S${i}`).join(', ')})`);
    series.forEach((s, i) => (params[`S${i}`] = p(() => sql.NVarChar(10), s)));
  }
  if (f.banco) {
    condiciones.push('C.CODBANCO COLLATE DATABASE_DEFAULT = @BANCO');
    params.BANCO = p(() => sql.NVarChar(200), f.banco);
  }
  if (f.buscar?.trim()) {
    condiciones.push('CAST(C.PAGARE AS NVARCHAR(40)) LIKE @BUSCAR');
    params.BUSCAR = p(() => sql.NVarChar(60), `%${f.buscar.trim().replace(/[[%_]/g, '[$&]')}%`);
  }
  return `CB AS (
    SELECT C.CODPAGARES AS COD, CAST(C.PAGARE AS NVARCHAR(40)) AS PAGARE, C.EMPRESA AS SERIE,
           LTRIM(RTRIM(C.CODBANCO)) AS BANCO,
           -- GENERAL, la base de gestión y RIP_PAGARESCAB pueden tener intercalaciones distintas.
           COALESCE(NULLIF(LTRIM(RTRIM(EC.DESCRIPCION)), '') COLLATE DATABASE_DEFAULT,
                    NULLIF(LTRIM(RTRIM(S.DESCRIPCION)), '') COLLATE DATABASE_DEFAULT,
                    C.EMPRESA COLLATE DATABASE_DEFAULT) AS EMPRESA,
           C.FECHA, C.PLAZO, C.FRECUENCIAPAGO AS FRECUENCIA,
           CONVERT(DECIMAL(9, 4), ISNULL(C.TASA, 0)) AS TASA,
           CONVERT(DECIMAL(19, 4), ISNULL(C.MONTO, 0)) AS MONTO
    FROM RIP_PAGARESCAB C WITH (NOLOCK)
    LEFT JOIN SERIES S WITH (NOLOCK) ON S.SERIE COLLATE DATABASE_DEFAULT = C.EMPRESA COLLATE DATABASE_DEFAULT
    LEFT JOIN GENERAL.dbo.EMPRESASCONTABLES EC WITH (NOLOCK)
      ON EC.CODIGO = TRY_CAST(SUBSTRING(S.CONTABILIDADB, 6, 3) AS INT)
     AND EC.EJERCICIO = TRY_CAST(SUBSTRING(S.CONTABILIDADB, 2, 4) AS INT)
    ${condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : ''})`;
}

const fechaIso = (col: string) => `CONVERT(CHAR(10), ${col}, 23)`;
/** Algo de la cuota sigue pendiente (capital o intereses). */
const PENDIENTE = '((L.CAPPAG = 0 AND L.CAP > 0) OR (L.INTPAG = 0 AND L.INTE > 0))';

function fechaParam(params: Record<string, SpParam>, nombre: string, yyyyMMdd: string) {
  const d = new Date(Date.UTC(+yyyyMMdd.slice(0, 4), +yyyyMMdd.slice(4, 6) - 1, +yyyyMMdd.slice(6, 8)));
  if (Number.isNaN(d.getTime())) throw new PagaresError(`Fecha inválida: ${yyyyMMdd}`);
  params[nombre] = p(() => sql.Date, d);
}

/** Empresas (agrupadas por empresa contable) y bancos que tienen pagarés. */
export async function catalogos(bd: string) {
  const e = await esquema(bd); // además avisa si la empresa no tiene las tablas
  const params: Record<string, SpParam> = {};
  const filas = await queryTenantRaw<{ SERIE: string; EMPRESA: string; BANCO: string; PAGARES: number }>(
    bd,
    `WITH ${cteCabecera({}, params, e)}
     SELECT SERIE, EMPRESA, BANCO, COUNT(*) AS PAGARES FROM CB GROUP BY SERIE, EMPRESA, BANCO`,
    params,
  );
  const empresas = new Map<string, { id: string; nombre: string; series: string[]; pagares: number }>();
  for (const f of filas) {
    const nombre = String(f.EMPRESA ?? f.SERIE).trim();
    const item = empresas.get(nombre) ?? { id: '', nombre, series: [], pagares: 0 };
    const serie = String(f.SERIE).trim();
    if (!item.series.includes(serie)) item.series.push(serie);
    item.pagares += Number(f.PAGARES);
    empresas.set(nombre, item);
  }
  const lista = [...empresas.values()]
    .map((x) => ({ ...x, series: x.series.sort(), id: x.series.sort().join(',') }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const bancos = [...new Set(filas.map((f) => String(f.BANCO ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { empresas: lista, bancos };
}

/** GENERAL: pagarés con cuotas que vencen en el período (o liquidados en él). */
export async function general(bd: string, f: FiltrosPagares, desde: string, hasta: string): Promise<Fila[]> {
  const e = await esquema(bd);
  const params: Record<string, SpParam> = {};
  fechaParam(params, 'DESDE', desde);
  fechaParam(params, 'HASTA', hasta);
  return queryTenantRaw<Fila>(
    bd,
    `WITH ${cteLineas(e)}, ${cteCabecera(f, params, e)},
     A AS (
       SELECT L.COD,
              SUM(CASE WHEN L.CAPPAG = 0 THEN L.CAP ELSE 0 END) AS SALDO,
              SUM(CASE WHEN L.CAPPAG = 1 THEN L.CAP ELSE 0 END) AS CAPITAL_PAGADO,
              SUM(CASE WHEN L.FV BETWEEN @DESDE AND @HASTA AND L.CAPPAG = 0 THEN L.CAP ELSE 0 END) AS CAPITAL,
              SUM(CASE WHEN L.FV BETWEEN @DESDE AND @HASTA AND L.INTPAG = 0 THEN L.INTE ELSE 0 END) AS INTERESES,
              SUM(CASE WHEN L.FV BETWEEN @DESDE AND @HASTA AND L.MES > 0 THEN 1 ELSE 0 END) AS CUOTAS_PERIODO,
              MAX(L.FV) AS VENCE,
              MIN(CASE WHEN ${PENDIENTE} THEN L.FV END) AS PROXIMO
       FROM L GROUP BY L.COD)
     SELECT CB.COD AS CODPAGARES, CB.PAGARE, CB.EMPRESA, CB.BANCO, ${fechaIso('CB.FECHA')} AS FECHA,
            ${fechaIso('A.VENCE')} AS VENCE, CB.PLAZO, CB.FRECUENCIA, CB.TASA, CB.MONTO,
            A.CAPITAL_PAGADO, A.SALDO, ${fechaIso('A.PROXIMO')} AS PROXIMO,
            A.CAPITAL, A.INTERESES, A.CAPITAL + A.INTERESES AS TOTAL
     FROM CB JOIN A ON A.COD = CB.COD
     WHERE A.CUOTAS_PERIODO > 0 OR CB.FECHA BETWEEN @DESDE AND @HASTA
     ORDER BY CB.EMPRESA, CB.BANCO, CB.FECHA, CB.PAGARE`,
    params,
  );
}

/** DEUDAS: lo vencido y sin pagar al corte (capital e intereses), por pagaré. */
export async function deudas(bd: string, f: FiltrosPagares, corte: string): Promise<Fila[]> {
  const e = await esquema(bd);
  const params: Record<string, SpParam> = {};
  fechaParam(params, 'CORTE', corte);
  return queryTenantRaw<Fila>(
    bd,
    `WITH ${cteLineas(e)}, ${cteCabecera(f, params, e)},
     A AS (
       SELECT L.COD,
              SUM(CASE WHEN L.CAPPAG = 0 THEN L.CAP ELSE 0 END) AS SALDO
       FROM L GROUP BY L.COD),
     V AS (
       SELECT L.COD,
              SUM(CASE WHEN L.CAPPAG = 0 THEN L.CAP ELSE 0 END) AS CAPITAL,
              SUM(CASE WHEN L.INTPAG = 0 THEN L.INTE ELSE 0 END) AS INTERESES,
              COUNT(*) AS CUOTAS,
              MIN(L.FV) AS DESDE
       FROM L WHERE L.FV <= @CORTE AND ${PENDIENTE}
       GROUP BY L.COD)
     SELECT CB.COD AS CODPAGARES, CB.PAGARE, CB.EMPRESA, CB.BANCO, CB.MONTO, A.SALDO,
            V.CUOTAS, ${fechaIso('V.DESDE')} AS DESDE, DATEDIFF(DAY, V.DESDE, @CORTE) AS DIAS,
            V.CAPITAL, V.INTERESES, V.CAPITAL + V.INTERESES AS TOTAL
     FROM CB JOIN V ON V.COD = CB.COD JOIN A ON A.COD = CB.COD
     ORDER BY V.DESDE, CB.EMPRESA, CB.BANCO, CB.PAGARE`,
    params,
  );
}

/** PAGOS DEL PERÍODO: lo que vence en el rango por empresa y banco, pendiente y pagado. */
export async function pagosPeriodo(bd: string, f: FiltrosPagares, desde: string, hasta: string): Promise<Fila[]> {
  const e = await esquema(bd);
  const params: Record<string, SpParam> = {};
  fechaParam(params, 'DESDE', desde);
  fechaParam(params, 'HASTA', hasta);
  return queryTenantRaw<Fila>(
    bd,
    `WITH ${cteLineas(e)}, ${cteCabecera(f, params, e)}
     SELECT CB.EMPRESA, CB.BANCO, COUNT(DISTINCT CB.COD) AS PAGARES,
            SUM(CASE WHEN L.CAPPAG = 0 THEN L.CAP ELSE 0 END) AS CAPITAL,
            SUM(CASE WHEN L.INTPAG = 0 THEN L.INTE ELSE 0 END) AS INTERESES,
            SUM(CASE WHEN L.CAPPAG = 0 THEN L.CAP ELSE 0 END) + SUM(CASE WHEN L.INTPAG = 0 THEN L.INTE ELSE 0 END) AS TOTAL,
            SUM(CASE WHEN L.CAPPAG = 1 THEN L.CAP ELSE 0 END) AS CAPITAL_PAGADO,
            SUM(CASE WHEN L.INTPAG = 1 THEN L.INTE ELSE 0 END) AS INTERESES_PAGADOS
     FROM CB JOIN L ON L.COD = CB.COD
     WHERE L.FV BETWEEN @DESDE AND @HASTA AND (L.CAP > 0 OR L.INTE > 0)
     GROUP BY CB.EMPRESA, CB.BANCO
     ORDER BY CB.EMPRESA, CB.BANCO`,
    params,
  );
}

/** CONSOLIDADO: deuda pendiente y lo pagado, por empresa y banco (o solo por banco). */
export async function consolidado(bd: string, f: FiltrosPagares, porBanco: boolean): Promise<Fila[]> {
  const e = await esquema(bd);
  const params: Record<string, SpParam> = {};
  const grupo = porBanco ? 'CB.BANCO' : 'CB.EMPRESA, CB.BANCO';
  return queryTenantRaw<Fila>(
    bd,
    `WITH ${cteLineas(e)}, ${cteCabecera(f, params, e)},
     A AS (
       SELECT L.COD,
              SUM(CASE WHEN L.CAPPAG = 0 THEN L.CAP ELSE 0 END) AS CAPITAL,
              SUM(CASE WHEN L.INTPAG = 0 THEN L.INTE ELSE 0 END) AS INTERESES,
              SUM(CASE WHEN L.CAPPAG = 1 THEN L.CAP ELSE 0 END) AS CAPITAL_PAGADO,
              SUM(CASE WHEN L.INTPAG = 1 THEN L.INTE ELSE 0 END) AS INTERESES_PAGADOS
       FROM L GROUP BY L.COD)
     SELECT ${grupo},
            SUM(CASE WHEN A.CAPITAL + A.INTERESES > 0 THEN 1 ELSE 0 END) AS PAGARES,
            SUM(A.CAPITAL) AS CAPITAL, SUM(A.INTERESES) AS INTERESES, SUM(A.CAPITAL + A.INTERESES) AS TOTAL,
            SUM(A.CAPITAL_PAGADO) AS CAPITAL_PAGADO, SUM(A.INTERESES_PAGADOS) AS INTERESES_PAGADOS,
            SUM(A.CAPITAL_PAGADO + A.INTERESES_PAGADOS) AS TOTAL_PAGADO
     FROM CB JOIN A ON A.COD = CB.COD
     GROUP BY ${grupo}
     HAVING SUM(A.CAPITAL + A.INTERESES + A.CAPITAL_PAGADO + A.INTERESES_PAGADOS) <> 0
     ORDER BY ${grupo}`,
    params,
  );
}

/** Tabla de amortización de un pagaré, con el estado de cada cuota al corte. */
export async function detalle(bd: string, codPagares: number, corte: string) {
  const e = await esquema(bd);
  const params: Record<string, SpParam> = { COD: p(() => sql.Int, codPagares) };
  fechaParam(params, 'CORTE', corte);
  const cab = await queryTenantRaw<Fila>(
    bd,
    `WITH ${cteCabecera({}, params, e)}
     SELECT CB.COD AS CODPAGARES, CB.PAGARE, CB.EMPRESA, CB.BANCO, ${fechaIso('CB.FECHA')} AS FECHA, CB.PLAZO, CB.FRECUENCIA,
            ${e.frecuenciaIntereses ? 'C.FRECUENCIAPAGOINTERESES' : 'NULL'} AS FRECUENCIA_INTERESES, CB.TASA, CB.MONTO
     FROM CB JOIN RIP_PAGARESCAB C WITH (NOLOCK) ON C.CODPAGARES = CB.COD
     WHERE CB.COD = @COD`,
    params,
  );
  if (!cab.length) throw new PagaresError('No se encontró el pagaré.');
  const estado = (pagado: string, monto: string) =>
    `CASE WHEN ${monto} = 0 THEN '' WHEN ${pagado} = 'T' THEN 'Pagado' WHEN R.FECHAVENCIMIENTO <= @CORTE THEN 'Vencido' ELSE 'Pendiente' END`;
  const CAP = 'ROUND(CONVERT(DECIMAL(19, 4), ISNULL(R.PAGOSCAPITAL, 0)), 2)';
  const INTE = 'ROUND(CONVERT(DECIMAL(19, 4), ISNULL(R.PAGOSINTERESES, 0)), 2)';
  const lineas = await queryTenantRaw<Fila>(
    bd,
    `SELECT R.MES, ${fechaIso('R.FECHAVENCIMIENTO')} AS FECHA,
            ROUND(CONVERT(DECIMAL(19, 4), ISNULL(R.SALDOPAGARES, 0)), 2) AS SALDO, ${CAP} AS CAPITAL, ${INTE} AS INTERESES, ${CAP} + ${INTE} AS TOTAL,
            ${estado('R.PAGADO', CAP)} AS ESTADO_CAPITAL,
            ${e.fechaContable ? fechaIso('R.FECHACONTABLE') : 'NULL'} AS PAGO_CAPITAL,
            CASE WHEN ${e.noCobrarIntereses ? "R.NOCOBRARINTERESES = 'T'" : '1 = 0'} THEN 'Sin intereses' ELSE ${estado('R.INTERESESPAGADOS', INTE)} END AS ESTADO_INTERESES,
            ${e.fechaContableInteres ? fechaIso('R.FECHACONTABLEINTERES') : 'NULL'} AS PAGO_INTERESES
     FROM RIP_PAGARESLIN R WITH (NOLOCK)
     WHERE R.NUMPAGARESCAB = @COD
     ORDER BY R.FECHAVENCIMIENTO, R.MES`,
    params,
  );
  return { pagare: cab[0], lineas };
}
