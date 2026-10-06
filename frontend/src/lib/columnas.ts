/**
 * Nombres legibles para las columnas de las vistas previas. Los procedimientos
 * devuelven nombres técnicos (NOMBRECLIENTE, NUMRETENCION…) que la tabla mostraba tal
 * cual. Esto es SOLO presentación: las claves de cada fila no cambian y la exportación
 * a Excel (armada en el backend) no pasa por aquí.
 *
 * Un mismo nombre técnico se repite entre módulos con el mismo significado (FECHA,
 * RIF, NUMCONTROL…), por eso el mapa es uno solo. Si en algún módulo un nombre
 * significa otra cosa, la vista puede pasar sus propias etiquetas a `ReportTable`.
 */

/** Columnas de relleno de los procedimientos, sin datos para el usuario. */
export const COLUMNAS_OCULTAS = new Set(['LIBRE', 'LIBRE2']);

const ETIQUETAS: Record<string, string> = {
  // --- Comunes ---
  ID: 'N° Oper.',
  FECHA: 'Fecha',
  RIF: 'RIF',
  TOTALNETO: 'Total con IVA',
  EXENTO: 'Exento',
  NUMCONTROL: 'Num. Control',
  NUMRETENCION: 'Num. Retención',
  IVARETENIDO: 'IVA Retenido',
  DESCRIPCION: 'Descripción',
  SUCURSAL: 'Sucursal',
  BASE_IGTF: 'Base IGTF',
  TOTAL_IGTF: 'IGTF',

  // --- Libro de Venta (MR_LIBRO_VENTA / MR_LIBRO_VENTA2) ---
  NOMBRECLIENTE: 'Cliente',
  FECHACOMPROBANTE: 'Fecha Comprobante',
  NROPLANILLAEXPORTACION: 'Num. Planilla Exportación',
  PRINTER_FISCAL: 'Factura Fiscal',
  NUMFACTURAICG: 'Factura Sistema',
  FACTURAICG: 'Factura Sistema',
  NOCONTROL: 'Num. Control',
  TIPODOCUMENTO: 'Tipo Doc.',
  ZFISCAL: 'Reporte Z',
  SFISCAL: 'Impresora Fiscal',
  NRO_NOTA_DEBITO: 'Nota de Débito',
  NUM_NOTA_CREDITO: 'Nota de Crédito',
  TIPO_TRANSACCION: 'Tipo Transacción',
  FACT_AFECTADA: 'Factura Afectada',
  BASE_EXENT_CONTR: 'Ventas Exentas',
  BASE_GENERAL_CONTR: 'Base 16% Contrib.',
  IMP_GENERAL_CONTR: 'IVA 16% Contrib.',
  BASE_REDUC_CONTR: 'Base 8% Contrib.',
  IMP_REDUC_CONTR: 'IVA 8% Contrib.',
  BASE_ADICI_CONTR: 'Base 31% Contrib.',
  IMP_ADICI_CONTR: 'IVA 31% Contrib.',
  BASE_PERC_CONTR: 'Base 0% Contrib.',
  IMP_PERC_CONTR: 'IVA 0% Contrib.',
  BASE_GENERAL_NO_CONTR: 'Base 16% No Contrib.',
  IMP_GENERAL_NO_CONTR: 'IVA 16% No Contrib.',
  BASE_REDUC_NO_CONTR: 'Base 8% No Contrib.',
  IMP_REDUC_NO_CONTR: 'IVA 8% No Contrib.',
  BASE_ADICI_NO_CONTR: 'Base 31% No Contrib.',
  IMP_ADICI_NO_CONTR: 'IVA 31% No Contrib.',
  BASE_PERC_NO_CONTR: 'Base 0% No Contrib.',
  IMP_PERC_NO_CONTR: 'IVA 0% No Contrib.',
  TOTAL_VENTA_IVA_IGTF: 'Total con IVA e IGTF',
  IVA_RETENIDO_COMPRADOR: 'IVA Retenido',

  // --- Libro de Compra (MR_LIBRO_COMPRA) ---
  NOMPROVEEDOR: 'Proveedor',
  TIPODOC: 'Tipo Doc.',
  NUMFAC: 'Num. Factura',
  NUMIMPORTACION: 'Num. Planilla Importación',
  NUMEXPEDIENTE: 'Num. Expediente',
  NUMNOTADEBITO: 'Nota de Débito',
  NUMCONTROLNOTADEBITO: 'Num. Control N/D',
  NUM_NC: 'Nota de Crédito',
  NUMCONTROL_NC: 'Num. Control N/C',
  NUMFACAFECTA: 'Factura Afectada',
  TIPOTRANSACCION: 'Tipo Transacción',
  TOTALIMPORTACION: 'Total Importación',
  BASE_IMPONIBLE_GENERAL: 'Base 16%',
  TOTALIMPUESTOS_16: 'IVA 16%',
  BASE_IMPONIBLE_REDUCIDO: 'Base 8%',
  TOTALIMPUESTOS_8: 'IVA 8%',
  BASE_IMPONIBLE_ADDICIONAL: 'Base 31%',
  TOTALIMPUESTOS_31: 'IVA 31%',
  BASE_IMPONIBLE_PERCIBIDO: 'Base 0%',
  TOTALIMPUESTOS_0: 'IVA 0%',
  NUMRETENCIONIVA: 'Num. Retención IVA',
  BASEIMPONIBLEIGTF: 'Base IGTF',
  TOTALIGTF: 'IGTF',

  // --- Retenciones ISLR (MR_RETENCIONES_ISLR) ---
  CODPROVEEDOR: 'Cód. Proveedor',
  RIF_PROVEEDOR: 'RIF Proveedor',
  FECHARETISLR: 'Fecha Retención',
  BASE: 'Base Imponible',
  PORCRETENCION: '% Retención',
  SUSTRAENDO: 'Sustraendo',
  RETENIDO: 'Monto Retenido',

  // --- ARCV (rip.MR_FORMATO_ARCV) ---
  DIA: 'Día',
  MES: 'Mes',
  ANYO: 'Año',
  PAGADO: 'Pagado',
  BASE_ACUM: 'Base Acumulada',
  RETENIDO_ACUM: 'Retenido Acumulado',

  // --- Retenciones IVA (MR_RETENCIONES_IVA) ---
  RIF_CLIENTE: 'RIF Cliente',
  PERIODO: 'Período',
  TIPO_OPERACION: 'Tipo Operación',
  TIPO_DOCUMENTO: 'Tipo Documento',
  NUMFACTURA: 'Num. Factura',
  MONTO_DOCUMENTO: 'Monto Documento',
  BASE_IMPONIBLE: 'Base Imponible',
  NUM_DOC_AFECTADO: 'Doc. Afectado',
  ALICUOTA: '% Alícuota',
  NUM_IMPORTACION: 'Num. Importación',

  // --- Movimiento de Inventario (REPM_MOVIMIENTO_INVENTARIO) ---
  REFPROVEEDOR: 'Ref. Proveedor',
  DEPARTAMENTO: 'Departamento',
  SECCION: 'Sección',
  MARCA: 'Marca',
  LINEA: 'Línea',
  COSTO: 'Costo',
  STOCK_INICIAL: 'Stock Inicial',
  MONTO_STOCK_INICIAL: 'Monto Stock Inicial',
  ENTRADAS: 'Entradas',
  MONTO_ENTRADAS: 'Monto Entradas',
  SALIDAS: 'Salidas',
  MONTO_SALIDAS: 'Monto Salidas',
  AUTOCONSUMOS: 'Autoconsumos',
  MONTO_AUTOCONSUMOS: 'Monto Autoconsumos',
  RETIROS: 'Retiros',
  MONTO_RETIROS: 'Monto Retiros',
  STOCK_FINAL: 'Stock Final',
  MONTO_STOCK_FINAL: 'Monto Stock Final',

  // --- Libro de Venta Isla (MR_LIBRO_VENTA_AGRUPADO, una fila por impresora) ---
  IMPRESORA: 'Impresora Fiscal',
};

