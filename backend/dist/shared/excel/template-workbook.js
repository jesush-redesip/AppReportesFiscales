import ExcelJS from 'exceljs';
/**
 * `exceljs` has no `cloneSheet` (unlike POI). This replicates it: copies column widths,
 * every cell's value/style/numFmt, and merged ranges from `source` into a brand new
 * sheet named `newName`.
 */
export function cloneSheetInto(wb, source, newName) {
    const dest = wb.addWorksheet(newName, { properties: { ...source.properties } });
    source.columns?.forEach((col, i) => {
        if (col.width !== undefined)
            dest.getColumn(i + 1).width = col.width;
    });
    source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const destRow = dest.getRow(rowNumber);
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const destCell = destRow.getCell(colNumber);
            destCell.value = cell.value;
            destCell.style = { ...cell.style };
            if (cell.numFmt)
                destCell.numFmt = cell.numFmt;
        });
        destRow.commit();
    });
    const merges = source.model.merges;
    merges?.forEach((m) => dest.mergeCells(m));
    return dest;
}
/**
 * Equivalent to `libreriascomunes.Util.copyRow` / `excel.Excel.clonarLinea`: copies a
 * single row's values + styles from `source` sheet/row to `dest` sheet/row (used to
 * bring static footer/formula rows from an auxiliary template sheet into the main sheet
 * at a computed offset).
 */
export function copyRow(source, dest, srcRowNum, destRowNum) {
    const srcRow = source.getRow(srcRowNum);
    const destRow = dest.getRow(destRowNum);
    srcRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const destCell = destRow.getCell(colNumber);
        destCell.value = cell.value;
        destCell.style = { ...cell.style };
        if (cell.numFmt)
            destCell.numFmt = cell.numFmt;
    });
    destRow.commit();
}
export async function loadTemplate(path) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    return wb;
}
//# sourceMappingURL=template-workbook.js.map