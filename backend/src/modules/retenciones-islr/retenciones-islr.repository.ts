import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
import type { SpResult } from '../../shared/db/sp-runner.js';

export interface RetencionesIslrParams {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  codEmpresa: string;
  codSucursal: string; // "" if none
}

/** `EXEC rip.MR_RETENCIONES_ISLR @DESDE,@HASTA,@EMPRESA,@SUCURSAL` — returns technical column names (CODPROVEEDOR, NOMPROVEEDOR, ...), nice-labeled in the service layer. */
export async function getRetencionesIslr(bd: string, params: RetencionesIslrParams): Promise<SpResult> {
  return execTenantSP(bd, 'rip.MR_RETENCIONES_ISLR', {
    DESDE: { type: () => sql.NVarChar(8), value: params.desde },
    HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
    EMPRESA: { type: () => sql.NVarChar(10), value: params.codEmpresa },
    SUCURSAL: { type: () => sql.NVarChar(10), value: params.codSucursal || null },
  });
}
