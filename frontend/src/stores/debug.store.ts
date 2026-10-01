import { defineStore } from 'pinia';
import { api } from '../lib/api';

export interface ParametroSql {
  nombre: string;
  tipo: string;
  valor: unknown;
}

interface EventoBase {
  id: number;
  fecha: string;
  reqId: string | null;
  ms: number;
  error: string | null;
}

export interface EventoSql extends EventoBase {
  tipo: 'sql';
  bd: string;
  modo: 'query' | 'execute';
  texto: string;
  parametros: ParametroSql[];
  filas: number[] | null;
  filasAfectadas: number[] | null;
  script: string;
}

export interface EventoApi extends EventoBase {
  tipo: 'api';
  metodo: string;
  url: string;
  estado: number;
  usuario: string | null;
  bd: string | null;
  cuerpo: unknown;
  respuesta: string | null;
}

export type EventoDebug = EventoSql | EventoApi;

/** Una acción de pantalla y si está disponible, con el motivo cuando no lo está. */
export interface DiagnosticoAccion {
  accion: string;
  disponible: boolean;
  motivo: string;
}

export interface DiagnosticoGrupo {
  titulo: string;
  acciones: DiagnosticoAccion[];
}

const MAX_EVENTOS = 500;
const INTERVALO_MS = 1500;

let temporizador: ReturnType<typeof setInterval> | null = null;

/**
 * Estado del panel de debug. Solo para el SUPERVISOR: él lo enciende y apaga con el
 * botón del header (POST /api/debug/estado) y el backend lo aplica en caliente para
 * todos los usuarios. `activo` refleja el estado real del backend.
 */
export const useDebugStore = defineStore('debug', {
  state: () => ({
    activo: false,
    comprobado: false,
    cambiando: false,
    eventos: [] as EventoDebug[],
    ultimoId: 0,
    pausado: false,
    errorConexion: '',
    /** Diagnóstico que publica la pantalla abierta (p. ej. Cierre de Caja). */
    diagnostico: { pantalla: '', grupos: [] as DiagnosticoGrupo[] },
  }),
  getters: {
    sql: (state) => state.eventos.filter((e): e is EventoSql => e.tipo === 'sql'),
    apiEventos: (state) => state.eventos.filter((e): e is EventoApi => e.tipo === 'api'),
    errores: (state) => state.eventos.filter((e) => e.error).length,
  },
  actions: {
    async comprobar() {
      if (this.comprobado) return;
      this.comprobado = true;
      try {
        const r = await api.get<{ debug: boolean }>('/api/debug/estado');
        this.activo = r.debug === true;
      } catch {
        this.activo = false;
      }
      if (this.activo) this.iniciar();
    },
    /** Enciende o apaga el modo debug en el backend (queda en la auditoría). */
    async cambiar(activar: boolean) {
      this.cambiando = true;
      try {
        const r = await api.post<{ debug: boolean }>('/api/debug/estado', { activo: activar });
        this.activo = r.debug === true;
        if (this.activo) this.iniciar();
        else this.pararSondeo();
      } finally {
        this.cambiando = false;
      }
    },
    pararSondeo() {
      if (temporizador) clearInterval(temporizador);
      temporizador = null;
    },
    iniciar() {
      if (temporizador) return;
      void this.traer();
      temporizador = setInterval(() => {
        if (!this.pausado) void this.traer();
      }, INTERVALO_MS);
    },
    /** Al cerrar sesión: deja de consultar y olvida el estado (lo vuelve a leer al entrar). */
    detener() {
      this.pararSondeo();
      this.comprobado = false;
      this.activo = false;
    },
    async traer() {
      try {
        const r = await api.get<{ eventos: EventoDebug[]; ultimoId: number }>('/api/debug/eventos', {
          desde: this.ultimoId,
        });
        // El backend se reinició (su contador volvió a empezar): se descarta lo viejo.
        if (r.ultimoId < this.ultimoId) this.eventos = [];
        this.ultimoId = r.ultimoId;
        if (r.eventos.length) {
          this.eventos = [...this.eventos, ...r.eventos].slice(-MAX_EVENTOS);
        }
        this.errorConexion = '';
      } catch (err) {
        this.errorConexion = err instanceof Error ? err.message : 'Sin conexión con el backend';
      }
    },
    async limpiar() {
      this.eventos = [];
      try {
        await api.delete('/api/debug/eventos', {});
      } catch {
        // Solo se limpia la vista si el backend no responde.
      }
    },
    publicarDiagnostico(pantalla: string, grupos: DiagnosticoGrupo[]) {
      this.diagnostico = { pantalla, grupos };
    },
    quitarDiagnostico(pantalla: string) {
      if (this.diagnostico.pantalla === pantalla) this.diagnostico = { pantalla: '', grupos: [] };
    },
  },
});
