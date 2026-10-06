import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { loadTemplate, copyRow } from '../../shared/excel/template-workbook.js';
import { exportResultSetToSheet } from '../../shared/excel/excel-exporter.js';
import { formatDdMMyyyy, parseYyyyMMdd } from '../../shared/util/date-format.js';
import { reportConfig } from '../../shared/config/report-config.js';
import * as catalogos from '../catalogos/catalogos.repository.js';
import * as repo from './libro-compra.repository.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', '..', 'templates', 'REPORTE_LIBRO_COMPRA.xlsx');
// Ported verbatim from `librocompra.LibroCompra.getLibroCompra` (Java, POI/JDBC) —
// see plan section "template-workbook" for the 0-indexed(Java)/1-indexed(exceljs) row
// mapping convention used throughout: physical row = javaRowIndex + 1.
const START_ROW = 10; // Java iIniciarEnLinea=9 (0-idx) -> exceljs row 10
const TOTALIZE_MASK = '000000000000001111111111100111';
const MERGE_LAST_COL = 14; // Java colFinUnion=13 (0-idx) -> exceljs column 14 (N)
const STYLE_LOOP_START = 10; // Java filaInicioExportacion=9 (0-idx) -> exceljs row 10
const BORDER_THIN = { style: 'thin' };
const BORDERS_ALL = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
const NUM_FORMAT = '#,##0.00';
/** NRO (el correlativo) es un identificador: entero, sin el formato de moneda. */
const MONEY_MASK = '0' + '1'.repeat(29);
/** Nombres con los que el SP podría traer la fecha del comprobante de retención. */
const NOMBRES_FECHA_RETENCION = ['FECHARETENCION', 'FECHA_RETENCION', 'FECHARETENCIONIVA', 'FECHA_RETENCION_IVA'];
const COL_FECHA_RETENCION = '__FECHA_RETENCION';
/**
 * La plantilla tiene 30 columnas: el bloque "DATOS DE LA RETENCIÓN" es FECHA · NRO
 * COMPROBANTE · I.V.A. RETENIDO, y después IGTF. `rip.MR_LIBRO_COMPRA` sí calcula la
 * fecha de la retención, pero con el alias `FECHA`, igual que la fecha de la factura:
 * el driver junta los dos en uno (llegan 29 columnas) y todo desde el comprobante quedaba
 * corrido una
 * columna a la izquierda (el IVA retenido bajo "NRO COMPROBANTE", la base IGTF bajo
 * "I.V.A. RETENIDO"...). Eso además rompía el resumen del pie, que toma el IVA retenido
 * de la columna AB, y la máscara de totales (pensada para 30 columnas).
 *
 * Se inserta la columna de la fecha justo antes de NUMRETENCIONIVA, con la fecha de la
 * retención venga como venga (ver abajo), o vacía si no hay retención.
 */
