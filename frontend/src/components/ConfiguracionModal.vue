<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';
import type { ModuloCatalogo, UsuarioPermisos } from '../lib/types';
import { PERMISO_CONFIG_CAJAS, PERMISO_PAGARES_GESTION, PERMISO_SUPERVISOR_INTERNO } from '../lib/reportes';
import BaseModal from './BaseModal.vue';
import AppIcon from './icons/AppIcon.vue';

const auth = useAuthStore();

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const usuarios = ref<UsuarioPermisos[]>([]);
const permisosLoading = ref(false);
const permisosGuardando = ref(false);
const permisosError = ref('');
const permisosGuardado = ref(false);
const filtroUsuario = ref('');
const modulosCatalogo = ref<ModuloCatalogo[]>([]);
/** Si la instalación tiene el Cierre de Caja (Módulos de la instalación). */
const cajasActivo = ref(true);
const codUsuarioSeleccionado = ref<number | null>(null);

/** Pestañas: la de módulos de la instalación es solo del SUPERVISOR. */
const pestana = ref<'permisos' | 'modulos'>('permisos');

/** Filtra por nombre o por código. */
const usuariosFiltrados = computed(() => {
  const q = filtroUsuario.value.trim().toLowerCase();
  if (!q) return usuarios.value;
  return usuarios.value.filter(
    (u) => u.usuario.toLowerCase().includes(q) || String(u.codUsuario).includes(q),
  );
});

const usuarioSeleccionado = computed(
  () => usuarios.value.find((u) => u.codUsuario === codUsuarioSeleccionado.value) ?? null,
);

/** Módulos agrupados como se ven en el menú, para que la pantalla de permisos y el
 * menú real se lean igual. */
const modulosPorGrupo = computed(() => {
  const grupos = new Map<string, ModuloCatalogo[]>();
  for (const m of modulosCatalogo.value) {
    grupos.set(m.grupo, [...(grupos.get(m.grupo) ?? []), m]);
  }
  return [...grupos.entries()].map(([grupo, modulos]) => ({ grupo, modulos }));
});

function tieneModulo(u: UsuarioPermisos, id: string) {
  return u.modulos.includes(id);
}

function alternarModulo(u: UsuarioPermisos, id: string) {
  u.modulos = tieneModulo(u, id) ? u.modulos.filter((m) => m !== id) : [...u.modulos, id];
  // Sin ver pagarés no se pueden gestionar.
  if (id === 'pagares' && !tieneModulo(u, id)) u.modulos = u.modulos.filter((m) => m !== PERMISO_PAGARES_GESTION);
}

/** Sub-permisos que se muestran debajo de su módulo. */
const SUBPERMISOS: Record<string, { id: string; nombre: string }> = {
  pagares: { id: PERMISO_PAGARES_GESTION, nombre: 'Registrar, pagar, editar y anular' },
};

function alternarGrupo(u: UsuarioPermisos, modulos: ModuloCatalogo[], activar: boolean) {
  const ids = modulos.map((m) => m.id);
  u.modulos = activar
    ? [...new Set([...u.modulos, ...ids])]
    : u.modulos.filter((m) => !ids.includes(m));
}

function grupoCompleto(u: UsuarioPermisos, modulos: ModuloCatalogo[]) {
  return modulos.every((m) => tieneModulo(u, m.id));
}

/** Resumen para la lista: cuántos módulos tiene habilitados de los disponibles. Se
 * cuentan solo los reportes del catálogo más el cierre; la Configuración del cierre es
 * un sub-permiso (como Contabilizar) y no suma. */
function resumenAcceso(u: UsuarioPermisos) {
  const conCierre = cajasActivo.value ? 1 : 0;
  const total = modulosCatalogo.value.length + conCierre;
  const reportes = u.modulos.filter((m) => modulosCatalogo.value.some((c) => c.id === m)).length;
  const activos = reportes + (conCierre && u.visualizarCajas ? 1 : 0);
  return `${activos}/${total}`;
}

const esInterno = (u: UsuarioPermisos) => u.codUsuario !== 0 && u.modulos.includes(PERMISO_SUPERVISOR_INTERNO);

