import sql from 'mssql';
import { execTenantSP, queryTenantRaw } from '../../shared/db/tenant-pool.js';
/**
 * Port of `libroventaisla.Impresora.getImpresoras(desde, hasta, codAlmacen)` — raw SQL
 * (not a stored procedure) listing fiscal-printer serials used at an almacén within a
 * date range. The Java version wrapped this in a `DECLARE @X = ?` block purely to work
 * around positional JDBC binding; `mssql` supports named parameters directly.
 */
export async function getImpresorasFiscales(bd, desde, hasta, codAlmacen) {
    const rows = await queryTenantRaw(bd, `SELECT SUBSTRING(FVCL.NUMSERIE,1,2) AS TIENDA, FVCL.SFISCAL AS SERIAL
     FROM FACTURASVENTA FV
     INNER JOIN FACTURASVENTACAMPOSLIBRES FVCL ON FV.NUMSERIE=FVCL.NUMSERIE AND FV.NUMFACTURA=FVCL.NUMFACTURA AND FV.N=FVCL.N
     INNER JOIN ALBVENTACAB AVC ON FV.NUMSERIE=AVC.NUMSERIEFAC AND FV.NUMFACTURA=AVC.NUMFAC AND FV.N=AVC.NFAC
     INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE=AVL.NUMSERIE AND AVC.NUMALBARAN=AVL.NUMALBARAN AND AVC.N=AVL.N
     WHERE FV.FECHA BETWEEN @DESDE AND @HASTA
       AND NOT SFISCAL IS NULL
       AND AVL.CODALMACEN=@CODALMACEN
     GROUP BY FVCL.SFISCAL, SUBSTRING(FVCL.NUMSERIE,1,2)
     ORDER BY FVCL.SFISCAL`, {
        DESDE: { type: () => sql.NVarChar(8), value: desde },
        HASTA: { type: () => sql.NVarChar(8), value: hasta },
        CODALMACEN: { type: () => sql.NVarChar(3), value: codAlmacen },
    });
    return rows.map((r) => ({ tienda: r.TIENDA, serial: r.SERIAL }));
}
/** `EXEC [rip].[MR_LIBRO_VENTA_AGRUPADO] @DESDE,@HASTA,@SERIAL,@CODMONEDA=1` (moneda fija en 1, tal cual el Java original). */
export async function getLibroVentaAgrupado(bd, desde, hasta, serial) {
    const { rows } = await execTenantSP(bd, 'rip.MR_LIBRO_VENTA_AGRUPADO', {
        DESDE: { type: () => sql.NVarChar(8), value: desde },
        HASTA: { type: () => sql.NVarChar(8), value: hasta },
        SERIAL: { type: () => sql.NVarChar(50), value: serial },
        CODMONEDA: { type: () => sql.Int, value: 1 },
    });
    return rows;
}
//# sourceMappingURL=libro-venta-isla.repository.js.map