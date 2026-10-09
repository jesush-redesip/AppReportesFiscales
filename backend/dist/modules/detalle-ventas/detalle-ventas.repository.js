import sql from 'mssql';
import { queryTenantMulti, queryTenantRaw } from '../../shared/db/tenant-pool.js';
import { asegurarProcedimiento, ProcedimientoError } from '../../shared/db/procedimientos.js';
export class DetalleVentasError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DetalleVentasError';
    }
}
const p = (type, value) => ({ type, value });
const PROCEDIMIENTO = 'rip.MR_DETALLE_VENTAS';
async function asegurar(bd) {
    try {
        await asegurarProcedimiento(bd, PROCEDIMIENTO);
    }
    catch (err) {
        if (err instanceof ProcedimientoError)
            throw new DetalleVentasError(err.message);
        throw err;
    }
}
function aFecha(yyyyMMdd) {
    const d = new Date(Date.UTC(+yyyyMMdd.slice(0, 4), +yyyyMMdd.slice(4, 6) - 1, +yyyyMMdd.slice(6, 8)));
    if (Number.isNaN(d.getTime()))
        throw new DetalleVentasError(`Fecha inválida: ${yyyyMMdd}`);
    return d;
}
/** Llama al procedimiento con los filtros y los parámetros del nivel. Devuelve filas y totales. */
async function ejecutar(bd, nivel, f, extra = {}) {
    await asegurar(bd);
    const refs = [...new Set((f.referencias ?? []).map((r) => r.trim()).filter(Boolean))].slice(0, 200);
    const params = {
        NIVEL: p(() => sql.VarChar(10), nivel),
        DESDE: p(() => sql.Date, aFecha(f.desde)),
        HASTA: p(() => sql.Date, aFecha(f.hasta)),
        MONEDA: p(() => sql.Int, f.moneda),
        GRUPO: p(() => sql.NVarChar(1), f.grupo ?? null),
        PROMOCION: p(() => sql.Int, f.promocion ?? null),
        REFS: p(() => sql.NVarChar(sql.MAX), refs.length ? refs.join(',') : null),
        DPTO: p(() => sql.Int, f.dpto ?? null),
        SECCION: p(() => sql.Int, f.seccion ?? null),
        FAMILIA: p(() => sql.Int, f.familia ?? null),
        SUBFAMILIA: p(() => sql.Int, f.subfamilia ?? null),
        MARCA: p(() => sql.Int, f.marca ?? null),
        LINEA: p(() => sql.Int, f.linea ?? null),
        ...extra,
    };
    const lista = Object.keys(params).map((k) => `@${k} = @${k}`).join(', ');
    const conjuntos = await queryTenantMulti(bd, `EXEC ${PROCEDIMIENTO} ${lista}`, params);
    return { filas: conjuntos[0] ?? [], totales: conjuntos[1]?.[0] ?? {} };
}
/** Nivel 1: por tienda (2 primeros caracteres de la serie). */
export function porTienda(bd, f) {
    return ejecutar(bd, 'TIENDAS', f);
}
/** Nivel 2: por día, de una tienda. */
export function porDia(bd, f, tienda) {
    return ejecutar(bd, 'DIAS', f, { TIENDA: p(() => sql.NVarChar(2), tienda) });
}
/** Nivel 3: tickets de una tienda en un día. */
export function porTicket(bd, f, tienda, fecha) {
    return ejecutar(bd, 'TICKETS', f, { TIENDA: p(() => sql.NVarChar(2), tienda), FECHA: p(() => sql.Date, aFecha(fecha)) });
}
/** Nivel 4: líneas de un ticket (mismos filtros, para que sumen lo del nivel 3). */
export function lineasTicket(bd, f, ticket) {
    return ejecutar(bd, 'LINEAS', f, {
        NUMSERIE: p(() => sql.NVarChar(4), ticket.numSerie),
        NUMALBARAN: p(() => sql.Int, ticket.numAlbaran),
        N: p(() => sql.NChar(1), ticket.n),
    });
}
// --- Catálogos de los filtros ---
/**
 * Moneda con que arrancan los Detalles de Ventas y Compras: el dólar (CODIGOISO = 'USD'),
 * aunque la principal de la empresa sea el bolívar (p. ej. BIGBEN); si no hay, la principal.
 */
