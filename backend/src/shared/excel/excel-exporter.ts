import type ExcelJS from 'exceljs';
import type { SpColumnMeta } from '../db/sp-runner.js';
import { cellKindFor, columnLetter } from './column-type.js';

export interface ExportOptions {
  /** 1-indexed row (exceljs) where data starts. Java's `iIniciarEnLinea` is 0-indexed — add 1 when porting. */
  startRow: number;
  showHeader: boolean;
  /** Equivalent to `bTotalizar` — append a SUM totals row after the data. */
  totalize: boolean;
  /**
   * Equivalent to `sTotalizar`: one character per column, `'1'` means "write a SUM()
   * formula for this column in the totals row" (only applies to numeric columns).
   * This is NOT a per-column format/type mask — cell type is inferred at runtime from
   * `columns` metadata, matching the legacy Java behavior exactly.
   */
  totalizeMask?: string;
  /**
   * Optional: one character per column, `'1'` means "this numeric column is a monetary
   * amount and gets `#,##0.00`"; `'0'` means "numeric but a plain id/reference number
   * (e.g. an invoice sequence or Z-report number) and must NOT get currency formatting".
   * Omit to format every numeric column as money (the default — correct for modules
   * where every numeric column really is an amount).
   */
  moneyMask?: string;
  /** Overrides the data rows' font family/size (some modules' bundled templates carry a
   * stale font from the old layout — e.g. Arial 10 instead of the real Calibri 11). Omit
   * to leave whatever font the template cell already has. */
  dataFont?: { name: string; size: number };
  /** Text for a merged label cell (columns 1 through the column before the first `'1'`
   * in `totalizeMask`) on the totals row, e.g. "TOTAL VENTAS: ". Omit for no label. */
  totalLabel?: string;
  /** Centers every data/totals cell horizontally (and vertically). Omit to leave the
   * template's default alignment (left for text, right for numbers) — only opt in for
   * modules that explicitly ask for centered content, since other modules' layouts were
   * verified byte-for-byte against real reference output with the default alignment. */
  centerContent?: boolean;
}

export interface ExportResult {
  /** 1-indexed last row written (data or totals, whichever is last). Equivalent to `getLastRow()`. */
  lastRow: number;
}

function headerLabel(name: string): string {
  return name.replace(/_/g, ' ');
}

/** Rough character-count estimate for how a value will actually display in Excel — used
 * to auto-fit column widths. Doesn't need to be pixel-perfect, just wide enough that the
 * real content isn't clipped. */
function displayLength(raw: unknown, isNumeric: boolean): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (isNumeric) {
    const n = Number(raw);
    if (Number.isNaN(n)) return String(raw).length;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length;
  }
  return String(raw).length;
}

const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 60;
const WIDTH_PADDING = 2;

// Bundled templates often carry a solid (usually white) fill baked into the data-row
// area from the old POI-era styling. Visually identical to no fill on a plain white
// sheet, but real production output has no fill at all — clear it explicitly on every
// cell this exporter writes rather than leaving whatever the template happened to have.
const NO_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'none' };

// The bundled templates' data-row area has no border at all (confirmed: `border: {}` on
// a freshly-loaded template cell, before any of our code touches it) — real production
// output has a thin grid around every data cell. Not something we broke; something the
// stale template never had.
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

/**
 * A cell freshly read via `row.getCell()` that hasn't been individually styled yet
 * shares its `.style` object reference with every other untouched cell in that row
 * (exceljs applies the row/template's default style lazily, by reference, until a cell
 * is given its own). Mutating a property directly (`cell.numFmt = x`) mutates that
 * SHARED object — so setting column 4 to plain text, then later setting column 17 to
 * money on what looks like a different cell, silently rewrites column 4 back to money
 * too, because they were the same object all along. Always assign a fresh style object
 * instead of mutating the existing one in place.
 */
const CENTER_ALIGNMENT: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' };

function setNumFmt(cell: ExcelJS.Cell, numFmt: string, font?: { name: string; size: number }, center?: boolean): void {
  cell.style = {
    ...cell.style,
    numFmt,
    fill: NO_FILL,
    border: THIN_BORDER,
    ...(font ? { font: { ...cell.style.font, ...font } } : {}),
    ...(center ? { alignment: CENTER_ALIGNMENT } : {}),
  };
}

