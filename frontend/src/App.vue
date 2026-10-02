<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth.store';
import Sidebar from './components/layout/Sidebar.vue';
import Breadcrumb from './components/layout/Breadcrumb.vue';
import AppIcon from './components/icons/AppIcon.vue';
import ConfiguracionModal from './components/ConfiguracionModal.vue';
import DebugPanel from './components/DebugPanel.vue';
import { useDebugStore } from './stores/debug.store';
import { useActualizacionesStore } from './stores/actualizaciones.store';

const auth = useAuthStore();
const debug = useDebugStore();
const router = useRouter();
const configuracionAbierta = ref(false);

// Menú lateral que se muestra u oculta (botón del header o Ctrl+B). La preferencia se
// recuerda en este navegador; si el almacenamiento no está disponible, arranca visible.
const CLAVE_MENU = 'menu_lateral_visible';
function leerMenuVisible(): boolean {
  try {
    return localStorage.getItem(CLAVE_MENU) !== '0';
  } catch {
    return true;
  }
}
const menuVisible = ref(leerMenuVisible());
function alternarMenu() {
  menuVisible.value = !menuVisible.value;
  try {
    localStorage.setItem(CLAVE_MENU, menuVisible.value ? '1' : '0');
  } catch {
    /* sin almacenamiento: solo dura esta sesión */
  }
}
function atajoMenu(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    alternarMenu();
  }
}
onMounted(() => {
  window.addEventListener('keydown', atajoMenu);
  // La sesión guardada puede ser de antes de un cambio de permisos o de módulos activos.
  void auth.refrescarAcceso();
});
onBeforeUnmount(() => window.removeEventListener('keydown', atajoMenu));
const errorDebug = ref('');
const actualizaciones = useActualizacionesStore();

// Al entrar el SUPERVISOR se revisa si hay versión nueva (el backend cachea 10 min la consulta a GitHub).
watch(
  () => auth.esSupervisor,
  (es) => {
    if (es) void actualizaciones.revisarEnSegundoPlano();
  },
  { immediate: true },
);

async function alternarDebug() {
  errorDebug.value = '';
  try {
    await debug.cambiar(!debug.activo);
  } catch (err) {
    errorDebug.value = err instanceof Error ? err.message : 'No se pudo cambiar el modo debug.';
  }
}

const iniciales = computed(() => {
  const nombre = auth.usuario ?? '';
  return nombre.slice(0, 2).toUpperCase();
});

function onLogout() {
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <div v-if="auth.isAuthenticated" class="app-shell">
    <Sidebar :class="{ oculto: !menuVisible }" :inert="!menuVisible || undefined" :aria-hidden="!menuVisible || undefined" />
    <div class="app-main">
      <header class="app-header">
        <div class="app-header-izq">
          <button
            class="secundario boton-menu"
            :aria-expanded="menuVisible"
            :aria-label="menuVisible ? 'Ocultar menú lateral' : 'Mostrar menú lateral'"
            :title="(menuVisible ? 'Ocultar' : 'Mostrar') + ' menú lateral (Ctrl+B)'"
            @click="alternarMenu"
          >
            <AppIcon name="menu" :size="17" />
          </button>
          <Breadcrumb />
        </div>
        <div class="app-header-user">
          <span class="empresa" v-if="auth.empresa">
            <AppIcon name="building" :size="15" />
            {{ auth.empresa.titulo }}
          </span>
          <span class="avatar" aria-hidden="true">{{ iniciales }}</span>
          <span class="usuario">{{ auth.usuario }}</span>
          <!-- Permisos de usuario: administración reservada al SUPERVISOR, así que se
               esconde el punto de entrada en vez de abrir un modal vacío. El backend
               rechaza igual estas rutas para cualquier otro usuario. Las cuentas del
               cierre se configuran en Cierre de Caja › Configuración. -->
          <!-- Herramientas del SUPERVISOR: modo debug (en caliente, para todos los usuarios)
               y registro de auditoría. El backend rechaza ambas para cualquier otro usuario. -->
          <template v-if="auth.esSupervisor">
            <button
              class="secundario boton-debug"
              :class="{ encendido: debug.activo }"
              :disabled="debug.cambiando"
              :aria-pressed="debug.activo"
              :title="errorDebug || (debug.activo ? 'Modo debug encendido: clic para apagarlo' : 'Encender el modo debug')"
              @click="alternarDebug"
            >
              <span class="punto" aria-hidden="true"></span>
              Debug {{ debug.activo ? 'ON' : 'OFF' }}
            </button>
            <RouterLink to="/auditoria" class="boton-enlace" title="Registro de auditoría">
              <AppIcon name="lock" :size="15" />
              Auditoría
            </RouterLink>
            <RouterLink
              to="/actualizaciones"
              class="boton-enlace"
              :title="actualizaciones.estado?.hayNueva ? 'Hay una versión nueva: ' + actualizaciones.estado.ultima?.version : 'Actualizaciones del aplicativo'"
            >
              <AppIcon name="download" :size="15" />
              <span v-if="actualizaciones.estado?.hayNueva" class="insignia" aria-label="Versión nueva disponible"></span>
              {{ actualizaciones.estado ? 'v' + actualizaciones.estado.versionActual : 'Actualizaciones' }}
            </RouterLink>
          </template>
          <button
            v-if="auth.puedeAdministrarPermisos"
            class="secundario"
            aria-label="Permisos de Usuario"
            title="Permisos de Usuario"
            @click="configuracionAbierta = true"
          >
            <AppIcon name="settings" :size="15" />
          </button>
          <button class="secundario" @click="onLogout">
            <AppIcon name="logout" :size="15" />
            Cerrar sesión
          </button>
        </div>
      </header>
      <div class="app-content">
        <RouterView />
      </div>
    </div>
    <ConfiguracionModal :open="configuracionAbierta" @close="configuracionAbierta = false" />
    <!-- Solo SUPERVISOR; se muestra mientras el modo debug está encendido. -->
    <DebugPanel v-if="auth.esSupervisor" />
  </div>
  <div v-else class="login-shell">
    <RouterView />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
}
.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.app-header {
  height: var(--header-height);
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.app-header-izq {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.boton-menu {
  width: 2.1rem;
  height: 2.1rem;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.app-header-user {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font-size: 0.85rem;
}
.empresa {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-muted);
  font-weight: 600;
  padding: 0.3rem 0.65rem;
  background: var(--bg-subtle);
  border-radius: 999px;
  font-size: 0.8rem;
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--color-brand-bg-strong);
  color: var(--color-brand-darker);
  font-size: 0.72rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.boton-debug {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-variant-numeric: tabular-nums;
}
.boton-debug .punto {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
}
.boton-debug.encendido {
  border-color: var(--color-error);
  color: var(--color-error);
}
.boton-debug.encendido .punto {
  background: var(--color-error);
  box-shadow: 0 0 0 3px var(--color-error-bg);
}
.boton-enlace {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 2.1rem;
  padding: 0 0.85rem;
  font-size: 0.83rem;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg);
}
.insignia {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-brand);
  box-shadow: 0 0 0 3px var(--color-brand-bg-strong);
}
.boton-enlace:hover,
.boton-enlace.router-link-active {
  border-color: var(--color-brand);
  color: var(--color-brand-darker);
}
.app-header-user .usuario {
  color: var(--text);
  font-weight: 700;
}
.app-header-user button {
  height: 2.1rem;
  padding: 0 0.85rem;
  font-size: 0.83rem;
}
.app-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
}
.login-shell {
  min-height: 100vh;
  background: var(--bg-subtle);
}
</style>
