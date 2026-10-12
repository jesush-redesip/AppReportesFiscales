<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../lib/api';
import BaseModal from '../BaseModal.vue';
import CuentaBuscador from '../CuentaBuscador.vue';

/**
 * Registrar un pagaré: datos del préstamo, vista previa de la tabla de amortización y
 * guardado (con el asiento de desembolso si la configuración contable lo indica).
 */
const emit = defineEmits<{ cerrar: []; guardado: [r: { codPagares: number; aviso: string | null; asientoVisible: number | null }] }>();

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
  /** USD (créditos indexados, lo normal) o VES (bolívares, sin conversión). */
  moneda: 'USD' as 'USD' | 'VES',
});

const series = ref<Serie[]>([]);
/** La instalación genera asientos: se pide la tasa del desembolso y los cargos del banco. */
const contabiliza = ref(false);
const tasaCambio = ref<number | ''>('');
const cargos = ref<{ descripcion: string; monto: number | '' }[]>([]);
const tituloComision = ref<string | null>(null);
/** Bs exactos que acreditó / cobró el banco; vacío = calculado. */
const montoBs = ref<number | ''>('');
const comisionBs = ref<number | ''>('');
const enBs = computed(() => f.moneda === 'VES');
const simbolo = computed(() => (enBs.value ? 'Bs' : 'USD'));
const tasaEfectiva = computed(() => (enBs.value ? 1 : Number(tasaCambio.value) || 0));
const montoBsCalculado = computed(() => Math.round((Number(f.monto) || 0) * tasaEfectiva.value * 100) / 100);
const montoBsFinal = computed(() => (montoBs.value === '' ? montoBsCalculado.value : Number(montoBs.value)));
const comisionBsCalculada = computed(() => Math.round(((montoBsFinal.value * (Number(f.comision) || 0)) / 100) * 100) / 100);
const bancos = ref<{ cuenta: string; titulo: string }[]>([]);
const error = ref('');
const serieActual = computed(() => series.value.find((s) => s.serie === f.serie));

