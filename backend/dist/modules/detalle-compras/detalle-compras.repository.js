import sql from 'mssql';
import { queryTenantMulti, queryTenantRaw } from '../../shared/db/tenant-pool.js';
import { asegurarProcedimiento, ProcedimientoError } from '../../shared/db/procedimientos.js';
import { reportConfig } from '../../shared/config/report-config.js';
export class DetalleComprasError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DetalleComprasError';
    }
}
const p = (type, value) => ({ type, value });
const PROCEDIMIENTO = 'rip.MR_DETALLE_COMPRAS';
/** Código del cargo IGTF en compras (el mismo que usa rip.MR_LIBRO_COMPRA). */
const COD_IGTF = 4;
function aFecha(yyyyMMdd) {
    const d = new Date(Date.UTC(+yyyyMMdd.slice(0, 4), +yyyyMMdd.slice(4, 6) - 1, +yyyyMMdd.slice(6, 8)));
    if (Number.isNaN(d.getTime()))
        throw new DetalleComprasError(`Fecha inválida: ${yyyyMMdd}`);
    return d;
}
async function ejecutar(bd, nivel, f, extra = {}) {
    try {
        await asegurarProcedimiento(bd, PROCEDIMIENTO);
    }
    catch (err) {
        if (err instanceof ProcedimientoError)
            throw new DetalleComprasError(err.message);
        throw err;
    }
    const refs = [...new Set((f.referencias ?? []).map((r) => r.trim()).filter(Boolean))].slice(0, 200);
    const tipos = [...new Set((f.tipos ?? []).filter((t) => Number.isInteger(t)))];
    const params = {
        NIVEL: p(() => sql.VarChar(12), nivel),
        DESDE: p(() => sql.Date, aFecha(f.desde)),
        HASTA: p(() => sql.Date, aFecha(f.hasta)),
        MONEDA: p(() => sql.Int, f.moneda),
        TIPOS: p(() => sql.NVarChar(sql.MAX), tipos.length ? tipos.join(',') : null),
        REFS: p(() => sql.NVarChar(sql.MAX), refs.length ? refs.join(',') : null),
        DPTO: p(() => sql.Int, f.dpto ?? null),
        SECCION: p(() => sql.Int, f.seccion ?? null),
        FAMILIA: p(() => sql.Int, f.familia ?? null),
        SUBFAMILIA: p(() => sql.Int, f.subfamilia ?? null),
        MARCA: p(() => sql.Int, f.marca ?? null),
        LINEA: p(() => sql.Int, f.linea ?? null),
        CODRETENCION: p(() => sql.Int, reportConfig.codRetencionConcepto),
        CODIGTF: p(() => sql.Int, COD_IGTF),
        ...extra,
    };
    const lista = Object.keys(params).map((k) => `@${k} = @${k}`).join(', ');
    const conjuntos = await queryTenantMulti(bd, `EXEC ${PROCEDIMIENTO} ${lista}`, params);
    return { filas: conjuntos[0] ?? [], totales: conjuntos[1]?.[0] ?? {} };
}
export function porTienda(bd, f) {
    return ejecutar(bd, 'TIENDAS', f);
}
export function porProveedor(bd, f, tienda) {
    return ejecutar(bd, 'PROVEEDORES', f, { TIENDA: p(() => sql.NVarChar(2), tienda) });
}
export function porDocumento(bd, f, tienda, proveedor) {
    return ejecutar(bd, 'DOCUMENTOS', f, { TIENDA: p(() => sql.NVarChar(2), tienda), PROVEEDOR: p(() => sql.Int, proveedor) });
}
export function lineasDocumento(bd, f, doc) {
    return ejecutar(bd, 'LINEAS', f, {
        NUMSERIE: p(() => sql.NVarChar(4), doc.numSerie),
        NUMFACTURA: p(() => sql.Int, doc.numFactura),
        N: p(() => sql.NChar(1), doc.n),
    });
}
/**
 * Tipos de documento usados en las compras de esta base, para el filtro. `porDefecto`:
 * todos salvo gastos no deducibles, traspasos y saldos iniciales.
 */
export async function tiposDocumento(bd) {
    const filas = await queryTenantRaw(bd, `SELECT F.TIPODOC, LTRIM(RTRIM(ISNULL(T.DESCRIPCION, ''))) AS DESCRIPCION, COUNT(*) AS DOCUMENTOS
     FROM FACTURASCOMPRA F WITH (NOLOCK)
     LEFT JOIN TIPOSDOC T WITH (NOLOCK) ON T.TIPODOC = F.TIPODOC
     WHERE F.FECHA >= DATEADD(YEAR, -2, GETDATE())
     GROUP BY F.TIPODOC, T.DESCRIPCION
     ORDER BY F.TIPODOC`);
    // Gastos no deducibles, traspasos de fondo y saldos iniciales ("CxP Iniciales") no son compras.
    const excluido = (d) => /no\s*deducible|traspaso|inicial/i.test(d);
    return filas.map((x) => {
        const descripcion = String(x.DESCRIPCION || `Tipo ${x.TIPODOC}`);
        return { id: Number(x.TIPODOC), descripcion, documentos: Number(x.DOCUMENTOS), porDefecto: !excluido(descripcion) };
    });
}
//# sourceMappingURL=detalle-compras.repository.js.map