/** Solo el SUPERVISOR nombra supervisores internos (y nunca a sí mismo). */
const supervisorInterno = computed({
  get: () => (usuarioSeleccionado.value ? esInterno(usuarioSeleccionado.value) : false),
  set: (activar: boolean) => {
    const u = usuarioSeleccionado.value;
    if (!u || u.codUsuario === 0 || activar === esInterno(u)) return;
    alternarModulo(u, PERMISO_SUPERVISOR_INTERNO);
  },
});

/** "Configuración" del Cierre de Caja: se guarda como un módulo más (PERMISO_CONFIG_CAJAS). */
const puedeConfigurarCajas = computed({
  get: () => usuarioSeleccionado.value?.modulos.includes(PERMISO_CONFIG_CAJAS) ?? false,
  set: (activar: boolean) => {
    const u = usuarioSeleccionado.value;
    if (!u || activar === u.modulos.includes(PERMISO_CONFIG_CAJAS)) return;
    alternarModulo(u, PERMISO_CONFIG_CAJAS);
  },
});

async function cargarPermisos() {
  permisosLoading.value = true;
  permisosError.value = '';
  try {
    const [lista, catalogo] = await Promise.all([
      api.get<UsuarioPermisos[]>('/api/config/permisos'),
      api.get<{ modulos: ModuloCatalogo[]; cajasActivo: boolean }>('/api/config/modulos'),
    ]);
    usuarios.value = lista;
    modulosCatalogo.value = catalogo.modulos;
    cajasActivo.value = catalogo.cajasActivo;
  } catch (err) {
    permisosError.value = err instanceof Error ? err.message : 'Error al cargar los permisos.';
  } finally {
    permisosLoading.value = false;
  }
}

/**
 * Guarda solo el usuario que se está editando, no la lista completa: con 20+ usuarios,
 * mandar todos en cada guardado convierte cualquier error de concurrencia (dos
 * administradores a la vez) en una sobreescritura silenciosa de trabajo ajeno.
 */
async function guardarPermisos() {
  const u = usuarioSeleccionado.value;
  if (!u) return;
  permisosGuardando.value = true;
  permisosError.value = '';
  permisosGuardado.value = false;
  try {
    // Sin acceso al módulo de cajas, contabilizar/descontabilizar no tienen sentido:
    // se guardan en false en vez de dejar en la base un permiso que la UI muestra
    // deshabilitado pero seguiría activo si mañana se rehabilita "Cierre de Caja".
    const item = {
      codUsuario: u.codUsuario,
      visualizarCajas: u.visualizarCajas,
      contabilizar: u.visualizarCajas && u.contabilizar,
      descontabilizar: u.visualizarCajas && u.descontabilizar,
      modulos: u.visualizarCajas ? u.modulos : u.modulos.filter((m) => m !== PERMISO_CONFIG_CAJAS),
    };
    await api.put('/api/config/permisos', { items: [item] });
    permisosGuardado.value = true;
    // Si se editó a sí mismo, el menú debe reflejarlo ya, no en el próximo login.
    if (item.codUsuario === auth.codUsuario) await auth.refrescarAcceso();
  } catch (err) {
    permisosError.value = err instanceof Error ? err.message : 'Error al guardar los permisos.';
  } finally {
    permisosGuardando.value = false;
  }
}

// La configuración de cuentas se movió a Cierre de Caja › Configuración; este modal
// quedó solo con los permisos de usuario (SUPERVISOR).
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    permisosGuardado.value = false;
    pestana.value = 'permisos';
    if (auth.puedeAdministrarPermisos) cargarPermisos();
  },
);

// --- Módulos de la instalación (solo SUPERVISOR) ---
interface EstadoModulo {
  id: string;
  nombre: string;
  grupo: string;
  exclusivo: boolean;
  activo: boolean;
}
const estadoModulos = ref<EstadoModulo[]>([]);
/** Cambios sin guardar: id -> activo. */
const pendientes = ref<Record<string, boolean>>({});
const modulosCargando = ref(false);
const modulosGuardando = ref(false);
const modulosError = ref('');
const modulosGuardado = ref('');

const modulosInstalacionPorGrupo = computed(() => {
  const grupos = new Map<string, EstadoModulo[]>();
  for (const m of estadoModulos.value) grupos.set(m.grupo, [...(grupos.get(m.grupo) ?? []), m]);
  return [...grupos.entries()].map(([grupo, modulos]) => ({ grupo, modulos }));
});
const activoEnPantalla = (m: EstadoModulo) => pendientes.value[m.id] ?? m.activo;
const cantidadPendientes = computed(() => Object.keys(pendientes.value).length);

