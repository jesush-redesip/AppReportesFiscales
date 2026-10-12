import sql from 'mssql';
import { queryTenantRaw } from '../../shared/db/tenant-pool.js';
import { PagaresError } from './pagares.repository.js';

/**
 * Pagarés › contabilidad (Fase 3).
 *
 * Configuración por instalación (tabla RIP_PAGARESCONFIG de la base de gestión, una
 * fila): si el Aplicativo genera los asientos y con qué cuentas. El Aplicativo reemplaza
 * al PHP reportesicg (ya no se usa en los clientes), así que contabiliza por defecto;
 * `contabilizar` se apaga solo si una empresa prefiere cargar los asientos a mano en ICG.
 *
 * Base contable del asiento: la del ejercicio de la FECHA CONTABLE. La serie da la
 * empresa contable (SERIES.CONTABILIDADB = 'C' + ejercicio + código de 3 dígitos) y
 * GENERAL..EMPRESASCONTABLES la base de ese código en el año de la fecha.
 */

export interface ConfigContable {
  contabilizar: boolean;
  /** Gasto por intereses (el PHP: 611301001). */
  cuentaIntereses: string;
  /** Cuenta del IGTF (el PHP: 611201035). */
  cuentaIgtf: string;
  /** % de IGTF sobre lo que se paga al banco. 0 = no se genera. */
  tasaIgtf: number;
  /** Cuenta de comisión bancaria por defecto al registrar (el PHP: 611201035). */
  cuentaComision: string;
  /** Raíz de la cuenta de cada pagaré (el PHP: 210104). */
  raizPagare: string;
}

export const CONFIG_DEFECTO: ConfigContable = {
  contabilizar: true,
  cuentaIntereses: '611301001',
  cuentaIgtf: '611201035',
  tasaIgtf: 0.75,
  cuentaComision: '611201035',
  raizPagare: '210104',
};

const TABLA = 'RIP_PAGARESCONFIG';

export async function leerConfig(bd: string): Promise<ConfigContable> {
  const filas = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `IF OBJECT_ID('${TABLA}', 'U') IS NOT NULL EXEC('SELECT TOP 1 * FROM ${TABLA}')`,
  );
  const f = filas[0];
  if (!f) return { ...CONFIG_DEFECTO };
  return {
    contabilizar: Boolean(f.CONTABILIZAR),
    cuentaIntereses: String(f.CUENTAINTERESES ?? CONFIG_DEFECTO.cuentaIntereses).trim(),
    cuentaIgtf: String(f.CUENTAIGTF ?? CONFIG_DEFECTO.cuentaIgtf).trim(),
    tasaIgtf: Number(f.TASAIGTF ?? CONFIG_DEFECTO.tasaIgtf),
    cuentaComision: String(f.CUENTACOMISION ?? CONFIG_DEFECTO.cuentaComision).trim(),
    raizPagare: String(f.RAIZPAGARE ?? CONFIG_DEFECTO.raizPagare).trim(),
  };
}

export async function guardarConfig(bd: string, c: ConfigContable): Promise<void> {
  const cuenta = (v: string, nombre: string) => {
    if (!/^\d{1,12}$/.test(v.trim())) throw new PagaresError(`La cuenta de ${nombre} no es válida.`);
    return v.trim();
  };
  if (!(c.tasaIgtf >= 0 && c.tasaIgtf < 100)) throw new PagaresError('La tasa del IGTF no es válida.');
  if (!/^\d{2,9}$/.test(c.raizPagare.trim())) throw new PagaresError('La raíz de las cuentas de pagaré no es válida.');
  await queryTenantRaw(
    bd,
    `IF OBJECT_ID('${TABLA}', 'U') IS NULL
       CREATE TABLE ${TABLA} (
         CONTABILIZAR BIT NOT NULL DEFAULT 0,
         CUENTAINTERESES NVARCHAR(12) NOT NULL,
         CUENTAIGTF NVARCHAR(12) NOT NULL,
         TASAIGTF FLOAT NOT NULL,
         CUENTACOMISION NVARCHAR(12) NOT NULL,
         RAIZPAGARE NVARCHAR(9) NOT NULL)
     DELETE FROM ${TABLA}
     INSERT INTO ${TABLA} (CONTABILIZAR, CUENTAINTERESES, CUENTAIGTF, TASAIGTF, CUENTACOMISION, RAIZPAGARE)
     VALUES (@C, @CI, @CG, @TG, @CC, @RP)`,
    {
      C: { type: () => sql.Bit, value: c.contabilizar },
      CI: { type: () => sql.NVarChar(12), value: cuenta(c.cuentaIntereses, 'intereses') },
      CG: { type: () => sql.NVarChar(12), value: cuenta(c.cuentaIgtf, 'IGTF') },
      TG: { type: () => sql.Float, value: c.tasaIgtf },
      CC: { type: () => sql.NVarChar(12), value: cuenta(c.cuentaComision, 'comisión') },
      RP: { type: () => sql.NVarChar(9), value: c.raizPagare.trim() },
    },
  );
}

