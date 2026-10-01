import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
import type { SpResult } from '../../shared/db/sp-runner.js';

export interface RetencionesIvaParams {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  codEmpresa: string;
  codSucursal: string; // "" if none
}

/** `EXEC rip.MR_RETENCIONES_IVA @DESDE,@HASTA,@EMPRESA,@SUCURSAL` */
export async function getRetencionesIva(bd: string, params: RetencionesIvaParams): Promise<SpResult> {
  return execTenantSP(bd, 'rip.MR_RETENCIONES_IVA', {
    DESDE: { type: () => sql.NVarChar(8), value: params.desde },
    HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
    EMPRESA: { type: () => sql.NVarChar(10), value: params.codEmpresa },
    SUCURSAL: { type: () => sql.NVarChar(10), value: params.codSucursal || null },
  });
}
