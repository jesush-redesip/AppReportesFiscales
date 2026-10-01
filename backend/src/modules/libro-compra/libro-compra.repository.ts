import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
import type { SpResult } from '../../shared/db/sp-runner.js';

export interface LibroCompraParams {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  codEmpresa: string;
  codSucursal: string; // "" if none
  codMoneda: number;
  codRetencionConcepto: number;
  areaEmpresas: string;
  codAlmacen: string; // "" if none
}

/** `EXEC [rip].[MR_LIBRO_COMPRA] @DESDE, @HASTA, @EMPRESA, @SUCURSAL, @CODMONEDA, @CODRETENCION, @UTIL_AREA_EMPRESAS, @CODALMACEN` */
export async function getLibroCompra(bd: string, params: LibroCompraParams): Promise<SpResult> {
  return execTenantSP(bd, 'rip.MR_LIBRO_COMPRA', {
    DESDE: { type: () => sql.NVarChar(8), value: params.desde },
    HASTA: { type: () => sql.NVarChar(8), value: params.hasta },
    EMPRESA: { type: () => sql.NVarChar(10), value: params.codEmpresa },
    SUCURSAL: { type: () => sql.NVarChar(10), value: params.codSucursal },
    CODMONEDA: { type: () => sql.Int, value: params.codMoneda },
    CODRETENCION: { type: () => sql.Int, value: params.codRetencionConcepto },
    UTIL_AREA_EMPRESAS: { type: () => sql.NVarChar(10), value: params.areaEmpresas },
    CODALMACEN: { type: () => sql.NVarChar(10), value: params.codAlmacen },
  });
}
