export interface Empresa {
  codEmpresa: string;
  nombre: string;
  nombreCliente: string;
  rif: string;
  direccion: string;
  codCliente: number;
}

export interface Sucursal {
  codSucursal: string;
  descripcion: string;
  nombreCliente: string;
  nombreComercial: string;
  rif: string;
  direccion: string;
  codCliente: number;
}

export interface Almacen {
  codAlmacen: string;
  nombre: string;
  nombreCliente: string;
  rif: string;
  direccion: string;
}

export interface Moneda {
  codMoneda: number;
  descripcion: string;
  iniciales: string;
  principal: boolean;
  cotizacion: number;
}

export interface Proveedor {
  codProveedor: number;
  nombre: string;
  rif: string;
  direccion: string;
}

export interface ConfiguracionCuentas {
  sobranteVenta: string;
  faltanteVenta: string;
  sobranteRedondeo: string;
  faltanteRedondeo: string;
  /** Base contable de la que se eligieron las cuentas (memoria de la ventana). */
  bdContable: string;
  /** Si el cierre de caja contabiliza el costo de venta (y ofrece "Contabilizar Compras"). */
  incluirCostoVenta: boolean;
}

export interface BaseContable {
  bd: string;
  descripcion: string;
  ejercicios: number[];
}

export interface CuentaContable {
  codigo: string;
  titulo: string;
}

export interface UsuarioPermisos {
  codUsuario: number;
  usuario: string;
  visualizarCajas: boolean;
  contabilizar: boolean;
  descontabilizar: boolean;
  modulos: string[];
}

export interface ModuloCatalogo {
  id: string;
  nombre: string;
  grupo: string;
}

export interface Tienda {
  serie: string;
  descripcion: string;
  codCliente: number;
  idFront: number;
}

export interface CierreCajaLinea {
  fecha: string;
  caja: string;
  serieCaja: string;
  z: number;
  codFormaPago: string;
  descripcion: string;
  /** ISO de la moneda (MONEDAS.INICIALES). */
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

export interface AsientoLinea {
  cuenta: string;
  titulo: string;
  comentario: string;
  debe: number;
  haber: number;
  centroCoste: string;
}

/** Respuesta de POST /api/cajas/contabilizar. */
export interface ResultadoContabilizar {
  status: 'SUCCESS' | 'ERROR' | 'ERRORCONCILIACION';
  /** DIARIOAPUNTES.ASIENTO (número interno). Null si falló o en depósitos. */
  asiento: number | null;
  /** DIARIOAPUNTES.ASIENTOVISIBLE (el que ve el usuario en la contabilidad). */
  asientoVisible: number | null;
  /** Mensaje de SQL Server cuando la base rechazó la operación. */
  mensaje?: string | null;
  /** Usuario de la sesión que contabilizó. */
  procesadoPor?: string;
  resumen?: {
    caja: string;
    cajero: string;
    z: number;
    facturas: number;
    notasCredito: number;
  } | null;
}

export interface AsientoPreview {
  lineas: AsientoLinea[];
  totalDebe: number;
  totalHaber: number;
  cuadrado: boolean;
  contabilizado: boolean;
  /** Solo en el asiento de cierre (tipo 1). */
  incluyeCostoVenta?: boolean;
}

export interface FormaPagoDisponible {
  codTipoPago: number;
  descripcion: string;
}

export type EstadoOperacion = 'SUCCESS' | 'ERROR' | 'ERRORCONCILIACION';
