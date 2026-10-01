const NUMERIC_TYPES = new Set(['Int', 'BigInt', 'Float', 'SmallInt', 'TinyInt', 'Decimal', 'Numeric', 'Real']);
const IMAGE_TYPES = new Set(['Image', 'VarBinary', 'Binary']);
/**
 * Mirrors the runtime switch in the legacy `excel.Excel.exportarExcel` (decompiled):
 * INT/BIGINT/FLOAT/DFLOAT0 -> numeric, VARCHAR/NVARCHAR/CHAR -> text, IMAGE -> image,
 * anything else falls back to text. `mssql` reports column SQL type the same way JDBC's
 * ResultSetMetaData did — dynamically per query, not from a static schema.
 */
export function cellKindFor(column) {
    if (IMAGE_TYPES.has(column.sqlType))
        return 'image';
    if (NUMERIC_TYPES.has(column.sqlType))
        return 'numeric';
    return 'text';
}
/** Excel column letter for a 1-based column index (A, B, ..., Z, AA, AB, ...). */
export function columnLetter(index1Based) {
    let n = index1Based;
    let letters = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        letters = String.fromCharCode(65 + rem) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}
//# sourceMappingURL=column-type.js.map