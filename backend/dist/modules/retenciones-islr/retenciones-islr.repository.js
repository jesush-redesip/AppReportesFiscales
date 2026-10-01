import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
/** `EXEC rip.MR_RETENCIONES_ISLR @DESDE,@HASTA,@EMPRESA,@SUCURSAL` — returns technical column names (CODPROVEEDOR, NOMPROVEEDOR, ...), nice-labeled in the service layer. */
export async function getRetencionesIslr(bd, params) {
    return execTenantSP(bd, 'rip.MR_RETENCIONES_ISLR', {
        DESDE: { type: () => sql.NVarChar(8), value: params.desde },
        HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
        EMPRESA: { type: () => sql.NVarChar(10), value: params.codEmpresa },
        SUCURSAL: { type: () => sql.NVarChar(10), value: params.codSucursal || null },
    });
}
//# sourceMappingURL=retenciones-islr.repository.js.map