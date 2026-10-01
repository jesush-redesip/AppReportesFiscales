import sql from 'mssql';
import { execTenantSP } from '../../shared/db/tenant-pool.js';
/** `Util.AREA_ADMINISTRATIVA` in the legacy app — a per-client scope filter, e.g. "Z%". */
export async function getEmpresas(bd, areaAdministrativa) {
    // Java bound this positionally (`EXEC rip.MR_GET_EMPRESAS ?`), so the source never
    // revealed the real parameter name — confirmed against sys.parameters: it's `@SERIE`.
    const { rows } = await execTenantSP(bd, 'rip.MR_GET_EMPRESAS', {
        SERIE: { type: () => sql.NVarChar(10), value: areaAdministrativa },
    });
    return rows.map((r) => ({
        codEmpresa: String(r.SERIE ?? ''),
        nombre: String(r.DESCRIPCION ?? ''),
        nombreCliente: String(r.NOMBRECLIENTE ?? ''),
        rif: String(r.RIF ?? ''),
        direccion: String(r.DIRECCION1 ?? ''),
        codCliente: Number(r.CODCLIENTE ?? 0),
    }));
}
export async function getSucursales(bd, empresa) {
    const { rows } = await execTenantSP(bd, 'rip.MR_GET_SUCURSALES', {
        EMPRESA: { type: () => sql.NVarChar(10), value: empresa },
    });
    return rows.map((r) => ({
        codSucursal: String(r.SERIE ?? ''),
        descripcion: String(r.DESCRIPCION ?? ''),
        nombreCliente: String(r.NOMBRECLIENTE ?? ''),
        nombreComercial: String(r.NOMBRECOMERCIAL ?? ''),
        rif: String(r.RIF ?? ''),
        direccion: String(r.DIRECCION1 ?? ''),
        codCliente: Number(r.CODCLIENTE ?? 0),
    }));
}
export async function getAlmacenes(bd) {
    const { rows } = await execTenantSP(bd, 'rip.MR_GET_ALMACENES');
    return rows.map((r) => ({
        codAlmacen: String(r.CODALMACEN ?? ''),
        nombre: String(r.NOMBREALMACEN ?? ''),
        nombreCliente: String(r.NOMBRECLIENTE ?? ''),
        rif: String(r.RIF ?? ''),
        direccion: String(r.DIRECCION ?? ''),
    }));
}
export async function getMonedas(bd) {
    const { rows } = await execTenantSP(bd, 'rip.MR_GET_MONEDAS');
    return rows.map((r) => ({
        codMoneda: Number(r.CODMONEDA ?? 0),
        descripcion: String(r.DESCRIPCION ?? ''),
        iniciales: String(r.INICIALES ?? ''),
        principal: String(r.PRINCIPAL ?? '').trim().toUpperCase() === 'T',
        cotizacion: Number(r.COTDEF ?? 0),
    }));
}
export async function getProveedores(bd) {
    const { rows } = await execTenantSP(bd, 'rip.MR_GET_PROVEEDORES');
    return rows.map((r) => ({
        codProveedor: Number(r.CODPROVEEDOR ?? 0),
        nombre: String(r.NOMPROVEEDOR ?? '').trim(),
        rif: String(r.NIF20 ?? '').trim(),
        direccion: String(r.DIRECCION1 ?? '').trim(),
    }));
}
export async function getImpresoras(bd, empresa, sucursal, almacen) {
    const { rows } = await execTenantSP(bd, 'rip.MR_GET_IMPRESORAS', {
        EMPRESA: { type: () => sql.NVarChar(10), value: empresa },
        SUCURSAL: { type: () => sql.NVarChar(10), value: sucursal ?? null },
        ALMACEN: { type: () => sql.NVarChar(10), value: almacen ?? null },
    });
    return rows.map((r) => ({
        lugar: String(r.LUGAR ?? '').trim(),
        serial: String(r.SFISCAL ?? '').trim(),
        impresora: String(r.IMPRESORA ?? '').trim(),
        modelo: String(r.MODELO ?? '').trim(),
    }));
}
//# sourceMappingURL=catalogos.repository.js.map