function alternarActivo(m: EstadoModulo) {
  const nuevo = !activoEnPantalla(m);
  const copia = { ...pendientes.value };
  if (nuevo === m.activo) delete copia[m.id];
  else copia[m.id] = nuevo;
  pendientes.value = copia;
}

async function cargarModulosInstalacion() {
  modulosCargando.value = true;
  modulosError.value = '';
  try {
    estadoModulos.value = await api.get<EstadoModulo[]>('/api/config/modulos-activos');
    pendientes.value = {};
  } catch (err) {
    modulosError.value = err instanceof Error ? err.message : 'Error al cargar los módulos.';
  } finally {
    modulosCargando.value = false;
  }
}

async function guardarModulosInstalacion() {
  modulosGuardando.value = true;
  modulosError.value = '';
  modulosGuardado.value = '';
  try {
    const items = Object.entries(pendientes.value).map(([id, activo]) => ({ id, activo }));
    const r = await api.put<{ ok: boolean; cambios: unknown[] }>('/api/config/modulos-activos', { items });
    modulosGuardado.value = `Guardado (${r.cambios.length} cambio${r.cambios.length === 1 ? '' : 's'}).`;
    await Promise.all([cargarModulosInstalacion(), cargarPermisos(), auth.refrescarAcceso()]);
  } catch (err) {
    modulosError.value = err instanceof Error ? err.message : 'Error al guardar los módulos.';
  } finally {
    modulosGuardando.value = false;
  }
}

watch(pestana, (p) => {
  modulosGuardado.value = '';
  if (p === 'modulos' && auth.esSupervisor) cargarModulosInstalacion();
});
</script>

