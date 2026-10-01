import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
/** `EXEC rip.MR_RETENCIONES_IVA @DESDE,@HASTA,@EMPRESA,@SUCURSAL` */
export async function getRetencionesIva(bd, params) {
    return execTenantSP(bd, 'rip.MR_RETENCIONES_IVA', {
        DESDE: { type: () => sql.NVarChar(8), value: params.desde },
        HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
        EMPRESA: { type: () => sql.NVarChar(10), value: params.codEmpresa },
        SUCURSAL: { type: () => sql.NVarChar(10), value: params.codSucursal || null },
    });
}
//# sourceMappingURL=retenciones-iva.repository.js.map