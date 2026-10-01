import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplate, cloneSheetInto } from '../../shared/excel/template-workbook.js';
import { formatDdMMyyyy, parseYyyyMMdd } from '../../shared/util/date-format.js';
import * as catalogos from '../catalogos/catalogos.repository.js';
import * as repo from './libro-venta-isla.repository.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', '..', 'templates', 'REPORTE_LIBRO_VENTA_ISLA.xlsx');
const TEMPLATE_SHEET_COUNT = 20;
// Ported from `libroventaisla.LibroVentaIsla.getLibroVentaIsla` (Java, POI/JDBC).
// Physical row/col = javaIndex + 1 (same convention as the other report modules).
const FILA_INICIAL = 12; // Java iFilaInicial=11 (0-idx) -> exceljs row 12
const FILA_TITULO_IMPRESORA = 10; // Java iFilaInicial-2=9 (0-idx) -> exceljs row 10
const COL_INICIAL = 8; // Java iColInicial=7 (0-idx) -> exceljs col 8
const COLUMNAS_POR_IMPRESORA = 42;
function setNum(row, col, raw) {
    row.getCell(col).value = raw === null || raw === undefined ? 0 : Number(raw);
}
function setText(row, col, raw) {
    row.getCell(col).value = raw === null || raw === undefined ? null : String(raw);
}
export async function generarLibroVentaIsla(bd, query) {
    const [almacenes, impresoras] = await Promise.all([
        catalogos.getAlmacenes(bd),
        repo.getImpresorasFiscales(bd, query.desde, query.hasta, query.almacen),
    ]);
    const almacen = almacenes.find((a) => a.codAlmacen === query.almacen);
    if (impresoras.length === 0) {
        throw new Error('No se encontraron impresoras fiscales con ventas para el almacén y rango de fechas indicados.');
    }
    if (impresoras.length > TEMPLATE_SHEET_COUNT) {
        throw new Error(`La plantilla soporta hasta ${TEMPLATE_SHEET_COUNT} impresoras fiscales; se encontraron ${impresoras.length}.`);
    }
    const wb = await loadTemplate(TEMPLATE_PATH);
    // Each of the 20 template sheets ("1".."20") is pre-formatted for exactly that many
    // 42-column printer blocks — pick the one matching the actual printer count, same
    // selection the Java does via `wb.cloneSheet(lImpresoras.size()-1)`.
    const sourceSheet = wb.getWorksheet(String(impresoras.length));
    if (!sourceSheet) {
        throw new Error(`No se encontró la hoja de plantilla para ${impresoras.length} impresoras.`);
    }
    const sheet = cloneSheetInto(wb, sourceSheet, 'Libro de Venta');
    for (let i = 1; i <= TEMPLATE_SHEET_COUNT; i++) {
        const original = wb.getWorksheet(String(i));
        if (original)
            wb.removeWorksheet(original.id);
    }
    // Header (Java rows 0,1,2,6 col0 0-idx -> exceljs rows 1,2,3,7 col1)
    sheet.getRow(1).getCell(1).value = almacen?.nombreCliente ?? '';
    sheet.getRow(2).getCell(1).value = `R.I.F.: ${almacen?.rif ?? ''}`;
    sheet.getRow(3).getCell(1).value = `DOMICILIO FISCAL: ${almacen?.direccion ?? ''}`;
    const desdeFmt = formatDdMMyyyy(parseYyyyMMdd(query.desde));
    const hastaFmt = formatDdMMyyyy(parseYyyyMMdd(query.hasta));
    sheet.getRow(7).getCell(1).value = `Del: ${desdeFmt} Hasta: ${hastaFmt}`;
    for (let i = 0; i < impresoras.length; i++) {
        const impresora = impresoras[i];
        const esPrimeraImpresora = i === 0;
        const colBase = COL_INICIAL + i * COLUMNAS_POR_IMPRESORA; // exceljs 1-idx base column for this printer's block
        const tituloRow = sheet.getRow(FILA_TITULO_IMPRESORA);
        tituloRow.getCell(colBase).value = `FACTURACIÓN AL DETAL ${impresora.serial}`;
        const rows = await repo.getLibroVentaAgrupado(bd, query.desde, query.hasta, impresora.serial);
        let filaActual = FILA_INICIAL;
        for (const r of rows) {
            const row = sheet.getRow(filaActual);
            if (esPrimeraImpresora)
                setText(row, 1, r.FECHA);
            setText(row, colBase, r.ZFISCAL);
            setText(row, colBase + 1, r.FV_INICIAL);
            setText(row, colBase + 2, r.FV_FINAL);
            setNum(row, colBase + 3, r.FV_TOTAL);
            setNum(row, colBase + 6, r.FV_BASE_REDUCIDO);
            setNum(row, colBase + 7, r.FV_IVA_REDUCIDO);
            setNum(row, colBase + 8, r.FV_BASE_GENERAL);
            setNum(row, colBase + 9, r.FV_IVA_GENERAL);
            setNum(row, colBase + 10, r.FV_BASE_ADICIONAL);
            setNum(row, colBase + 11, r.FV_IVA_ADICIONAL);
            setNum(row, colBase + 12, r.FV_BASE_PERCIBIDO);
            setNum(row, colBase + 13, r.FV_IVA_PERCIBIDO);
            setNum(row, colBase + 14, r.FV_BASE_EXENTO);
            setNum(row, colBase + 15, r.FV_IVA_EXENTO);
            setNum(row, colBase + 17, r.FV_BASE_IGTF);
            setNum(row, colBase + 18, r.FV_IGTF);
            setText(row, colBase + 19, r.ND_INICIAL);
            setText(row, colBase + 20, r.ND_FINAL);
            setNum(row, colBase + 21, r.ND_TOTAL);
            setNum(row, colBase + 23, r.ND_BASE_GENERAL);
            setNum(row, colBase + 24, r.ND_IVA_GENERAL);
            setText(row, colBase + 25, r.NC_INICIAL);
            setText(row, colBase + 26, r.NC_FINAL);
            setNum(row, colBase + 27, Math.abs(Number(r.NC_TOTAL ?? 0)));
            setNum(row, colBase + 29, r.NC_BASE_REDUCIDO);
            setNum(row, colBase + 30, r.NC_IVA_REDUCIDO);
            setNum(row, colBase + 31, r.NC_BASE_GENERAL);
            setNum(row, colBase + 32, r.NC_IVA_GENERAL);
            setNum(row, colBase + 33, r.NC_BASE_ADICIONAL);
            setNum(row, colBase + 34, r.NC_IVA_ADICIONAL);
            setNum(row, colBase + 35, r.NC_BASE_PERCIBIDO);
            // Fixed per the migration decision: the Java source writes NC_BASE_PERCIBIDO
            // again here (copy-paste bug) instead of NC_IVA_PERCIBIDO.
            setNum(row, colBase + 36, r.NC_IVA_PERCIBIDO);
            setNum(row, colBase + 37, r.NC_BASE_EXENTO);
            setNum(row, colBase + 38, r.NC_IVA_EXENTO);
            setNum(row, colBase + 40, r.NC_BASE_IGTF);
            setNum(row, colBase + 41, r.NC_IGTF);
            filaActual++;
        }
    }
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
//# sourceMappingURL=libro-venta-isla.service.js.map