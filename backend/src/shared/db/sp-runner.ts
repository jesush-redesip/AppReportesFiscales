export interface SpParam {
  // mssql's own factory functions (sql.Int, sql.NVarChar(n), ...) return slightly
  // different factory subtypes depending on whether they take parameters — widen to
  // `unknown` here and let `request.input()`'s own overloads validate the real value.
  type: () => unknown;
  value: unknown;
}

export interface SpColumnMeta {
  name: string;
  sqlType: string; // e.g. 'Int', 'BigInt', 'Float', 'VarChar', 'NVarChar', 'Image', ...
}

export interface SpResult<T = Record<string, unknown>> {
  rows: T[];
  columns: SpColumnMeta[];
}

export interface PreviewResponse {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Shapes a raw SP result into the flat {columns, rows} JSON the frontend's preview
 * table expects — used instead of building the full workbook, since the preview
 * doesn't need the company header block or any Excel-specific formatting. */
export function toPreviewResponse(result: SpResult): PreviewResponse {
  return {
    columns: result.columns.map((c) => c.name),
    rows: result.rows as Record<string, unknown>[],
  };
}
