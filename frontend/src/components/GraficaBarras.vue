<script setup lang="ts">
import { computed } from 'vue';

/**
 * Gráfica de barras verticales en SVG (sin librerías). Valores negativos (p. ej. un
 * beneficio en pérdida) bajan desde la línea del cero. Cada barra muestra su valor al
 * pasar el mouse y, si caben, encima.
 */
const props = defineProps<{
  datos: { etiqueta: string; valor: number | null }[];
  /** Cómo mostrar los valores: moneda, entero o porcentaje. */
  formato?: 'moneda' | 'entero' | 'porcentaje';
  /** Al hacer clic en una barra. */
  clicable?: boolean;
}>();
const emit = defineEmits<{ seleccionar: [indice: number] }>();

const ALTO = 260;
const MARGEN = { arriba: 22, abajo: 56, izq: 64, der: 12 };
const ANCHO_BARRA_MAX = 56;

const ancho = computed(() => Math.max(560, props.datos.length * 34 + MARGEN.izq + MARGEN.der));
const valores = computed(() => props.datos.map((d) => d.valor ?? 0));
const maximo = computed(() => Math.max(0, ...valores.value));
const minimo = computed(() => Math.min(0, ...valores.value));
const rango = computed(() => maximo.value - minimo.value || 1);
const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo;
const y = (v: number) => MARGEN.arriba + ((maximo.value - v) / rango.value) * altoUtil;
const paso = computed(() => (ancho.value - MARGEN.izq - MARGEN.der) / Math.max(1, props.datos.length));
const anchoBarra = computed(() => Math.min(ANCHO_BARRA_MAX, paso.value * 0.7));
const mostrarValores = computed(() => paso.value >= 46);
const rotarEtiquetas = computed(() => paso.value < 70);

const numero = computed(() => {
  if (props.formato === 'entero') return new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 });
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});
const fmt = (v: number) => numero.value.format(v) + (props.formato === 'porcentaje' ? ' %' : '');
const fmtCorto = (v: number) => {
  const a = Math.abs(v);
  if (props.formato === 'porcentaje') return `${Math.round(v)} %`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return numero.value.format(v);
};

/** 5 líneas guía repartidas entre el mínimo y el máximo. */
const guias = computed(() => Array.from({ length: 5 }, (_, i) => minimo.value + (rango.value * i) / 4));
</script>

<template>
  <div class="grafica">
    <svg :viewBox="`0 0 ${ancho} ${ALTO}`" :width="ancho" :height="ALTO" role="img" aria-label="Gráfica de barras">
      <g class="guias">
        <template v-for="g in guias" :key="g">
          <line :x1="MARGEN.izq" :x2="ancho - MARGEN.der" :y1="y(g)" :y2="y(g)" />
          <text :x="MARGEN.izq - 6" :y="y(g) + 4" text-anchor="end">{{ fmtCorto(g) }}</text>
        </template>
        <line class="cero" :x1="MARGEN.izq" :x2="ancho - MARGEN.der" :y1="y(0)" :y2="y(0)" />
      </g>
      <g
        v-for="(d, i) in datos"
        :key="i"
        class="barra"
        :class="{ clicable, negativa: (d.valor ?? 0) < 0 }"
        @click="clicable && emit('seleccionar', i)"
      >
        <title>{{ d.etiqueta }}: {{ fmt(d.valor ?? 0) }}</title>
        <rect
          :x="MARGEN.izq + i * paso + (paso - anchoBarra) / 2"
          :y="Math.min(y(d.valor ?? 0), y(0))"
          :width="anchoBarra"
          :height="Math.max(1, Math.abs(y(d.valor ?? 0) - y(0)))"
          rx="3"
        />
        <text
          v-if="mostrarValores"
          class="valor"
          :x="MARGEN.izq + i * paso + paso / 2"
          :y="(d.valor ?? 0) >= 0 ? y(d.valor ?? 0) - 5 : y(d.valor ?? 0) + 13"
          text-anchor="middle"
        >
          {{ fmtCorto(d.valor ?? 0) }}
        </text>
        <text
          class="etiqueta"
          :text-anchor="rotarEtiquetas ? 'end' : 'middle'"
          :transform="
            rotarEtiquetas
              ? `translate(${MARGEN.izq + i * paso + paso / 2}, ${ALTO - MARGEN.abajo + 12}) rotate(-40)`
              : `translate(${MARGEN.izq + i * paso + paso / 2}, ${ALTO - MARGEN.abajo + 16})`
          "
        >
          {{ d.etiqueta.length > 18 ? d.etiqueta.slice(0, 17) + '…' : d.etiqueta }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.grafica {
  overflow-x: auto;
}
svg {
  display: block;
  font-family: var(--sans);
}
.guias line {
  stroke: var(--border);
  stroke-dasharray: 3 3;
}
.guias line.cero {
  stroke: var(--border-strong);
  stroke-dasharray: none;
}
.guias text {
  font-size: 10px;
  fill: var(--text-faint);
}
.barra rect {
  fill: var(--color-brand);
  transition: fill 0.15s var(--ease);
}
.barra.negativa rect {
  fill: var(--color-error);
}
.barra.clicable {
  cursor: pointer;
}
.barra.clicable:hover rect {
  fill: var(--color-brand-dark);
}
.valor {
  font-size: 10px;
  font-weight: 600;
  fill: var(--text-muted);
}
.etiqueta {
  font-size: 10.5px;
  fill: var(--text-muted);
}
</style>
