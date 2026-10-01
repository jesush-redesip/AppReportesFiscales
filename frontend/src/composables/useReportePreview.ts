import { ref } from 'vue';
import { api } from '../lib/api';

export interface PreviewData {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function useReportePreview() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const data = ref<PreviewData | null>(null);

  async function cargar(path: string, params: Record<string, string | number | undefined>) {
    loading.value = true;
    error.value = null;
    data.value = null;
    try {
      data.value = await api.get<PreviewData>(path, params);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al cargar la vista previa';
    } finally {
      loading.value = false;
    }
  }

  function limpiar() {
    data.value = null;
    error.value = null;
  }

  return { loading, error, data, cargar, limpiar };
}
