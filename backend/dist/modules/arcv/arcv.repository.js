import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
/** `EXEC rip.MR_FORMATO_ARCV @DESDE,@HASTA,@EMPRESA,@SUCURSAL,@PROVEEDOR` (Java bound these positionally via a DECLARE block). */
export async function getArcv(bd, params) {
    return execTenantSP(bd, 'rip.MR_FORMATO_ARCV', {
        DESDE: { type: () => sql.NVarChar(8), value: params.desde },
        HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
        EMPRESA: { type: () => sql.NVarChar(2), value: params.codEmpresa },
        SUCURSAL: { type: () => sql.NVarChar(3), value: params.codSucursal },
        PROVEEDOR: { type: () => sql.Int, value: params.codProveedor },
    });
}
//# sourceMappingURL=arcv.repository.js.map