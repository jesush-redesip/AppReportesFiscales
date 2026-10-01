<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { REPORT_GROUPS, moduloDeRuta } from '../lib/reportes';
import { useAuthStore } from '../stores/auth.store';
import { useDebugStore, type EventoApi, type EventoSql } from '../stores/debug.store';

const debug = useDebugStore();
const auth = useAuthStore();

const abierto = ref(false);
type Tab = 'sql' | 'api' | 'permisos';
const tab = ref<Tab>('sql');
const filtro = ref('');
const soloErrores = ref(false);
const expandidos = ref(new Set<number>());
const copiado = ref<number | null>(null);

onMounted(() => debug.comprobar());
onBeforeUnmount(() => debug.detener());

function coincide(texto: string) {
  const q = filtro.value.trim().toLowerCase();
  return !q || texto.toLowerCase().includes(q);
}

// Más recientes arriba: es lo que se busca mientras se usa un módulo.
const sqlVisibles = computed(() =>
  [...debug.sql]
    .reverse()
    .filter((e) => (!soloErrores.value || e.error) && coincide(`${e.bd} ${e.texto} ${e.error ?? ''}`)),
);
const apiVisibles = computed(() =>
  [...debug.apiEventos]
    .reverse()
    .filter((e) => (!soloErrores.value || e.error) && coincide(`${e.metodo} ${e.url} ${e.estado} ${e.error ?? ''}`)),
);

/** Consultas SQL que disparó una llamada a la API (mismo reqId). */
function sqlDePeticion(e: EventoApi): EventoSql[] {
  return debug.sql.filter((s) => s.reqId === e.reqId);
}

function alternar(id: number) {
  const s = new Set(expandidos.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  expandidos.value = s;
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('es-VE', { hour12: false });
}

function resumen(texto: string, max = 140) {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length > max ? `${plano.slice(0, max)}…` : plano;
}

function formatoValor(v: unknown) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'string') return `'${v}'`;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function formatoJson(texto: string | null) {
  if (!texto) return '';
  try {
    return JSON.stringify(JSON.parse(texto), null, 2);
  } catch {
    return texto;
  }
}

async function copiar(e: EventoSql) {
  try {
    await navigator.clipboard.writeText(e.script);
    copiado.value = e.id;
    setTimeout(() => (copiado.value = null), 1500);
  } catch {
    // Portapapeles bloqueado: el script sigue visible para copiarlo a mano.
  }
}

/** Mismas reglas que Sidebar (menú) y router.beforeEach (acceso por URL). */
const modulos = computed(() =>
  REPORT_GROUPS.flatMap((g) =>
    g.reportes.map((r) => {
      if (r.permisoModulo) {
        const cajas = !g.permiso || auth.permisos[g.permiso];
        const tienePermiso = auth.modulos.includes(r.permisoModulo);
        const acceso = Boolean(cajas && tienePermiso);
        return {
          grupo: g.label,
          nombre: r.nombre,
          enMenu: acceso,
          acceso,
          motivo: `permiso "${r.permisoModulo}" ${tienePermiso ? 'asignado' : 'no asignado'} en RIP_PERMISOSMODULOS${cajas ? '' : '; sin VISUALIZARCAJAS'}`,
        };
      }
      const id = moduloDeRuta(r.path);
      const esCajas = g.permiso === 'visualizarCajas';
      const tiene = esCajas ? auth.permisos.visualizarCajas : auth.modulos.includes(id);
      const acceso = tiene;
      const motivo = esCajas
        ? tiene
          ? 'VISUALIZARCAJAS = 1'
          : 'VISUALIZARCAJAS = 0 en RIP_PERMISOSUSUARIOS'
        : tiene
          ? `módulo "${id}" asignado`
          : `módulo "${id}" no asignado en RIP_PERMISOSMODULOS`;
      return { grupo: g.label, nombre: r.nombre, enMenu: tiene, acceso, motivo };
    }),
  ),
);
</script>

