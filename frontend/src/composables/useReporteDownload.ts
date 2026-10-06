import { ref } from 'vue';
import { api } from '../lib/api';

/** yyyyMMdd -> dd-MM-yyyy (con guiones: "/" no es válido en un nombre de archivo). */
function fechaArchivo(yyyyMMdd: string | number | undefined): string | null {
  const s = String(yyyyMMdd ?? '');
  return /^\d{8}$/.test(s) ? `${s.slice(6, 8)}-${s.slice(4, 6)}-${s.slice(0, 4)}` : null;
}

/**
 * Nombre del Excel: el módulo y el rango consultado, p. ej.
 * "Libro de Venta 01-09-2026 al 30-09-2026.xlsx". Lo arma el frontend porque el
 * navegador no deja leer el Content-Disposition del backend cuando están en orígenes
 * distintos (desarrollo), y así el nombre es igual en desarrollo y en el servicio.
 */
export function nombreArchivo(modulo: string, params: Record<string, string | number | undefined>): string {
  const desde = fechaArchivo(params.desde);
  const hasta = fechaArchivo(params.hasta);
  if (!desde || !hasta) return `${modulo}.xlsx`;
  return desde === hasta ? `${modulo} ${desde}.xlsx` : `${modulo} ${desde} al ${hasta}.xlsx`;
}

export function useReporteDownload() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** `modulo`: el nombre del reporte tal como se ve en el menú. */
  async function descargar(path: string, params: Record<string, string | number | undefined>, modulo: string) {
    loading.value = true;
    error.value = null;
    try {
      const resp = await api.getFile(path, params);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo(modulo, params);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al generar el reporte';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, descargar };
}
