import sql from 'mssql';
import { queryTenantRaw } from '../../shared/db/tenant-pool.js';
import { PagaresError } from './pagares.repository.js';
export const CONFIG_DEFECTO = {
    contabilizar: true,
    cuentaIntereses: '611301001',
    cuentaIgtf: '611201035',
    tasaIgtf: 0.75,
    cuentaComision: '611201035',
    raizPagare: '210104',
};
const TABLA = 'RIP_PAGARESCONFIG';
export async function leerConfig(bd) {
    const filas = await queryTenantRaw(bd, `IF OBJECT_ID('${TABLA}', 'U') IS NOT NULL EXEC('SELECT TOP 1 * FROM ${TABLA}')`);
    const f = filas[0];
    if (!f)
        return { ...CONFIG_DEFECTO };
    return {
        contabilizar: Boolean(f.CONTABILIZAR),
        cuentaIntereses: String(f.CUENTAINTERESES ?? CONFIG_DEFECTO.cuentaIntereses).trim(),
        cuentaIgtf: String(f.CUENTAIGTF ?? CONFIG_DEFECTO.cuentaIgtf).trim(),
        tasaIgtf: Number(f.TASAIGTF ?? CONFIG_DEFECTO.tasaIgtf),
        cuentaComision: String(f.CUENTACOMISION ?? CONFIG_DEFECTO.cuentaComision).trim(),
        raizPagare: String(f.RAIZPAGARE ?? CONFIG_DEFECTO.raizPagare).trim(),
    };
}
export async function guardarConfig(bd, c) {
    const cuenta = (v, nombre) => {
        if (!/^\d{1,12}$/.test(v.trim()))
            throw new PagaresError(`La cuenta de ${nombre} no es válida.`);
        return v.trim();
    };
    if (!(c.tasaIgtf >= 0 && c.tasaIgtf < 100))
        throw new PagaresError('La tasa del IGTF no es válida.');
    if (!/^\d{2,9}$/.test(c.raizPagare.trim()))
        throw new PagaresError('La raíz de las cuentas de pagaré no es válida.');
    await queryTenantRaw(bd, `IF OBJECT_ID('${TABLA}', 'U') IS NULL
       CREATE TABLE ${TABLA} (
         CONTABILIZAR BIT NOT NULL DEFAULT 0,
         CUENTAINTERESES NVARCHAR(12) NOT NULL,
         CUENTAIGTF NVARCHAR(12) NOT NULL,
         TASAIGTF FLOAT NOT NULL,
         CUENTACOMISION NVARCHAR(12) NOT NULL,
         RAIZPAGARE NVARCHAR(9) NOT NULL)
     DELETE FROM ${TABLA}
     INSERT INTO ${TABLA} (CONTABILIZAR, CUENTAINTERESES, CUENTAIGTF, TASAIGTF, CUENTACOMISION, RAIZPAGARE)
     VALUES (@C, @CI, @CG, @TG, @CC, @RP)`, {
        C: { type: () => sql.Bit, value: c.contabilizar },
        CI: { type: () => sql.NVarChar(12), value: cuenta(c.cuentaIntereses, 'intereses') },
        CG: { type: () => sql.NVarChar(12), value: cuenta(c.cuentaIgtf, 'IGTF') },
        TG: { type: () => sql.Float, value: c.tasaIgtf },
        CC: { type: () => sql.NVarChar(12), value: cuenta(c.cuentaComision, 'comisión') },
        RP: { type: () => sql.NVarChar(9), value: c.raizPagare.trim() },
    });
}
/**
 * Base contable de la empresa (serie) para el ejercicio de `fechaIso`, o null si en
 * GENERAL..EMPRESASCONTABLES no hay una para ese año o la base no está en el servidor.
 */
export async function bdContableDelEjercicio(bd, serie, fechaIso) {
    const anio = Number(fechaIso.slice(0, 4));
    const filas = await queryTenantRaw(bd, `SELECT TOP 1 SUBSTRING(EC.PATHBD, CHARINDEX(':', EC.PATHBD) + 1, 200) AS BD
     FROM SERIES S WITH (NOLOCK)
     JOIN GENERAL.dbo.EMPRESASCONTABLES EC WITH (NOLOCK)
       ON EC.CODIGO = TRY_CAST(SUBSTRING(S.CONTABILIDADB, 6, 3) AS INT) AND EC.EJERCICIO = @ANIO
     WHERE S.SERIE = @SERIE
       AND DB_ID(SUBSTRING(EC.PATHBD, CHARINDEX(':', EC.PATHBD) + 1, 200)) IS NOT NULL`, { SERIE: { type: () => sql.NVarChar(15), value: serie }, ANIO: { type: () => sql.Int, value: anio } });
    const nombre = filas[0]?.BD?.trim() ?? '';
    return /^[A-Za-z0-9_]+$/.test(nombre) ? nombre : null;
}
// --- Plan de cuentas para elegir las cuentas de la configuración ---
/**
 * Base contable de referencia para elegir cuentas: la del año en curso de la empresa
 * (serie) con los pagarés más recientes; si ninguna la tiene, la de cualquier serie.
 */
export async function bdContableReferencia(bd) {
    const hoy = new Date().toISOString().slice(0, 10);
    const series = await queryTenantRaw(bd, `SELECT S.SERIE FROM SERIES S WITH (NOLOCK)
     LEFT JOIN (SELECT EMPRESA, MAX(FECHA) ULT FROM RIP_PAGARESCAB WITH (NOLOCK) GROUP BY EMPRESA) P
       ON P.EMPRESA COLLATE DATABASE_DEFAULT = S.SERIE COLLATE DATABASE_DEFAULT
     WHERE S.SERIE LIKE '__' AND ISNULL(S.CONTABILIDADB, '') <> ''
     ORDER BY ISNULL(P.ULT, '19000101') DESC, S.SERIE`);
    for (const s of series) {
        // eslint-disable-next-line no-await-in-loop
        const bdC = await bdContableDelEjercicio(bd, s.SERIE.trim(), hoy);
        if (bdC)
            return bdC;
    }
    return null;
}
// La búsqueda en el plan de cuentas es compartida con Cierre de Caja › Configuración.
export { buscarCuentas } from '../../shared/db/plan-cuentas.js';
/** Última cuenta creada bajo la raíz de los pagarés (para orientar al configurarla). */
export async function ultimaCuentaDeRaiz(bdContable, raiz) {
    if (!/^[A-Za-z0-9_]+$/.test(bdContable) || !/^\d{2,9}$/.test(raiz))
        return null;
    const f = await queryTenantRaw(bdContable, `SELECT TOP 1 LTRIM(RTRIM(CODIGO)) AS CODIGO, LTRIM(RTRIM(TITULO)) AS TITULO FROM dbo.CUENTAS WITH (NOLOCK)
     WHERE CODIGO LIKE @R AND LEN(LTRIM(RTRIM(CODIGO))) = @L ORDER BY CODIGO DESC`, { R: { type: () => sql.NVarChar(12), value: `${raiz}%` }, L: { type: () => sql.Int, value: raiz.length + 3 } });
    return f[0] ? { codigo: f[0].CODIGO, titulo: f[0].TITULO } : null;
}
//# sourceMappingURL=pagares.contabilidad.js.map