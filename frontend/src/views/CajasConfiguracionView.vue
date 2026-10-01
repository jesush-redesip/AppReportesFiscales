<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '../lib/api';
import type { BaseContable, ConfiguracionCuentas, CuentaContable } from '../lib/types';
import AppIcon from '../components/icons/AppIcon.vue';
import FormasPagoAsiento from '../components/FormasPagoAsiento.vue';

type Pestana = 'cuentas' | 'formas-pago';
const pestana = ref<Pestana>('cuentas');

/**
 * Cierre de Caja › Configuración: cuentas de sobrante/faltante y costo de venta de la
 * empresa. Antes era la pestaña "Cuentas" del modal del engranaje del header; se movió
 * aquí para que quede junto al módulo que la usa. Solo SUPERVISOR (ruta y backend).
 */

const CAMPOS_CUENTA = [
  { key: 'sobranteVenta', label: 'Sobrante Venta' },
  { key: 'faltanteVenta', label: 'Faltante Venta' },
  { key: 'sobranteRedondeo', label: 'Sobrante Redondeo' },
  { key: 'faltanteRedondeo', label: 'Faltante Redondeo' },
] as const;

const cuentas = reactive<ConfiguracionCuentas>({
  sobranteVenta: '',
  faltanteVenta: '',
  sobranteRedondeo: '',
  faltanteRedondeo: '',
  bdContable: '',
  incluirCostoVenta: true,
});
const basesContables = ref<BaseContable[]>([]);
const cuentasDisponibles = ref<CuentaContable[]>([]);
const cargando = ref(false);
const listaCuentasLoading = ref(false);
const guardando = ref(false);
const error = ref('');
const guardado = ref(false);
/** Evita que el `watch` de bdContable dispare recargas mientras se puebla el formulario. */
let inicializando = false;

async function cargarListaCuentas(bdContable: string) {
  if (!bdContable) {
    cuentasDisponibles.value = [];
    return;
  }
  listaCuentasLoading.value = true;
  try {
    cuentasDisponibles.value = await api.get<CuentaContable[]>('/api/config/cuentas-disponibles', { bdContable });
  } catch (err) {
    cuentasDisponibles.value = [];
    error.value = err instanceof Error ? err.message : 'Error al cargar el plan de cuentas.';
  } finally {
    listaCuentasLoading.value = false;
  }
}

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    inicializando = true;
    const [config, bases] = await Promise.all([
      api.get<ConfiguracionCuentas>('/api/config/cuentas'),
      api.get<BaseContable[]>('/api/config/bases-contables'),
    ]);
    // `bdContable` ya viene resuelta por el backend: la guardada, o la de las tiendas
    // de esta empresa como sugerencia inicial.
    Object.assign(cuentas, config);
    basesContables.value = bases;
    await cargarListaCuentas(cuentas.bdContable);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al cargar la configuración.';
  } finally {
    inicializando = false;
    cargando.value = false;
  }
}

async function guardar() {
  guardando.value = true;
  error.value = '';
  guardado.value = false;
  try {
    await api.put('/api/config/cuentas', { ...cuentas });
    guardado.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al guardar la configuración.';
  } finally {
    guardando.value = false;
  }
}

/**
 * Opciones del desplegable de una cuenta. Si el valor ya configurado no existe en el
 * plan de la base elegida (pasa al traer una configuración hecha contra otra base
 * contable), se agrega como opción marcada en vez de dejar el select en blanco — así
 * el valor no se pierde en silencio al guardar y queda visible que no pertenece a esta
 * base.
 */
function opcionesDe(valorActual: string): CuentaContable[] {
  const lista = cuentasDisponibles.value;
  if (!valorActual || lista.some((c) => c.codigo === valorActual)) return lista;
  return [{ codigo: valorActual, titulo: '(no existe en esta base contable)' }, ...lista];
}

watch(
  () => cuentas.bdContable,
  async (bdContable) => {
    if (inicializando) return;
    guardado.value = false;
    await cargarListaCuentas(bdContable);
  },
);

onMounted(cargar);
</script>

