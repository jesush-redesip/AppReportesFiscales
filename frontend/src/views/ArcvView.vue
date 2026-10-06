<script setup lang="ts">
import FiltroReporteBase from '../components/filtros/FiltroReporteBase.vue';
import ReportTable from '../components/ReportTable.vue';
import { useReportePreview } from '../composables/useReportePreview';
import { useReporteDownload } from '../composables/useReporteDownload';

type Filtros = { desde: string; hasta: string; empresa?: string; sucursal?: string; proveedor?: number };

const { loading: previewLoading, error: previewError, data: previewData, cargar: cargarPreview } = useReportePreview();
const { loading: descargando, error: descargaError, descargar } = useReporteDownload();

let ultimosFiltros: Filtros | null = null;

function onSubmit(filtros: Filtros) {
  ultimosFiltros = filtros;
  cargarPreview('/api/reportes/arcv/preview', filtros);
}

function onDescargar() {
  if (!ultimosFiltros) return;
  descargar('/api/reportes/arcv', ultimosFiltros, 'ARCV').catch(() => {
    // error already captured in `descargaError`
  });
}
</script>

<template>
  <section>
    <h1>ARCV (Retenciones)</h1>
    <FiltroReporteBase :fields="{ sucursal: true, proveedor: true }" :loading="previewLoading" @submit="onSubmit" />
    <p v-if="previewError" class="error">{{ previewError }}</p>

    <template v-if="previewData">
      <div class="acciones-preview">
        <h2>Vista previa</h2>
        <button class="secundario" :disabled="descargando" @click="onDescargar">
          {{ descargando ? 'Descargando...' : 'Descargar Excel' }}
        </button>
      </div>
      <p v-if="descargaError" class="error">{{ descargaError }}</p>
      <!-- El año no es un monto; los acumulados ya son totales corridos, sumarlos no tiene sentido. -->
      <ReportTable
        :columns="previewData.columns"
        :rows="previewData.rows"
        :text-columns="['ANYO']"
        :no-total-columns="['BASE_ACUM', 'RETENIDO_ACUM']"
      />
    </template>
    <p class="nota">Nota: el comprobante se genera sin la imagen de firma (pendiente de definir dónde almacenarla).</p>
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
.nota {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: 1rem;
}
</style>
