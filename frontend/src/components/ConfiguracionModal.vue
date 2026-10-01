<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';
import type { ModuloCatalogo, UsuarioPermisos } from '../lib/types';
import { PERMISO_CONFIG_CAJAS } from '../lib/reportes';
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
const codUsuarioSeleccionado = ref<number | null>(null);

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
}

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
  const total = modulosCatalogo.value.length + 1; // +1 por el cierre de caja
  const reportes = u.modulos.filter((m) => modulosCatalogo.value.some((c) => c.id === m)).length;
  const activos = reportes + (u.visualizarCajas ? 1 : 0);
  return `${activos}/${total}`;
}

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
      api.get<ModuloCatalogo[]>('/api/config/modulos'),
    ]);
    usuarios.value = lista;
    modulosCatalogo.value = catalogo;
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
    if (item.codUsuario === auth.codUsuario) {
      auth.actualizarPermisosPropios(
        {
          visualizarCajas: item.visualizarCajas,
          contabilizar: item.contabilizar,
          descontabilizar: item.descontabilizar,
        },
        item.modulos,
      );
    }
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
    if (auth.esSupervisor) cargarPermisos();
  },
);
</script>

<template>
  <BaseModal :open="open" title="Permisos de Usuario" ancho="760px" @close="emit('close')">
    <section v-if="auth.esSupervisor">
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
                <span class="badge" :class="{ cero: resumenAcceso(u).startsWith('0/') }">{{ resumenAcceso(u) }}</span>
              </button>
            </li>
            <li v-if="usuariosFiltrados.length === 0" class="vacio">Ningún usuario coincide.</li>
          </ul>

          <div class="detalle-usuario">
            <p v-if="!usuarioSeleccionado" class="estado">Elegí un usuario de la lista para ver y editar su acceso.</p>
            <template v-else>
              <h3>{{ usuarioSeleccionado.usuario }}</h3>

              <div class="bloque">
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
                <label v-for="m in g.modulos" :key="m.id" class="check">
                  <input
                    type="checkbox"
                    :checked="tieneModulo(usuarioSeleccionado, m.id)"
                    @change="alternarModulo(usuarioSeleccionado, m.id)"
                  />
                  {{ m.nombre }}
                </label>
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
  </BaseModal>
</template>

<style scoped>
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
