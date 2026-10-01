import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplate, copyRow } from '../../shared/excel/template-workbook.js';
import { exportResultSetToSheet } from '../../shared/excel/excel-exporter.js';
import { formatDdMMyyyy, parseYyyyMMdd } from '../../shared/util/date-format.js';
import * as catalogos from '../catalogos/catalogos.repository.js';
import * as repo from './arcv.repository.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', '..', 'templates', 'REPORTE_RETENCIONES.xlsx');
// Ported from `retenciones.Retenciones.getRetenciones` (Java, POI/JDBC). Physical row
// = javaRowIndex + 1 (same convention as the other report modules).
const START_ROW = 13; // Java iIniciarEnLinea=12 (0-idx) -> exceljs row 13
const TOTALIZE_MASK = '000110100';
/** `if (rif starts with "J") "JURIDICO" else "NATURAL"` — Venezuelan RIF prefix convention. */
function tipoPersona(rif) {
    return rif.startsWith('J') ? 'JURIDICO' : 'NATURAL';
}
export async function generarArcv(bd, query) {
    const [empresas, sucursales, proveedores] = await Promise.all([
        catalogos.getEmpresas(bd, 'Z%'),
        query.sucursal ? catalogos.getSucursales(bd, query.empresa) : Promise.resolve([]),
        catalogos.getProveedores(bd),
    ]);
    const empresa = empresas.find((e) => e.codEmpresa === query.empresa);
    const sucursal = query.sucursal ? sucursales.find((s) => s.codSucursal === query.sucursal) : undefined;
    const proveedor = proveedores.find((p) => p.codProveedor === query.proveedor);
    const nombreCliente = sucursal?.nombreCliente ?? empresa?.nombreCliente ?? '';
    const rifAgente = sucursal?.rif ?? empresa?.rif ?? '';
    const direccionAgente = sucursal?.direccion ?? empresa?.direccion ?? '';
    const rifProveedor = proveedor?.rif ?? '';
    const wb = await loadTemplate(TEMPLATE_PATH);
    const sheet = wb.worksheets[0];
    sheet.getRow(5).getCell(1).value = `NOMBRE: ${nombreCliente}`;
    sheet.getRow(5).getCell(6).value = `NOMBRE O RAZON SOCIAL: ${proveedor?.nombre ?? ''}`;
    // Bug-for-bug port: the Java checks `empresa.getRif() == null` but then, if that's
    // false, uses `sucursal.getRif()` (not empresa's) for the actual tipo-persona lookup
    // — an existing quirk, preserved rather than "fixed" per the migration's approach to
    // this kind of pre-existing behavior.
    const agenteRifParaTipo = empresa?.rif == null ? 'RIF: ' : rifAgente;
    sheet.getRow(6).getCell(1).value = `TIPO DE AGENTE DE RETENCION: ${tipoPersona(agenteRifParaTipo)}`;
    sheet.getRow(6).getCell(6).value = `TIPO DE PERSONA: ${tipoPersona(proveedor?.rif ?? 'RIF: ')}`;
    sheet.getRow(7).getCell(1).value = `RIF: ${rifAgente}`;
    sheet.getRow(7).getCell(6).value = `RIF: ${rifProveedor}`;
    sheet.getRow(8).getCell(1).value = `DIRECCION: ${direccionAgente}`;
    sheet.getRow(8).getCell(6).value = `DIRECCION: ${proveedor?.direccion ?? ''}`;
    const anioFiscalAnterior = new Date().getFullYear() - 1;
    sheet.getRow(10).getCell(5).value = `31 | 12 | ${anioFiscalAnterior}`;
    sheet.getRow(10).getCell(8).value = formatDdMMyyyy(parseYyyyMMdd(query.desde));
    sheet.getRow(10).getCell(9).value = formatDdMMyyyy(parseYyyyMMdd(query.hasta));
    const { rows, columns } = await repo.getArcv(bd, {
        desde: query.desde,
        hasta: query.hasta,
        codEmpresa: query.empresa,
        codSucursal: query.sucursal ?? '',
        codProveedor: query.proveedor,
    });
    const { lastRow: nodeLastRow } = exportResultSetToSheet(sheet, rows, columns, {
        startRow: START_ROW,
        showHeader: false,
        totalize: true,
        totalizeMask: TOTALIZE_MASK,
    });
    const javaUltRegistro = nodeLastRow - 1;
    const iFila = javaUltRegistro + 2; // Java-index space
    const auxSheet = wb.worksheets[1];
    if (auxSheet) {
        for (let iCopy = 1; iCopy <= 6; iCopy++) {
            copyRow(auxSheet, sheet, iCopy + 1, iFila + iCopy + 1);
        }
    }
    // FIRMA (signature image) insertion deliberately NOT ported — deferred per an
    // explicit decision during the migration: the legacy `FIRMA` column stores a local
    // filesystem path, meaningless on a centralized backend. Revisit once a storage
    // strategy (VARBINARY in DB vs. shared volume) is chosen.
    if (auxSheet)
        wb.removeWorksheet(auxSheet.id);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
//# sourceMappingURL=arcv.service.js.map