import { ref } from 'vue';
import { api } from '../lib/api';

function filenameFromHeader(resp: Response, fallback: string): string {
  const header = resp.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(header);
  return match?.[1] ?? fallback;
}

export function useReporteDownload() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function descargar(path: string, params: Record<string, string | number | undefined>, fallbackName: string) {
    loading.value = true;
    error.value = null;
    try {
      const resp = await api.getFile(path, params);
      const blob = await resp.blob();
      const filename = filenameFromHeader(resp, fallbackName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
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
