import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
/** `EXEC rip.MR_RESUMEN_IGTF @DESDE,@HASTA,@EMPRESA,@SUCURSAL` — already returns nicely-labeled columns (Fecha, Establecimiento, Caja, "Serial Imp.", "# Z", Transacciones, "Base Imponible IGTF", "Total IGTF"). */
export async function getResumenIgtf(bd, params) {
    return execTenantSP(bd, 'rip.MR_RESUMEN_IGTF', {
        DESDE: { type: () => sql.NVarChar(8), value: params.desde },
        HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
        EMPRESA: { type: () => sql.NVarChar(10), value: params.codEmpresa },
        SUCURSAL: { type: () => sql.NVarChar(10), value: params.codSucursal || null },
    });
}
//# sourceMappingURL=resumen-igtf.repository.js.map