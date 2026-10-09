<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../lib/api';
import BaseModal from '../BaseModal.vue';

/**
 * Registrar un pagaré: datos del préstamo, vista previa de la tabla de amortización y
 * guardado. No genera asientos: los sigue haciendo el PHP (o la Fase 3).
 */
const emit = defineEmits<{ cerrar: []; guardado: [r: { codPagares: number; aviso: string | null }] }>();

interface Serie {
  serie: string;
  descripcion: string;
  bdContable: string | null;
}
interface Cuota {
  mes: number;
  fecha: string;
  saldo: number;
  capital: number;
  intereses: number;
  total: number;
  sinIntereses: boolean;
}

const BASE = '/api/reportes/pagares';
const hoy = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const f = reactive({
  serie: '',
  cuentaBanco: '',
  pagare: '' as number | '',
  fechaLiquidacion: iso(hoy),
  diaPago: hoy.getDate(),
  monto: '' as number | '',
  tasa: 16 as number | '',
  plazo: 12 as number | '',
  metodo: 'CUOTA_FIJA' as 'CUOTA_FIJA' | 'CAPITAL_FIJO',
  baseInteres: 'MENSUAL' as 'MENSUAL' | 'DIAS_360',
  frecuenciaCapital: 'MENSUAL' as 'MENSUAL' | 'BIMESTRAL' | 'TRIMESTRAL',
  frecuenciaIntereses: 'MENSUAL' as 'MENSUAL' | 'TRIMESTRAL',
  mesesGracia: 0,
  mesesInteresAdelantado: 0,
  comision: 0 as number | '',
  cuentaComision: '611201035',
});

const series = ref<Serie[]>([]);
const bancos = ref<{ cuenta: string; titulo: string }[]>([]);
const error = ref('');
const serieActual = computed(() => series.value.find((s) => s.serie === f.serie));

onMounted(async () => {
  try {
    series.value = await api.get<Serie[]>(`${BASE}/registro/series`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar las empresas.';
  }
});

watch(
  () => f.serie,
  async (serie) => {
    bancos.value = [];
    f.cuentaBanco = '';
    if (!serie) return;
    try {
      bancos.value = await api.get(`${BASE}/registro/bancos`, { serie });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'No se pudieron cargar los bancos.';
    }
  },
);
// El día de pago sigue a la fecha de liquidación hasta que el usuario lo cambie.
watch(
  () => f.fechaLiquidacion,
  (v, antes) => {
    if (antes && f.diaPago === Number(antes.slice(8, 10)) && v) f.diaPago = Number(v.slice(8, 10));
  },
);

function datosAmortizacion() {
  return {
    monto: Number(f.monto),
    tasa: Number(f.tasa),
    plazo: Number(f.plazo),
    fechaLiquidacion: f.fechaLiquidacion,
    diaPago: Number(f.diaPago),
    frecuenciaCapital: f.frecuenciaCapital,
    frecuenciaIntereses: f.frecuenciaIntereses,
    metodo: f.metodo,
    baseInteres: f.baseInteres,
    mesesGracia: Number(f.mesesGracia) || 0,
  };
}

// --- Vista previa ---
const cuotas = ref<Cuota[]>([]);
const errorSimulacion = ref('');
let temporizador: ReturnType<typeof setTimeout> | undefined;
watch(
  () => JSON.stringify(datosAmortizacion()),
  () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(simular, 350);
  },
  { immediate: true },
);
async function simular() {
  const d = datosAmortizacion();
  if (!(d.monto > 0) || !(d.plazo > 0) || !d.fechaLiquidacion || f.tasa === '') {
    cuotas.value = [];
    errorSimulacion.value = '';
    return;
  }
  try {
    cuotas.value = await api.post<Cuota[]>(`${BASE}/registro/simular`, d);
    errorSimulacion.value = '';
  } catch (e) {
    cuotas.value = [];
    errorSimulacion.value = e instanceof Error ? e.message : 'No se pudo calcular.';
  }
}
const totales = computed(() => ({
  capital: cuotas.value.reduce((s, c) => s + c.capital, 0),
  intereses: cuotas.value.reduce((s, c) => s + c.intereses, 0),
  total: cuotas.value.reduce((s, c) => s + c.total, 0),
}));

const numero = (v: number) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (v: string) => v.split('-').reverse().join('/');

