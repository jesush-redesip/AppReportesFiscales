import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
/** `EXEC rip.REPM_MOVIMIENTO_INVENTARIO @DESDE, @HASTA, @ALMACEN` (Java bound these positionally — names confirmed against sys.parameters). */
export async function getMovimientoInventario(bd, params) {
    return execTenantSP(bd, 'rip.REPM_MOVIMIENTO_INVENTARIO', {
        DESDE: { type: () => sql.NVarChar(8), value: params.desde },
        HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
        ALMACEN: { type: () => sql.NVarChar(10), value: params.codAlmacen },
    });
}
//# sourceMappingURL=movimiento-inventario.repository.js.map