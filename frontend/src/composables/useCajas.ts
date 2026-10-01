import { ref } from 'vue';
import { api } from '../lib/api';
import type {
  AsientoPreview,
  CierreCajaLinea,
  DepositoLinea,
  EstadoOperacion,
  FormaPagoDisponible,
  ResultadoContabilizar,
  Tienda,
} from '../lib/types';

export function useCajas() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function conLoading<T>(fn: () => Promise<T>): Promise<T | null> {
    loading.value = true;
    error.value = null;
    try {
      return await fn();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error de comunicación con el servidor';
      return null;
    } finally {
      loading.value = false;
    }
  }

  const cargarTiendas = () => conLoading(() => api.get<Tienda[]>('/api/cajas/tiendas'));

  const cargarCierre = (serie: string, fecha: string) =>
    conLoading(() => api.get<CierreCajaLinea[]>('/api/cajas/cierre', { serie, fecha }));

  const cargarDepositos = (serie: string, fecha: string) =>
    conLoading(() => api.get<DepositoLinea[]>('/api/cajas/depositos', { serie, fecha }));

  const cargarAsiento = (tipo: '1' | '2', serie: string, serieCaja: string, fecha: string, z: number) =>
    conLoading(() => api.get<AsientoPreview>('/api/cajas/asiento', { tipo, serie, serieCaja, fecha, z }));

  const cargarFormasPagoDisponibles = (caja: string, z: number) =>
    conLoading(() => api.get<FormaPagoDisponible[]>('/api/cajas/formas-pago-disponibles', { caja, z }));

  const cargarCotizacion = (fecha: string, importe: number) =>
    conLoading(() => api.get<string[]>('/api/cajas/cotizacion', { fecha, importe }));

  const contabilizar = (body: {
    tipo: '1' | '2' | '3';
    serie: string;
    serieCaja: string;
    fecha: string;
    z: number;
    fechaContable?: string;
    fondoCaja?: string;
    fondoN?: string;
    fondoNumero?: string;
  }) => conLoading(() => api.post<ResultadoContabilizar>('/api/cajas/contabilizar', body));

  const descontabilizar = (body: { serie: string; serieCaja: string; fecha: string; z: number; fechaContable?: string }) =>
    conLoading(() => api.post<{ status: EstadoOperacion }>('/api/cajas/descontabilizar', body));

  const descontabilizarDeposito = (body: {
    serie: string;
    serieCaja: string;
    fecha: string;
    fechaContable?: string;
    fondoCaja: string;
    fondoN: string;
    fondoNumero: string;
  }) => conLoading(() => api.post<{ status: EstadoOperacion }>('/api/cajas/descontabilizar-deposito', body));

  const traspasar = (serieCaja: string, z: number) =>
    conLoading(() => api.post<{ ok: boolean }>('/api/cajas/traspasar', { serieCaja, z }));

  const guardarDeclarado = (body: { z: number; codTipoPago: number; caja: string; fecha: string; nuevo: number }) =>
    conLoading(() => api.post<{ ok: boolean }>('/api/cajas/declarado', body));

  const guardarFormaPago = (body: { caja: string; z: number; forma: string; monto: number }) =>
    conLoading(() => api.post<{ ok: boolean }>('/api/cajas/forma-pago', body));

  const eliminarFormaPago = (body: { caja: string; z: number; forma: string }) =>
    conLoading(() => api.delete<{ ok: boolean }>('/api/cajas/forma-pago', body));

  return {
    loading,
    error,
    cargarTiendas,
    cargarCierre,
    cargarDepositos,
    cargarAsiento,
    cargarFormasPagoDisponibles,
    cargarCotizacion,
    contabilizar,
    descontabilizar,
    descontabilizarDeposito,
    traspasar,
    guardarDeclarado,
    guardarFormaPago,
    eliminarFormaPago,
  };
}