function setBold(cell: ExcelJS.Cell, font?: { name: string; size: number }, center?: boolean): void {
  cell.style = {
    ...cell.style,
    fill: NO_FILL,
    border: THIN_BORDER,
    font: { ...cell.style.font, ...font, bold: true },
    ...(center ? { alignment: CENTER_ALIGNMENT } : {}),
  };
}

export function exportResultSetToSheet(
  sheet: ExcelJS.Worksheet,
  rows: Record<string, unknown>[],
  columns: SpColumnMeta[],
  opts: ExportOptions,
): ExportResult {
  let rowNum = opts.startRow;
  // Tracks the widest value seen per column so widths can be auto-fit to content at the
  // end — bundled templates only size columns to fit the HEADER label, so anything wider
  // than that (long descriptions, larger numbers) gets visually clipped.
  const maxContentLength = new Array(columns.length).fill(0) as number[];

  if (opts.showHeader) {
    const headerRow = sheet.getRow(rowNum);
    columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      const label = headerLabel(col.name);
      cell.value = label;
      setBold(cell, opts.dataFont, opts.centerContent);
      maxContentLength[i] = Math.max(maxContentLength[i], label.length);
    });
    headerRow.commit();
    rowNum += 1;
  }

  for (const record of rows) {
    const row = sheet.getRow(rowNum);
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      const raw = record[col.name];
      const kind = cellKindFor(col);
      if (kind === 'numeric') {
        cell.value = raw === null || raw === undefined ? null : Number(raw);
        const isMoney = !opts.moneyMask || opts.moneyMask[i] === '1';
        setNumFmt(cell, isMoney ? '#,##0.00' : '@', opts.dataFont, opts.centerContent);
        maxContentLength[i] = Math.max(maxContentLength[i], displayLength(raw, true));
      } else if (kind === 'image') {
        // Image insertion is handled by the caller (needs the workbook to addImage);
        // the generic exporter only reserves the cell.
        cell.value = null;
        setNumFmt(cell, 'General', opts.dataFont, opts.centerContent);
      } else {
        cell.value = raw === null || raw === undefined ? null : String(raw);
        // Clear any numFmt the template cell inherited (e.g. a blanket money format
        // baked into the data-row template area) — text columns must not show one.
        setNumFmt(cell, 'General', opts.dataFont, opts.centerContent);
        maxContentLength[i] = Math.max(maxContentLength[i], displayLength(raw, false));
      }
    });
    row.commit();
    rowNum += 1;
  }

  columns.forEach((_col, i) => {
    const target = Math.min(Math.max(maxContentLength[i] + WIDTH_PADDING, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
    const excelCol = sheet.getColumn(i + 1);
    excelCol.width = Math.max(excelCol.width ?? 0, target);
    // A stale template may have hidden a column back when it held no real data (see the
    // Movimiento de Inventario "Línea" column) — any column we actually write data into
    // must be visible, regardless of what the template says.
    excelCol.hidden = false;
  });

  const lastDataRow = rowNum - 1;

  if (opts.totalize && opts.totalizeMask) {
    const totalsRow = sheet.getRow(rowNum);
    const firstDataRow = opts.showHeader ? opts.startRow + 1 : opts.startRow;
    const firstMoneyCol = opts.totalizeMask.indexOf('1') + 1; // 1-indexed; 0 if none found
    if (opts.totalLabel && firstMoneyCol > 1) {
      sheet.mergeCells(rowNum, 1, rowNum, firstMoneyCol - 1);
      const labelCell = totalsRow.getCell(1);
      labelCell.value = opts.totalLabel;
      labelCell.style = { ...labelCell.style, alignment: { horizontal: 'center', vertical: 'middle' } };
      setBold(labelCell, opts.dataFont, opts.centerContent);
    }
    columns.forEach((col, i) => {
      const flag = opts.totalizeMask?.[i];
      if (flag !== '1') return;
      if (cellKindFor(col) !== 'numeric') return;
      const letter = columnLetter(i + 1);
      const cell = totalsRow.getCell(i + 1);
      cell.value = { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` };
      setBold(cell, opts.dataFont, opts.centerContent);
      setNumFmt(cell, '#,##0.00', opts.dataFont, opts.centerContent);
    });
    totalsRow.commit();
    return { lastRow: rowNum };
  }

  return { lastRow: lastDataRow };
}
