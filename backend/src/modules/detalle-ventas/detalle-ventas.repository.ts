import sql from 'mssql';
import { queryTenantMulti, queryTenantRaw } from '../../shared/db/tenant-pool.js';
import type { SpParam } from '../../shared/db/sp-runner.js';
import { asegurarProcedimiento, ProcedimientoError } from '../../shared/db/procedimientos.js';

/**
 * Detalle de Ventas: tablero de ventas por niveles (tienda → día → ticket → líneas).
 * Reemplaza "DETALLES VENTAS" del PHP reportesicg.
 *
 * La consulta vive en la base de datos, en el procedimiento rip.MR_DETALLE_VENTAS
 * (script: backend/sql/rip.MR_DETALLE_VENTAS.sql, con el detalle del cálculo). Si una
 * base no lo tiene, se crea la primera vez que se usa el módulo; si ya existe NO se toca,
 * así un ajuste hecho para un cliente se respeta (igual que con los rip.MR_* de los
 * libros). Para reinstalar la versión original, ejecutar ese script en la base.
 */

export interface FiltrosVentas {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  moneda: number;
  grupo?: string; // 1 carácter (SERIES de 1 letra)
  promocion?: number;
  referencias?: string[]; // REFPROVEEDOR exactas
  dpto?: number;
  seccion?: number;
  familia?: number;
  subfamilia?: number;
  marca?: number;
  linea?: number;
}

export class DetalleVentasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetalleVentasError';
  }
}

export type Fila = Record<string, unknown>;

const p = (type: () => unknown, value: unknown): SpParam => ({ type, value });

const PROCEDIMIENTO = 'rip.MR_DETALLE_VENTAS';

async function asegurar(bd: string) {
  try {
    await asegurarProcedimiento(bd, PROCEDIMIENTO);
  } catch (err) {
    if (err instanceof ProcedimientoError) throw new DetalleVentasError(err.message);
    throw err;
  }
}

function aFecha(yyyyMMdd: string): Date {
  const d = new Date(Date.UTC(+yyyyMMdd.slice(0, 4), +yyyyMMdd.slice(4, 6) - 1, +yyyyMMdd.slice(6, 8)));
  if (Number.isNaN(d.getTime())) throw new DetalleVentasError(`Fecha inválida: ${yyyyMMdd}`);
  return d;
}

type Nivel = 'TIENDAS' | 'DIAS' | 'TICKETS' | 'LINEAS';

