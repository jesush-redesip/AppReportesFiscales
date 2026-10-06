<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

/**
 * Leyenda de derechos reservados (pie del aplicativo y pantalla de inicio de sesión).
 * La versión sale de /health, que es público: así se ve también antes de iniciar sesión.
 */
const TITULAR = 'Redes IP, C.A.';
const ANIO_INICIO = 2026;

defineProps<{ variante?: 'barra' | 'login' }>();

const anioActual = new Date().getFullYear();
const anios = computed(() => (anioActual > ANIO_INICIO ? `${ANIO_INICIO}–${anioActual}` : String(ANIO_INICIO)));
const version = ref('');

onMounted(async () => {
  try {
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || window.location.origin;
    const r = await fetch(new URL('/health', base), { cache: 'no-store' });
    const h = (await r.json()) as { version?: string };
    if (h.version) version.value = h.version;
  } catch {
    /* sin versión: solo la leyenda */
  }
});
</script>

<template>
  <footer class="derechos" :class="variante ?? 'barra'">
    <span>Reportes Fiscales<template v-if="version"> v{{ version }}</template></span>
    <span class="separador" aria-hidden="true">·</span>
    <span>© {{ anios }} {{ TITULAR }} Todos los derechos reservados.</span>
  </footer>
</template>

<style scoped>
.derechos {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.15rem 0.45rem;
  font-size: 0.72rem;
  color: var(--text-faint);
  text-align: center;
}
.derechos.barra {
  flex-shrink: 0;
  padding: 0.45rem var(--space-6);
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.derechos.login {
  margin-top: var(--space-5);
}
</style>
