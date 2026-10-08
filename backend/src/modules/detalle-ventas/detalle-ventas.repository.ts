import sql from 'mssql';
import { queryTenantMulti, queryTenantRaw } from '../../shared/db/tenant-pool.js';
import type { SpParam } from '../../shared/db/sp-runner.js';

/**
 * Detalle de Ventas: tablero de ventas que se abre por niveles (tienda → día → ticket →
 * líneas). Reemplaza "DETALLES VENTAS" del PHP reportesicg con un solo cálculo para
 * todos los niveles (el PHP calculaba distinto en cada uno y no cuadraba):
 *
 *  - Línea:   MONTO = TOTAL de la línea menos el descuento comercial de la cabecera;
 *             IVA = MONTO × %IVA; COSTO = COSTE × unidades.
 *  - Ticket:  un albarán (NUMSERIE, NUMALBARAN, N). IGTF = TOTALCARGOSDTOS de la cabecera.
 *  - Tienda:  los 2 primeros caracteres de la serie (SERIES.DESCRIPCION); grupo = el 1.º.
 *  - Moneda:  todo se lleva a la moneda elegida como el Libro de Compra: importes del
 *             documento × (1 si ya está en esa moneda, si no FACTORMONEDA × cotización);
 *             el COSTE está en la moneda principal → × cotización de la moneda elegida.
 *  - Se excluyen las series que empiezan por Z (administración), como el PHP.
 *
 * Los filtros por artículo (referencia, clasificación, promoción) se aplican a las
 * líneas: un ticket cuenta si tiene al menos una línea que cumple, y su IGTF entra entero.
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

const p = (type: () => unknown, value: unknown): SpParam => ({ type, value });

/** WHERE de líneas + parámetros. La jerarquía se aplica en orden (sección solo con dpto, etc.). */
function filtrosLineas(f: FiltrosVentas): { where: string; params: Record<string, SpParam> } {
  const w: string[] = [];
  const params: Record<string, SpParam> = {
    DESDE: p(() => sql.Date, aFecha(f.desde)),
    HASTA: p(() => sql.Date, aFecha(f.hasta)),
    MONEDA: p(() => sql.Int, f.moneda),
  };
  if (f.grupo) {
    w.push('C.NUMSERIE LIKE @GRUPO + \'%\'');
    params.GRUPO = p(() => sql.NVarChar(1), f.grupo);
  }
  if (f.promocion != null) {
    w.push(`EXISTS (SELECT 1 FROM ALBVENTALINPROMOCIONES PR WITH (NOLOCK)
                    WHERE PR.NUMSERIE = L.NUMSERIE AND PR.NUMALBARAN = L.NUMALBARAN AND PR.N = L.N
                      AND PR.NUMLIN = L.NUMLIN AND PR.IDPROMOCION = @PROMOCION)`);
    params.PROMOCION = p(() => sql.Int, f.promocion);
  }
  const refs = [...new Set((f.referencias ?? []).map((r) => r.trim()).filter(Boolean))].slice(0, 200);
  if (refs.length) {
    w.push(`ART.REFPROVEEDOR IN (${refs.map((_, i) => `@REF${i}`).join(', ')})`);
    refs.forEach((r, i) => (params[`REF${i}`] = p(() => sql.NVarChar(50), r)));
  }
  const jerarquia: [keyof FiltrosVentas, string][] = [
    ['dpto', 'DPTO'],
    ['seccion', 'SECCION'],
    ['familia', 'FAMILIA'],
    ['subfamilia', 'SUBFAMILIA'],
  ];
  for (const [k, col] of jerarquia) {
    if (f[k] == null) break;
    w.push(`ART.${col} = @${col}`);
    params[col] = p(() => sql.Int, f[k]);
  }
  if (f.marca != null) {
    w.push('ART.MARCA = @MARCA');
    params.MARCA = p(() => sql.Int, f.marca);
    if (f.linea != null) {
      w.push('ART.LINEA = @LINEA');
      params.LINEA = p(() => sql.Int, f.linea);
    }
  }
  return { where: w.length ? 'AND ' + w.join('\n      AND ') : '', params };
}

