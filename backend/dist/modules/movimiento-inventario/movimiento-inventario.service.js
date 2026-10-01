import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplate } from '../../shared/excel/template-workbook.js';
import { exportResultSetToSheet } from '../../shared/excel/excel-exporter.js';
import * as catalogos from '../catalogos/catalogos.repository.js';
import * as repo from './movimiento-inventario.repository.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', '..', 'templates', 'REPORTE_MOVIMIENTOS.xlsx');
// Ported verbatim from `movimientoinventario.MovimientoInventario.getMovimientoInventario`
// (Java, POI/JDBC) — physical row = javaRowIndex + 1 (see libro-compra.service.ts for the
// same convention). No auxiliary sheet/footer formulas in this module — the simplest of
// the report modules: single sheet, header + data + totals row, nothing else.
//
// The template's original header only had 2 lines: row 1 (bold, size 16) held the
// almacén's own name, row 2 held the RIF — there was no line for the cliente/business
// name at all. A row for it is inserted between the two at runtime (not baked into the
// template), which shifts everything below (RIF, title, table header, data) down by one
// row — hence START_ROW is 8, not the original 7.
const START_ROW = 8;
const TOTALIZE_MASK = '000000000111111111111';
// Column 1 (ID / "Oper Nº") is a plain running number, not an amount — everything else
// numeric (columns 10-21: the Cantidad/Monto pairs) is real money and keeps `#,##0.00`.
const MONEY_MASK = '0'.repeat(9) + '1'.repeat(12);
export async function generarMovimientoInventario(bd, query) {
    const almacenes = await catalogos.getAlmacenes(bd);
    const almacen = almacenes.find((a) => a.codAlmacen === query.almacen);
    const wb = await loadTemplate(TEMPLATE_PATH);
    const sheet = wb.worksheets[0];
    // Insert a blank row right after the (existing, already bold/size-16) almacén-name
    // row for the cliente/business name — everything from the RIF line down shifts by one.
    sheet.spliceRows(2, 0, []);
    // Row 1 keeps the template's original bold/size-16 style untouched.
    sheet.getRow(1).getCell(1).value = almacen?.nombre ?? '';
    const clienteCell = sheet.getRow(2).getCell(1);
    clienteCell.value = almacen?.nombreCliente ?? '';
    clienteCell.style = { ...clienteCell.style, font: { bold: true, size: 16, name: 'Calibri', family: 2 } };
    sheet.getRow(3).getCell(1).value = `R.I.F.: ${almacen?.rif ?? ''}`;
    const { rows, columns } = await repo.getMovimientoInventario(bd, {
        desde: query.desde,
        hasta: query.hasta,
        codAlmacen: query.almacen,
    });
    exportResultSetToSheet(sheet, rows, columns, {
        startRow: START_ROW,
        showHeader: false,
        totalize: true,
        totalizeMask: TOTALIZE_MASK,
        moneyMask: MONEY_MASK,
        centerContent: true,
    });
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
//# sourceMappingURL=movimiento-inventario.service.js.map