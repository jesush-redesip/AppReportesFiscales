import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
import type { SpResult } from '../../shared/db/sp-runner.js';

export interface ResumenIgtfParams {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  codEmpresa: string;
  codSucursal: string; // "" if none
}

/** `EXEC rip.MR_RESUMEN_IGTF @DESDE,@HASTA,@EMPRESA,@SUCURSAL` — already returns nicely-labeled columns (Fecha, Establecimiento, Caja, "Serial Imp.", "# Z", Transacciones, "Base Imponible IGTF", "Total IGTF"). */
export async function getResumenIgtf(bd: string, params: ResumenIgtfParams): Promise<SpResult> {
  return execTenantSP(bd, 'rip.MR_RESUMEN_IGTF', {
    DESDE: { type: () => sql.NVarChar(8), value: params.desde },
    HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
    EMPRESA: { type: () => sql.NVarChar(10), value: params.codEmpresa },
    SUCURSAL: { type: () => sql.NVarChar(10), value: params.codSucursal || null },
  });
}
