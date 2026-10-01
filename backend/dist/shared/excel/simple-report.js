import ExcelJS from 'exceljs';
/**
 * For the 3 report modules with no recovered Java source (Retenciones IVA/ISLR,
 * Resumen IGTF) — there's no original .xlsx template to clone, so these build a
 * fresh workbook from scratch instead of `template-workbook.ts`'s clone-and-fill.
 */
export function newReportWorkbook(sheetName) {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(sheetName);
    return { wb, sheet };
}
/** Company/period header block matching the layout observed in real generated samples
 * for Resumen IGTF / Retenciones ISLR (row1 nombre, row3 RIF, row5 rango, row7 título). */
export function writeCompanyHeaderBlock(sheet, info) {
    sheet.getRow(1).getCell(1).value = info.nombreCliente;
    const rifRow = sheet.getRow(3);
    rifRow.getCell(1).value = 'R.I.F.:';
    rifRow.getCell(2).value = info.rif;
    sheet.getRow(5).getCell(1).value = `Rangos: Fecha: ${info.desdeFmt} Hasta ${info.hastaFmt}`;
    sheet.getRow(7).getCell(1).value = info.titulo;
}
/** Writes a bold header row with the given column labels, verbatim (no underscore replacement). */
export function writeHeaderRow(sheet, rowNum, labels) {
    const row = sheet.getRow(rowNum);
    labels.forEach((label, i) => {
        const cell = row.getCell(i + 1);
        cell.value = label;
        cell.font = { bold: true };
    });
}
//# sourceMappingURL=simple-report.js.map