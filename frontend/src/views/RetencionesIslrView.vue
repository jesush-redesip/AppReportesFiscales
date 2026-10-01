<script setup lang="ts">
import FiltroReporteBase from '../components/filtros/FiltroReporteBase.vue';
import ReportTable from '../components/ReportTable.vue';
import { useReportePreview } from '../composables/useReportePreview';
import { useReporteDownload } from '../composables/useReporteDownload';

type Filtros = { desde: string; hasta: string; empresa?: string; sucursal?: string };

const { loading: previewLoading, error: previewError, data: previewData, cargar: cargarPreview } = useReportePreview();
const { loading: descargando, error: descargaError, descargar } = useReporteDownload();

let ultimosFiltros: Filtros | null = null;

function onSubmit(filtros: Filtros) {
  ultimosFiltros = filtros;
  cargarPreview('/api/reportes/retenciones-islr/preview', filtros);
}

function onDescargar() {
  if (!ultimosFiltros) return;
  descargar('/api/reportes/retenciones-islr', ultimosFiltros, 'RetencionesISLR.xlsx').catch(() => {
    // error already captured in `descargaError`
  });
}
</script>

<template>
  <section>
    <h1>Retenciones ISLR</h1>
    <FiltroReporteBase :fields="{ sucursal: true }" :loading="previewLoading" @submit="onSubmit" />
    <p v-if="previewError" class="error">{{ previewError }}</p>

    <template v-if="previewData">
      <div class="acciones-preview">
        <h2>Vista previa</h2>
        <button class="secundario" :disabled="descargando" @click="onDescargar">
          {{ descargando ? 'Descargando...' : 'Descargar Excel' }}
        </button>
      </div>
      <p v-if="descargaError" class="error">{{ descargaError }}</p>
      <ReportTable :columns="previewData.columns" :rows="previewData.rows" />
    </template>
  </section>
</template>

<style scoped>
.error {
  color: var(--color-error);
  margin-top: 1rem;
}
.acciones-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 1.5rem;
}
.acciones-preview h2 {
  margin: 0;
}
</style>
