<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { COLUMNAS_OCULTAS, etiquetaColumna } from '../lib/columnas';

const props = withDefaults(
  defineProps<{
    columns: string[];
    rows: Record<string, unknown>[];
    /** Column names that must render as plain text even though their underlying value is
     * a number (e.g. an invoice sequence or Z-report serial) — no thousand separators or
     * forced decimals. */
    textColumns?: string[];
    /** Etiquetas propias de esta vista, por nombre técnico; ganan sobre `lib/columnas`. */
    labels?: Record<string, string>;
    /** Montos que el SP devuelve como texto ("171988.99", p. ej. el formato del TXT del
     * SENIAT): se muestran y se suman como números. */
    numericColumns?: string[];
    /** Cantidades enteras (se suman, pero sin decimales). */
    integerColumns?: string[];
    /** Numéricas que no se suman en esta vista (porcentajes, códigos...). */
    noTotalColumns?: string[];
  }>(),
  { textColumns: () => [], labels: () => ({}), numericColumns: () => [], integerColumns: () => [], noTotalColumns: () => [] },
);

/** Solo presentación: las filas siguen indexadas por el nombre técnico de SQL. */
const columnasVisibles = computed(() =>
  props.columns
    .filter((col) => !COLUMNAS_OCULTAS.has(col))
    .map((col) => ({ col, etiqueta: etiquetaColumna(col, props.labels) })),
);

/** Correlativos y números de reporte Z: nunca son montos, sin decimales en ningún módulo. */
const TEXTO_SIEMPRE = ['ID', 'ZFISCAL', '# Z'];
const esTexto = (col: string) => TEXTO_SIEMPRE.includes(col) || props.textColumns.includes(col);

/** Numéricas que no tiene sentido sumar: porcentajes y costo unitario. */
const NO_TOTALIZAR = new Set(['PORCRETENCION', 'ALICUOTA', 'COSTO']);

const noTotalizar = (col: string) => NO_TOTALIZAR.has(col) || props.noTotalColumns.includes(col);

/** Valor numérico de la celda: número, o texto numérico en las columnas `numericColumns`. */
function aNumero(col: string, value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && props.numericColumns.includes(col)) {
    const t = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  }
  return null;
}

function isNumeric(col: string, value: unknown): boolean {
  return aNumero(col, value) !== null && !esTexto(col);
}

