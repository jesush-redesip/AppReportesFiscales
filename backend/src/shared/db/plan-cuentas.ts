import sql from 'mssql';
import { assertSafeDatabaseIdentifier, queryTenantRaw } from './tenant-pool.js';

/**
 * Búsqueda en el plan de cuentas (CUENTAS) de una base contable de ICG, para los
 * buscadores de cuentas de la configuración (Cierre de Caja, Pagarés). El plan completo
 * es demasiado grande para una lista desplegable (decenas de miles de cuentas), y no se
 * filtra por grupo: cada cliente decide qué cuentas usa (6, 7 u otras).
 *
 * Quien llama valida antes que `bdContable` sea una base contable legítima (viene
 * interpolada como identificador).
 */
export interface CuentaPlan {
  codigo: string;
  titulo: string;
}

/**
 * Busca por código (prefijo, si se escriben solo dígitos) o por título (sin distinguir
 * mayúsculas ni acentos). Con `codigos` devuelve esas cuentas (para mostrar el título de
 * las ya configuradas o validarlas). Excluye las "Cuenta indefinida". Máximo 30.
 */
export async function buscarCuentas(bdContable: string, q: string, codigos: string[] = []): Promise<CuentaPlan[]> {
  assertSafeDatabaseIdentifier(bdContable);
  const params: Record<string, { type: () => unknown; value: unknown }> = {};
  let filtro: string;
  if (codigos.length) {
    const lista = [...new Set(codigos.map((c) => c.trim()).filter((c) => /^\d{1,12}$/.test(c)))].slice(0, 20);
    if (!lista.length) return [];
    lista.forEach((c, i) => (params[`C${i}`] = { type: () => sql.NVarChar(12), value: c }));
    filtro = `LTRIM(RTRIM(CODIGO)) IN (${lista.map((_, i) => `@C${i}`).join(', ')})`;
  } else {
    const t = q.trim();
    if (t.length < 2) return [];
    params.COD = { type: () => sql.NVarChar(13), value: `${t.replace(/[^0-9]/g, '')}%` };
    params.TXT = { type: () => sql.NVarChar(100), value: `%${t.replace(/[[%_]/g, '[$&]')}%` };
    filtro = `(${/^\d+$/.test(t) ? 'CODIGO LIKE @COD' : 'TITULO COLLATE Latin1_General_CI_AI LIKE @TXT'})`;
  }
  const filas = await queryTenantRaw<{ CODIGO: string; TITULO: string }>(
    bdContable,
    `SELECT TOP 30 LTRIM(RTRIM(CODIGO)) AS CODIGO, LTRIM(RTRIM(TITULO)) AS TITULO
     FROM dbo.CUENTAS WITH (NOLOCK)
     WHERE ${filtro} AND ISNULL(TITULO, '') NOT IN ('', 'Cuenta indefinida')
     ORDER BY CODIGO`,
    params,
  );
  return filas.map((f) => ({ codigo: f.CODIGO, titulo: f.TITULO }));
}
