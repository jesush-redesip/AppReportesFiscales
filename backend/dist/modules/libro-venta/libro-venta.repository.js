import sql from 'mssql';
import { execTenantSP, queryTenantRaw } from '../../shared/db/tenant-pool.js';
function spParams(p) {
    return {
        DESDE: { type: () => sql.NVarChar(8), value: p.desde },
        HASTA: { type: () => sql.NVarChar(8), value: p.hasta },
        EMPRESA: { type: () => sql.NVarChar(10), value: p.codEmpresa },
        SUCURSAL: { type: () => sql.NVarChar(10), value: p.codSucursal },
        IMPRESORA: { type: () => sql.NVarChar(50), value: p.serialImpresora },
        CODTIPOPAGO: { type: () => sql.NVarChar(10), value: p.codFormaPagoRetencion },
        CODMONEDA: { type: () => sql.Int, value: p.codMoneda },
        UTIL_AREA_EMPRESAS: { type: () => sql.NVarChar(10), value: p.areaEmpresas },
    };
}
/** `EXEC [rip].[MR_LIBRO_VENTA] @DESDE,@HASTA,@EMPRESA,@SUCURSAL,@IMPRESORA,@CODTIPOPAGO,@CODMONEDA,@UTIL_AREA_EMPRESAS` */
export async function getLibroVenta(bd, params) {
    return execTenantSP(bd, 'rip.MR_LIBRO_VENTA', spParams(params));
}
/** `EXEC [rip].[MR_LIBRO_VENTA2]` — retenciones rezagadas de períodos anteriores, mismos parámetros. */
export async function getLibroVentaRetencionesViejas(bd, params) {
    return execTenantSP(bd, 'rip.MR_LIBRO_VENTA2', spParams(params));
}
/**
 * Port of `LibroVenta.getQuerySucursales()` — inline SQL (not a stored procedure) that
 * lists sub-branches under an empresa for the header block. The Java version declared
 * local `@EMPRESA`/`@SUCURSAL` variables purely to work around positional (`?`) JDBC
 * binding; `mssql` supports named parameters directly, so the concatenation is inlined.
 */
export async function getSucursalesParaEncabezado(bd, codEmpresa, codSucursal) {
    return queryTenantRaw(bd, `SELECT SUBSTRING(S.SERIE,2,1)+': '+S.DESCRIPCION AS SUCURSAL
     FROM SERIES S
     WHERE S.SERIE LIKE @EMPRESA + '_'
       AND (S.SERIE = @SUCURSAL OR ISNULL(@SUCURSAL,'') = '')`, {
        EMPRESA: { type: () => sql.NVarChar(2), value: codEmpresa },
        SUCURSAL: { type: () => sql.NVarChar(3), value: codSucursal },
    });
}
//# sourceMappingURL=libro-venta.repository.js.map