<template>
  <BaseModal :open="open" title="Permisos de Usuario" ancho="760px" @close="emit('close')">
    <div v-if="auth.esSupervisor" class="pestanas" role="tablist">
      <button type="button" role="tab" :aria-selected="pestana === 'permisos'" :class="{ activa: pestana === 'permisos' }" @click="pestana = 'permisos'">
        Permisos de usuario
      </button>
      <button type="button" role="tab" :aria-selected="pestana === 'modulos'" :class="{ activa: pestana === 'modulos' }" @click="pestana = 'modulos'">
        Módulos de la instalación
      </button>
    </div>

    <section v-if="auth.puedeAdministrarPermisos && pestana === 'permisos'">
      <p v-if="auth.esSupervisorInterno" class="nota">
        Como supervisor interno puede asignar módulos y permisos a los usuarios de su grupo.
      </p>
      <p v-if="permisosLoading" class="estado">Cargando...</p>
      <template v-else>
        <div class="filtro-usuarios">
          <input v-model="filtroUsuario" type="text" placeholder="Buscar usuario por nombre o código..." />
          <span class="contador">{{ usuariosFiltrados.length }} de {{ usuarios.length }}</span>
        </div>

        <div class="permisos-layout">
          <ul class="lista-usuarios">
            <li v-for="u in usuariosFiltrados" :key="u.codUsuario">
              <button
                type="button"
                class="item-usuario"
                :class="{ activo: u.codUsuario === codUsuarioSeleccionado }"
                @click="codUsuarioSeleccionado = u.codUsuario"
              >
                <span class="nombre">{{ u.usuario }}</span>
                <span v-if="esInterno(u)" class="badge interno" title="Supervisor interno">Sup.</span>
                <span class="badge" :class="{ cero: resumenAcceso(u).startsWith('0/') }">{{ resumenAcceso(u) }}</span>
              </button>
            </li>
            <li v-if="usuariosFiltrados.length === 0" class="vacio">Ningún usuario coincide.</li>
          </ul>

          <div class="detalle-usuario">
            <p v-if="!usuarioSeleccionado" class="estado">Elegí un usuario de la lista para ver y editar su acceso.</p>
            <template v-else>
              <h3>{{ usuarioSeleccionado.usuario }}</h3>

              <div v-if="auth.esSupervisor && usuarioSeleccionado.codUsuario !== 0" class="bloque">
                <div class="bloque-titulo">Administración</div>
                <label class="check"><input v-model="supervisorInterno" type="checkbox" /> Supervisor interno</label>
                <p class="ayuda-check">Puede asignar permisos a los usuarios de su grupo y configurar el cierre de caja.</p>
              </div>
              <p v-else-if="esInterno(usuarioSeleccionado)" class="nota">Supervisor interno (lo asigna el SUPERVISOR).</p>

              <div v-if="cajasActivo" class="bloque">
                <div class="bloque-titulo">Cierre de Caja</div>
                <label class="check"
                  ><input type="checkbox" v-model="usuarioSeleccionado.visualizarCajas" /> Acceso al módulo</label
                >
                <label class="check sangria"
                  ><input
                    type="checkbox"
                    v-model="usuarioSeleccionado.contabilizar"
                    :disabled="!usuarioSeleccionado.visualizarCajas"
                  />
                  Contabilizar</label
                >
                <label class="check sangria"
                  ><input
                    type="checkbox"
                    v-model="usuarioSeleccionado.descontabilizar"
                    :disabled="!usuarioSeleccionado.visualizarCajas"
                  />
                  Descontabilizar</label
                >
                <label class="check sangria"
                  ><input
                    v-model="puedeConfigurarCajas"
                    type="checkbox"
                    :disabled="!usuarioSeleccionado.visualizarCajas"
                  />
                  Configuración (cuentas y costo de venta)</label
                >
              </div>

              <div v-for="g in modulosPorGrupo" :key="g.grupo" class="bloque">
                <div class="bloque-titulo">
                  {{ g.grupo }}
                  <button
                    type="button"
                    class="enlace"
                    @click="alternarGrupo(usuarioSeleccionado, g.modulos, !grupoCompleto(usuarioSeleccionado, g.modulos))"
                  >
                    {{ grupoCompleto(usuarioSeleccionado, g.modulos) ? 'quitar todos' : 'todos' }}
                  </button>
                </div>
                <template v-for="m in g.modulos" :key="m.id">
                  <label class="check">
                    <input
                      type="checkbox"
                      :checked="tieneModulo(usuarioSeleccionado, m.id)"
                      @change="alternarModulo(usuarioSeleccionado, m.id)"
                    />
                    {{ m.nombre }}
                  </label>
                  <label v-if="SUBPERMISOS[m.id]" class="check sangria">
                    <input
                      type="checkbox"
                      :checked="tieneModulo(usuarioSeleccionado, SUBPERMISOS[m.id].id)"
                      :disabled="!tieneModulo(usuarioSeleccionado, m.id)"
                      @change="alternarModulo(usuarioSeleccionado, SUBPERMISOS[m.id].id)"
                    />
                    {{ SUBPERMISOS[m.id].nombre }}
                  </label>
                </template>
              </div>
            </template>
          </div>
        </div>

        <p v-if="permisosError" class="error">{{ permisosError }}</p>
        <p v-if="permisosGuardado && !permisosError" class="exito"><AppIcon name="check" :size="14" /> Guardado.</p>
        <button type="button" :disabled="permisosGuardando || !usuarioSeleccionado" @click="guardarPermisos">
          {{ permisosGuardando ? 'Guardando...' : 'Guardar permisos' }}
        </button>
      </template>
    </section>

    <section v-if="auth.esSupervisor && pestana === 'modulos'">
      <p class="nota">
        Qué módulos tiene este grupo económico. Un módulo desactivado desaparece del menú de todos y no se puede asignar;
        al reactivarlo, cada usuario recupera lo que tenía.
      </p>
      <p v-if="modulosCargando" class="estado">Cargando...</p>
      <template v-else>
        <div class="modulos-instalacion">
          <div v-for="g in modulosInstalacionPorGrupo" :key="g.grupo" class="bloque">
            <div class="bloque-titulo">{{ g.grupo }}</div>
            <label v-for="m in g.modulos" :key="m.id" class="check" :class="{ cambiado: m.id in pendientes }">
              <input type="checkbox" :checked="activoEnPantalla(m)" @change="alternarActivo(m)" />
              {{ m.nombre }}
              <span v-if="m.exclusivo" class="badge interno" title="Módulo exclusivo: llega desactivado">Exclusivo</span>
              <span v-if="!activoEnPantalla(m)" class="inactivo">desactivado</span>
            </label>
          </div>
        </div>
        <p v-if="modulosError" class="error">{{ modulosError }}</p>
        <p v-if="modulosGuardado && !modulosError" class="exito"><AppIcon name="check" :size="14" /> {{ modulosGuardado }}</p>
        <div class="acciones-modulos">
          <button type="button" class="secundario" :disabled="!cantidadPendientes || modulosGuardando" @click="pendientes = {}">
            Descartar
          </button>
          <button type="button" :disabled="!cantidadPendientes || modulosGuardando" @click="guardarModulosInstalacion">
            {{ modulosGuardando ? 'Guardando...' : cantidadPendientes ? `Guardar ${cantidadPendientes} cambio${cantidadPendientes === 1 ? '' : 's'}` : 'Guardar' }}
          </button>
        </div>
      </template>
    </section>
  </BaseModal>
