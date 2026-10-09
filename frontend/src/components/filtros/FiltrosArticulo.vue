<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '../../lib/api';
import type { Opcion, ValorFiltrosArticulo } from '../../lib/filtrosArticulo';

/**
 * Filtros por artículo (Detalle de Ventas y Detalle de Compras): buscador de artículos
 * por referencia o descripción, y clasificación dpto → sección → familia → subfamilia,
 * marca → línea. `base` es la ruta del módulo (sus /articulos y /clasificacion).
 */
const props = defineProps<{ base: string; departamentos: Opcion[]; marcas: Opcion[] }>();
const modelo = defineModel<ValorFiltrosArticulo>({ required: true });

const abierto = ref(false);
const secciones = ref<Opcion[]>([]);
const familias = ref<Opcion[]>([]);
const subfamilias = ref<Opcion[]>([]);
const lineas = ref<Opcion[]>([]);

async function cargarNivel(nivel: 'seccion' | 'familia' | 'subfamilia' | 'linea') {
  const v = modelo.value;
  const n = (x: number | '') => (x === '' ? undefined : x);
  return api.get<Opcion[]>(`${props.base}/clasificacion`, {
    nivel,
    dpto: n(v.dpto),
    seccion: n(v.seccion),
    familia: n(v.familia),
    marca: n(v.marca),
  });
}
// Cada nivel depende del anterior: al cambiar uno se limpian los de abajo.
watch(
  () => modelo.value.dpto,
  async (d) => {
    modelo.value.seccion = '';
    secciones.value = d === '' ? [] : await cargarNivel('seccion');
  },
);
watch(
  () => modelo.value.seccion,
  async (s) => {
    modelo.value.familia = '';
    familias.value = s === '' ? [] : await cargarNivel('familia');
  },
);
watch(
  () => modelo.value.familia,
  async (f) => {
    modelo.value.subfamilia = '';
    subfamilias.value = f === '' ? [] : await cargarNivel('subfamilia');
  },
);
watch(
  () => modelo.value.marca,
  async (m) => {
    modelo.value.linea = '';
    lineas.value = m === '' ? [] : await cargarNivel('linea');
  },
);

const busqueda = ref('');
const sugerencias = ref<{ referencia: string; descripcion: string }[]>([]);
let temporizador: ReturnType<typeof setTimeout> | null = null;
watch(busqueda, (texto) => {
  if (temporizador) clearTimeout(temporizador);
  if (texto.trim().length < 2) {
    sugerencias.value = [];
    return;
  }
  temporizador = setTimeout(async () => {
    try {
      sugerencias.value = await api.get(`${props.base}/articulos`, { q: texto.trim() });
    } catch {
      sugerencias.value = [];
    }
  }, 300);
});
function agregar(a: { referencia: string; descripcion: string }) {
  if (!modelo.value.referencias.some((r) => r.referencia === a.referencia)) modelo.value.referencias.push(a);
  busqueda.value = '';
  sugerencias.value = [];
}
function quitar(ref: string) {
  modelo.value.referencias = modelo.value.referencias.filter((r) => r.referencia !== ref);
}

const activos = computed(() => modelo.value.referencias.length + [modelo.value.dpto, modelo.value.marca].filter((v) => v !== '').length);
</script>

<template>
  <button type="button" class="enlace-filtros" :aria-expanded="abierto" @click="abierto = !abierto">
    {{ abierto ? '▾' : '▸' }} Filtros por artículo
    <span v-if="activos" class="badge">{{ activos }}</span>
  </button>
  <div v-if="abierto" class="filtros-articulo">
    <div class="campo">
      Artículos (referencia o descripción)
      <div class="buscador">
        <input v-model="busqueda" type="text" placeholder="Escriba al menos 2 letras…" autocomplete="off" />
        <ul v-if="sugerencias.length" class="sugerencias">
          <li v-for="s in sugerencias" :key="s.referencia">
            <button type="button" @click="agregar(s)"><strong>{{ s.referencia }}</strong> {{ s.descripcion }}</button>
          </li>
        </ul>
      </div>
      <div v-if="modelo.referencias.length" class="chips">
        <span v-for="r in modelo.referencias" :key="r.referencia" class="chip" :title="r.descripcion">
          {{ r.referencia }}
          <button type="button" :aria-label="`Quitar ${r.referencia}`" @click="quitar(r.referencia)">×</button>
        </span>
      </div>
    </div>
    <div class="fila-filtros">
      <label class="campo">
        Departamento
        <select v-model="modelo.dpto">
          <option value="">Todos</option>
          <option v-for="o in departamentos" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
        </select>
      </label>
      <label class="campo">
        Sección
        <select v-model="modelo.seccion" :disabled="modelo.dpto === ''">
          <option value="">Todas</option>
          <option v-for="o in secciones" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
        </select>
      </label>
      <label class="campo">
        Familia
        <select v-model="modelo.familia" :disabled="modelo.seccion === ''">
          <option value="">Todas</option>
          <option v-for="o in familias" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
        </select>
      </label>
      <label class="campo">
        Subfamilia
        <select v-model="modelo.subfamilia" :disabled="modelo.familia === ''">
          <option value="">Todas</option>
          <option v-for="o in subfamilias" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
        </select>
      </label>
      <label class="campo">
        Marca
        <select v-model="modelo.marca" :disabled="!marcas.length">
          <option value="">{{ marcas.length ? 'Todas' : 'Sin marcas' }}</option>
          <option v-for="o in marcas" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
        </select>
      </label>
      <label class="campo">
        Línea
        <select v-model="modelo.linea" :disabled="modelo.marca === ''">
          <option value="">Todas</option>
          <option v-for="o in lineas" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
        </select>
      </label>
    </div>
  </div>
</template>

<style scoped>
.enlace-filtros {
  margin-top: var(--space-3);
  background: none;
  color: var(--color-brand-darker);
  padding: 0;
  height: auto;
  font-size: 0.85rem;
}
.enlace-filtros:hover:not(:disabled) {
  background: none;
  text-decoration: underline;
}
.badge {
  font-size: 0.7rem;
  background: var(--color-brand-bg-strong);
  color: var(--color-brand-darker);
  border-radius: 999px;
  padding: 0 0.45rem;
}
.filtros-articulo {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.fila-filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3) var(--space-4);
}
.campo {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.campo select,
.campo input {
  min-width: 10rem;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  color: var(--text);
}
.buscador {
  position: relative;
  max-width: 28rem;
}
.buscador input {
  width: 100%;
}
.sugerencias {
  position: absolute;
  z-index: 20;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  max-height: 16rem;
  overflow-y: auto;
}
.sugerencias button {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  background: transparent;
  color: var(--text);
  font-weight: 400;
  font-size: 0.82rem;
  padding: 0.35rem 0.5rem;
  height: auto;
  text-transform: none;
  letter-spacing: 0;
}
.sugerencias button:hover {
  background: var(--bg-subtle);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  color: var(--color-brand-darker);
  background: var(--color-brand-bg-strong);
  border-radius: 999px;
  padding: 0.15rem 0.3rem 0.15rem 0.6rem;
}
.chip button {
  width: 1.2rem;
  height: 1.2rem;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 0.9rem;
}
.chip button:hover:not(:disabled) {
  background: var(--color-brand-bg);
}
</style>