/**
 * Base contable de la empresa (serie) para el ejercicio de `fechaIso`, o null si en
 * GENERAL..EMPRESASCONTABLES no hay una para ese año o la base no está en el servidor.
 */
export async function bdContableDelEjercicio(bd: string, serie: string, fechaIso: string): Promise<string | null> {
  const anio = Number(fechaIso.slice(0, 4));
  const filas = await queryTenantRaw<{ BD: string | null }>(
    bd,
    `SELECT TOP 1 SUBSTRING(EC.PATHBD, CHARINDEX(':', EC.PATHBD) + 1, 200) AS BD
     FROM SERIES S WITH (NOLOCK)
     JOIN GENERAL.dbo.EMPRESASCONTABLES EC WITH (NOLOCK)
       ON EC.CODIGO = TRY_CAST(SUBSTRING(S.CONTABILIDADB, 6, 3) AS INT) AND EC.EJERCICIO = @ANIO
     WHERE S.SERIE = @SERIE
       AND DB_ID(SUBSTRING(EC.PATHBD, CHARINDEX(':', EC.PATHBD) + 1, 200)) IS NOT NULL`,
    { SERIE: { type: () => sql.NVarChar(15), value: serie }, ANIO: { type: () => sql.Int, value: anio } },
  );
  const nombre = filas[0]?.BD?.trim() ?? '';
  return /^[A-Za-z0-9_]+$/.test(nombre) ? nombre : null;
}

// --- Plan de cuentas para elegir las cuentas de la configuración ---

/**
 * Base contable de referencia para elegir cuentas: la del año en curso de la empresa
 * (serie) con los pagarés más recientes; si ninguna la tiene, la de cualquier serie.
 */
export async function bdContableReferencia(bd: string): Promise<string | null> {
  const hoy = new Date().toISOString().slice(0, 10);
  const series = await queryTenantRaw<{ SERIE: string }>(
    bd,
    `SELECT S.SERIE FROM SERIES S WITH (NOLOCK)
     LEFT JOIN (SELECT EMPRESA, MAX(FECHA) ULT FROM RIP_PAGARESCAB WITH (NOLOCK) GROUP BY EMPRESA) P
       ON P.EMPRESA COLLATE DATABASE_DEFAULT = S.SERIE COLLATE DATABASE_DEFAULT
     WHERE S.SERIE LIKE '__' AND ISNULL(S.CONTABILIDADB, '') <> ''
     ORDER BY ISNULL(P.ULT, '19000101') DESC, S.SERIE`,
  );
  for (const s of series) {
    // eslint-disable-next-line no-await-in-loop
    const bdC = await bdContableDelEjercicio(bd, s.SERIE.trim(), hoy);
    if (bdC) return bdC;
  }
  return null;
}

// La búsqueda en el plan de cuentas es compartida con Cierre de Caja › Configuración.
export { buscarCuentas, type CuentaPlan } from '../../shared/db/plan-cuentas.js';
import type { CuentaPlan } from '../../shared/db/plan-cuentas.js';

/** Última cuenta creada bajo la raíz de los pagarés (para orientar al configurarla). */
export async function ultimaCuentaDeRaiz(bdContable: string, raiz: string): Promise<CuentaPlan | null> {
  if (!/^[A-Za-z0-9_]+$/.test(bdContable) || !/^\d{2,9}$/.test(raiz)) return null;
  const f = await queryTenantRaw<{ CODIGO: string; TITULO: string }>(
    bdContable,
    `SELECT TOP 1 LTRIM(RTRIM(CODIGO)) AS CODIGO, LTRIM(RTRIM(TITULO)) AS TITULO FROM dbo.CUENTAS WITH (NOLOCK)
     WHERE CODIGO LIKE @R AND LEN(LTRIM(RTRIM(CODIGO))) = @L ORDER BY CODIGO DESC`,
    { R: { type: () => sql.NVarChar(12), value: `${raiz}%` }, L: { type: () => sql.Int, value: raiz.length + 3 } },
  );
  return f[0] ? { codigo: f[0].CODIGO, titulo: f[0].TITULO } : null;
}
