import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type ExcelJS from 'exceljs';
import { loadTemplate, copyRow } from '../../shared/excel/template-workbook.js';
import { exportResultSetToSheet } from '../../shared/excel/excel-exporter.js';
import { parseYyyyMMdd } from '../../shared/util/date-format.js';
import { reportConfig } from '../../shared/config/report-config.js';
import * as catalogos from '../catalogos/catalogos.repository.js';
import * as repo from './libro-venta.repository.js';
import type { LibroVentaQuery } from './libro-venta.schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', '..', 'templates', 'REPORTE_LIBRO_VENTA_DETALLE.xlsx');

// Ported from `libroventa.LibroVenta.getLibroVentaDetallado` (Java, POI/JDBC). Same
// 0-indexed(Java)/1-indexed(exceljs) row mapping convention as libro-compra.service.ts:
// physical row = javaRowIndex + 1.
const START_ROW = 15; // Java iIniciarEnLinea=14 (0-idx) -> exceljs row 15
// The bundled template's data rows carry a stale Arial 10 font from the old layout —
// the real production output (reverse-engineered from a sample file) uses Calibri 11.
const DATA_FONT = { name: 'Calibri', size: 11 };

/**
 * `rip.MR_LIBRO_VENTA` was updated on the server at some point to split the old single
 * "% Alícuota" pair into two full rate breakdowns — one for "CONTRIBUYENTES" (ordinario)
 * and one for "NO CONTRIBUYENTES" — but the `.xlsx` template bundled with the Java app
 * (and every copy of it found in the decompiled sources) was never updated to match: it
 * still has the OLD 30-column header baked in. The SP itself already returns the correct
 * 40 columns (verified directly against `EMPORIOP`), so the data was always right — only
 * the static header text/merges (and the totals mask, sized for the old 42-char layout)
 * were stale, silently mislabeling every column from "Print Fiscal" (9) onward. This
 * header layout and the totals mask below were reverse-engineered from a real production
 * output file the user provided, not from the (outdated) Java template.
 */
const TOTALIZE_MASK =
  '0000000000000000' + // 1-16: no totals (ids, dates, text fields)
  '1'.repeat(21) + // 17-37: TOTALNETO, BASE_EXENT + both CONTR/NO_CONTR alícuota blocks, IGTF, total
  '0' + // 38: LIBRE2 (blank spacer)
  '1' + // 39: IVA_RETENIDO_COMPRADOR
  '0'; // 40: SUCURSAL (text code)

interface HeaderCell {
  col: number;
  text: string;
  /** Rows to merge this label across (e.g. [12,13,14] for a plain 3-row column header,
   * [13,14] for a two-row sub-header, or a single row for the unmerged rate columns). */
  rows: number[];
}

// Reverse-engineered column-by-column from the reference output file (rows 11-14),
// matching `rip.MR_LIBRO_VENTA`'s real 40-column order exactly.
const HEADER_CELLS: HeaderCell[] = [
  { col: 2, text: 'Oper. Nro.', rows: [12, 13, 14] },
  { col: 3, text: 'Fecha de la Factura', rows: [12, 13, 14] },
  { col: 4, text: 'RIF', rows: [13] },
  { col: 5, text: 'Nombre o Razon Social', rows: [13] },
  { col: 6, text: 'Número Comprobante de Retención', rows: [12, 13, 14] },
  { col: 7, text: 'Fecha de Comprobante de Retención', rows: [12, 13, 14] },
  { col: 8, text: 'Nro Planilla de Exportación (Forma D)', rows: [12, 13, 14] },
  { col: 9, text: 'Print Fiscal', rows: [13, 14] },
  { col: 10, text: 'Sistema Facturación', rows: [13, 14] },
  { col: 11, text: 'Núm Rep Z o Núm Control', rows: [12, 13, 14] },
  { col: 12, text: 'Impresora Fiscal', rows: [12, 13, 14] },
  { col: 13, text: 'Número Nota de Débito', rows: [12, 13, 14] },
  { col: 14, text: 'Número Nota de Crédito', rows: [12, 13, 14] },
  { col: 15, text: 'Tipo de Transacción', rows: [12, 13, 14] },
  { col: 16, text: 'Número de Factura Afectada', rows: [12, 13, 14] },
  { col: 17, text: 'Total de Venta Incluyendo IVA', rows: [12, 13, 14] },
  { col: 18, text: 'Ventas Internas No Grabadas', rows: [12, 13, 14] },
  { col: 19, text: 'Base Imponible IVA', rows: [13, 14] },
  { col: 20, text: 'Impuesto IVA 16%', rows: [13, 14] },
  { col: 21, text: 'Base imponible IVA', rows: [13, 14] },
  { col: 22, text: 'Impuesto IVA 8% ', rows: [13] },
  { col: 23, text: 'Base Imponible IVA', rows: [13, 14] },
  { col: 24, text: 'Impuesto IVA 31%', rows: [13] },
  { col: 25, text: 'Base Imponible IVA', rows: [13, 14] },
  { col: 26, text: 'Impuesto IVA 0%', rows: [13] },
  { col: 27, text: 'Base Imponible IVA', rows: [13, 14] },
  { col: 28, text: 'Impuesto IVA 16%', rows: [13, 14] },
  { col: 29, text: 'Base imponible IVA', rows: [13, 14] },
  { col: 30, text: 'Impuesto IVA 8% ', rows: [13] },
  { col: 31, text: 'Base Imponible IVA', rows: [13, 14] },
  { col: 32, text: 'Impuesto IVA 31%', rows: [13] },
  { col: 33, text: 'Base Imponible IVA', rows: [13] },
  { col: 34, text: 'Impuesto IVA 0%', rows: [13] },
  { col: 35, text: 'Base Imponible IGTF', rows: [12, 13, 14] },
  { col: 36, text: 'Total IGTF', rows: [12, 13, 14] },
  { col: 37, text: 'Total Ventas Incluyendo IVA e IGTF', rows: [12, 13, 14] },
  { col: 39, text: 'IVA Retenido (Por el Comprador)', rows: [12, 13, 14] },
  { col: 40, text: 'Código Suc.', rows: [12, 13, 14] },
];

