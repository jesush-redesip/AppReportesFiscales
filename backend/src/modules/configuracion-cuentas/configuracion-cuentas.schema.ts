/**
 * Solo las 4 cuentas de sobrante/faltante que consume el cierre de caja. Las otras 5
 * columnas de la `RIP_CONFIGURACIONCUENTAS` original (IVA, COMISIONBANCARIA,
 * RAIZPAGARE, RAIZUTILIDAD, APERTURA) pertenecen a módulos que no se migraron
 * (pagarés/balances) y siguen viviendo en GENERAL para el aplicativo PHP legacy —
 * esta app no las lee ni las escribe.
 */
export interface ConfiguracionCuentas {
  sobranteVenta: string;
  faltanteVenta: string;
  sobranteRedondeo: string;
  faltanteRedondeo: string;
  /** Base de datos contable de la que se eligieron las cuentas. Se guarda solo para
   * que la ventana de configuración vuelva a abrirse mostrando el mismo plan de
   * cuentas; el cierre de caja NO la usa (resuelve la BD contable por tienda, vía
   * SERIES.CONTABILIDADB — ver `resolveBdContable`). */
  bdContable: string;
  /** Si el cierre de caja postea el costo de venta (`RIP_COSTOVENTA`) y permite
   * "Contabilizar Compras". Hay empresas que no llevan costo de ventas en su
   * contabilidad; por defecto `true`, que es el comportamiento legacy. */
  incluirCostoVenta: boolean;
}

export interface BaseContable {
  /** Nombre de la base de datos contable (p. ej. "cFRANCELINA_2021"). */
  bd: string;
  descripcion: string;
  ejercicios: number[];
}

export interface CuentaContable {
  codigo: string;
  titulo: string;
}

// CUENTAS.CODIGO es NVARCHAR(12) en el esquema real de ICG.
export const configuracionCuentasBodySchema = {
  type: 'object',
  required: ['sobranteVenta', 'faltanteVenta', 'sobranteRedondeo', 'faltanteRedondeo', 'bdContable'],
  properties: {
    sobranteVenta: { type: 'string', maxLength: 12 },
    faltanteVenta: { type: 'string', maxLength: 12 },
    sobranteRedondeo: { type: 'string', maxLength: 12 },
    faltanteRedondeo: { type: 'string', maxLength: 12 },
    bdContable: { type: 'string', maxLength: 128 },
    incluirCostoVenta: { type: 'boolean' },
  },
} as const;

export const cuentasDisponiblesQuerySchema = {
  type: 'object',
  required: ['bdContable'],
  properties: {
    bdContable: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;