<template>
  <div v-if="debug.activo" class="debug">
    <button type="button" class="lanzador" :class="{ con_error: debug.errores > 0 }" @click="abierto = !abierto">
      DEBUG
      <span class="cuenta">{{ debug.sql.length }} SQL · {{ debug.apiEventos.length }} API</span>
      <span v-if="debug.errores" class="cuenta-error">{{ debug.errores }} err</span>
    </button>

    <section v-if="abierto" class="panel" aria-label="Panel de debug">
      <header class="barra">
        <div class="tabs">
          <button type="button" :class="{ activo: tab === 'sql' }" @click="tab = 'sql'">SQL ({{ debug.sql.length }})</button>
          <button type="button" :class="{ activo: tab === 'api' }" @click="tab = 'api'">
            API ({{ debug.apiEventos.length }})
          </button>
          <button type="button" :class="{ activo: tab === 'permisos' }" @click="tab = 'permisos'">
            Permisos y botones
          </button>
        </div>
        <div v-if="tab !== 'permisos'" class="controles">
          <input v-model="filtro" type="search" placeholder="Filtrar…" />
          <label><input v-model="soloErrores" type="checkbox" /> solo errores</label>
          <button type="button" @click="debug.pausado = !debug.pausado">{{ debug.pausado ? 'Reanudar' : 'Pausar' }}</button>
          <button type="button" @click="debug.limpiar()">Limpiar</button>
        </div>
        <button type="button" class="cerrar" aria-label="Cerrar panel" @click="abierto = false">×</button>
      </header>
      <p v-if="debug.errorConexion" class="aviso">Sin conexión con el backend: {{ debug.errorConexion }}</p>

      <div class="cuerpo">
        <!-- SQL -->
        <template v-if="tab === 'sql'">
          <p v-if="sqlVisibles.length === 0" class="vacio">Todavía no hay consultas. Usa cualquier módulo y aparecen aquí.</p>
          <article v-for="e in sqlVisibles" :key="e.id" class="evento" :class="{ error: e.error }">
            <button type="button" class="fila" @click="alternar(e.id)">
              <span class="hora">{{ hora(e.fecha) }}</span>
              <span class="etiqueta">{{ e.modo === 'execute' ? 'SP' : 'SQL' }}</span>
              <span class="bd">{{ e.bd }}</span>
              <span class="ms">{{ e.ms }} ms</span>
              <span class="filas">{{ e.error ? 'ERROR' : e.filas?.length ? `${e.filas.join('+')} filas` : `${e.filasAfectadas?.join('+') ?? 0} afect.` }}</span>
              <span class="texto">{{ resumen(e.texto) }}</span>
            </button>
            <div v-if="expandidos.has(e.id)" class="detalle">
              <p v-if="e.error" class="msg-error">{{ e.error }}</p>
              <table v-if="e.parametros.length" class="params">
                <tr v-for="p in e.parametros" :key="p.nombre">
                  <td>@{{ p.nombre }}</td>
                  <td class="tipo">{{ p.tipo }}</td>
                  <td>{{ formatoValor(p.valor) }}</td>
                </tr>
              </table>
              <div class="script-cabecera">
                <span>Script para SSMS</span>
                <button type="button" @click="copiar(e)">{{ copiado === e.id ? 'Copiado' : 'Copiar' }}</button>
              </div>
              <pre>{{ e.script }}</pre>
            </div>
          </article>
        </template>

        <!-- API -->
        <template v-else-if="tab === 'api'">
          <p v-if="apiVisibles.length === 0" class="vacio">Todavía no hay llamadas registradas.</p>
          <article v-for="e in apiVisibles" :key="e.id" class="evento" :class="{ error: e.error }">
            <button type="button" class="fila" @click="alternar(e.id)">
              <span class="hora">{{ hora(e.fecha) }}</span>
              <span class="etiqueta">{{ e.metodo }}</span>
              <span class="estado" :class="{ mal: e.estado >= 400 }">{{ e.estado }}</span>
              <span class="ms">{{ e.ms }} ms</span>
              <span class="filas">{{ sqlDePeticion(e).length }} SQL</span>
              <span class="texto">{{ e.url }}</span>
            </button>
            <div v-if="expandidos.has(e.id)" class="detalle">
              <p v-if="e.error" class="msg-error">{{ e.error }}</p>
              <p class="meta">Usuario: {{ e.usuario ?? '—' }} · Base: {{ e.bd ?? '—' }}</p>
              <template v-if="e.cuerpo">
                <div class="script-cabecera"><span>Datos enviados</span></div>
                <pre>{{ JSON.stringify(e.cuerpo, null, 2) }}</pre>
              </template>
              <div class="script-cabecera"><span>Respuesta</span></div>
              <pre>{{ formatoJson(e.respuesta) || '(vacía)' }}</pre>
              <template v-if="sqlDePeticion(e).length">
                <div class="script-cabecera"><span>Consultas de esta llamada</span></div>
                <ul class="sql-relacionado">
                  <li v-for="s in sqlDePeticion(e)" :key="s.id" :class="{ error: s.error }">
                    {{ s.bd }} · {{ s.ms }} ms · {{ s.error ?? resumen(s.texto, 90) }}
                  </li>
                </ul>
              </template>
            </div>
          </article>
        </template>

        <!-- PERMISOS -->
        <template v-else>
          <div class="sesion">
            <span><b>Usuario:</b> {{ auth.usuario }} (CODUSUARIO {{ auth.codUsuario }})</span>
            <span><b>Supervisor:</b> {{ auth.esSupervisor ? 'sí' : 'no' }}</span>
            <span><b>Empresa:</b> {{ auth.empresa?.titulo }} — base {{ auth.empresa?.bd }}</span>
          </div>
          <div class="sesion">
            <span :class="auth.permisos.visualizarCajas ? 'ok' : 'no'">Ver cajas: {{ auth.permisos.visualizarCajas ? 'sí' : 'no' }}</span>
            <span :class="auth.permisos.contabilizar ? 'ok' : 'no'">Contabilizar: {{ auth.permisos.contabilizar ? 'sí' : 'no' }}</span>
            <span :class="auth.permisos.descontabilizar ? 'ok' : 'no'">
              Descontabilizar: {{ auth.permisos.descontabilizar ? 'sí' : 'no' }}
            </span>
          </div>
          <p class="nota">
            Permisos de la sesión, cargados al iniciar sesión. Si cambias RIP_PERMISOSUSUARIOS directo en SQL, cierra sesión
            y vuelve a entrar para verlos.
          </p>

          <template v-if="debug.diagnostico.grupos.length">
            <h3>{{ debug.diagnostico.pantalla }}</h3>
            <div v-for="g in debug.diagnostico.grupos" :key="g.titulo" class="diag-grupo">
              <div class="diag-titulo">{{ g.titulo }}</div>
              <ul>
                <li v-for="a in g.acciones" :key="a.accion" :class="a.disponible ? 'ok' : 'no'">
                  {{ a.disponible ? '✓' : '✗' }} <b>{{ a.accion }}</b> — {{ a.motivo }}
                </li>
              </ul>
            </div>
          </template>

          <h3>Módulos</h3>
          <table class="modulos">
            <thead>
              <tr><th>Módulo</th><th>En el menú</th><th>Acceso</th><th>Motivo</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in modulos" :key="m.nombre">
                <td>{{ m.grupo }} › {{ m.nombre }}</td>
                <td :class="m.enMenu ? 'ok' : 'no'">{{ m.enMenu ? 'sí' : 'no' }}</td>
                <td :class="m.acceso ? 'ok' : 'no'">{{ m.acceso ? 'sí' : 'no' }}</td>
                <td>{{ m.motivo }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.debug {
  --debug-bg: #111827;
  --debug-fg: #e5e7eb;
  --debug-muted: #9ca3af;
  --debug-line: #374151;
  --debug-error: #f87171;
  --debug-ok: #4ade80;
  font-size: 0.78rem;
}
.lanzador {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 1000;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  height: 2rem;
  padding: 0 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--debug-line);
  background: var(--debug-bg);
  color: var(--debug-fg);
  font-weight: 800;
  letter-spacing: 0.05em;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
}
.lanzador.con_error {
  border-color: var(--debug-error);
}
.cuenta {
  font-weight: 500;
  color: var(--debug-muted);
  letter-spacing: 0;
}
.cuenta-error {
  background: var(--debug-error);
  color: #111;
  border-radius: 999px;
  padding: 0 0.4rem;
  letter-spacing: 0;
}
.panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 45vh;
  z-index: 999;
  display: flex;
  flex-direction: column;
  background: var(--debug-bg);
  color: var(--debug-fg);
  border-top: 2px solid var(--color-brand, #84b82b);
  /* Referencia para el botón cerrar (absoluto) y para que nada desborde en ancho. */
  overflow-x: hidden;
}
.panel > .barra {
  position: relative;
}
.barra {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--debug-line);
  flex-wrap: wrap;
}
.barra button,
.detalle button {
  height: 1.7rem;
  padding: 0 0.6rem;
  font-size: 0.75rem;
  background: transparent;
  color: var(--debug-fg);
  border: 1px solid var(--debug-line);
  border-radius: 4px;
}
.tabs {
  display: flex;
  gap: 0.35rem;
}
.tabs button.activo {
  background: var(--debug-fg);
  color: var(--debug-bg);
}
.controles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  min-width: 0;
}
.controles input[type='search'] {
  height: 1.7rem;
  width: 14rem;
  max-width: 40vw;
  font-size: 0.75rem;
  background: #1f2937;
  color: var(--debug-fg);
  border: 1px solid var(--debug-line);
}
.controles label {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  color: var(--debug-muted);
}
.cerrar {
  position: absolute;
  top: 0.4rem;
  right: 0.75rem;
  font-size: 1rem !important;
}
.barra {
  padding-right: 3rem;
}
.aviso {
  margin: 0;
  padding: 0.3rem 0.75rem;
  background: #7f1d1d;
}
.cuerpo {
  flex: 1;
  overflow-y: auto;
  padding: 0.25rem 0;
}
.vacio,
.nota {
  color: var(--debug-muted);
  padding: 0.5rem 0.75rem;
  margin: 0;
}
.evento {
  border-bottom: 1px solid var(--debug-line);
}
.evento.error {
  background: rgb(248 113 113 / 0.08);
}
.fila {
  width: 100%;
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  justify-content: flex-start;
  padding: 0.3rem 0.75rem;
  background: transparent;
  border: none;
  border-radius: 0;
  color: inherit;
  font: inherit;
  font-weight: 400;
  height: auto;
  text-align: left;
  cursor: pointer;
}
.fila:hover {
  background: rgb(255 255 255 / 0.05);
}
.hora,
.ms,
.filas {
  color: var(--debug-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.etiqueta {
  font-weight: 800;
  min-width: 3rem;
}
.bd {
  color: #93c5fd;
  white-space: nowrap;
}
.estado {
  color: var(--debug-ok);
  font-weight: 700;
}
.estado.mal,
.evento.error .filas {
  color: var(--debug-error);
  font-weight: 700;
}
.texto {
  font-family: ui-monospace, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.detalle {
  padding: 0.25rem 0.75rem 0.75rem 2rem;
}
.msg-error {
  color: var(--debug-error);
  font-weight: 700;
  margin: 0.25rem 0;
}
.meta {
  color: var(--debug-muted);
  margin: 0.25rem 0;
}
.params {
  border-collapse: collapse;
  margin: 0.25rem 0;
  font-family: ui-monospace, Consolas, monospace;
}
.params td {
  padding: 0.1rem 0.75rem 0.1rem 0;
}
.params .tipo {
  color: var(--debug-muted);
}
.script-cabecera {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.5rem;
  color: var(--debug-muted);
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.68rem;
  letter-spacing: 0.05em;
}
pre {
  margin: 0.25rem 0 0;
  padding: 0.5rem;
  background: #0b1220;
  border: 1px solid var(--debug-line);
  border-radius: 4px;
  font-family: ui-monospace, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 16rem;
  overflow: auto;
}
.sql-relacionado {
  margin: 0.25rem 0 0;
  padding-left: 1rem;
  font-family: ui-monospace, Consolas, monospace;
}
.sql-relacionado .error {
  color: var(--debug-error);
}
.sesion {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  padding: 0.4rem 0.75rem 0;
}
h3 {
  margin: 0.75rem 0.75rem 0.35rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--debug-muted);
}
.diag-grupo {
  padding: 0 0.75rem 0.5rem;
}
.diag-titulo {
  font-weight: 700;
}
.diag-grupo ul {
  margin: 0.2rem 0 0;
  padding-left: 1rem;
  list-style: none;
}
.ok {
  color: var(--debug-ok);
}
.no {
  color: var(--debug-error);
}
.modulos {
  margin: 0 0.75rem 0.75rem;
  border-collapse: collapse;
}
.modulos th,
.modulos td {
  text-align: left;
  padding: 0.2rem 1rem 0.2rem 0;
  border-bottom: 1px solid var(--debug-line);
}
.modulos th {
  color: var(--debug-muted);
  font-weight: 700;
}
</style>