const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, size: 9, name: 'Arial', family: 2 };
const HEADER_ALIGNMENT: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
// The bundled template's header cells carry a stale solid fill left over from the old
// 30-column layout (e.g. a highlight color over what used to be the "% Alícuota"
// columns). The real production header has no fill at all — explicitly clear it rather
// than inheriting whatever the template happened to have at that cell position.
const NO_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'none' };

function styleHeaderCell(cell: ExcelJS.Cell, text: string): void {
  cell.value = text;
  // A cell fresh off `getCell()` shares its `.style` object reference with every other
  // untouched cell in that row until individually styled — mutating `cell.font = x`
  // directly would mutate that SHARED object, silently restyling unrelated cells later
  // in the same row (see the identical note on `setNumFmt` in excel-exporter.ts, where
  // this exact bug caused every data column to inherit the last-written column's
  // currency format). Assign a whole new style object instead of mutating in place.
  cell.style = { ...cell.style, font: HEADER_FONT, alignment: HEADER_ALIGNMENT, fill: NO_FILL };
}

/** Rebuilds the data-table header (rows 11-14) to match the real 40-column SP schema —
 * see the comment on `TOTALIZE_MASK` above for why the bundled template can't be trusted
 * as-is for this block. */
function writeLibroVentaHeader(sheet: ExcelJS.Worksheet): void {
  sheet.unMergeCells(11, 1, 14, 40);

  // `unMergeCells` recomputes each freed cell's style from the row/column defaults
  // (`Cell.unmerge()` in exceljs), which can reintroduce the template's stale fill even
  // on cells we just cleared — including "sibling" rows (e.g. row 14 of a single-row
  // header entry) that `styleHeaderCell` below never individually touches. Blanket-clear
  // fill across the whole block first; the per-cell styling below still applies on top.
  for (let r = 11; r <= 14; r++) {
    for (let c = 1; c <= 40; c++) {
      const cell = sheet.getCell(r, c);
      cell.style = { ...cell.style, fill: NO_FILL };
    }
  }

  // `mergeCells` copies the anchor's CURRENT `.style` object reference onto the slave
  // cells at merge time (see `Cell.merge()` in exceljs) — style the anchor first, THEN
  // merge, or the slave rows end up frozen on the pre-style (stale/default) object.
  const groupHeader = (fromCol: number, toCol: number, text: string) => {
    styleHeaderCell(sheet.getCell(11, fromCol), text);
    sheet.mergeCells(11, fromCol, 12, toCol);
  };
  groupHeader(19, 26, 'CONTRIBUYENTES');
  groupHeader(27, 34, 'NO CONTRIBUYENTES');

  // Columns 9-10 additionally share a row-12-only group label above their own headers.
  styleHeaderCell(sheet.getCell(12, 9), 'Número de Factura');
  sheet.mergeCells(12, 9, 12, 10);

  for (const { col, text, rows } of HEADER_CELLS) {
    styleHeaderCell(sheet.getCell(rows[0], col), text);
    if (rows.length > 1) sheet.mergeCells(rows[0], col, rows[rows.length - 1], col);
  }

  for (let col = 19; col <= 40; col++) {
    sheet.getColumn(col).width = 21.44;
  }
}