/** Libro de Venta Isla: FV_/ND_/NC_ + concepto (FV_BASE_GENERAL → "Fact. Base 16%"). */
const PREFIJOS_ISLA: Record<string, string> = { FV: 'Fact.', ND: 'N/D', NC: 'N/C' };
const CONCEPTOS_ISLA: Record<string, string> = {
  INICIAL: 'Desde',
  FINAL: 'Hasta',
  TOTAL: 'Total',
  SUBTOTAL: 'Subtotal',
  BASE_GENERAL: 'Base 16%',
  IVA_GENERAL: 'IVA 16%',
  BASE_REDUCIDO: 'Base 8%',
  IVA_REDUCIDO: 'IVA 8%',
  BASE_ADICIONAL: 'Base 31%',
  IVA_ADICIONAL: 'IVA 31%',
  BASE_PERCIBIDO: 'Base 0%',
  IVA_PERCIBIDO: 'IVA 0%',
  BASE_EXENTO: 'Exento',
  IVA_EXENTO: 'IVA Exento',
  BASE_IGTF: 'Base IGTF',
  IGTF: 'IGTF',
};

function etiquetaIsla(col: string): string | undefined {
  const m = /^(FV|ND|NC)_(.+)$/.exec(col);
  if (!m) return undefined;
  const concepto = CONCEPTOS_ISLA[m[2]];
  return concepto ? `${PREFIJOS_ISLA[m[1]]} ${concepto}` : undefined;
}

/**
 * Nombre a mostrar. Orden: etiquetas propias de la vista → mapa general → patrón del
 * Libro de Venta Isla → el nombre técnico con "_" como espacio (para columnas que aún
 * no están en el mapa, p. ej. las de ARCV o las que agregue una nueva versión de un SP).
 */
export function etiquetaColumna(col: string, propias: Record<string, string> = {}): string {
  return propias[col] ?? ETIQUETAS[col] ?? etiquetaIsla(col) ?? col.replaceAll('_', ' ');
}
