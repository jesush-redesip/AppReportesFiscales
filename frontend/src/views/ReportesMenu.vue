<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '../stores/auth.store';
import { gruposVisibles } from '../lib/reportes';
import AppIcon from '../components/icons/AppIcon.vue';

const auth = useAuthStore();
const grupos = computed(() => gruposVisibles(auth.permisos, auth.modulos));
</script>

<template>
  <section>
    <div class="bienvenida">
      <h1>Reportes</h1>
      <p v-if="auth.empresa">
        Generando reportes para <strong>{{ auth.empresa.titulo }}</strong>
      </p>
    </div>
    <div v-if="grupos.length === 0" class="sin-modulos">
      <h2>Sin módulos asignados</h2>
      <p v-if="auth.esSupervisor">
        Todavía no tienes módulos habilitados. Asígnatelos en Permisos de Usuario (botón del engranaje, arriba a la
        derecha).
      </p>
      <p v-else>Tu usuario todavía no tiene módulos habilitados. Pídele al SUPERVISOR que te asigne acceso.</p>
    </div>
    <div v-else class="grupos">
      <div v-for="(group, i) in grupos" :key="group.id" class="grupo-card" :style="{ '--delay': `${i * 60}ms` }">
        <div class="grupo-card-header">
          <span class="grupo-icono">
            <AppIcon :name="group.icon" :size="18" />
          </span>
          <h2>{{ group.label }}</h2>
        </div>
        <ul>
          <li v-for="r in group.reportes" :key="r.path">
            <RouterLink :to="r.path">
              <span>{{ r.nombre }}</span>
              <AppIcon name="chevron-right" :size="15" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bienvenida {
  margin-bottom: var(--space-6);
}
.bienvenida p {
  color: var(--text-muted);
  font-size: 0.92rem;
  margin-top: 0.15rem;
}
.bienvenida strong {
  color: var(--text);
}
.sin-modulos {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-6);
  text-align: center;
  box-shadow: var(--shadow);
}
.sin-modulos h2 {
  margin-bottom: 0.35rem;
}
.sin-modulos p {
  color: var(--text-muted);
  font-size: 0.9rem;
}
.grupos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}
.grupo-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4) var(--space-4) var(--space-3);
  box-shadow: var(--shadow);
  transition:
    transform 0.18s var(--ease),
    box-shadow 0.18s var(--ease);
  animation: subir-y-aparecer 0.35s var(--ease) both;
  animation-delay: var(--delay);
}
.grupo-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
}
.grupo-card-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.grupo-icono {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--color-brand-bg);
  color: var(--color-brand-darker);
  display: flex;
  align-items: center;
  justify-content: center;
}
.grupo-card-header h2 {
  margin: 0;
  font-size: 0.92rem;
}
.grupo-card ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.grupo-card a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: 0.87rem;
  color: var(--text);
  text-decoration: none;
  padding: 0.5rem 0.5rem;
  margin: 0 -0.5rem;
  border-radius: var(--radius-sm);
  transition: background-color 0.15s var(--ease);
}
.grupo-card a :deep(svg) {
  color: var(--text-faint);
  flex-shrink: 0;
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 0.15s var(--ease),
    transform 0.15s var(--ease);
}
.grupo-card a:hover {
  background: var(--bg-subtle);
  color: var(--color-brand-darker);
}
.grupo-card a:hover :deep(svg) {
  opacity: 1;
  transform: translateX(0);
}

@keyframes subir-y-aparecer {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
