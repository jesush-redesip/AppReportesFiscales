<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../lib/api';
import ReportTable from '../components/ReportTable.vue';

/** Registro de auditoría (solo SUPERVISOR): quién hizo qué y cuándo. */

interface FilaAuditoria {
  id: number;
  fecha: string;
  usuario: string;
  codUsuario: number | null;
  empresa: string;
  accion: string;
  resultado: string;
  mensaje: string;
  detalle: string;
  ip: string;
}

function isoLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const hoy = new Date();
const haceUnaSemana = new Date(hoy.getTime() - 6 * 86400000);

const filtros = reactive({ desde: isoLocal(haceUnaSemana), hasta: isoLocal(hoy), usuario: '', accion: '', resultado: '' });
const acciones = ref<string[]>([]);
const filas = ref<FilaAuditoria[]>([]);
const truncado = ref(false);
const cargando = ref(false);
const error = ref('');
const consultado = ref(false);

const COLUMNAS = ['FECHA', 'HORA', 'USUARIO', 'EMPRESA', 'ACCION', 'RESULTADO', 'MENSAJE', 'DETALLE', 'IP'];
const ETIQUETAS = { FECHA: 'Fecha', HORA: 'Hora', USUARIO: 'Usuario', EMPRESA: 'Empresa', ACCION: 'Acción', RESULTADO: 'Resultado', MENSAJE: 'Mensaje', DETALLE: 'Detalle', IP: 'IP' };

/**
 * 'AAAA-MM-DD HH:MM:SS' (hora del servidor, sin zona) -> fecha 'DD/MM/AAAA' y hora en
 * 12 horas 'hh:mm:ss a. m.'. Se arma con texto a propósito: pasar por `new Date()` la
 * trataría como otra zona horaria y corría la hora (ver consultarAuditoria en el backend).
 */
function fechaYHora(texto: string): { fecha: string; hora: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(texto);
  if (!m) return { fecha: texto, hora: '' };
  const h24 = Number(m[4]);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const sufijo = h24 < 12 ? 'a. m.' : 'p. m.';
  return { fecha: `${m[3]}/${m[2]}/${m[1]}`, hora: `${String(h12).padStart(2, '0')}:${m[5]}:${m[6]} ${sufijo}` };
}

/** Detalle legible: "serieCaja: AA1, z: 125" en vez del JSON crudo. */
function resumirDetalle(json: string): string {
  if (!json) return '';
  let valor: unknown;
  try {
    valor = JSON.parse(json);
  } catch {
    return json;
  }
  const plano = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.map(plano).join(' | ');
    if (typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined && x !== '')
        .map(([k, x]) => `${k}: ${typeof x === 'object' && x !== null ? `[${plano(x)}]` : plano(x)}`)
        .join(', ');
    }
    if (typeof v === 'boolean') return v ? 'sí' : 'no';
    return String(v);
  };
  const texto = plano(valor);
  return texto.length > 160 ? `${texto.slice(0, 160)}…` : texto;
}

// ReportTable centra, pagina y oculta nada de esto; se le pasan textos ya formateados
// para que no intente sumar ni formatear números (no hay montos en la auditoría).
const filasTabla = computed(() =>
  filas.value.map((f) => {
    const { fecha, hora } = fechaYHora(f.fecha);
    return {
      FECHA: fecha,
      HORA: hora,
      USUARIO: f.usuario || '—',
      EMPRESA: f.empresa || '—',
      ACCION: f.accion,
      RESULTADO: f.resultado,
      MENSAJE: f.mensaje,
      DETALLE: resumirDetalle(f.detalle),
      IP: f.ip,
    };
  }),
);

async function consultar() {
  if (filtros.desde > filtros.hasta) {
    error.value = 'La fecha "desde" no puede ser posterior a "hasta".';
    return;
  }
  cargando.value = true;
  error.value = '';
  try {
    const r = await api.get<{ filas: FilaAuditoria[]; truncado: boolean }>('/api/auditoria', { ...filtros });
    filas.value = r.filas;
    truncado.value = r.truncado;
    consultado.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al consultar la auditoría.';
  } finally {
    cargando.value = false;
  }
}

onMounted(async () => {
  try {
    acciones.value = await api.get<string[]>('/api/auditoria/acciones');
  } catch {
    // Sin la lista, el filtro de acción queda solo con "Todas".
  }
  await consultar();
});
</script>

<template>
  <section>
    <h1>Auditoría</h1>
    <p class="ayuda">
      Quién hizo qué y cuándo: inicios de sesión, contabilizaciones, cambios en el cierre de caja, configuración,
      permisos, descargas de Excel y el modo debug.
    </p>

    <form class="card filtros" @submit.prevent="consultar">
      <label class="campo">
        Desde
        <input v-model="filtros.desde" type="date" required />
      </label>
      <label class="campo">
        Hasta
        <input v-model="filtros.hasta" type="date" required />
      </label>
      <label class="campo">
        Usuario
        <input v-model="filtros.usuario" type="text" placeholder="Todos" />
      </label>
      <label class="campo">
        Acción
        <select v-model="filtros.accion">
          <option value="">Todas</option>
          <option v-for="a in acciones" :key="a" :value="a">{{ a }}</option>
        </select>
      </label>
      <label class="campo">
        Resultado
        <select v-model="filtros.resultado">
          <option value="">Todos</option>
          <option value="OK">OK</option>
          <option value="ERROR">Error</option>
          <option value="RECHAZADO">Rechazado</option>
        </select>
      </label>
      <button type="submit" :disabled="cargando">{{ cargando ? 'Consultando...' : 'Consultar' }}</button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="truncado" class="aviso">
      Se muestran los 5.000 registros más recientes del rango. Acota las fechas o los filtros para ver el resto.
    </p>
    <ReportTable v-if="consultado" :columns="COLUMNAS" :rows="filasTabla" :labels="ETIQUETAS" />
  </section>
</template>

<style scoped>
.ayuda {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0 0 var(--space-4);
}
.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
}
.campo {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.campo input,
.campo select {
  min-width: 10rem;
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin-top: var(--space-3);
}
.aviso {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: var(--space-3);
}
</style>