function aFecha(yyyyMMdd: string): Date {
  const d = new Date(Date.UTC(+yyyyMMdd.slice(0, 4), +yyyyMMdd.slice(4, 6) - 1, +yyyyMMdd.slice(6, 8)));
  if (Number.isNaN(d.getTime())) throw new DetalleVentasError(`Fecha inválida: ${yyyyMMdd}`);
  return d;
}

/**
 * Tickets (albaranes) con sus importes ya convertidos, en la tabla temporal #TIC (se
 * calcula una vez y la usan las filas y los totales). `extra` agrega condiciones sobre la
 * cabecera (tienda, día, ticket). Cotización: una vez por fecha, no por línea.
 */
function cteTickets(where: string, extra = ''): string {
  // Por si una consulta anterior falló a mitad en esta conexión del pool.
  return `
IF OBJECT_ID('tempdb..#TIC') IS NOT NULL DROP TABLE #TIC;
IF OBJECT_ID('tempdb..#COT') IS NOT NULL DROP TABLE #COT;
-- Cotización una vez por día: como CTE, SQL Server la recalculaba en cada línea (55 mil
-- llamadas a la función en 9 meses de VELAPARK, ~8 s); en tabla temporal son ~120.
SELECT F.FECHA, dbo.F_GET_COTIZACION(F.FECHA, @MONEDA) AS COT
INTO #COT
FROM (SELECT DISTINCT FECHA FROM ALBVENTACAB WITH (NOLOCK)
      WHERE FECHA BETWEEN @DESDE AND @HASTA AND NUMSERIE NOT LIKE 'Z%') F;
WITH LIN AS (
  SELECT C.NUMSERIE, C.NUMALBARAN, C.N,
         L.UNIDADESTOTAL AS UNIDADES,
         L.TOTAL * (1 - ISNULL(C.DTOCOMERCIAL, 0) / 100.0) * FX.FD AS MONTO,
         L.TOTAL * (1 - ISNULL(C.DTOCOMERCIAL, 0) / 100.0) * ISNULL(L.IVA, 0) / 100.0 * FX.FD AS IVA,
         ISNULL(L.COSTE, 0) * L.UNIDADESTOTAL * X.COT AS COSTO
  FROM ALBVENTACAB C WITH (NOLOCK)
  JOIN ALBVENTALIN L WITH (NOLOCK) ON L.NUMSERIE = C.NUMSERIE AND L.NUMALBARAN = C.NUMALBARAN AND L.N = C.N
  JOIN ARTICULOS ART WITH (NOLOCK) ON ART.CODARTICULO = L.CODARTICULO
  JOIN #COT X ON X.FECHA = C.FECHA
  CROSS APPLY (SELECT CASE WHEN C.CODMONEDA = @MONEDA THEN 1.0 ELSE C.FACTORMONEDA * X.COT END AS FD) FX
  WHERE C.FECHA BETWEEN @DESDE AND @HASTA
    AND C.NUMSERIE NOT LIKE 'Z%'
    ${extra}
    ${where}
),
TIC AS (
  SELECT C.NUMSERIE, C.NUMALBARAN, C.N, C.FECHA,
         SUM(LIN.UNIDADES) AS UNIDADES, SUM(LIN.MONTO) AS MONTO, SUM(LIN.IVA) AS IVA, SUM(LIN.COSTO) AS COSTO,
         MAX(ISNULL(C.TOTALCARGOSDTOS, 0) * CASE WHEN C.CODMONEDA = @MONEDA THEN 1.0 ELSE C.FACTORMONEDA * X.COT END) AS IGTF
  FROM LIN
  JOIN ALBVENTACAB C WITH (NOLOCK) ON C.NUMSERIE = LIN.NUMSERIE AND C.NUMALBARAN = LIN.NUMALBARAN AND C.N = LIN.N
  JOIN #COT X ON X.FECHA = C.FECHA
  GROUP BY C.NUMSERIE, C.NUMALBARAN, C.N, C.FECHA
)
SELECT * INTO #TIC FROM TIC;`;
}

