<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import AppIcon from './icons/AppIcon.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    ancho?: string;
    /** Alto máximo del modal (el cuerpo hace scroll si el contenido no cabe). */
    altoMax?: string;
  }>(),
  { ancho: '640px', altoMax: 'calc(100vh - 4rem)' },
);
const emit = defineEmits<{ close: [] }>();

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close');
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
      <div class="modal card" role="dialog" aria-modal="true" :aria-label="title" :style="{ maxWidth: ancho, maxHeight: altoMax }">
        <header class="modal-header">
          <h2>{{ title }}</h2>
          <button class="secundario cerrar" aria-label="Cerrar" @click="emit('close')">
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(32, 32, 32, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  z-index: 1000;
}
.modal {
  width: 100%;
  /* max-width y max-height los fijan las props `ancho` y `altoMax` por estilo inline. */
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-5) var(--space-4);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.modal-header h2 {
  margin: 0;
}
.cerrar {
  height: 2rem;
  width: 2rem;
  padding: 0;
  border-radius: 50%;
}
.modal-body {
  padding: var(--space-5);
  overflow-y: auto;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
</style>
