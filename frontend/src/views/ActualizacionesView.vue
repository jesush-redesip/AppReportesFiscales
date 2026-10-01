<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../lib/api';
import { useActualizacionesStore, type EstadoActualizador } from '../stores/actualizaciones.store';

/**
 * Actualizaciones del aplicativo (solo SUPERVISOR). El backend consulta el último Release
 * de GitHub; "Actualizar ahora" lo descarga, verifica y lo instala reiniciando el servicio.
 * Mientras tanto esta pantalla espera a que /health responda la versión nueva.
 */
const store = useActualizacionesStore();
const estado = computed(() => store.estado);
const cargando = ref(false);
const error = ref('');
const confirmando = ref(false);
const fase = ref<'nada' | 'descargando' | 'reiniciando' | 'listo' | 'fallo'>('nada');
const mensajeFase = ref('');
let temporizador: ReturnType<typeof setInterval> | null = null;

async function consultar(forzar = false) {
  cargando.value = true;
  error.value = '';
  try {
    await store.consultar(forzar);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo consultar el estado.';
  } finally {
    cargando.value = false;
  }
}

function formatoTamano(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatoFecha(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

const puedeActualizar = computed(
  () => !!estado.value?.hayNueva && estado.value.comoServicio && !estado.value.enCurso && fase.value !== 'descargando' && fase.value !== 'reiniciando',
);

const motivoSinBoton = computed(() => {
  const e = estado.value;
  if (!e || !e.hayNueva) return '';
  if (!e.comoServicio) return 'El aplicativo no está corriendo como servicio de Windows (por ejemplo, en desarrollo): el botón solo se habilita en la instalación como servicio.';
  if (e.enCurso) return 'Ya hay una actualización en curso.';
  return '';
});

async function actualizar() {
  confirmando.value = false;
  error.value = '';
  fase.value = 'descargando';
  mensajeFase.value = 'Descargando y verificando el paquete…';
  try {
    const r = await api.post<{ ok: boolean; desde: string; hasta: string; mensaje: string }>('/api/actualizador/actualizar', {});
    fase.value = 'reiniciando';
    mensajeFase.value = r.mensaje;
    esperarVersion(r.hasta);
  } catch (err) {
    fase.value = 'fallo';
    mensajeFase.value = err instanceof Error ? err.message : 'No se pudo iniciar la actualización.';
  }
}

/** Sondea /health (público) hasta ver la versión nueva; luego recarga para tomar el frontend nuevo. */
function esperarVersion(version: string) {
  const inicio = Date.now();
  detenerSondeo();
  temporizador = setInterval(async () => {
    try {
      const resp = await fetch(new URL('/health', import.meta.env.VITE_API_BASE_URL || window.location.origin), { cache: 'no-store' });
      const h = (await resp.json()) as { version?: string };
      if (h.version === version) {
        detenerSondeo();
        fase.value = 'listo';
        mensajeFase.value = `Versión ${version} instalada. Recargando…`;
        setTimeout(() => window.location.reload(), 1500);
        return;
      }
    } catch {
      // Servicio detenido mientras se reemplazan los archivos: seguir esperando.
    }
    if (Date.now() - inicio > 4 * 60 * 1000) {
      detenerSondeo();
      fase.value = 'fallo';
      mensajeFase.value = 'La versión nueva no respondió a tiempo. Si falló, el actualizador restauró la anterior: revise "Última actualización".';
      void consultar(true);
    }
  }, 3000);
}

function detenerSondeo() {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}

onMounted(() => consultar(false));
onBeforeUnmount(detenerSondeo);

function claseResultado(e: EstadoActualizador['ultimoResultado']) {
  return e?.estado === 'ok' ? 'ok' : e?.estado === 'error' ? 'mal' : 'curso';
}
</script>

<template>
  <section>
    <h1>Actualizaciones</h1>
    <p class="ayuda">
      Las versiones nuevas se publican en GitHub. Al actualizar se respalda la versión actual; si la nueva no arranca,
      se restaura sola. Nunca se tocan la configuración (.env) ni los registros.
    </p>

    <div class="card panel">
      <div class="fila-versiones">
        <div class="version">
          <span class="etiqueta">Versión instalada</span>
          <span class="numero">{{ estado?.versionActual ?? '—' }}</span>
        </div>
        <div class="version">
          <span class="etiqueta">Última disponible</span>
          <span class="numero" :class="{ nueva: estado?.hayNueva }">{{ estado?.ultima?.version ?? '—' }}</span>
          <span v-if="estado?.ultima" class="sub">
            {{ formatoFecha(estado.ultima.fecha) }} · {{ formatoTamano(estado.ultima.tamano) }}
          </span>
        </div>
        <div class="acciones">
          <button class="secundario" :disabled="cargando" @click="consultar(true)">
            <span v-if="cargando" class="spinner" aria-hidden="true"></span>
            Buscar actualizaciones
          </button>
          <button v-if="estado?.hayNueva" :disabled="!puedeActualizar" @click="confirmando = true">
            Actualizar a {{ estado.ultima?.version }}
          </button>
        </div>
      </div>

      <p v-if="estado && !estado.configurado" class="aviso">
        No hay repositorio configurado. Agregue <code>UPDATE_REPO=usuario/repositorio</code> en <code>backend/.env</code> y reinicie el servicio.
      </p>
      <p v-else-if="estado && !estado.hayNueva && estado.ultima && !estado.error" class="aviso ok-texto">Está al día.</p>
      <p v-else-if="estado?.configurado && !estado.ultima && !estado.error" class="aviso">El repositorio {{ estado.repo }} todavía no tiene versiones publicadas.</p>
      <p v-if="motivoSinBoton" class="aviso">{{ motivoSinBoton }}</p>
      <p v-if="estado?.error" class="error">{{ estado.error }}</p>
      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="fase !== 'nada'" class="progreso" :class="fase">
        <span v-if="fase === 'descargando' || fase === 'reiniciando'" class="spinner" aria-hidden="true"></span>
        {{ mensajeFase }}
      </div>
    </div>

    <div v-if="estado?.ultima" class="card panel">
      <h2>
        Novedades de {{ estado.ultima.nombre }}
        <a :href="estado.ultima.url" target="_blank" rel="noopener">ver en GitHub</a>
      </h2>
      <pre class="notas">{{ estado.ultima.notas || 'Sin notas.' }}</pre>
    </div>

    <div v-if="estado?.ultimoResultado" class="card panel">
      <h2>Última actualización</h2>
      <p class="resultado" :class="claseResultado(estado.ultimoResultado)">
        <strong>{{ estado.ultimoResultado.estado === 'ok' ? 'Correcta' : estado.ultimoResultado.estado === 'error' ? 'Fallida' : 'En curso' }}</strong>
        · {{ estado.ultimoResultado.desde }} → {{ estado.ultimoResultado.hasta }} · {{ formatoFecha(estado.ultimoResultado.fecha) }}
      </p>
      <p class="mensaje">{{ estado.ultimoResultado.mensaje }}</p>
    </div>

    <div v-if="confirmando" class="fondo" @click.self="confirmando = false">
      <div class="card dialogo" role="dialog" aria-modal="true">
        <h2>¿Actualizar a la versión {{ estado?.ultima?.version }}?</h2>
        <p>
          El aplicativo se detendrá por uno o dos minutos para todos los usuarios. Conviene hacerlo cuando nadie esté
          contabilizando.
        </p>
        <div class="botones">
          <button class="secundario" @click="confirmando = false">Cancelar</button>
          <button @click="actualizar">Actualizar ahora</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ayuda {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0 0 var(--space-4);
  max-width: 60rem;
}
.panel {
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-4);
  max-width: 60rem;
}
.panel h2 {
  font-size: 1rem;
  margin: 0 0 var(--space-3);
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
}
.panel h2 a {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-brand-darker);
}
.fila-versiones {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-6);
}
.version {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.etiqueta {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.numero {
  font-size: 1.6rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.numero.nueva {
  color: var(--color-brand-darker);
}
.sub {
  font-size: 0.78rem;
  color: var(--text-faint);
}
.acciones {
  margin-left: auto;
  display: flex;
  gap: var(--space-3);
}
.acciones button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.aviso {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: var(--space-3) 0 0;
}
.ok-texto {
  color: var(--color-success);
  font-weight: 600;
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin: var(--space-3) 0 0;
}
.progreso {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  font-size: 0.88rem;
}
.progreso.listo {
  background: var(--color-success-bg);
  color: var(--color-success);
}
.progreso.fallo {
  background: var(--color-error-bg);
  color: var(--color-error);
}
.notas {
  margin: 0;
  white-space: pre-wrap;
  font: inherit;
  font-size: 0.88rem;
  color: var(--text);
  max-height: 22rem;
  overflow: auto;
}
.resultado {
  margin: 0;
  font-size: 0.9rem;
}
.resultado.ok strong {
  color: var(--color-success);
}
.resultado.mal strong {
  color: var(--color-error);
}
.mensaje {
  margin: var(--space-2) 0 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: girar 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes girar {
  to {
    transform: rotate(360deg);
  }
}
.fondo {
  position: fixed;
  inset: 0;
  background: rgba(32, 32, 32, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.dialogo {
  width: min(28rem, calc(100vw - 2rem));
  padding: var(--space-5);
}
.dialogo h2 {
  font-size: 1.05rem;
  margin: 0 0 var(--space-3);
}
.dialogo p {
  font-size: 0.88rem;
  color: var(--text-muted);
  margin: 0 0 var(--space-4);
}
.botones {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
