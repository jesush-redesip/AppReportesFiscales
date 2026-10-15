import { newReportWorkbook, writeCompanyHeaderBlock, writeHeaderRow } from '../../shared/excel/simple-report.js';
import { exportResultSetToSheet } from '../../shared/excel/excel-exporter.js';
import { formatDdMMyyyy, parseYyyyMMdd } from '../../shared/util/date-format.js';
import { reportConfig } from '../../shared/config/report-config.js';
import * as catalogos from '../catalogos/catalogos.repository.js';
import * as repo from './retenciones-islr.repository.js';
import type { RetencionesIslrQuery } from './retenciones-islr.schema.js';
import type ExcelJS from 'exceljs';
import { convertirEnXlsm } from './retenciones-islr.xlsm.js';
import { aDetalle, construirXml, periodoDe, rifSinGuiones, validarDetalles, type CampoDetalle, type ErrorDetalle, type FilaIslrSp } from './retenciones-islr.xml.js';

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

/** Empresa (o sucursal) del reporte: nombre y RIF para los encabezados. */
async function agenteDe(bd: string, query: RetencionesIslrQuery) {
  const [empresas, sucursales] = await Promise.all([
    catalogos.getEmpresas(bd, reportConfig.areaEmpresas + '%'),
    query.sucursal ? catalogos.getSucursales(bd, query.empresa) : Promise.resolve([]),
  ]);
  const empresa = empresas.find((e) => e.codEmpresa === query.empresa);
  const sucursal = query.sucursal ? sucursales.find((s) => s.codSucursal === query.sucursal) : undefined;
  return {
    nombre: sucursal?.nombreCliente ?? empresa?.nombreCliente ?? '',
    rif: sucursal?.rif ?? empresa?.rif ?? '',
    // El agente de retención es la empresa: el SP trae las retenciones de toda la empresa
    // y el RIF de una sucursal puede estar mal cargado.
    rifEmpresa: empresa?.rif || sucursal?.rif || '',
  };
}

const consultar = (bd: string, query: RetencionesIslrQuery) =>
  repo.getRetencionesIslr(bd, {
    desde: query.desde,
    hasta: query.hasta,
    codEmpresa: query.empresa,
    codSucursal: query.sucursal ?? '',
  });