/** Llama al procedimiento con los filtros y los parámetros del nivel. Devuelve filas y totales. */
async function ejecutar(bd: string, nivel: Nivel, f: FiltrosVentas, extra: Record<string, SpParam> = {}): Promise<{ filas: Fila[]; totales: Fila }> {
  await asegurar(bd);
  const refs = [...new Set((f.referencias ?? []).map((r) => r.trim()).filter(Boolean))].slice(0, 200);
  const params: Record<string, SpParam> = {
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
  const conjuntos = await queryTenantMulti<Fila>(bd, `EXEC ${PROCEDIMIENTO} ${lista}`, params);
  return { filas: conjuntos[0] ?? [], totales: conjuntos[1]?.[0] ?? {} };
}

/** Nivel 1: por tienda (2 primeros caracteres de la serie). */
export function porTienda(bd: string, f: FiltrosVentas) {
  return ejecutar(bd, 'TIENDAS', f);
}

/** Nivel 2: por día, de una tienda. */
export function porDia(bd: string, f: FiltrosVentas, tienda: string) {
  return ejecutar(bd, 'DIAS', f, { TIENDA: p(() => sql.NVarChar(2), tienda) });
}

/** Nivel 3: tickets de una tienda en un día. */
export function porTicket(bd: string, f: FiltrosVentas, tienda: string, fecha: string) {
  return ejecutar(bd, 'TICKETS', f, { TIENDA: p(() => sql.NVarChar(2), tienda), FECHA: p(() => sql.Date, aFecha(fecha)) });
}

/** Nivel 4: líneas de un ticket (mismos filtros, para que sumen lo del nivel 3). */
export function lineasTicket(bd: string, f: FiltrosVentas, ticket: { numSerie: string; numAlbaran: number; n: string }) {
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
export async function monedaPorDefecto(bd: string): Promise<number | null> {
  const r = await queryTenantRaw<{ M: number | null }>(
    bd,
    `DECLARE @M INT;
     IF COL_LENGTH('dbo.MONEDAS', 'CODIGOISO') IS NOT NULL
       EXEC sys.sp_executesql
         N'SELECT TOP 1 @M = CODMONEDA FROM dbo.MONEDAS WHERE LTRIM(RTRIM(CODIGOISO)) = ''USD'' ORDER BY CASE WHEN PRINCIPAL = ''T'' THEN 0 ELSE 1 END, CODMONEDA',
         N'@M INT OUTPUT', @M = @M OUTPUT;
     SELECT ISNULL(@M, (SELECT TOP 1 CODMONEDA FROM dbo.MONEDAS WHERE PRINCIPAL = 'T')) AS M;`,
  );
  return r[0]?.M ?? null;
}

export async function catalogos(bd: string) {
  const [grupos, promociones, departamentos, marcas, moneda] = await Promise.all([
    queryTenantRaw<Fila>(bd, "SELECT SERIE, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM SERIES WITH (NOLOCK) WHERE SERIE LIKE '_' AND SERIE <> 'Z' ORDER BY SERIE"),
    queryTenantRaw<Fila>(bd, 'SELECT IDPROMOCION, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM PROMOCIONES WITH (NOLOCK) ORDER BY DESCRIPCION'),
    queryTenantRaw<Fila>(bd, 'SELECT NUMDPTO AS ID, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM DEPARTAMENTO WITH (NOLOCK) ORDER BY DESCRIPCION'),
    queryTenantRaw<Fila>(bd, 'SELECT CODMARCA AS ID, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM MARCA WITH (NOLOCK) ORDER BY DESCRIPCION'),
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

const opcion = (x: Fila) => ({ id: Number(x.ID), descripcion: String(x.DESCRIPCION ?? '') });

/** Niveles dependientes de la clasificación: secciones de un dpto, familias, subfamilias, líneas de una marca. */
export async function clasificacion(
  bd: string,
  nivel: 'seccion' | 'familia' | 'subfamilia' | 'linea',
  q: { dpto?: number; seccion?: number; familia?: number; marca?: number },
) {
  const params: Record<string, SpParam> = {
    DPTO: p(() => sql.Int, q.dpto ?? null),
    SECCION: p(() => sql.Int, q.seccion ?? null),
    FAMILIA: p(() => sql.Int, q.familia ?? null),
    MARCA: p(() => sql.Int, q.marca ?? null),
  };
  const consultas = {
    seccion: 'SELECT NUMSECCION AS ID, DESCRIPCION FROM SECCIONES WITH (NOLOCK) WHERE NUMDPTO = @DPTO',
    familia: 'SELECT NUMFAMILIA AS ID, DESCRIPCION FROM FAMILIAS WITH (NOLOCK) WHERE NUMDPTO = @DPTO AND NUMSECCION = @SECCION',
    subfamilia:
      'SELECT NUMSUBFAMILIA AS ID, DESCRIPCION FROM SUBFAMILIAS WITH (NOLOCK) WHERE NUMDPTO = @DPTO AND NUMSECCION = @SECCION AND NUMFAMILIA = @FAMILIA',
    linea: 'SELECT CODLINEA AS ID, DESCRIPCION FROM LINEA WITH (NOLOCK) WHERE CODMARCA = @MARCA',
  };
  const filas = await queryTenantRaw<Fila>(bd, `${consultas[nivel]} ORDER BY DESCRIPCION`, params);
  return filas.map((x) => ({ id: Number(x.ID), descripcion: String(x.DESCRIPCION ?? '').trim() }));
}

/** Buscador de artículos por referencia o descripción (máx. 30). */
export async function buscarArticulos(bd: string, texto: string) {
  const t = texto.trim();
  if (t.length < 2) return [];
  const filas = await queryTenantRaw<Fila>(
    bd,
    `SELECT TOP 30 REFPROVEEDOR, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION
     FROM ARTICULOS WITH (NOLOCK)
     WHERE ISNULL(REFPROVEEDOR, '') <> ''
       -- Sin distinguir mayúsculas ni acentos (algunas bases de ICG usan intercalación CS).
       AND (REFPROVEEDOR COLLATE Latin1_General_CI_AI LIKE @T + '%' OR DESCRIPCION COLLATE Latin1_General_CI_AI LIKE '%' + @T + '%')
     ORDER BY CASE WHEN REFPROVEEDOR COLLATE Latin1_General_CI_AI LIKE @T + '%' THEN 0 ELSE 1 END, DESCRIPCION`,
    { T: p(() => sql.NVarChar(60), t) },
  );
  return filas.map((x) => ({ referencia: String(x.REFPROVEEDOR).trim(), descripcion: String(x.DESCRIPCION ?? '') }));
}