/** Métricas comunes de un grupo de tickets (tienda o día). Divisiones protegidas contra cero. */
const METRICAS = `
  ROUND(SUM(T.MONTO), 2) AS MONTO,
  ROUND(SUM(T.IVA), 2) AS IVA,
  ROUND(SUM(T.IGTF), 2) AS IGTF,
  ROUND(SUM(T.MONTO + T.IVA + T.IGTF), 2) AS TOTAL,
  ROUND(SUM(T.COSTO), 2) AS COSTO,
  ROUND(SUM(T.MONTO) - SUM(T.COSTO), 2) AS BENEFICIO,
  ROUND((SUM(T.MONTO) - SUM(T.COSTO)) * 100.0 / NULLIF(SUM(T.MONTO), 0), 2) AS MARGEN,
  SUM(T.UNIDADES) AS UNIDADES,
  COUNT(*) AS TICKETS,
  ROUND(SUM(T.MONTO + T.IVA + T.IGTF) / NULLIF(COUNT(*), 0), 2) AS PROMEDIO,
  ROUND(SUM(T.UNIDADES) / NULLIF(COUNT(*), 0), 2) AS UPF,
  ROUND(SUM(T.MONTO) / NULLIF(SUM(T.UNIDADES), 0), 2) AS MONTO_UNIDAD`;

export type Fila = Record<string, unknown>;

/** Nivel 1: por tienda (2 primeros caracteres de la serie). Incluye la fila de totales. */
export async function porTienda(bd: string, f: FiltrosVentas): Promise<{ filas: Fila[]; totales: Fila }> {
  const { where, params } = filtrosLineas(f);
  const sqlText = `${cteTickets(where)}
SELECT G.*, LTRIM(RTRIM(ISNULL(S.DESCRIPCION, G.TIENDA))) AS DESCRIPCION
FROM (
  SELECT SUBSTRING(T.NUMSERIE, 1, 2) AS TIENDA, ${METRICAS}
  FROM #TIC T GROUP BY SUBSTRING(T.NUMSERIE, 1, 2)
) G
LEFT JOIN SERIES S WITH (NOLOCK) ON S.SERIE = G.TIENDA
ORDER BY DESCRIPCION;
SELECT ${METRICAS} FROM #TIC T;
DROP TABLE #TIC;
DROP TABLE #COT;`;
  return conTotales(bd, sqlText, params);
}

/** Nivel 2: por día, de una tienda. */
export async function porDia(bd: string, f: FiltrosVentas, tienda: string): Promise<{ filas: Fila[]; totales: Fila }> {
  const { where, params } = filtrosLineas(f);
  params.TIENDA = p(() => sql.NVarChar(2), tienda);
  const extra = "AND C.NUMSERIE LIKE @TIENDA + '%'";
  const sqlText = `${cteTickets(where, extra)}
SELECT CONVERT(varchar(10), T.FECHA, 120) AS FECHA, ${METRICAS}
FROM #TIC T GROUP BY T.FECHA ORDER BY T.FECHA;
SELECT ${METRICAS} FROM #TIC T;
DROP TABLE #TIC;
DROP TABLE #COT;`;
  return conTotales(bd, sqlText, params);
}

