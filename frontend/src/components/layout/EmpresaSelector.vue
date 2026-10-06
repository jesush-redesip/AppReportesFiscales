<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { useAuthStore, type EmpresaGeneral, type PermisosCaja } from '../../stores/auth.store';
import AppIcon from '../icons/AppIcon.vue';

/**
 * Nombre de la empresa del encabezado: al hacer clic muestra las otras empresas del
 * usuario y permite pasar a una sin cerrar sesión. El backend emite una sesión nueva
 * (el token fija la base de datos) y la pantalla actual se vuelve a montar con la nueva.
 */
interface EmpresaOpcion {
  codEmpresa: number;
  titulo: string;
  actual: boolean;
}

interface SesionNueva {
  token: string;
  usuario: string;
  codUsuario: number;
  empresa: EmpresaGeneral;
  permisos: PermisosCaja;
  modulos: string[];
}

const auth = useAuthStore();
const abierto = ref(false);
const cargando = ref(false);
const cambiando = ref<number | null>(null);
const error = ref('');
const empresas = ref<EmpresaOpcion[]>([]);
const raiz = ref<HTMLElement | null>(null);

async function abrir() {
  if (abierto.value) {
    abierto.value = false;
    return;
  }
  abierto.value = true;
  error.value = '';
  cargando.value = true;
  try {
    empresas.value = await api.get<EmpresaOpcion[]>('/api/auth/empresas');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar las empresas.';
  } finally {
    cargando.value = false;
  }
}

async function cambiar(e: EmpresaOpcion) {
  if (e.actual || cambiando.value !== null) return;
  cambiando.value = e.codEmpresa;
  error.value = '';
  try {
    const s = await api.post<SesionNueva>('/api/auth/cambiar-empresa', { codEmpresa: e.codEmpresa });
    auth.setSession(s.token, s.usuario, s.codUsuario, s.empresa, s.permisos, s.modulos);
    abierto.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo cambiar de empresa.';
  } finally {
    cambiando.value = null;
  }
}

function cerrarSiAfuera(ev: MouseEvent) {
  if (abierto.value && raiz.value && !raiz.value.contains(ev.target as Node)) abierto.value = false;
}
function cerrarConEscape(ev: KeyboardEvent) {
  if (ev.key === 'Escape') abierto.value = false;
}
onMounted(() => {
  document.addEventListener('mousedown', cerrarSiAfuera);
  document.addEventListener('keydown', cerrarConEscape);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', cerrarSiAfuera);
  document.removeEventListener('keydown', cerrarConEscape);
});
</script>

<template>
  <div v-if="auth.empresa" ref="raiz" class="selector">
    <button
      type="button"
      class="empresa"
      :class="{ abierto }"
      :aria-expanded="abierto"
      aria-haspopup="listbox"
      title="Cambiar de empresa"
      @click="abrir"
    >
      <AppIcon name="building" :size="15" />
      {{ auth.empresa.titulo }}
      <span class="flecha" aria-hidden="true">▾</span>
    </button>

    <div v-if="abierto" class="menu" role="listbox" aria-label="Empresas">
      <p class="titulo">Cambiar de empresa</p>
      <p v-if="cargando" class="estado">Cargando…</p>
      <template v-else>
        <button
          v-for="e in empresas"
          :key="e.codEmpresa"
          type="button"
          role="option"
          class="opcion"
          :class="{ actual: e.actual }"
          :aria-selected="e.actual"
          :disabled="e.actual || cambiando !== null"
          @click="cambiar(e)"
        >
          <span class="nombre">{{ e.titulo }}</span>
          <AppIcon v-if="e.actual" name="check" :size="14" />
          <span v-else-if="cambiando === e.codEmpresa" class="spinner" aria-hidden="true"></span>
        </button>
        <p v-if="!error && empresas.length <= 1" class="estado">No tiene acceso a otras empresas.</p>
      </template>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.selector {
  position: relative;
}
.empresa {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-muted);
  font-weight: 600;
  padding: 0.3rem 0.65rem;
  background: var(--bg-subtle);
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 0.8rem;
  height: auto;
  cursor: pointer;
}
.empresa:hover:not(:disabled),
.empresa.abierto {
  background: var(--bg-subtle);
  border-color: var(--color-brand);
  color: var(--color-brand-darker);
}
.flecha {
  font-size: 0.7rem;
}
.menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 40;
  min-width: 15rem;
  max-height: 20rem;
  overflow-y: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: var(--space-2);
}
.titulo {
  margin: 0.15rem 0.5rem 0.4rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}
.opcion {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text);
  font-weight: 500;
  font-size: 0.85rem;
  padding: 0.45rem 0.6rem;
  height: auto;
  text-align: left;
}
.opcion:hover:not(:disabled) {
  background: var(--bg-subtle);
}
.opcion.actual {
  color: var(--color-brand-darker);
  font-weight: 700;
}
.opcion:disabled {
  cursor: default;
  opacity: 1;
}
.nombre {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.estado {
  margin: 0.3rem 0.5rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.error {
  margin: 0.3rem 0.5rem;
  font-size: 0.8rem;
  color: var(--color-error);
}
.spinner {
  width: 13px;
  height: 13px;
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
</style>
