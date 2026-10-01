<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { gruposVisibles } from '../../lib/reportes';
import { useAuthStore } from '../../stores/auth.store';
import AppIcon from '../icons/AppIcon.vue';

const route = useRoute();
const auth = useAuthStore();
const grupos = computed(() => gruposVisibles(auth.permisos, auth.modulos));
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <RouterLink to="/" class="brand-link">
        <span class="brand-mark" aria-hidden="true">
          <AppIcon name="table" :size="18" />
        </span>
        <span class="brand-text">
          <strong>Reportes</strong>
          <small>Redes IP</small>
        </span>
      </RouterLink>
    </div>
    <nav>
      <div v-for="group in grupos" :key="group.id" class="grupo">
        <h2 class="grupo-titulo">
          <AppIcon :name="group.icon" :size="14" />
          {{ group.label }}
        </h2>
        <ul>
          <li v-for="r in group.reportes" :key="r.path">
            <RouterLink :to="r.path" class="link" :class="{ activo: route.path === r.path }">
              {{ r.nombre }}
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  flex-shrink: 0;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.brand {
  height: var(--header-height);
  display: flex;
  align-items: center;
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.brand-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  text-decoration: none;
  color: var(--text);
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: var(--color-brand);
  color: var(--color-white);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.brand-text strong {
  font-size: 0.98rem;
  font-weight: 800;
}
.brand-text small {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 500;
}
nav {
  padding: var(--space-4) 0 var(--space-5);
  overflow-y: auto;
}
.grupo {
  margin-bottom: var(--space-5);
}
.grupo-titulo {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  padding: 0 var(--space-5);
  margin: 0 0 var(--space-2);
}
.grupo-titulo :deep(svg) {
  flex-shrink: 0;
  opacity: 0.85;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.link {
  display: block;
  padding: 0.5rem var(--space-5);
  margin: 0 var(--space-3);
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--text);
  font-size: 0.88rem;
  font-weight: 500;
  transition:
    background-color 0.15s var(--ease),
    color 0.15s var(--ease);
}
.link:hover {
  background: var(--bg-subtle);
}
.link.activo {
  background: var(--color-brand-bg-strong);
  color: var(--color-brand-darker);
  font-weight: 700;
}
</style>