<template>
  <section>
    <h1>Configuración del Cierre de Caja</h1>

    <div class="pestanas" role="tablist">
      <button
        type="button"
        role="tab"
        class="secundario"
        :class="{ activa: pestana === 'cuentas' }"
        :aria-selected="pestana === 'cuentas'"
        @click="pestana = 'cuentas'"
      >
        Cuentas
      </button>
      <button
        type="button"
        role="tab"
        class="secundario"
        :class="{ activa: pestana === 'formas-pago' }"
        :aria-selected="pestana === 'formas-pago'"
        @click="pestana = 'formas-pago'"
      >
        Formas de pago del asiento
      </button>
    </div>

    <!-- v-if (no v-show): cada pestaña carga sus datos al abrirse. -->
    <div v-if="pestana === 'formas-pago'" class="card panel panel-ancho">
      <FormasPagoAsiento />
    </div>

    <div v-else class="card panel">
      <p v-if="cargando" class="estado">Cargando...</p>
      <template v-else>
        <p class="ayuda">
          Cuentas de sobrante y faltante que usa el cierre de caja de esta empresa. Elige primero la base contable de la
          que se traen las cuentas.
        </p>

        <label class="campo">
          Base contable
          <select v-model="cuentas.bdContable">
            <option value="" disabled>Seleccionar...</option>
            <option v-for="b in basesContables" :key="b.bd" :value="b.bd">
              {{ b.descripcion }}{{ b.descripcion === b.bd ? '' : ` (${b.bd})` }}
            </option>
          </select>
        </label>

        <p v-if="listaCuentasLoading" class="estado">Cargando plan de cuentas...</p>
        <p v-else-if="cuentas.bdContable && cuentasDisponibles.length === 0" class="estado">
          Esta base contable no tiene cuentas con código que empiece por 7.
        </p>

        <div class="grid-cuentas">
          <label v-for="campo in CAMPOS_CUENTA" :key="campo.key" class="campo">
            {{ campo.label }}
            <select v-model="cuentas[campo.key]" :disabled="listaCuentasLoading">
              <option value="">(sin asignar)</option>
              <option v-for="c in opcionesDe(cuentas[campo.key])" :key="c.codigo" :value="c.codigo">
                {{ c.codigo }} — {{ c.titulo }}
              </option>
            </select>
          </label>
        </div>

        <div class="bloque">
          <div class="bloque-titulo">Costo de venta</div>
          <label class="check">
            <input v-model="cuentas.incluirCostoVenta" type="checkbox" />
            Contabilizar costo de venta
          </label>
          <p class="ayuda nota">
            Desmarcar para empresas que no llevan costo de ventas: el asiento del cierre no incluirá las líneas de costo y
            no se mostrará "Contabilizar Compras".
          </p>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="guardado && !error" class="exito"><AppIcon name="check" :size="14" /> Guardado.</p>
        <button type="button" :disabled="guardando" @click="guardar">
          {{ guardando ? 'Guardando...' : 'Guardar configuración' }}
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.pestanas {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.pestanas button.activa {
  background: var(--color-brand-bg);
  color: var(--color-brand-darker);
  border-color: var(--color-brand);
}
.panel {
  max-width: 760px;
  padding: var(--space-5);
}
.panel-ancho {
  max-width: 1100px;
}
.ayuda {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0 0 var(--space-4);
}
.ayuda.nota {
  margin: 0.25rem 0 0;
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
.grid-cuentas {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin: var(--space-4) 0;
}
.grid-cuentas select {
  /* Los títulos de cuenta son largos; que el select no empuje el ancho del panel. */
  max-width: 100%;
}
.estado {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: var(--space-3);
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin-bottom: var(--space-3);
}
.exito {
  color: var(--color-success);
  font-size: 0.85rem;
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.bloque {
  margin-bottom: var(--space-4);
}
.bloque-titulo {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  margin-bottom: 0.35rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  padding: 0.12rem 0;
  cursor: pointer;
}
.check input {
  margin: 0;
  cursor: pointer;
}
@media (max-width: 640px) {
  .grid-cuentas {
    grid-template-columns: 1fr;
  }
}
</style>