// --- Guardar ---
const guardando = ref(false);
const valido = computed(
  () => Boolean(f.serie && f.cuentaBanco && Number(f.pagare) > 0 && Number.isInteger(Number(f.pagare)) && cuotas.value.length && !errorSimulacion.value),
);
async function guardar() {
  if (!valido.value || guardando.value) return;
  guardando.value = true;
  error.value = '';
  try {
    const r = await api.post<{ codPagares: number; aviso: string | null }>(`${BASE}/registro`, {
      ...datosAmortizacion(),
      pagare: Number(f.pagare),
      serie: f.serie,
      cuentaBanco: f.cuentaBanco,
      comision: Number(f.comision) || 0,
      cuentaComision: f.cuentaComision.trim(),
      mesesInteresAdelantado: Number(f.mesesInteresAdelantado) || 0,
    });
    emit('guardado', r);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo registrar.';
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <BaseModal :open="true" title="Registrar pagaré" ancho="min(1100px, 96vw)" @close="emit('cerrar')">
    <form class="registro" @submit.prevent="guardar">
      <fieldset>
        <legend>Pagaré</legend>
        <label class="campo">
          Empresa
          <select v-model="f.serie" required>
            <option value="" disabled>Seleccione</option>
            <option v-for="s in series" :key="s.serie" :value="s.serie">{{ s.descripcion || s.serie }} ({{ s.serie }})</option>
          </select>
        </label>
        <label class="campo">
          Banco
          <select v-model="f.cuentaBanco" required :disabled="!f.serie">
            <option value="" disabled>{{ f.serie ? 'Seleccione' : 'Elija la empresa' }}</option>
            <option v-for="b in bancos" :key="b.cuenta" :value="b.cuenta">{{ b.titulo }} ({{ b.cuenta }})</option>
          </select>
        </label>
        <label class="campo">
          N.º pagaré
          <input v-model.number="f.pagare" type="number" min="1" step="1" required />
        </label>
        <label class="campo">
          Liquidación
          <input v-model="f.fechaLiquidacion" type="date" required />
        </label>
        <label class="campo corto">
          Día de pago
          <input v-model.number="f.diaPago" type="number" min="1" max="31" required />
        </label>
      </fieldset>

      <fieldset>
        <legend>Condiciones</legend>
        <label class="campo">
          Monto
          <input v-model.number="f.monto" type="number" min="0.01" step="0.01" required />
        </label>
        <label class="campo corto">
          Tasa anual %
          <input v-model.number="f.tasa" type="number" min="0" step="0.01" required />
        </label>
        <label class="campo corto">
          Plazo (meses)
          <input v-model.number="f.plazo" type="number" min="1" max="360" step="1" required />
        </label>
        <label class="campo">
          Amortización
          <select v-model="f.metodo">
            <option value="CUOTA_FIJA">Cuota fija (francés)</option>
            <option value="CAPITAL_FIJO">Capital fijo</option>
          </select>
        </label>
        <label class="campo">
          Intereses
          <select v-model="f.baseInteres">
            <option value="MENSUAL">Tasa / 12 sobre el saldo</option>
            <option value="DIAS_360">Días del mes / 360</option>
          </select>
        </label>
        <label class="campo">
          Pago de capital
          <select v-model="f.frecuenciaCapital">
            <option value="MENSUAL">Mensual</option>
            <option value="BIMESTRAL">Bimestral</option>
            <option value="TRIMESTRAL">Trimestral</option>
          </select>
        </label>
        <label class="campo">
          Pago de intereses
          <select v-model="f.frecuenciaIntereses">
            <option value="MENSUAL">Mensual</option>
            <option value="TRIMESTRAL">Trimestral</option>
          </select>
        </label>
        <label class="campo corto">
          Meses sin intereses
          <input v-model.number="f.mesesGracia" type="number" min="0" step="1" />
        </label>
        <label class="campo corto">
          Intereses pagados por adelantado (meses)
          <input v-model.number="f.mesesInteresAdelantado" type="number" min="0" step="1" />
        </label>
        <label class="campo corto">
          Comisión bancaria %
          <input v-model.number="f.comision" type="number" min="0" step="0.01" />
        </label>
        <label class="campo">
          Cuenta de comisión
          <input v-model="f.cuentaComision" type="text" maxlength="15" />
        </label>
      </fieldset>

      <p v-if="serieActual && !serieActual.bdContable" class="aviso">
        La base contable de esta empresa no está en este servidor: el pagaré se registra sin su cuenta contable (210104) y el
        PHP no podrá contabilizar sus pagos.
      </p>
      <p class="nota">
        Registrar no genera asientos (desembolso, comisión, intereses ni IGTF): se siguen haciendo en el PHP o en ICG.
      </p>

      <div class="previa">
        <p v-if="errorSimulacion" class="error">{{ errorSimulacion }}</p>
        <p v-else-if="!cuotas.length" class="nota">Complete monto, tasa y plazo para ver las cuotas.</p>
        <table v-else>
          <thead>
            <tr>
              <th>Cuota</th>
              <th>Vencimiento</th>
              <th>Saldo</th>
              <th>Capital</th>
              <th>Intereses</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in cuotas" :key="c.mes">
              <td>{{ c.mes }}</td>
              <td>{{ fecha(c.fecha) }}</td>
              <td class="num">{{ numero(c.saldo) }}</td>
              <td class="num">{{ numero(c.capital) }}</td>
              <td class="num">
                {{ numero(c.intereses) }}
                <span v-if="c.sinIntereses" class="etiqueta">sin intereses</span>
                <span v-else-if="c.mes <= f.mesesInteresAdelantado" class="etiqueta">adelantado</span>
              </td>
              <td class="num">{{ numero(c.total) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3">Total</td>
              <td class="num">{{ numero(totales.capital) }}</td>
              <td class="num">{{ numero(totales.intereses) }}</td>
              <td class="num">{{ numero(totales.total) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <div class="acciones">
        <button type="button" class="secundario" @click="emit('cerrar')">Cancelar</button>
        <button type="submit" :disabled="!valido || guardando">{{ guardando ? 'Guardando…' : 'Registrar pagaré' }}</button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped>
.registro {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
fieldset {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
  margin: 0;
}
legend {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-muted);
  padding: 0 0.3rem;
}
.campo {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  max-width: 15rem;
}
.campo input,
.campo select {
  min-width: 11rem;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  color: var(--text);
}
.campo.corto input {
  min-width: 6rem;
  width: 8rem;
}
.previa {
  max-height: 18rem;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.83rem;
}
th,
td {
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
th {
  position: sticky;
  top: 0;
  background: var(--bg-subtle);
  font-size: 0.75rem;
}
tfoot td {
  font-weight: 700;
  background: var(--bg-subtle);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.etiqueta {
  margin-left: 0.4rem;
  font-size: 0.7rem;
  color: var(--text-muted);
}
.nota {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
  padding: var(--space-2);
}
.aviso {
  font-size: 0.82rem;
  color: var(--color-warning, #a15c00);
  margin: 0;
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin: 0;
  padding: var(--space-2);
}
.acciones {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
