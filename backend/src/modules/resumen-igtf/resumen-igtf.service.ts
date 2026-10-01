import { newReportWorkbook, writeCompanyHeaderBlock, writeHeaderRow } from '../../shared/excel/simple-report.js';
import { exportResultSetToSheet } from '../../shared/excel/excel-exporter.js';
import { formatDdMMyyyy, parseYyyyMMdd } from '../../shared/util/date-format.js';
import { reportConfig } from '../../shared/config/report-config.js';
import * as catalogos from '../catalogos/catalogos.repository.js';
import * as repo from './resumen-igtf.repository.js';
import type { ResumenIgtfQuery } from './resumen-igtf.schema.js';

const START_ROW = 10;

/**
 * No recovered Java source for this module — reconstructed from the real `.xlsx`
 * this app already generates (`temp/REPORTE_RESUMEN_IGTF.xlsx`): company header block
 * (nombre/RIF/rango de fechas/título) then a data table from row 10. The SP already
 * returns nicely-labeled columns, so the header row uses them verbatim.
 */
export async function generarResumenIgtf(bd: string, query: ResumenIgtfQuery): Promise<Buffer> {
  const [empresas, sucursales] = await Promise.all([
    catalogos.getEmpresas(bd, reportConfig.areaEmpresas + '%'),
    query.sucursal ? catalogos.getSucursales(bd, query.empresa) : Promise.resolve([]),
  ]);
  const empresa = empresas.find((e) => e.codEmpresa === query.empresa);
  const sucursal = query.sucursal ? sucursales.find((s) => s.codSucursal === query.sucursal) : undefined;

  const { wb, sheet } = newReportWorkbook('Resumen IGTF');
  writeCompanyHeaderBlock(sheet, {
    nombreCliente: sucursal?.nombreCliente ?? empresa?.nombreCliente ?? '',
    rif: sucursal?.rif ?? empresa?.rif ?? '',
    desdeFmt: formatDdMMyyyy(parseYyyyMMdd(query.desde)),
    hastaFmt: formatDdMMyyyy(parseYyyyMMdd(query.hasta)),
    titulo: 'RELACIÓN DE IGTF',
  });

  const { rows, columns } = await repo.getResumenIgtf(bd, {
    desde: query.desde,
    hasta: query.hasta,
    codEmpresa: query.empresa,
    codSucursal: query.sucursal ?? '',
  });

  writeHeaderRow(sheet, START_ROW, columns.map((c) => c.name));
  exportResultSetToSheet(sheet, rows, columns, {
    startRow: START_ROW + 1,
    showHeader: false,
    totalize: false,
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
