import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api';

export interface EstadoActualizador {
  versionActual: string;
  repo: string;
  configurado: boolean;
  comoServicio: boolean;
  ultima: { version: string; tag: string; nombre: string; notas: string; fecha: string | null; url: string; tamano: number } | null;
  hayNueva: boolean;
  enCurso: boolean;
  ultimoResultado: { estado: 'en-curso' | 'ok' | 'error'; desde?: string; hasta?: string; mensaje?: string; fecha?: string } | null;
  error: string | null;
}

/** Estado del actualizador, compartido entre la pantalla y el aviso del header (SUPERVISOR). */
export const useActualizacionesStore = defineStore('actualizaciones', () => {
  const estado = ref<EstadoActualizador | null>(null);

  async function consultar(forzar = false) {
    estado.value = await api.get<EstadoActualizador>('/api/actualizador/estado', forzar ? { forzar: 1 } : undefined);
    return estado.value;
  }

  /** Para el header: si falla (sin internet, GitHub caído) simplemente no se muestra el aviso. */
  async function revisarEnSegundoPlano() {
    try {
      await consultar(false);
    } catch {
      /* sin aviso */
    }
  }

  return { estado, consultar, revisarEnSegundoPlano };
});