</template>

<style scoped>
.pestanas {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--space-4);
}
.pestanas button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.85rem;
  padding: 0.45rem 0.8rem;
  height: auto;
  margin-bottom: -1px;
}
.pestanas button:hover:not(:disabled) {
  background: none;
  color: var(--text);
}
.pestanas button.activa {
  color: var(--color-brand-darker);
  border-bottom-color: var(--color-brand);
}
.nota {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0 0 var(--space-3);
}
.ayuda-check {
  font-size: 0.75rem;
  color: var(--text-faint);
  margin: 0.1rem 0 0 1.3rem;
}
.badge.interno {
  color: var(--color-brand-darker);
  background: var(--color-brand-bg-strong);
}
.modulos-instalacion {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--space-2) var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
  max-height: 22rem;
  overflow-y: auto;
}
.check.cambiado {
  color: var(--color-brand-darker);
  font-weight: 600;
}
.inactivo {
  font-size: 0.7rem;
  color: var(--color-error);
}
.acciones-modulos {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
.estado {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: var(--space-3);
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin-bottom: var(--space-3);
}
.exito {
  color: var(--color-success);
  font-size: 0.85rem;
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.filtro-usuarios {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.filtro-usuarios input {
  flex: 1;
  height: 2rem;
  font-size: 0.85rem;
}
.contador {
  font-size: 0.75rem;
  color: var(--text-faint);
  white-space: nowrap;
}
/* Maestro-detalle: con 11 permisos por usuario una grilla usuario × permiso no cabe en
   un modal, así que se elige un usuario y se editan sus accesos al lado. */
.permisos-layout {
  display: grid;
  grid-template-columns: 15rem 1fr;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  align-items: start;
}
.lista-usuarios {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 19rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.item-usuario {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  color: var(--text);
  font-weight: 500;
  font-size: 0.82rem;
  padding: 0.4rem 0.6rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.item-usuario:hover:not(:disabled) {
  background: var(--bg-subtle);
}
.item-usuario.activo {
  background: var(--color-brand-bg-strong);
  color: var(--color-brand-darker);
  font-weight: 700;
}
.item-usuario .nombre {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-muted);
  background: var(--bg-subtle);
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
  flex-shrink: 0;
}
.badge.cero {
  color: var(--color-error);
  background: var(--color-error-bg);
}
.detalle-usuario {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-4);
  max-height: 19rem;
  overflow-y: auto;
}
.detalle-usuario h3 {
  margin: 0 0 var(--space-3);
  font-size: 0.95rem;
}
.bloque {
  margin-bottom: var(--space-4);
}
.bloque:last-child {
  margin-bottom: 0;
}
.bloque-titulo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  margin-bottom: 0.35rem;
}
.enlace {
  background: none;
  border: none;
  color: var(--color-brand-darker);
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
  padding: 0;
  height: auto;
  cursor: pointer;
}
.enlace:hover {
  background: none;
  text-decoration: underline;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  padding: 0.12rem 0;
  cursor: pointer;
}
.check.sangria {
  padding-left: 1.3rem;
}
.check input {
  margin: 0;
  cursor: pointer;
}
.check input:disabled {
  cursor: not-allowed;
}
.check input:disabled + * {
  opacity: 0.5;
}
.vacio {
  color: var(--text-faint);
  text-align: center;
  padding: var(--space-4);
  font-size: 0.82rem;
  list-style: none;
}
</style>
