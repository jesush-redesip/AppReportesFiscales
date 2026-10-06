<script setup lang="ts">
import { computed } from 'vue';
import { useTema } from '../../composables/useTema';
import AppIcon from '../icons/AppIcon.vue';

const { tema, alternar } = useTema();
const etiqueta = computed(() => (tema.value === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'));
</script>

<template>
  <button type="button" class="secundario tema-toggle" :aria-label="etiqueta" :title="etiqueta" @click="alternar">
    <!-- Muestra el modo actual: sol en claro, luna en oscuro. -->
    <AppIcon :name="tema === 'oscuro' ? 'moon' : 'sun'" :size="16" />
  </button>
</template>

<style scoped>
.tema-toggle {
  width: 2.1rem;
  height: 2.1rem;
  padding: 0;
  flex-shrink: 0;
}
</style>
