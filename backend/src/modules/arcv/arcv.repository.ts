import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
import type { SpResult } from '../../shared/db/sp-runner.js';

export interface ArcvParams {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  codEmpresa: string;
  codSucursal: string; // "" if none
  codProveedor: number;
}

/** `EXEC rip.MR_FORMATO_ARCV @DESDE,@HASTA,@EMPRESA,@SUCURSAL,@PROVEEDOR` (Java bound these positionally via a DECLARE block). */
export async function getArcv(bd: string, params: ArcvParams): Promise<SpResult> {
  return execTenantSP(bd, 'rip.MR_FORMATO_ARCV', {
    DESDE: { type: () => sql.NVarChar(8), value: params.desde },
    HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
    EMPRESA: { type: () => sql.NVarChar(2), value: params.codEmpresa },
    SUCURSAL: { type: () => sql.NVarChar(3), value: params.codSucursal },
    PROVEEDOR: { type: () => sql.Int, value: params.codProveedor },
  });
}