export async function monedaPorDefecto(bd) {
    const r = await queryTenantRaw(bd, `DECLARE @M INT;
     IF COL_LENGTH('dbo.MONEDAS', 'CODIGOISO') IS NOT NULL
       EXEC sys.sp_executesql
         N'SELECT TOP 1 @M = CODMONEDA FROM dbo.MONEDAS WHERE LTRIM(RTRIM(CODIGOISO)) = ''USD'' ORDER BY CASE WHEN PRINCIPAL = ''T'' THEN 0 ELSE 1 END, CODMONEDA',
         N'@M INT OUTPUT', @M = @M OUTPUT;
     SELECT ISNULL(@M, (SELECT TOP 1 CODMONEDA FROM dbo.MONEDAS WHERE PRINCIPAL = 'T')) AS M;`);
    return r[0]?.M ?? null;
}
export async function catalogos(bd) {
    const [grupos, promociones, departamentos, marcas, moneda] = await Promise.all([
        queryTenantRaw(bd, "SELECT SERIE, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM SERIES WITH (NOLOCK) WHERE SERIE LIKE '_' AND SERIE <> 'Z' ORDER BY SERIE"),
        queryTenantRaw(bd, 'SELECT IDPROMOCION, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM PROMOCIONES WITH (NOLOCK) ORDER BY DESCRIPCION'),
        queryTenantRaw(bd, 'SELECT NUMDPTO AS ID, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM DEPARTAMENTO WITH (NOLOCK) ORDER BY DESCRIPCION'),
        queryTenantRaw(bd, 'SELECT CODMARCA AS ID, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM MARCA WITH (NOLOCK) ORDER BY DESCRIPCION'),
        monedaPorDefecto(bd),
    ]);
    return {
        grupos: grupos.map((g) => ({ serie: String(g.SERIE).trim(), descripcion: String(g.DESCRIPCION ?? '') })),
        promociones: promociones.map((x) => ({ id: Number(x.IDPROMOCION), descripcion: String(x.DESCRIPCION ?? '') })),
        departamentos: departamentos.map(opcion),
        marcas: marcas.map(opcion),
        monedaDefecto: moneda,
    };
}
const opcion = (x) => ({ id: Number(x.ID), descripcion: String(x.DESCRIPCION ?? '') });
/** Niveles dependientes de la clasificación: secciones de un dpto, familias, subfamilias, líneas de una marca. */
export async function clasificacion(bd, nivel, q) {
    const params = {
        DPTO: p(() => sql.Int, q.dpto ?? null),
        SECCION: p(() => sql.Int, q.seccion ?? null),
        FAMILIA: p(() => sql.Int, q.familia ?? null),
        MARCA: p(() => sql.Int, q.marca ?? null),
    };
    const consultas = {
        seccion: 'SELECT NUMSECCION AS ID, DESCRIPCION FROM SECCIONES WITH (NOLOCK) WHERE NUMDPTO = @DPTO',
        familia: 'SELECT NUMFAMILIA AS ID, DESCRIPCION FROM FAMILIAS WITH (NOLOCK) WHERE NUMDPTO = @DPTO AND NUMSECCION = @SECCION',
        subfamilia: 'SELECT NUMSUBFAMILIA AS ID, DESCRIPCION FROM SUBFAMILIAS WITH (NOLOCK) WHERE NUMDPTO = @DPTO AND NUMSECCION = @SECCION AND NUMFAMILIA = @FAMILIA',
        linea: 'SELECT CODLINEA AS ID, DESCRIPCION FROM LINEA WITH (NOLOCK) WHERE CODMARCA = @MARCA',
    };
    const filas = await queryTenantRaw(bd, `${consultas[nivel]} ORDER BY DESCRIPCION`, params);
    return filas.map((x) => ({ id: Number(x.ID), descripcion: String(x.DESCRIPCION ?? '').trim() }));
}
/** Buscador de artículos por referencia o descripción (máx. 30). */
export async function buscarArticulos(bd, texto) {
    const t = texto.trim();
    if (t.length < 2)
        return [];
    const filas = await queryTenantRaw(bd, `SELECT TOP 30 REFPROVEEDOR, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION
     FROM ARTICULOS WITH (NOLOCK)
     WHERE ISNULL(REFPROVEEDOR, '') <> ''
       -- Sin distinguir mayúsculas ni acentos (algunas bases de ICG usan intercalación CS).
       AND (REFPROVEEDOR COLLATE Latin1_General_CI_AI LIKE @T + '%' OR DESCRIPCION COLLATE Latin1_General_CI_AI LIKE '%' + @T + '%')
     ORDER BY CASE WHEN REFPROVEEDOR COLLATE Latin1_General_CI_AI LIKE @T + '%' THEN 0 ELSE 1 END, DESCRIPCION`, { T: p(() => sql.NVarChar(60), t) });
    return filas.map((x) => ({ referencia: String(x.REFPROVEEDOR).trim(), descripcion: String(x.DESCRIPCION ?? '') }));
}
//# sourceMappingURL=detalle-ventas.repository.js.map