/** Nivel 3: tickets de una tienda en un día (con factura, N.º fiscal y Z si los tiene). */
export async function porTicket(bd: string, f: FiltrosVentas, tienda: string, fecha: string): Promise<{ filas: Fila[]; totales: Fila }> {
  const { where, params } = filtrosLineas({ ...f, desde: fecha, hasta: fecha });
  params.TIENDA = p(() => sql.NVarChar(2), tienda);
  const extra = "AND C.NUMSERIE LIKE @TIENDA + '%'";
  const sqlText = `${cteTickets(where, extra)}
SELECT T.NUMSERIE, T.NUMALBARAN, T.N,
       C.CAJA,
       CONVERT(varchar(5), C.HORA, 108) AS HORA,
       CASE WHEN SUBSTRING(T.NUMSERIE, 4, 1) = 'N' OR T.MONTO < 0 THEN 'Nota de crédito' ELSE 'Factura' END AS TIPO,
       CASE WHEN C.NUMFAC IS NULL OR C.NUMFAC = 0 THEN T.NUMSERIE + '-' + CAST(T.NUMALBARAN AS varchar(12))
            ELSE ISNULL(C.NUMSERIEFAC, '') + '-' + CAST(C.NUMFAC AS varchar(12)) END AS DOCUMENTO,
       ISNULL(CL.NFISCAL, '') AS NFISCAL,
       CL.ZFISCAL,
       -- ICG guarda '00000000000' cuando no afecta a ninguna factura.
       CASE WHEN REPLACE(ISNULL(CL.FACAFECTA, ''), '0', '') = '' THEN '' ELSE CL.FACAFECTA END AS FACAFECTA,
       ROUND(T.MONTO, 2) AS MONTO, ROUND(T.IVA, 2) AS IVA, ROUND(T.IGTF, 2) AS IGTF,
       ROUND(T.MONTO + T.IVA + T.IGTF, 2) AS TOTAL, ROUND(T.COSTO, 2) AS COSTO,
       ROUND(T.MONTO - T.COSTO, 2) AS BENEFICIO,
       ROUND((T.MONTO - T.COSTO) * 100.0 / NULLIF(T.MONTO, 0), 2) AS MARGEN,
       T.UNIDADES
FROM #TIC T
JOIN ALBVENTACAB C WITH (NOLOCK) ON C.NUMSERIE = T.NUMSERIE AND C.NUMALBARAN = T.NUMALBARAN AND C.N = T.N
LEFT JOIN FACTURASVENTACAMPOSLIBRES CL WITH (NOLOCK)
  ON CL.NUMSERIE = C.NUMSERIEFAC AND CL.NUMFACTURA = C.NUMFAC AND CL.N = C.NFAC
ORDER BY C.HORA, T.NUMSERIE, T.NUMALBARAN;
SELECT ${METRICAS} FROM #TIC T;
DROP TABLE #TIC;
DROP TABLE #COT;`;
  return conTotales(bd, sqlText, params);
}

