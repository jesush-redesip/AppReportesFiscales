<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { findReporte } from '../../lib/reportes';
import AppIcon from '../icons/AppIcon.vue';

const route = useRoute();

const PANTALLAS_SIN_MENU: Record<string, string> = { '/auditoria': 'Auditoría', '/actualizaciones': 'Actualizaciones' };

const trail = computed(() => {
  if (route.path === '/') return [{ label: 'Inicio' }];
  // Pantallas de administración que no son reportes del menú.
  const extra = PANTALLAS_SIN_MENU[route.path];
  if (extra) return [{ label: 'Inicio', to: '/' }, { label: extra }];
  const found = findReporte(route.path);
  if (!found) return [{ label: 'Inicio', to: '/' }];
  return [{ label: 'Inicio', to: '/' }, { label: found.group.label }, { label: found.reporte.nombre }];
});
</script>

<template>
  <nav class="breadcrumb" aria-label="breadcrumb">
    <template v-for="(item, i) in trail" :key="i">
      <RouterLink v-if="item.to" :to="item.to" class="crumb-link">{{ item.label }}</RouterLink>
      <span v-else class="crumb-actual">{{ item.label }}</span>
      <AppIcon v-if="i < trail.length - 1" name="chevron-right" :size="13" class="sep" />
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb {
  display: flex;
  align-items: center;
  font-size: 0.82rem;
  color: var(--text-muted);
}
.crumb-link {
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.15s var(--ease);
}
.crumb-link:hover {
  color: var(--color-brand-darker);
}
.crumb-actual {
  color: var(--text);
  font-weight: 700;
}
.sep {
  margin: 0 0.35rem;
  color: var(--text-faint);
  flex-shrink: 0;
}
</style>
