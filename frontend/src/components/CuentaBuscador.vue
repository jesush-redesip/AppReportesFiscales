<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../lib/api';

/**
 * Lista desplegable con búsqueda para elegir una cuenta contable: se escribe el código o
 * parte del nombre y se elige de las coincidencias (el plan de cuentas es demasiado
 * grande para cargarlo entero). El v-model es el código; `titulo` es el que ya se conoce.
 *
 * `url` es la búsqueda del backend (recibe `q` más `params`) y puede responder con la
 * lista de cuentas o con { cuentas }. Lo usan Pagarés y Cierre de Caja › Configuración.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    titulo?: string | null;
    invalida?: boolean;
    url?: string;
    params?: Record<string, string | number | undefined>;
    disabled?: boolean;
  }>(),
  { titulo: null, invalida: false, url: '/api/reportes/pagares/config/cuentas', params: () => ({}), disabled: false },
);
const emit = defineEmits<{ 'update:modelValue': [codigo: string]; elegida: [cuenta: { codigo: string; titulo: string }] }>();

const texto = ref('');
const abierta = ref(false);
const resultados = ref<{ codigo: string; titulo: string }[]>([]);
const buscando = ref(false);
const resaltada = ref(0);
let temporizador: ReturnType<typeof setTimeout> | undefined;

const etiqueta = () => (props.modelValue ? `${props.modelValue}${props.titulo ? ` — ${props.titulo}` : ''}` : '');
watch(
  () => [props.modelValue, props.titulo],
  () => {
    if (!abierta.value) texto.value = etiqueta();
  },
  { immediate: true },
);

function abrir() {
  abierta.value = true;
  texto.value = '';
  resultados.value = [];
}

function alEscribir() {
  clearTimeout(temporizador);
  temporizador = setTimeout(buscar, 250);
}

async function buscar() {
  const q = texto.value.trim();
  if (q.length < 2) {
    resultados.value = [];
    return;
  }
  buscando.value = true;
  try {
    type Cuenta = { codigo: string; titulo: string };
    const r = await api.get<Cuenta[] | { cuentas: Cuenta[] }>(props.url, { ...props.params, q });
    if (texto.value.trim() === q) {
      resultados.value = Array.isArray(r) ? r : r.cuentas;
      resaltada.value = 0;
    }
  } catch {
    resultados.value = [];
  } finally {
    buscando.value = false;
  }
}

function elegir(c: { codigo: string; titulo: string }) {
  emit('update:modelValue', c.codigo);
  emit('elegida', c);
  abierta.value = false;
  texto.value = `${c.codigo} — ${c.titulo}`;
}

function cerrar() {
  // Deja tiempo al clic sobre una opción antes de cerrar.
  setTimeout(() => {
    abierta.value = false;
    texto.value = etiqueta();
  }, 150);
}

function teclado(e: KeyboardEvent) {
  if (!abierta.value) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    resaltada.value = Math.min(resaltada.value + 1, resultados.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    resaltada.value = Math.max(resaltada.value - 1, 0);
  } else if (e.key === 'Enter' && resultados.value[resaltada.value]) {
    e.preventDefault();
    elegir(resultados.value[resaltada.value]);
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    cerrar();
  }
}

onBeforeUnmount(() => clearTimeout(temporizador));
</script>

<template>
  <div class="buscador" :class="{ invalida }">
    <input
      v-model="texto"
      type="text"
      autocomplete="off"
      :disabled="disabled"
      :placeholder="abierta ? 'Escriba código o nombre…' : 'Elija una cuenta'"
      @focus="abrir"
      @input="alEscribir"
      @blur="cerrar"
      @keydown="teclado"
    />
    <span class="flecha" aria-hidden="true">▾</span>
    <ul v-if="abierta" class="opciones" role="listbox">
      <li v-if="texto.trim().length < 2" class="info">Escriba al menos 2 caracteres del código o del nombre.</li>
      <li v-else-if="buscando" class="info">Buscando…</li>
      <li v-else-if="!resultados.length" class="info">Sin coincidencias.</li>
      <li
        v-for="(c, i) in resultados"
        v-else
        :key="c.codigo"
        role="option"
        :aria-selected="i === resaltada"
        :class="{ activa: i === resaltada }"
        @mousedown.prevent="elegir(c)"
        @mouseenter="resaltada = i"
      >
        <span class="codigo">{{ c.codigo }}</span> {{ c.titulo }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.buscador {
  position: relative;
}
.buscador input {
  width: 100%;
  padding-right: 1.6rem;
  text-transform: none;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--text);
}
.buscador.invalida input {
  border-color: var(--color-error);
}
.flecha {
  position: absolute;
  right: 0.55rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
  font-size: 0.8rem;
}
.opciones {
  position: absolute;
  z-index: 30;
  top: calc(100% + 3px);
  left: 0;
  right: 0;
  max-height: 16rem;
  overflow: auto;
  margin: 0;
  padding: 0.25rem 0;
  list-style: none;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}
.opciones li {
  padding: 0.35rem 0.6rem;
  font-size: 0.84rem;
  color: var(--text);
  cursor: pointer;
}
.opciones li.activa {
  background: var(--color-brand-bg-strong);
}
.opciones li.info {
  color: var(--text-muted);
  cursor: default;
}
.codigo {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  margin-right: 0.35rem;
}
</style>