/** Nivel 4: líneas de un ticket. Mismos filtros, para que sumen lo que se vio en el nivel 3. */
export async function lineasTicket(
  bd: string,
  f: FiltrosVentas,
  ticket: { numSerie: string; numAlbaran: number; n: string },
): Promise<{ filas: Fila[]; totales: Fila }> {
  const { where, params } = filtrosLineas(f);
  params.NUMSERIE = p(() => sql.NVarChar(4), ticket.numSerie);
  params.NUMALBARAN = p(() => sql.Int, ticket.numAlbaran);
  params.NTICKET = p(() => sql.NChar(1), ticket.n);
  const sqlText = `
WITH X AS (
  SELECT C.FECHA, dbo.F_GET_COTIZACION(C.FECHA, @MONEDA) AS COT,
         CASE WHEN C.CODMONEDA = @MONEDA THEN 1.0 ELSE C.FACTORMONEDA * dbo.F_GET_COTIZACION(C.FECHA, @MONEDA) END AS FD
  FROM ALBVENTACAB C WITH (NOLOCK)
  WHERE C.NUMSERIE = @NUMSERIE AND C.NUMALBARAN = @NUMALBARAN AND C.N = @NTICKET
),
LIN AS (
  SELECT L.NUMLIN,
         ISNULL(VC.NOMVENDEDOR, '') AS CAJERO,
         ISNULL(VL.NOMVENDEDOR, '') AS VENDEDOR,
         ART.REFPROVEEDOR, ART.DESCRIPCION, L.TALLA, L.COLOR,
         L.UNIDADESTOTAL AS UNIDADES,
         ROUND(L.PRECIO * X.FD, 2) AS PRECIO,
         ISNULL(L.DTO, 0) AS DTO_LINEA,
         ISNULL(C.DTOCOMERCIAL, 0) AS DTO_FACTURA,
         L.TOTAL * (1 - ISNULL(C.DTOCOMERCIAL, 0) / 100.0) * X.FD AS MONTO,
         L.TOTAL * (1 - ISNULL(C.DTOCOMERCIAL, 0) / 100.0) * ISNULL(L.IVA, 0) / 100.0 * X.FD AS IVA,
         ISNULL(L.COSTE, 0) * L.UNIDADESTOTAL * X.COT AS COSTO
  FROM ALBVENTACAB C WITH (NOLOCK)
  CROSS JOIN X
  JOIN ALBVENTALIN L WITH (NOLOCK) ON L.NUMSERIE = C.NUMSERIE AND L.NUMALBARAN = C.NUMALBARAN AND L.N = C.N
  JOIN ARTICULOS ART WITH (NOLOCK) ON ART.CODARTICULO = L.CODARTICULO
  LEFT JOIN VENDEDORES VC WITH (NOLOCK) ON VC.CODVENDEDOR = C.CODVENDEDOR
  LEFT JOIN VENDEDORES VL WITH (NOLOCK) ON VL.CODVENDEDOR = L.CODVENDEDOR
  WHERE C.NUMSERIE = @NUMSERIE AND C.NUMALBARAN = @NUMALBARAN AND C.N = @NTICKET
    AND C.FECHA BETWEEN @DESDE AND @HASTA
    ${where}
)
SELECT NUMLIN, CAJERO, VENDEDOR, REFPROVEEDOR, DESCRIPCION, TALLA, COLOR, UNIDADES, PRECIO, DTO_LINEA, DTO_FACTURA,
       ROUND(MONTO, 2) AS MONTO, ROUND(IVA, 2) AS IVA, ROUND(COSTO, 2) AS COSTO,
       ROUND(MONTO - COSTO, 2) AS BENEFICIO, ROUND((MONTO - COSTO) * 100.0 / NULLIF(MONTO, 0), 2) AS MARGEN
FROM LIN ORDER BY NUMLIN;`;
  const filas = await queryTenantRaw<Fila>(bd, sqlText, params);
  const suma = (k: string) => Math.round(filas.reduce((a, r) => a + Number(r[k] ?? 0), 0) * 100) / 100;
  const monto = suma('MONTO');
  const costo = suma('COSTO');
  return {
    filas,
    totales: {
      UNIDADES: suma('UNIDADES'),
      MONTO: monto,
      IVA: suma('IVA'),
      COSTO: costo,
      BENEFICIO: Math.round((monto - costo) * 100) / 100,
      MARGEN: monto ? Math.round(((monto - costo) * 100) / monto * 100) / 100 : null,
    },
  };
}

/** Ejecuta dos SELECT (filas y totales) en una sola ida al servidor. */
async function conTotales(bd: string, sqlText: string, params: Record<string, SpParam>): Promise<{ filas: Fila[]; totales: Fila }> {
  const conjuntos = await queryTenantMulti<Fila>(bd, sqlText, params);
  return { filas: conjuntos[0] ?? [], totales: conjuntos[1]?.[0] ?? {} };
}

// --- Catálogos de los filtros ---

export async function catalogos(bd: string) {
  const [grupos, promociones, departamentos, marcas] = await Promise.all([
    queryTenantRaw<Fila>(bd, "SELECT SERIE, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM SERIES WITH (NOLOCK) WHERE SERIE LIKE '_' AND SERIE <> 'Z' ORDER BY SERIE"),
    queryTenantRaw<Fila>(bd, 'SELECT IDPROMOCION, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM PROMOCIONES WITH (NOLOCK) ORDER BY DESCRIPCION'),
    queryTenantRaw<Fila>(bd, 'SELECT NUMDPTO AS ID, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM DEPARTAMENTO WITH (NOLOCK) ORDER BY DESCRIPCION'),
    queryTenantRaw<Fila>(bd, 'SELECT CODMARCA AS ID, LTRIM(RTRIM(DESCRIPCION)) AS DESCRIPCION FROM MARCA WITH (NOLOCK) ORDER BY DESCRIPCION'),
  ]);
  return {
    grupos: grupos.map((g) => ({ serie: String(g.SERIE).trim(), descripcion: String(g.DESCRIPCION ?? '') })),
    promociones: promociones.map((x) => ({ id: Number(x.IDPROMOCION), descripcion: String(x.DESCRIPCION ?? '') })),
    departamentos: departamentos.map(opcion),
    marcas: marcas.map(opcion),
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
