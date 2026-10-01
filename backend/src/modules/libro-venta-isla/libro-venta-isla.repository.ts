import sql from 'mssql';
import { execTenantSP, queryTenantRaw } from '../../shared/db/tenant-pool.js';

export interface ImpresoraFiscal {
  tienda: string;
  serial: string;
}

/**
 * Port of `libroventaisla.Impresora.getImpresoras(desde, hasta, codAlmacen)` — raw SQL
 * (not a stored procedure) listing fiscal-printer serials used at an almacén within a
 * date range. The Java version wrapped this in a `DECLARE @X = ?` block purely to work
 * around positional JDBC binding; `mssql` supports named parameters directly.
 */
export async function getImpresorasFiscales(bd: string, desde: string, hasta: string, codAlmacen: string): Promise<ImpresoraFiscal[]> {
  const rows = await queryTenantRaw<{ TIENDA: string; SERIAL: string }>(
    bd,
    `SELECT SUBSTRING(FVCL.NUMSERIE,1,2) AS TIENDA, FVCL.SFISCAL AS SERIAL
     FROM FACTURASVENTA FV
     INNER JOIN FACTURASVENTACAMPOSLIBRES FVCL ON FV.NUMSERIE=FVCL.NUMSERIE AND FV.NUMFACTURA=FVCL.NUMFACTURA AND FV.N=FVCL.N
     INNER JOIN ALBVENTACAB AVC ON FV.NUMSERIE=AVC.NUMSERIEFAC AND FV.NUMFACTURA=AVC.NUMFAC AND FV.N=AVC.NFAC
     INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE=AVL.NUMSERIE AND AVC.NUMALBARAN=AVL.NUMALBARAN AND AVC.N=AVL.N
     WHERE FV.FECHA BETWEEN @DESDE AND @HASTA
       AND NOT SFISCAL IS NULL
       AND AVL.CODALMACEN=@CODALMACEN
     GROUP BY FVCL.SFISCAL, SUBSTRING(FVCL.NUMSERIE,1,2)
     ORDER BY FVCL.SFISCAL`,
    {
      DESDE: { type: () => sql.NVarChar(8), value: desde },
      HASTA: { type: () => sql.NVarChar(8), value: hasta },
      CODALMACEN: { type: () => sql.NVarChar(3), value: codAlmacen },
    },
  );
  return rows.map((r) => ({ tienda: r.TIENDA, serial: r.SERIAL }));
}

export interface LibroVentaIslaRow {
  FECHA: string;
  // The SP selects ZFISCAL twice — `mssql` merges duplicate-named columns into an
  // array rather than a scalar (see `firstIfArray` in the service).
  ZFISCAL: string | string[];
  FV_INICIAL: string;
  FV_FINAL: string;
  FV_TOTAL: number;
  FV_BASE_REDUCIDO: number;
  FV_IVA_REDUCIDO: number;
  FV_BASE_GENERAL: number;
  FV_IVA_GENERAL: number;
  FV_BASE_ADICIONAL: number;
  FV_IVA_ADICIONAL: number;
  FV_BASE_PERCIBIDO: number;
  FV_IVA_PERCIBIDO: number;
  FV_BASE_EXENTO: number;
  FV_IVA_EXENTO: number;
  FV_BASE_IGTF: number;
  FV_IGTF: number;
  ND_INICIAL: string;
  ND_FINAL: string;
  ND_TOTAL: number;
  ND_BASE_GENERAL: number;
  ND_IVA_GENERAL: number;
  NC_INICIAL: string;
  NC_FINAL: string;
  NC_TOTAL: number;
  NC_BASE_REDUCIDO: number;
  NC_IVA_REDUCIDO: number;
  NC_BASE_GENERAL: number;
  NC_IVA_GENERAL: number;
  NC_BASE_ADICIONAL: number;
  NC_IVA_ADICIONAL: number;
  NC_BASE_PERCIBIDO: number;
  NC_IVA_PERCIBIDO: number;
  NC_BASE_EXENTO: number;
  NC_IVA_EXENTO: number;
  NC_BASE_IGTF: number;
  NC_IGTF: number;
}

/** `EXEC [rip].[MR_LIBRO_VENTA_AGRUPADO] @DESDE,@HASTA,@SERIAL,@CODMONEDA=1` (moneda fija en 1, tal cual el Java original). */
export async function getLibroVentaAgrupado(bd: string, desde: string, hasta: string, serial: string): Promise<LibroVentaIslaRow[]> {
  const { rows } = await execTenantSP<LibroVentaIslaRow>(bd, 'rip.MR_LIBRO_VENTA_AGRUPADO', {
    DESDE: { type: () => sql.NVarChar(8), value: desde },
    HASTA: { type: () => sql.NVarChar(8), value: hasta },
    SERIAL: { type: () => sql.NVarChar(50), value: serial },
    CODMONEDA: { type: () => sql.Int, value: 1 },
  });
  return rows;
}
