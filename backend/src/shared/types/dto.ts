export interface Empresa {
  codEmpresa: string;
  nombre: string;
  nombreCliente: string;
  rif: string;
  direccion: string;
  codCliente: number;
}

export interface Sucursal {
  codSucursal: string; // SERIE
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

export interface Impresora {
  lugar: string;
  serial: string;
  impresora: string;
  modelo: string;
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