/** "14/10/2026, 11:57:26" — hora local del servidor, como la planilla vieja. */
function fechaConsulta(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function generarRetencionesIslr(bd: string, query: RetencionesIslrQuery): Promise<Buffer> {
  const agente = await agenteDe(bd, query);
  const { wb, sheet } = newReportWorkbook('Retenciones ISLR');
  writeCompanyHeaderBlock(sheet, {
    nombreCliente: agente.nombre,
    rif: agente.rif,
    desdeFmt: formatDdMMyyyy(parseYyyyMMdd(query.desde)),
    hastaFmt: formatDdMMyyyy(parseYyyyMMdd(query.hasta)),
    titulo: 'RELACIÓN RETENCIONES DE IMPUESTOS SOBRE LA RENTA',
  });

  sheet.getRow(6).getCell(1).value = `Fecha Consulta: ${fechaConsulta()}`;

  const { rows, columns } = await consultar(bd, query);

  writeHeaderRow(sheet, START_ROW, columns.map((c) => NICE_LABELS[c.name] ?? c.name));
  exportResultSetToSheet(sheet, rows, columns, {
    startRow: START_ROW + 1,
    showHeader: false,
    totalize: rows.length > 0,
    // Totales de Cant. Objeto de Retención, Sustraendo e Impuesto Retenido (como la planilla vieja).
    totalizeMask: columns.map((c) => (['BASE', 'SUSTRAENDO', 'RETENIDO'].includes(c.name) ? '1' : '0')).join(''),
    moneyMask: columns.map((c) => (['CODPROVEEDOR', 'PORCRETENCION'].includes(c.name) ? '0' : '1')).join(''),
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// --- Formato para el XML del SENIAT ---

export class RetencionesIslrInvalidasError extends Error {
  constructor(public readonly errores: ErrorDetalle[]) {
    super(
      `No se generó el XML: hay ${errores.length} dato(s) inválido(s). ` +
        errores
          .slice(0, 5)
          .map((e) => (e.fila ? `Fila ${e.fila}: ${e.mensaje}` : e.mensaje))
          .join(' ') +
        (errores.length > 5 ? ' Descargue el formato XML (Excel) para ver todas las observaciones.' : ''),
    );
  }
}

async function datosXml(bd: string, query: RetencionesIslrQuery) {
  const [agente, { rows }] = await Promise.all([agenteDe(bd, query), consultar(bd, query)]);
  const detalles = (rows as FilaIslrSp[]).map(aDetalle);
  const rifAgente = rifSinGuiones(agente.rifEmpresa);
  const periodo = periodoDe(query.hasta);
  return { detalles, rifAgente, periodo, errores: validarDetalles(detalles, rifAgente, periodo) };
}

// Columnas B..H de la planilla vieja `retISLR` (la columna A es el ID-Sec.).
const COLUMNAS_XML: { campo: CampoDetalle; titulo: [string, string]; ancho: number }[] = [
  { campo: 'rifRetenido', titulo: ['RIF', 'Retenido'], ancho: 14 },
  { campo: 'numeroFactura', titulo: ['Número', 'Factura'], ancho: 13 },
  { campo: 'numeroControl', titulo: ['Número', 'Control'], ancho: 13 },
  { campo: 'fechaOperacion', titulo: ['Fecha', 'Operación'], ancho: 12 },
  { campo: 'codigoConcepto', titulo: ['Codigo', 'Concepto'], ancho: 10 },
  { campo: 'montoOperacion', titulo: ['Monto', 'Operación'], ancho: 16 },
  { campo: 'porcentajeRetencion', titulo: ['Porcentaje', 'Retención'], ancho: 11 },
];

/** Filas vacías con formato y borde debajo de la última retención, para agregar registros a mano. */
const FILAS_LIBRES = 10;
const ROJO = 'FF9C0006';

/**
 * Libro con macros (.xlsm) igual a la planilla vieja `retISLR`: RIF del agente y período
 * arriba, la carpeta de salida en C2 (la carpeta donde está guardado el archivo), una fila
 * por retención y el botón "Convertir a XML" con la macro de siempre. Las celdas con datos
 * que el SENIAT rechazaría van en rojo, con la observación en la columna M.
 */
export async function generarFormatoXmlIslr(bd: string, query: RetencionesIslrQuery): Promise<Buffer> {
  const { detalles, rifAgente, periodo, errores } = await datosXml(bd, query);
  const { wb, sheet } = newReportWorkbook('retISLR');
  // C2 e I1 son fórmulas: que Excel las calcule al abrir.
  wb.calcProperties.fullCalcOnLoad = true;
  const negrita = { bold: true };
  const borde: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };

  sheet.getCell('A1').value = 'Data para Crear archivo XML de retISLRSalariosOtras';
  sheet.getCell('A1').font = negrita;
  sheet.getCell('G1').value = 'RIF Agente :';
  sheet.getCell('H1').value = rifAgente;
  sheet.getCell('G2').value = 'Periodo :';
  sheet.getCell('H2').value = periodo;
  for (const c of ['G1', 'G2']) sheet.getCell(c).font = negrita;
  for (const c of ['H1', 'H2']) {
    sheet.getCell(c).font = negrita;
    sheet.getCell(c).numFmt = '@';
  }
  // La macro guarda el XML en la carpeta de C2: la del propio archivo (termina en "\").
  sheet.getCell('A2').value = 'RUTA SALIDA DE ARCHIVO XML:';
  sheet.getCell('A2').font = negrita;
  sheet.mergeCells('C2:F2');
  sheet.getCell('C2').value = {
    formula: 'IFERROR(LEFT(CELL("filename",A1),FIND("[",CELL("filename",A1))-1),"")',
    result: '',
  };
  sheet.getCell('C2').font = { color: { argb: 'FF1F4E79' } };
  // La macro toma de I1 la cantidad de registros (los números de la columna A).
  sheet.getCell('I1').value = { formula: 'COUNT(A5:A65536)', result: detalles.length };
  sheet.getCell('I1').numFmt = '0';

  const titulos: [string, string][] = [['ID-', 'Sec.'], ...COLUMNAS_XML.map((c) => c.titulo)];
  titulos.forEach(([l1, l2], i) => {
    for (const [fila, valor] of [
      [3, l1],
      [4, l2],
    ] as const) {
      const cell = sheet.getRow(fila).getCell(i + 1);
      cell.value = valor;
      cell.font = negrita;
      cell.alignment = { horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
      cell.border = borde;
    }
  });
  sheet.getColumn(1).width = 7;
  COLUMNAS_XML.forEach((c, i) => (sheet.getColumn(i + 2).width = c.ancho));
  // I y J: auxiliares de la macro (monto y porcentaje como texto); K..L: el botón.
  for (const c of [9, 10]) {
    sheet.getColumn(c).width = 11;
    sheet.getColumn(c).font = { color: { argb: 'FFA6A6A6' }, size: 9 };
  }
  sheet.getColumn(11).width = 12;
  sheet.getColumn(12).width = 12;
  sheet.getColumn(13).width = 60;
  sheet.getCell('M3').value = 'Para agregar un registro: escriba el número en ID-Sec. (columna A) y los datos en B a H.';
  sheet.getCell('M3').font = { italic: true, color: { argb: 'FF808080' } };

  const erroresPorFila = new Map<number, ErrorDetalle[]>();
  for (const e of errores) erroresPorFila.set(e.fila, [...(erroresPorFila.get(e.fila) ?? []), e]);

  const formatear = (row: ExcelJS.Row) => {
    row.getCell(1).border = borde;
    row.getCell(1).alignment = { horizontal: 'center' };
    COLUMNAS_XML.forEach((c, j) => {
      const cell = row.getCell(j + 2);
      cell.border = borde;
      if (c.campo === 'montoOperacion') cell.numFmt = '#,##0.00';
      else if (c.campo === 'porcentajeRetencion') cell.numFmt = 'General';
      else cell.numFmt = '@';
    });
  };

  detalles.forEach((d, i) => {
    const row = sheet.getRow(5 + i);
    const propios = erroresPorFila.get(i + 1) ?? [];
    formatear(row);
    row.getCell(1).value = i + 1;
    COLUMNAS_XML.forEach((c, j) => {
      const cell = row.getCell(j + 2);
      cell.value = d[c.campo];
      if (propios.some((e) => e.campo === c.campo)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
        cell.font = { color: { argb: ROJO } };
      }
    });
    if (propios.length) {
      row.getCell(13).value = propios.map((e) => e.mensaje).join(' ');
      row.getCell(13).font = { color: { argb: ROJO } };
    }
  });
  for (let k = 0; k < FILAS_LIBRES; k++) formatear(sheet.getRow(5 + detalles.length + k));

  const generales = erroresPorFila.get(0);
  if (generales?.length) {
    sheet.getCell('M1').value = generales.map((e) => e.mensaje).join(' ');
    sheet.getCell('M1').font = { color: { argb: ROJO } };
  }
  sheet.views = [{ state: 'frozen', ySplit: 4 }];

  return convertirEnXlsm(Buffer.from(await wb.xlsx.writeBuffer()));
}

/** Archivo XML listo para cargar en el portal del SENIAT. Si hay datos inválidos no se genera (como la macro). */
export async function generarXmlIslr(bd: string, query: RetencionesIslrQuery): Promise<Buffer> {
  const { detalles, rifAgente, periodo, errores } = await datosXml(bd, query);
  if (errores.length) throw new RetencionesIslrInvalidasError(errores);
  return Buffer.from(construirXml(detalles, rifAgente, periodo), 'latin1');
}