function alinearConPlantilla(r) {
    const mayus = (n) => n.toUpperCase();
    const fechaCol = r.columns.find((c) => NOMBRES_FECHA_RETENCION.includes(mayus(c.name)));
    const otras = r.columns.filter((c) => c !== fechaCol);
    const iNum = otras.findIndex((c) => mayus(c.name) === 'NUMRETENCIONIVA');
    if (iNum < 0)
        return r;
    const columns = [...otras.slice(0, iNum), { name: COL_FECHA_RETENCION, sqlType: 'NVarChar' }, ...otras.slice(iNum)];
    const rows = r.rows.map((row) => {
        // Con el alias renombrado (script ALTER_MR_LIBRO_COMPRA_FECHARETENCION) llega con su
        // nombre; si no, es el segundo "FECHA", que tenant-pool conserva como FECHA__2.
        const v = fechaCol ? row[fechaCol.name] : (row.FECHA__2 ?? null);
        return { ...row, [COL_FECHA_RETENCION]: v instanceof Date ? formatDdMMyyyy(v) : (v ?? null) };
    });
    return { rows, columns };
}
function isNumericOrFormula(cell) {
    return cell.type === ExcelJS.ValueType.Number || cell.type === ExcelJS.ValueType.Formula;
}
export async function generarLibroCompra(bd, query) {
    const [empresas, sucursales] = await Promise.all([
        catalogos.getEmpresas(bd, reportConfig.areaEmpresas + '%'),
        query.sucursal ? catalogos.getSucursales(bd, query.empresa) : Promise.resolve([]),
    ]);
    const empresa = empresas.find((e) => e.codEmpresa === query.empresa);
    const sucursal = query.sucursal ? sucursales.find((s) => s.codSucursal === query.sucursal) : undefined;
    const nombreCliente = empresa?.nombreCliente ?? sucursal?.nombreCliente ?? '';
    const rif = empresa?.rif ?? sucursal?.rif ?? '';
    const direccion = empresa?.direccion ?? sucursal?.direccion ?? '';
    const wb = await loadTemplate(TEMPLATE_PATH);
    const sheet = wb.worksheets[0];
    // Header block (Java rows 0,1,2,5 0-idx / col 1 0-idx -> exceljs rows 1,2,3,6 / col 2)
    sheet.getRow(1).getCell(2).value = nombreCliente;
    sheet.getRow(2).getCell(2).value = `R.I.F: ${rif}`;
    sheet.getRow(3).getCell(2).value = `DOMICILIO FISCAL: ${direccion}`;
    const ffe = formatDdMMyyyy(parseYyyyMMdd(query.desde));
    const ffs = formatDdMMyyyy(parseYyyyMMdd(query.hasta));
    sheet.getRow(6).getCell(2).value = `PERIODO IMPOSICION:  ${ffe} al ${ffs}`;
    const { rows, columns } = alinearConPlantilla(await repo.getLibroCompra(bd, {
        desde: query.desde,
        hasta: query.hasta,
        codEmpresa: query.empresa,
        codSucursal: query.sucursal ?? '',
        codMoneda: query.moneda,
        codRetencionConcepto: reportConfig.codRetencionConcepto,
        areaEmpresas: reportConfig.areaEmpresas,
        codAlmacen: query.almacen ?? '',
    }));
    const { lastRow: nodeLastRow } = exportResultSetToSheet(sheet, rows, columns, {
        startRow: START_ROW,
        showHeader: false,
        totalize: true,
        totalizeMask: TOTALIZE_MASK,
        moneyMask: MONEY_MASK,
    });
    // javaUltRegistro mirrors the Java `iUltRegistro` (POI 0-indexed last written row).
    const javaUltRegistro = nodeLastRow - 1;
    const numCols = columns.length;
    // --- POI-equivalent styling pass (bordes, negrita, formato numérico) ---
    for (let physicalRow = STYLE_LOOP_START; physicalRow <= nodeLastRow; physicalRow++) {
        const esUltimaLinea = physicalRow === nodeLastRow;
        const row = sheet.getRow(physicalRow);
        for (let j = 0; j < numCols; j++) {
            const cell = row.getCell(j + 1);
            const numeric = j > 0 && isNumericOrFormula(cell);
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = BORDERS_ALL;
            cell.font = { bold: esUltimaLinea };
            if (numeric)
                cell.numFmt = NUM_FORMAT;
            else if (j === 0 && !esUltimaLinea && isNumericOrFormula(cell))
                cell.numFmt = '0';
        }
    }
    sheet.mergeCells(nodeLastRow, 1, nodeLastRow, MERGE_LAST_COL);
    const totalCell = sheet.getRow(nodeLastRow).getCell(1);
    totalCell.value = 'TOTAL COMPRAS CONSOLIDADAS: ';
    // --- Copy the 10 SUMIF/footer rows from the auxiliary template sheet ---
    const auxSheet = wb.worksheets[1];
    const iFila = javaUltRegistro + 2; // Java-index space
    if (auxSheet) {
        for (let iCopy = 1; iCopy <= 10; iCopy++) {
            copyRow(auxSheet, sheet, iCopy + 1, iFila + iCopy + 1);
        }
    }
    // --- Formula patch block (bug-for-bug port of the Java try/catch block) ---
    const u = javaUltRegistro;
    const colO = 15;
    const colP = 16;
    const colQ = 17;
    const rangeUpper = u; // bare `iUltRegistro` embedded directly in A1 ranges, as Java does
    sheet.getRow(u + 4 + 1).getCell(colO).value = { formula: `P${u + 1}` };
    sheet.getRow(u + 5 + 1).getCell(colO).value = { formula: `Q${u + 1}` };
    const r6 = sheet.getRow(u + 6 + 1);
    r6.getCell(colO).value = { formula: `SUMIF(H9:H${rangeUpper},"<>",R9:R${rangeUpper})` };
    r6.getCell(colP).value = { formula: `SUMIF(H9:H${rangeUpper},"<>",S9:S${rangeUpper})` };
    const r7 = sheet.getRow(u + 7 + 1);
    r7.getCell(colO).value = { formula: `SUMIF(H9:H${rangeUpper},"<>",V9:V${rangeUpper})` };
    r7.getCell(colP).value = { formula: `SUMIF(H9:H${rangeUpper},"<>",W9:W${rangeUpper})` };
    const r8 = sheet.getRow(u + 8 + 1);
    r8.getCell(colO).value = { formula: `SUMIF(H9:H${rangeUpper},"<>",T9:T${rangeUpper})` };
    r8.getCell(colP).value = { formula: `SUMIF(H9:H${rangeUpper},"<>",U9:U${rangeUpper})` };
    const r9 = sheet.getRow(u + 9 + 1);
    r9.getCell(colO).value = { formula: `SUMIF(H9:H${rangeUpper},"",R9:R${rangeUpper})` };
    r9.getCell(colP).value = { formula: `SUMIF(H9:H${rangeUpper},"",S9:S${rangeUpper})` };
    r9.getCell(colQ).value = { formula: `AB${u + 1}` };
    const r10 = sheet.getRow(u + 10 + 1);
    r10.getCell(colO).value = { formula: `SUMIF(H9:H${rangeUpper},"",V9:V${rangeUpper})` };
    r10.getCell(colP).value = { formula: `SUMIF(H9:H${rangeUpper},"",W9:W${rangeUpper})` };
    const r11 = sheet.getRow(u + 11 + 1);
    r11.getCell(colO).value = { formula: `SUMIF(H9:H${rangeUpper},"",T9:T${rangeUpper})` };
    r11.getCell(colP).value = { formula: `SUMIF(H9:H${rangeUpper},"",U9:U${rangeUpper})` };
    const r12 = sheet.getRow(u + 12 + 1);
    r12.getCell(colO).value = { formula: `SUM(O${u + 5}:O${u + 12})` };
    r12.getCell(colP).value = { formula: `SUM(P${u + 5}:P${u + 12})` };
    r12.getCell(colQ).value = { formula: `SUM(Q${u + 5}:Q${u + 12})` };
    if (auxSheet)
        wb.removeWorksheet(auxSheet.id);
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
//# sourceMappingURL=libro-compra.service.js.map