onMounted(async () => {
  try {
    series.value = await api.get<Serie[]>(`${BASE}/registro/series`);
    const config = await api.get<{ contabilizar: boolean; cuentaComision: string }>(`${BASE}/config`);
    contabiliza.value = config.contabilizar;
    f.cuentaComision = config.cuentaComision || f.cuentaComision;
    try {
      const t = await api.get<{ cuentas: { codigo: string; titulo: string }[] }>(`${BASE}/config/cuentas`, { codigos: f.cuentaComision });
      tituloComision.value = t.cuentas[0]?.titulo ?? null;
    } catch {
      /* sin título */
    }
    void sugerirTasa();
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
async function sugerirTasa() {
  if (!contabiliza.value || !f.fechaLiquidacion) return;
  try {
    const c = await api.get<{ tasa: number | null }>(`${BASE}/cotizacion`, { fecha: f.fechaLiquidacion });
    if (c.tasa) tasaCambio.value = c.tasa;
  } catch {
    /* sin sugerencia */
  }
}
watch(() => f.fechaLiquidacion, sugerirTasa);

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
  () =>
    Boolean(f.serie && f.cuentaBanco && Number(f.pagare) > 0 && Number.isInteger(Number(f.pagare)) && cuotas.value.length && !errorSimulacion.value) &&
    (!contabiliza.value || enBs.value || Number(tasaCambio.value) > 0),
);
async function guardar() {
  if (!valido.value || guardando.value) return;
  guardando.value = true;
  error.value = '';
  try {
    const r = await api.post<{ codPagares: number; aviso: string | null; asientoVisible: number | null }>(`${BASE}/registro`, {
      ...datosAmortizacion(),
      pagare: Number(f.pagare),
      serie: f.serie,
      cuentaBanco: f.cuentaBanco,
      comision: Number(f.comision) || 0,
      cuentaComision: f.cuentaComision.trim(),
      mesesInteresAdelantado: Number(f.mesesInteresAdelantado) || 0,
      moneda: f.moneda,
      ...(contabiliza.value
        ? {
            ...(enBs.value ? {} : { tasaCambio: Number(tasaCambio.value) }),
            ...(montoBs.value !== '' ? { montoBs: Number(montoBs.value) } : {}),
            ...(comisionBs.value !== '' ? { comisionBs: Number(comisionBs.value) } : {}),
            cargos: cargos.value
              .filter((c) => c.descripcion.trim() && Number(c.monto) > 0)
              .map((c) => ({ descripcion: c.descripcion.trim(), monto: Number(c.monto) })),
          }
        : {}),
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
        <label class="campo corto">
          Moneda
          <select v-model="f.moneda">
            <option value="USD">USD (indexado)</option>
            <option value="VES">Bs</option>
          </select>
        </label>
        <label class="campo">
          Monto ({{ simbolo }})
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
        <div class="campo cuenta">
          Cuenta de comisión
          <CuentaBuscador v-model="f.cuentaComision" :titulo="tituloComision" @elegida="(c) => (tituloComision = c.titulo)" />
        </div>
      </fieldset>

      <fieldset v-if="contabiliza">
        <legend>Asiento de desembolso</legend>
        <label v-if="!enBs" class="campo corto">
          Tasa Bs/USD
          <input v-model.number="tasaCambio" type="number" min="0.0001" step="0.0001" required />
        </label>
        <label class="campo corto">
          Bs acreditados por el banco
          <input v-model.number="montoBs" type="number" min="0" step="0.01" :placeholder="numero(montoBsCalculado)" />
        </label>
        <label class="campo corto">
          Comisión (Bs)
          <input v-model.number="comisionBs" type="number" min="0" step="0.01" :placeholder="numero(comisionBsCalculada)" />
        </label>
        <p class="nota">
          <template v-if="!enBs && Number(f.monto) > 0 && Number(tasaCambio) > 0">
            {{ numero(Number(f.monto)) }} USD × {{ numero(Number(tasaCambio)) }} = {{ numero(montoBsCalculado) }} Bs.
          </template>
          Deje los montos en Bs vacíos para usar los calculados, o escriba los del estado de cuenta del banco.
        </p>
        <div class="cargos">
          <div v-for="(c, i) in cargos" :key="i" class="cargo">
            <input v-model="c.descripcion" type="text" maxlength="80" placeholder="Concepto (impuesto 1x1000, firma electrónica…)" />
            <input v-model.number="c.monto" type="number" min="0.01" step="0.01" placeholder="Bs" />
            <button type="button" class="enlace" @click="cargos.splice(i, 1)">quitar</button>
          </div>
          <button type="button" class="enlace" @click="cargos.push({ descripcion: '', monto: '' })">+ otro cargo del banco</button>
        </div>
      </fieldset>

      <p v-if="serieActual && !serieActual.bdContable" class="aviso">
        La base contable de esta empresa no está en este servidor: el pagaré se registra sin su cuenta contable (210104) y
        no se podrán contabilizar sus pagos.
      </p>
      <p v-if="!contabiliza" class="nota">
        Registrar no genera asientos (la contabilización está apagada en la configuración): cárguelos en ICG.
      </p>

      <div class="previa">
        <p v-if="errorSimulacion" class="error">{{ errorSimulacion }}</p>
        <p v-else-if="!cuotas.length" class="nota">Complete monto, tasa y plazo para ver las cuotas.</p>
        <table v-else>
          <thead>
            <tr>
              <th>Cuota</th>
              <th>Vencimiento</th>
              <th>Saldo ({{ simbolo }})</th>
              <th>Capital ({{ simbolo }})</th>
              <th>Intereses ({{ simbolo }})</th>
              <th>Total ({{ simbolo }})</th>
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
.campo.cuenta {
  min-width: 20rem;
  max-width: 26rem;
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
.cargos {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex-basis: 100%;
}
.cargo {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.cargo input[type='text'] {
  min-width: 20rem;
}
.cargo input[type='number'] {
  width: 9rem;
}
.enlace {
  background: none;
  color: var(--color-brand-darker);
  padding: 0;
  height: auto;
  font-size: 0.8rem;
  align-self: flex-start;
}
.acciones {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