export async function generarLibroVenta(bd: string, query: LibroVentaQuery): Promise<Buffer> {
  const [empresas, sucursales] = await Promise.all([
    catalogos.getEmpresas(bd, reportConfig.areaEmpresas + '%'),
    query.sucursal ? catalogos.getSucursales(bd, query.empresa) : Promise.resolve([]),
  ]);
  const empresa = empresas.find((e) => e.codEmpresa === query.empresa);
  const sucursal = query.sucursal ? sucursales.find((s) => s.codSucursal === query.sucursal) : undefined;

  const nombreCliente = sucursal?.nombreCliente ?? empresa?.nombreCliente ?? '';
  const rif = sucursal?.rif ?? empresa?.rif ?? '';
  // Bug-for-bug port: the Java checks `sucursal.getRif() != null` (not direccion) to
  // decide whether to use the sucursal's own direccion — an existing quirk, not ours
  // to silently "fix" per the migration's decision to preserve such behavior.
  const direccion = sucursal?.rif ? sucursal.direccion : (empresa?.direccion ?? '');

  const periodo = parseYyyyMMdd(query.desde);
  const anio = periodo.getFullYear();
  const mes = periodo.getMonth() + 1;

  const wb = await loadTemplate(TEMPLATE_PATH);
  const sheet = wb.worksheets[0];
  writeLibroVentaHeader(sheet);

  // Header block (Java row5,col1/col8/col15/col16 0-idx -> exceljs row6,col2/col9/col16/col17)
  sheet.getRow(6).getCell(2).value = nombreCliente;
  sheet.getRow(6).getCell(9).value = rif;
  sheet.getRow(6).getCell(16).value = `AÑO: ${anio}`;
  sheet.getRow(6).getCell(17).value = `MES: ${mes}`;
  // Java row8,col1 (0-idx) -> exceljs row9,col2
  sheet.getRow(9).getCell(2).value = direccion;

  // --- Sucursales list, paginated every 7 rows into a new column pair (Java iRecords/iColumnas loop) ---
  const sucursalRows = await repo.getSucursalesParaEncabezado(bd, query.empresa, query.sucursal ?? '');
  sucursalRows.forEach((row, n) => {
    const iRecords = (n % 7) + 1; // Java POI row index used directly as physical row - 1
    const iColumnas = 2 * Math.floor(n / 7);
    const physicalRow = iRecords + 1;
    const col = 18 + iColumnas; // Java col 17+iColumnas (0-idx) -> exceljs col 18+iColumnas
    sheet.getRow(physicalRow).getCell(col).value = row.SUCURSAL;
  });

  const spParams: repo.LibroVentaParams = {
    desde: query.desde,
    hasta: query.hasta,
    codEmpresa: query.empresa,
    codSucursal: query.sucursal ?? '',
    serialImpresora: '',
    codFormaPagoRetencion: reportConfig.codFormaPagoIva,
    codMoneda: query.moneda,
    areaEmpresas: reportConfig.areaEmpresas,
  };

  const { rows, columns } = await repo.getLibroVenta(bd, spParams);
  const { lastRow: nodeLastRow } = exportResultSetToSheet(sheet, rows, columns, {
    startRow: START_ROW,
    showHeader: false,
    totalize: true,
    totalizeMask: TOTALIZE_MASK,
    moneyMask: TOTALIZE_MASK,
    dataFont: DATA_FONT,
    totalLabel: 'TOTAL VENTAS: ',
  });

  // javaUltRegistro mirrors the Java `iUltRegistro` (POI 0-indexed last written row).
  const javaUltRegistro = nodeLastRow - 1;

  // --- Copy the 23 footer/formula rows from the auxiliary "Copia" template sheet ---
  const auxSheet = wb.worksheets[1];
  const iFila = javaUltRegistro + 2; // Java-index space
  if (auxSheet) {
    for (let iCopy = 1; iCopy <= 23; iCopy++) {
      copyRow(auxSheet, sheet, iCopy + 1, iFila + iCopy + 1);
    }
  }

  // --- The single ACTIVE formula in the Java source (everything else there is dead,
  // commented-out SUMIFS-by-alícuota code — per the migration decision, preserved as
  // absent rather than reimplemented). ---
  sheet.getRow(javaUltRegistro + 7 + 1).getCell(19).value = { formula: `R${javaUltRegistro + 1}` };

  // --- Second export: retenciones rezagadas de períodos anteriores (MR_LIBRO_VENTA2),
  // appended starting right after the copied footer block. ---
  const segundaStartRowJava = javaUltRegistro + 24;
  const { rows: rowsViejas, columns: columnsViejas } = await repo.getLibroVentaRetencionesViejas(bd, spParams);
  exportResultSetToSheet(sheet, rowsViejas, columnsViejas, {
    startRow: segundaStartRowJava + 1,
    showHeader: false,
    totalize: true,
    totalizeMask: TOTALIZE_MASK,
    moneyMask: TOTALIZE_MASK,
    dataFont: DATA_FONT,
  });

  if (auxSheet) wb.removeWorksheet(auxSheet.id);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
