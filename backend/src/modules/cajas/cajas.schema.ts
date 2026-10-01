export interface Tienda {
  serie: string;
  descripcion: string;
  codCliente: number;
  idFront: number;
}

export interface CierreCajaLinea {
  fecha: string;
  caja: string; // "01A (NOMBRE VENDEDOR)" — matches legacy display string
  serieCaja: string; // raw CAJA column, used as the key for actions
  z: number;
  codFormaPago: string;
  descripcion: string;
  /** ISO de la moneda de esta forma de pago (MONEDAS.INICIALES: USD, Bs.D, ...).
   * Vacío si la función de cierre de esta base no expone CODMONEDA. */
  moneda: string;
  importe: number;
  declarado: number;
  gastos: number;
  fo: string;
  cerrado: string;
  diferencia: number;
  codTipoPago: number | null;
  importeLocal: string;
  declaradoLocal: string;
  tasaVes: number;
  /** True when this (serieCaja, z) group still has FACTURASVENTA rows pending
   * traspaso (TRASPASADA='F'), OR has zero invoices at all — same "not yet
   * contabilizado" criterion the legacy PHP used per row-group to decide whether to
   * show TRASPASAR/DESCONTABILIZAR. */
  contabilizado: boolean;
}

export interface DepositoLinea {
  serie: string;
  tienda: string;
  fechaVenta: string;
  fechaDeposito: string;
  numeroDeposito: string;
  importe: number;
  banco: string;
  tipo: 'EFECTIVO' | 'CHEQUE';
  contabilizado: string;
  fondoCaja: string;
  fondoNumero: number;
  fondoN: string;
}

export const cierreQuerySchema = {
  type: 'object',
  required: ['serie', 'fecha'],
  properties: {
    serie: { type: 'string', minLength: 1, maxLength: 4 },
    fecha: { type: 'string', pattern: '^[0-9]{8}$' },
  },
} as const;

export interface AsientoLinea {
  cuenta: string;
  titulo: string;
  comentario: string;
  debe: number;
  haber: number;
  centroCoste: string;
}

export interface AsientoPreview {
  lineas: AsientoLinea[];
  totalDebe: number;
  totalHaber: number;
  cuadrado: boolean;
  /** Only meaningful for tipo=2 (depósito) — comes straight from RIP_V_DEPOSITOS.CONTABILIZADO. */
  contabilizado: boolean;
  /** Only set for tipo=1 (cierre): whether this company posts cost of sales, so the
   * UI knows to offer "Contabilizar Compras". See RIP_CONFIGURACIONCUENTAS.INCLUIRCOSTOVENTA. */
  incluyeCostoVenta?: boolean;
}

export const asientoQuerySchema = {
  type: 'object',
  required: ['tipo', 'serie', 'serieCaja', 'fecha', 'z'],
  properties: {
    tipo: { type: 'string', enum: ['1', '2'] },
    // The 2-3 char store code (same one used by /tiendas, /cierre, /depositos) —
    // determines which accounting DB this posts against.
    serie: { type: 'string', minLength: 1, maxLength: 4 },
    // The specific physical register (e.g. "FA1"), not the store code above.
    serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
    fecha: { type: 'string', pattern: '^[0-9]{8}$' },
    z: { type: 'string' },
  },
} as const;

export interface FormaPagoDisponible {
  codTipoPago: number;
  descripcion: string;
}

export const formasPagoDisponiblesQuerySchema = {
  type: 'object',
  required: ['caja', 'z'],
  properties: {
    caja: { type: 'string', minLength: 1, maxLength: 10 },
    z: { type: 'string' },
  },
} as const;

export const cotizacionQuerySchema = {
  type: 'object',
  required: ['fecha', 'importe'],
  properties: {
    fecha: { type: 'string', pattern: '^[0-9]{8}$' },
    importe: { type: 'number' },
  },
} as const;

export type EstadoOperacion = 'SUCCESS' | 'ERROR' | 'ERRORCONCILIACION';

