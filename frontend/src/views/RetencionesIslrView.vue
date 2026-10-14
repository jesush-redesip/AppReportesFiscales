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

// Las tres descargas: la relación, el Excel con el formato para migrar a XML
// (como la planilla vieja) y el XML del SENIAT directo.
const DESCARGAS = {
  relacion: { path: '/api/reportes/retenciones-islr', nombre: 'Retenciones ISLR', ext: 'xlsx' },
  formatoXml: { path: '/api/reportes/retenciones-islr/formato-xml', nombre: 'Retenciones ISLR - Formato XML', ext: 'xlsx' },
  xml: { path: '/api/reportes/retenciones-islr/xml', nombre: 'Retenciones ISLR', ext: 'xml' },
} as const;

function onDescargar(tipo: keyof typeof DESCARGAS) {
  if (!ultimosFiltros) return;
  const d = DESCARGAS[tipo];
  descargar(d.path, ultimosFiltros, d.nombre, d.ext).catch(() => {
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
        <div class="botones-descarga">
          <button class="secundario" :disabled="descargando" @click="onDescargar('relacion')">Descargar Excel</button>
          <button
            class="secundario"
            :disabled="descargando"
            title="Excel con el formato para migrar a XML (RIF del agente, período y una fila por retención)"
            @click="onDescargar('formatoXml')"
          >
            Formato XML (Excel)
          </button>
          <button
            class="secundario"
            :disabled="descargando"
            title="Archivo XML para cargar en el portal del SENIAT"
            @click="onDescargar('xml')"
          >
            Descargar XML
          </button>
          <span v-if="descargando" class="tenue">Descargando...</span>
        </div>
      </div>
      <p v-if="descargaError" class="error">{{ descargaError }}</p>
      <ReportTable
        :columns="previewData.columns"
        :rows="previewData.rows"
        :text-columns="['Cód. Prov.']"
        :no-total-columns="['% Retención']"
      />
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
.botones-descarga {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.acciones-preview {
  flex-wrap: wrap;
  gap: 0.75rem;
}
</style>
