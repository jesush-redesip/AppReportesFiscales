<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useCatalogosStore } from '../../stores/catalogos.store';
import type { Sucursal } from '../../lib/types';
import AppIcon from '../icons/AppIcon.vue';

export interface FiltroFields {
  /** Defaults to true — set false for reports that don't filter by empresa (e.g. Movimiento de Inventario). */
  empresa?: boolean;
  sucursal?: boolean;
  almacen?: boolean;
  /** Whether the almacén field is mandatory (hides the "(todos)" option). Defaults to false. */
  almacenRequired?: boolean;
  moneda?: boolean;
  /** Proveedor select (required when shown) — used by ARCV. */
  proveedor?: boolean;
}

const props = withDefaults(
  defineProps<{
    fields?: FiltroFields;
    loading?: boolean;
  }>(),
  { fields: () => ({}), loading: false },
);

const emit = defineEmits<{
  submit: [
    value: {
      desde: string;
      hasta: string;
      empresa?: string;
      sucursal?: string;
      moneda?: number;
      almacen?: string;
      proveedor?: number;
    },
  ];
}>();

const catalogos = useCatalogosStore();

const showEmpresa = computed(() => props.fields.empresa !== false);

const desde = ref('');
const hasta = ref('');
const empresa = ref('');
const sucursal = ref('');
const moneda = ref<number | ''>('');
const almacen = ref('');
const proveedor = ref<number | ''>('');
const sucursalesDisponibles = ref<Sucursal[]>([]);

onMounted(async () => {
  await catalogos.loadBase();
});

watch(empresa, async (codEmpresa) => {
  sucursal.value = '';
  sucursalesDisponibles.value = codEmpresa ? await catalogos.loadSucursales(codEmpresa) : [];
});

function toYyyyMMdd(dateInputValue: string): string {
  return dateInputValue.replaceAll('-', '');
}

const canSubmit = computed(
  () =>
    Boolean(desde.value && hasta.value) &&
    (!showEmpresa.value || empresa.value !== '') &&
    (!props.fields.moneda || moneda.value !== '') &&
    (!props.fields.almacenRequired || almacen.value !== '') &&
    (!props.fields.proveedor || proveedor.value !== ''),
);

function onSubmit() {
  emit('submit', {
    desde: toYyyyMMdd(desde.value),
    hasta: toYyyyMMdd(hasta.value),
    empresa: showEmpresa.value ? empresa.value : undefined,
    sucursal: props.fields.sucursal ? sucursal.value || undefined : undefined,
    moneda: props.fields.moneda ? (moneda.value === '' ? undefined : Number(moneda.value)) : undefined,
    almacen: props.fields.almacen ? almacen.value || undefined : undefined,
    proveedor: props.fields.proveedor ? (proveedor.value === '' ? undefined : Number(proveedor.value)) : undefined,
  });
}
</script>

<template>
  <form class="filtro-reporte" @submit.prevent="onSubmit">
    <div class="campo">
      <label>Desde</label>
      <input v-model="desde" type="date" required />
    </div>
    <div class="campo">
      <label>Hasta</label>
      <input v-model="hasta" type="date" required />
    </div>
    <div v-if="showEmpresa" class="campo">
      <label>Empresa</label>
      <select v-model="empresa" required>
        <option value="" disabled>Seleccionar...</option>
        <option v-for="e in catalogos.empresas" :key="e.codEmpresa" :value="e.codEmpresa">
          {{ e.nombre }} ({{ e.codEmpresa }})
        </option>
      </select>
    </div>
    <div v-if="fields.sucursal" class="campo">
      <label>Sucursal</label>
      <select v-model="sucursal">
        <option value="">(todas)</option>
        <option v-for="s in sucursalesDisponibles" :key="s.codSucursal" :value="s.codSucursal">
          {{ s.descripcion }} ({{ s.codSucursal }})
        </option>
      </select>
    </div>
    <div v-if="fields.almacen" class="campo">
      <label>Almacén</label>
      <select v-model="almacen" :required="fields.almacenRequired">
        <option value="" :disabled="fields.almacenRequired">{{ fields.almacenRequired ? 'Seleccionar...' : '(todos)' }}</option>
        <option v-for="a in catalogos.almacenes" :key="a.codAlmacen" :value="a.codAlmacen">
          {{ a.nombre }} ({{ a.codAlmacen }})
        </option>
      </select>
    </div>
    <div v-if="fields.moneda" class="campo">
      <label>Moneda</label>
      <select v-model="moneda" required>
        <option value="" disabled>Seleccionar...</option>
        <option v-for="m in catalogos.monedas" :key="m.codMoneda" :value="m.codMoneda">
          {{ m.descripcion }}
        </option>
      </select>
    </div>
    <div v-if="fields.proveedor" class="campo">
      <label>Proveedor</label>
      <select v-model="proveedor" required>
        <option value="" disabled>Seleccionar...</option>
        <option v-for="p in catalogos.proveedores" :key="p.codProveedor" :value="p.codProveedor">
          {{ p.nombre }}
        </option>
      </select>
    </div>
    <button type="submit" :disabled="!canSubmit || loading">
      <AppIcon name="table" :size="15" />
      {{ loading ? 'Generando...' : 'Generar reporte' }}
    </button>
  </form>
</template>

<style scoped>
.filtro-reporte {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: flex-end;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-5);
  box-shadow: var(--shadow);
}
.campo {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 10rem;
}
label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
button {
  height: 2.35rem;
  padding: 0 1.2rem;
}
</style>