export interface ContabilizarBody {
  tipo: '1' | '2' | '3';
  serie: string;
  serieCaja: string;
  fecha: string;
  z: number;
  /** Cierre "a fecha atrasada" — cuando se da, el asiento se postea con esta fecha en
   * vez de la fecha de venta. Se pasa explícitamente en cada llamada (a diferencia del
   * legacy, que la dejaba pegada en `$_SESSION['fechacontable']` entre operaciones —
   * un efecto colateral peligroso si el usuario cambiaba de caja sin refrescar). */
  fechaContable?: string;
  fondoCaja?: string;
  fondoN?: string;
  /** Lista de NUMERO de FONDOCAJA separados por coma (mismo formato que el `IN(...)` legacy). */
  fondoNumero?: string;
}

export const contabilizarBodySchema = {
  type: 'object',
  required: ['tipo', 'serie', 'serieCaja', 'fecha', 'z'],
  properties: {
    tipo: { type: 'string', enum: ['1', '2', '3'] },
    serie: { type: 'string', minLength: 1, maxLength: 4 },
    serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
    fecha: { type: 'string', pattern: '^[0-9]{8}$' },
    z: { type: 'integer' },
    fechaContable: { type: 'string', pattern: '^[0-9]{8}$' },
    fondoCaja: { type: 'string' },
    fondoN: { type: 'string' },
    fondoNumero: { type: 'string' },
  },
} as const;

export interface DescontabilizarBody {
  serie: string;
  serieCaja: string;
  fecha: string;
  z: number;
  fechaContable?: string;
}

export const descontabilizarBodySchema = {
  type: 'object',
  required: ['serie', 'serieCaja', 'fecha', 'z'],
  properties: {
    serie: { type: 'string', minLength: 1, maxLength: 4 },
    serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
    fecha: { type: 'string', pattern: '^[0-9]{8}$' },
    z: { type: 'integer' },
    fechaContable: { type: 'string', pattern: '^[0-9]{8}$' },
  },
} as const;

export interface DescontabilizarDepositoBody {
  serie: string;
  serieCaja: string;
  fecha: string;
  fechaContable?: string;
  fondoCaja: string;
  fondoN: string;
  fondoNumero: string;
}

export const descontabilizarDepositoBodySchema = {
  type: 'object',
  required: ['serie', 'serieCaja', 'fecha', 'fondoCaja', 'fondoN', 'fondoNumero'],
  properties: {
    serie: { type: 'string', minLength: 1, maxLength: 4 },
    serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
    fecha: { type: 'string', pattern: '^[0-9]{8}$' },
    fechaContable: { type: 'string', pattern: '^[0-9]{8}$' },
    fondoCaja: { type: 'string' },
    fondoN: { type: 'string' },
    fondoNumero: { type: 'string' },
  },
} as const;

export interface TraspasarBody {
  serieCaja: string;
  z: number;
}

export const traspasarBodySchema = {
  type: 'object',
  required: ['serieCaja', 'z'],
  properties: {
    serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
    z: { type: 'integer' },
  },
} as const;

export interface GuardarMontoBody {
  z: number;
  codTipoPago: number;
  caja: string;
  fecha: string;
  nuevo: number;
}

export const guardarMontoBodySchema = {
  type: 'object',
  required: ['z', 'codTipoPago', 'caja', 'fecha'],
  properties: {
    z: { type: 'integer' },
    codTipoPago: { type: 'integer' },
    caja: { type: 'string', minLength: 1, maxLength: 10 },
    fecha: { type: 'string', pattern: '^[0-9]{8}$' },
    nuevo: { type: 'number' },
  },
} as const;

export interface GuardarFormaPagoBody {
  caja: string;
  z: number;
  forma: string;
  monto: number;
}

export const guardarFormaPagoBodySchema = {
  type: 'object',
  required: ['caja', 'z', 'forma', 'monto'],
  properties: {
    caja: { type: 'string', minLength: 1, maxLength: 10 },
    z: { type: 'integer' },
    forma: { type: 'string', minLength: 1 },
    monto: { type: 'number' },
  },
} as const;

export interface EliminarFormaPagoBody {
  caja: string;
  z: number;
  forma: string;
}

export const eliminarFormaPagoBodySchema = {
  type: 'object',
  required: ['caja', 'z', 'forma'],
  properties: {
    caja: { type: 'string', minLength: 1, maxLength: 10 },
    z: { type: 'integer' },
    forma: { type: 'string', minLength: 1 },
  },
} as const;
