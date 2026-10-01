import { newReportWorkbook, writeCompanyHeaderBlock, writeHeaderRow } from '../../shared/excel/simple-report.js';
import { exportResultSetToSheet } from '../../shared/excel/excel-exporter.js';
import { formatDdMMyyyy, parseYyyyMMdd } from '../../shared/util/date-format.js';
import { reportConfig } from '../../shared/config/report-config.js';
import * as catalogos from '../catalogos/catalogos.repository.js';
import * as repo from './retenciones-islr.repository.js';
import type { RetencionesIslrQuery } from './retenciones-islr.schema.js';

const START_ROW = 10;

// Maps the SP's technical column names to the Spanish labels observed in the real
// `.xlsx` this app already generates (`temp/REPORTE_RETENCION_ISLR.xlsx`) — unlike
// Resumen IGTF, this SP does NOT alias its columns nicely.
export const NICE_LABELS: Record<string, string> = {
  CODPROVEEDOR: 'Cód. Prov.',
  NOMPROVEEDOR: 'Proveedor',
  RIF_PROVEEDOR: 'RIF',
  NUMFAC: 'Núm. Factura',
  NUMCONTROL: 'Núm. Control',
  DESCRIPCION: 'Concepto de ISLR',
  FECHARETISLR: 'Fecha de Pago',
  BASE: 'Cant. Objeto de Retención',
  PORCRETENCION: '% Retención',
  SUSTRAENDO: 'Sustraendo',
  RETENIDO: 'Impuesto Retenido',
};

export async function generarRetencionesIslr(bd: string, query: RetencionesIslrQuery): Promise<Buffer> {
  const [empresas, sucursales] = await Promise.all([
    catalogos.getEmpresas(bd, reportConfig.areaEmpresas + '%'),
    query.sucursal ? catalogos.getSucursales(bd, query.empresa) : Promise.resolve([]),
  ]);
  const empresa = empresas.find((e) => e.codEmpresa === query.empresa);
  const sucursal = query.sucursal ? sucursales.find((s) => s.codSucursal === query.sucursal) : undefined;

  const { wb, sheet } = newReportWorkbook('Retenciones ISLR');
  writeCompanyHeaderBlock(sheet, {
    nombreCliente: sucursal?.nombreCliente ?? empresa?.nombreCliente ?? '',
    rif: sucursal?.rif ?? empresa?.rif ?? '',
    desdeFmt: formatDdMMyyyy(parseYyyyMMdd(query.desde)),
    hastaFmt: formatDdMMyyyy(parseYyyyMMdd(query.hasta)),
    titulo: 'RELACIÓN RETENCIONES DE IMPUESTOS SOBRE LA RENTA',
  });

  const { rows, columns } = await repo.getRetencionesIslr(bd, {
    desde: query.desde,
    hasta: query.hasta,
    codEmpresa: query.empresa,
    codSucursal: query.sucursal ?? '',
  });

  writeHeaderRow(sheet, START_ROW, columns.map((c) => NICE_LABELS[c.name] ?? c.name));
  exportResultSetToSheet(sheet, rows, columns, {
    startRow: START_ROW + 1,
    showHeader: false,
    totalize: false,
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