function formatValue(col: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  const n = esTexto(col) ? null : aNumero(col, value);
  if (n !== null) {
    const decimales = props.integerColumns.includes(col) ? 0 : 2;
    return n.toLocaleString('es-VE', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  }
  return String(value);
}

// --- Filtro por impresora fiscal (sobre las filas ya cargadas, sin volver a consultar) ---
/** Nombre de la columna de impresora según el módulo: Libro de Venta, Isla, Resumen IGTF. */
const COLUMNAS_IMPRESORA = ['SFISCAL', 'IMPRESORA', 'Serial Imp.'];
const columnaImpresora = computed(() => COLUMNAS_IMPRESORA.find((c) => props.columns.includes(c)) ?? null);
const impresoras = computed(() => {
  const col = columnaImpresora.value;
  if (!col) return [];
  const valores = new Set(props.rows.map((r) => String(r[col] ?? '').trim()).filter(Boolean));
  return [...valores].sort();
});
const impresoraSeleccionada = ref('');

const filasFiltradas = computed(() => {
  const col = columnaImpresora.value;
  const sel = impresoraSeleccionada.value;
  if (!col || !sel) return props.rows;
  return props.rows.filter((r) => String(r[col] ?? '').trim() === sel);
});

const totalFilas = computed(() => filasFiltradas.value.length);
const hayFiltro = computed(() => filasFiltradas.value.length !== props.rows.length);

// --- Totales de todas las filas filtradas (no solo de la página visible) ---
const totales = computed(() => {
  const suma: Record<string, number> = {};
  for (const { col } of columnasVisibles.value) {
    if (esTexto(col) || noTotalizar(col)) continue;
    let total = 0;
    let esMonto = false;
    for (const r of filasFiltradas.value) {
      const v = aNumero(col, r[col]);
      if (v !== null) {
        total += v;
        esMonto = true;
      }
    }
    if (esMonto) suma[col] = total;
  }
  return suma;
});
const hayTotales = computed(() => Object.keys(totales.value).length > 0);

// --- Paginación (solo de la vista previa; el Excel sigue exportando todo) ---
const TAMANOS_PAGINA = [25, 50, 100, 250];
const tamanoPagina = ref(50);
const pagina = ref(1);
const totalPaginas = computed(() => Math.max(1, Math.ceil(totalFilas.value / tamanoPagina.value)));
const filasPagina = computed(() => {
  const inicio = (pagina.value - 1) * tamanoPagina.value;
  return filasFiltradas.value.slice(inicio, inicio + tamanoPagina.value);
});
const desde = computed(() => (totalFilas.value === 0 ? 0 : (pagina.value - 1) * tamanoPagina.value + 1));
const hasta = computed(() => Math.min(pagina.value * tamanoPagina.value, totalFilas.value));

/** Números de página a mostrar: primera, última y dos a cada lado de la actual. */
const botonesPagina = computed<(number | '…')[]>(() => {
  const total = totalPaginas.value;
  const actual = pagina.value;
  const paginas = new Set([1, total]);
  for (let p = actual - 2; p <= actual + 2; p++) if (p >= 1 && p <= total) paginas.add(p);
  const ordenadas = [...paginas].sort((a, b) => a - b);
  const resultado: (number | '…')[] = [];
  ordenadas.forEach((p, i) => {
    if (i > 0 && p - ordenadas[i - 1] > 1) resultado.push('…');
    resultado.push(p);
  });
  return resultado;
});

const scrollRef = ref<HTMLElement | null>(null);

function irA(p: number) {
  pagina.value = Math.min(Math.max(1, p), totalPaginas.value);
  scrollRef.value?.scrollTo({ top: 0 });
}

// Datos nuevos (otra consulta), otro filtro o cambio de tamaño: se vuelve a la primera
// página. Con datos nuevos también se limpia el filtro: la impresora elegida puede no
// existir en la nueva consulta.
watch(
  () => props.rows,
  () => {
    impresoraSeleccionada.value = '';
    irA(1);
  },
);
watch([tamanoPagina, impresoraSeleccionada], () => irA(1));

const numero = new Intl.NumberFormat('es-VE');
</script>

<template>
  <div class="report-table-wrap">
    <div class="report-table-info">
      <span>
        {{ numero.format(totalFilas) }} fila{{ totalFilas === 1 ? '' : 's' }}
        <template v-if="hayFiltro"> de {{ numero.format(rows.length) }}</template>
      </span>
      <label v-if="impresoras.length > 1" class="filtro-impresora">
        Impresora fiscal
        <select v-model="impresoraSeleccionada">
          <option value="">Todas ({{ impresoras.length }})</option>
          <option v-for="imp in impresoras" :key="imp" :value="imp">{{ imp }}</option>
        </select>
      </label>
    </div>
    <div v-if="totalFilas === 0" class="sin-datos">No hay datos para los filtros seleccionados.</div>
    <template v-else>
      <div ref="scrollRef" class="scroll">
        <table>
          <thead>
            <tr>
              <th v-for="c in columnasVisibles" :key="c.col" :title="c.col">{{ c.etiqueta }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in filasPagina" :key="desde + i">
              <td v-for="{ col } in columnasVisibles" :key="col" :class="{ numero: isNumeric(col, row[col]) }">
                {{ formatValue(col, row[col]) }}
              </td>
            </tr>
          </tbody>
          <tfoot v-if="hayTotales">
            <tr>
              <td v-for="({ col }, i) in columnasVisibles" :key="col" :class="{ numero: col in totales }">
                <template v-if="col in totales">{{ formatValue(col, totales[col]) }}</template>
                <template v-else-if="i === 0">{{ hayFiltro ? 'Total impresora' : 'Total' }}</template>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <nav class="paginacion" aria-label="Paginación de la vista previa">
        <span class="rango">
          Mostrando {{ numero.format(desde) }}–{{ numero.format(hasta) }} de {{ numero.format(totalFilas) }}
        </span>
        <div class="paginas">
          <button type="button" class="secundario" :disabled="pagina === 1" aria-label="Primera página" @click="irA(1)">«</button>
          <button type="button" class="secundario" :disabled="pagina === 1" aria-label="Página anterior" @click="irA(pagina - 1)">‹</button>
          <template v-for="(b, i) in botonesPagina" :key="`${b}-${i}`">
            <span v-if="b === '…'" class="elipsis">…</span>
            <button
              v-else
              type="button"
              class="secundario"
              :class="{ activa: b === pagina }"
              :aria-current="b === pagina ? 'page' : undefined"
              @click="irA(b)"
            >
              {{ numero.format(b) }}
            </button>
          </template>
          <button type="button" class="secundario" :disabled="pagina === totalPaginas" aria-label="Página siguiente" @click="irA(pagina + 1)">›</button>
          <button type="button" class="secundario" :disabled="pagina === totalPaginas" aria-label="Última página" @click="irA(totalPaginas)">»</button>
        </div>
        <label class="tamano">
          Filas por página
          <select v-model.number="tamanoPagina">
            <option v-for="t in TAMANOS_PAGINA" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.report-table-wrap {
  margin-top: var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.report-table-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0.6rem var(--space-4);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}
.sin-datos {
  padding: var(--space-6) var(--space-4);
  color: var(--text-muted);
  font-size: 0.9rem;
  text-align: center;
}
.scroll {
  overflow-x: auto;
  max-height: 60vh;
  overflow-y: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.82rem;
  white-space: nowrap;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-subtle);
  text-align: center;
  vertical-align: middle;
  padding: 0.55rem var(--space-4);
  border-bottom: 1px solid var(--border-strong);
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  font-size: 0.68rem;
  letter-spacing: 0.03em;
}
td {
  padding: 0.5rem var(--space-4);
  border-bottom: 1px solid var(--border);
  text-align: center;
  vertical-align: middle;
}
/* Centrados como el resto; tabular-nums mantiene los dígitos del mismo ancho para que
   los montos se lean en columna aunque no estén alineados a la derecha. */
td.numero {
  font-variant-numeric: tabular-nums;
}
.filtro-impresora {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.filtro-impresora select {
  height: 2rem;
  font-size: 0.8rem;
}
/* Totales fijos al pie del área con scroll, visibles en cualquier página. */
tfoot td {
  position: sticky;
  bottom: 0;
  z-index: 1;
  /* --color-brand-bg es translúcido: se apoya sobre un fondo sólido para que las filas
     no se vean a través del pie fijo. */
  background: linear-gradient(var(--color-brand-bg), var(--color-brand-bg)), var(--bg-elevated);
  border-top: 2px solid var(--border-strong);
  border-bottom: none;
  font-weight: 700;
  color: var(--text);
}
.paginacion {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 0.6rem var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--bg-subtle);
  font-size: 0.8rem;
  color: var(--text-muted);
}
.rango {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.paginas {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.paginas button {
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.5rem;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.paginas button.activa {
  background: var(--color-brand-bg);
  color: var(--color-brand-darker);
  border-color: var(--color-brand);
  font-weight: 700;
}
.elipsis {
  padding: 0 0.25rem;
}
.tamano {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.tamano select {
  height: 2rem;
  font-size: 0.8rem;
}
tbody tr {
  transition: background-color 0.1s var(--ease);
}
tbody tr:hover {
  background: var(--bg-subtle);
}
</style>
