import sql from 'mssql';
import { assertSafeDatabaseIdentifier, queryTenantRaw } from './tenant-pool.js';
/**
 * Busca por código (prefijo, si se escriben solo dígitos) o por título (sin distinguir
 * mayúsculas ni acentos). Con `codigos` devuelve esas cuentas (para mostrar el título de
 * las ya configuradas o validarlas). Excluye las "Cuenta indefinida". Máximo 30.
 */
export async function buscarCuentas(bdContable, q, codigos = []) {
    assertSafeDatabaseIdentifier(bdContable);
    const params = {};
    let filtro;
    if (codigos.length) {
        const lista = [...new Set(codigos.map((c) => c.trim()).filter((c) => /^\d{1,12}$/.test(c)))].slice(0, 20);
        if (!lista.length)
            return [];
        lista.forEach((c, i) => (params[`C${i}`] = { type: () => sql.NVarChar(12), value: c }));
        filtro = `LTRIM(RTRIM(CODIGO)) IN (${lista.map((_, i) => `@C${i}`).join(', ')})`;
    }
    else {
        const t = q.trim();
        if (t.length < 2)
            return [];
        params.COD = { type: () => sql.NVarChar(13), value: `${t.replace(/[^0-9]/g, '')}%` };
        params.TXT = { type: () => sql.NVarChar(100), value: `%${t.replace(/[[%_]/g, '[$&]')}%` };
        filtro = `(${/^\d+$/.test(t) ? 'CODIGO LIKE @COD' : 'TITULO COLLATE Latin1_General_CI_AI LIKE @TXT'})`;
    }
    const filas = await queryTenantRaw(bdContable, `SELECT TOP 30 LTRIM(RTRIM(CODIGO)) AS CODIGO, LTRIM(RTRIM(TITULO)) AS TITULO
     FROM dbo.CUENTAS WITH (NOLOCK)
     WHERE ${filtro} AND ISNULL(TITULO, '') NOT IN ('', 'Cuenta indefinida')
     ORDER BY CODIGO`, params);
    return filas.map((f) => ({ codigo: f.CODIGO, titulo: f.TITULO }));
}
//# sourceMappingURL=plan-cuentas.js.map