import { newReportWorkbook, writeHeaderRow } from '../../shared/excel/simple-report.js';
import { exportResultSetToSheet } from '../../shared/excel/excel-exporter.js';
import * as repo from './retenciones-iva.repository.js';
/**
 * No recovered Java source for this module — it lives in the inaccessible main
 * shell. Reconstructed from the real `.xlsx` this app already generates (`temp/
 * REPORTE_RETENCION_IVA.xlsx`): a flat dump with NO company header block, raw SQL
 * column names as the header row verbatim (unlike the other reports' generic
 * exporter, this one does not "nice-ify" — e.g. `RIF_CLIENTE` stays `RIF_CLIENTE`,
 * not `RIF CLIENTE`), matching the layout the SENIAT electronic filing expects.
 */
export async function generarRetencionesIva(bd, query) {
    const { rows, columns } = await repo.getRetencionesIva(bd, {
        desde: query.desde,
        hasta: query.hasta,
        codEmpresa: query.empresa,
        codSucursal: query.sucursal ?? '',
    });
    const { wb, sheet } = newReportWorkbook('Retenciones IVA');
    writeHeaderRow(sheet, 1, columns.map((c) => c.name));
    exportResultSetToSheet(sheet, rows, columns, {
        startRow: 2,
        showHeader: false,
        totalize: false,
    });
    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
//# sourceMappingURL=retenciones-iva.service.js.map