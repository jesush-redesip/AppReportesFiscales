/** Shapes a raw SP result into the flat {columns, rows} JSON the frontend's preview
 * table expects — used instead of building the full workbook, since the preview
 * doesn't need the company header block or any Excel-specific formatting. */
export function toPreviewResponse(result) {
    return {
        columns: result.columns.map((c) => c.name),
        rows: result.rows,
    };
}
//# sourceMappingURL=sp-runner.js.map