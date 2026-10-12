<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { useReporteDownload } from '../../composables/useReporteDownload';
import AppIcon from '../icons/AppIcon.vue';

/**
 * Tabla de amortización de un pagaré. Con permiso de gestión: pagar capital o intereses
 * de una cuota, editarla, cambiar la tasa y anular el pagaré. Nada de esto genera
 * asientos contables.
 */
const props = defineProps<{ cod: number; corte: string; puedeGestionar: boolean }>();
const emit = defineEmits<{ cambio: []; anulado: [] }>();

type Fila = Record<string, unknown>;
interface Detalle {
  pagare: Fila;
  lineas: Fila[];
  asientos: Fila[];
  /** La instalación genera los asientos (configuración contable). */
  contabiliza: boolean;
  /** % de IGTF de la configuración (para sugerir el monto). */
  tasaIgtf: number;
}
interface Cargo {
  descripcion: string;
  monto: number | '';
}
const BASE = '/api/reportes/pagares';
const datos = ref<Detalle | null>(null);
const cargando = ref(true);
const error = ref('');
const mensaje = ref('');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    datos.value = await api.get<Detalle>(`${BASE}/detalle`, { cod: props.cod, corte: props.corte });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el pagaré.';
  } finally {
    cargando.value = false;
  }
}
onMounted(cargar);

const numero = (v: unknown) => Number(v ?? 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10).split('-').reverse().join('/') : '');
const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const pendiente = (estado: unknown) => estado === 'Pendiente' || estado === 'Vencido';
const totales = computed(() => {
  const l = datos.value?.lineas ?? [];
  const s = (k: string) => l.reduce((t, x) => t + Number(x[k] ?? 0), 0);
  return { capital: s('CAPITAL'), intereses: s('INTERESES'), total: s('TOTAL') };
});

// --- Acción en curso (un solo panel a la vez) ---
type Accion =
  | {
      tipo: 'pagar';
      fila: Fila;
      capital: boolean;
      intereses: boolean;
      fechaContable: string;
      tasaCambio: number | '';
      cargos: Cargo[];
      /** Bs exactos del estado de cuenta; vacío = calculado. */
      capitalBs: number | '';
      interesesBs: number | '';
      igtfBs: number | '';
    }
  | { tipo: 'moneda'; moneda: 'USD' | 'VES' }
  | { tipo: 'reversar'; asiento: Fila; fechaContable: string }
  | { tipo: 'editar'; fila: Fila; fecha: string; capital: number; intereses: number; ajustarIntereses: boolean }
  | { tipo: 'tasa'; tasa: number }
  | { tipo: 'anular'; motivo: string };
const accion = ref<Accion | null>(null);
const trabajando = ref(false);

function pagar(fila: Fila, que: 'capital' | 'intereses') {
  mensaje.value = '';
  // Por defecto se paga lo que la cuota tenga pendiente (como hace el banco).
  accion.value = {
    tipo: 'pagar',
    fila,
    capital: que === 'capital' || pendiente(fila.ESTADO_CAPITAL),
    intereses: que === 'intereses' || pendiente(fila.ESTADO_INTERESES),
    fechaContable: hoyIso(),
    tasaCambio: '',
    cargos: [],
    capitalBs: '',
    interesesBs: '',
    igtfBs: '',
  };
  if (!enBs.value) void sugerirTasa();
}

/** Cotización USD de la fecha contable, como sugerencia (se puede corregir por la del banco). */
async function sugerirTasa() {
  const a = accion.value;
  if (!a || a.tipo !== 'pagar' || !datos.value?.contabiliza || !a.fechaContable) return;
  try {
    const c = await api.get<{ tasa: number | null }>(`${BASE}/cotizacion`, { fecha: a.fechaContable });
    if (accion.value === a && c.tasa) a.tasaCambio = c.tasa;
  } catch {
    /* sin sugerencia: el usuario la escribe */
  }
}

/** Moneda del pagaré: USD (indexado, lo normal) o VES (Bs, sin conversión). */
const enBs = computed(() => datos.value?.pagare.MONEDA === 'VES');
const simbolo = computed(() => (enBs.value ? 'Bs' : 'USD'));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Montos en Bs del pago: los escritos o los calculados (monto × tasa y el % de IGTF). */
const resumenPago = computed(() => {
  const a = accion.value;
  if (!a || a.tipo !== 'pagar' || !datos.value) return null;
  const tasa = enBs.value ? 1 : Number(a.tasaCambio) || 0;
  const capCalc = a.capital ? r2(Number(a.fila.CAPITAL) * tasa) : 0;
  const intCalc = a.intereses ? r2(Number(a.fila.INTERESES) * tasa) : 0;
  const cap = a.capital ? (a.capitalBs === '' ? capCalc : Number(a.capitalBs)) : 0;
  const inte = a.intereses ? (a.interesesBs === '' ? intCalc : Number(a.interesesBs)) : 0;
  const igtfCalc = r2(((cap + inte) * (datos.value.tasaIgtf || 0)) / 100);
  const igtf = a.igtfBs === '' ? igtfCalc : Number(a.igtfBs);
  const cargos = a.cargos.reduce((t, c) => t + (Number(c.monto) || 0), 0);
  return { capCalc, intCalc, igtfCalc, total: r2(cap + inte + igtf + cargos) };
});

function reversar(asiento: Fila) {
  mensaje.value = '';
  accion.value = { tipo: 'reversar', asiento, fechaContable: hoyIso() };
}
const TIPOS_ASIENTO: Record<string, string> = { DESEMBOLSO: 'Desembolso', PAGO: 'Pago', REVERSO: 'Reverso' };
function editar(fila: Fila) {
  mensaje.value = '';
  accion.value = {
    tipo: 'editar',
    fila,
    fecha: String(fila.FECHA).slice(0, 10),
    capital: Number(fila.CAPITAL),
    intereses: Number(fila.INTERESES),
    ajustarIntereses: true,
  };
}

async function ejecutar() {
  const a = accion.value;
  if (!a || trabajando.value) return;
  trabajando.value = true;
  error.value = '';
  try {
    if (a.tipo === 'pagar') {
      const r = await api.post<{ asientoVisible: number | null }>(`${BASE}/cuotas/pagar`, {
        cod: props.cod,
        mes: Number(a.fila.MES),
        fecha: String(a.fila.FECHA).slice(0, 10),
        capital: a.capital,
        intereses: a.intereses,
        fechaContable: a.fechaContable,
        ...(datos.value?.contabiliza && !enBs.value && a.tasaCambio !== '' ? { tasaCambio: Number(a.tasaCambio) } : {}),
        ...(datos.value?.contabiliza && (a.capitalBs !== '' || a.interesesBs !== '' || a.igtfBs !== '')
          ? {
              montosBs: {
                ...(a.capital && a.capitalBs !== '' ? { capital: Number(a.capitalBs) } : {}),
                ...(a.intereses && a.interesesBs !== '' ? { intereses: Number(a.interesesBs) } : {}),
                ...(a.igtfBs !== '' ? { igtf: Number(a.igtfBs) } : {}),
              },
            }
          : {}),
        ...(datos.value?.contabiliza ? { cargos: a.cargos.filter((c) => c.descripcion.trim() && Number(c.monto) > 0).map((c) => ({ descripcion: c.descripcion.trim(), monto: Number(c.monto) })) } : {}),
      });
      mensaje.value = `Cuota ${a.fila.MES} pagada.` + (r.asientoVisible ? ` Asiento ${r.asientoVisible}.` : '');
    } else if (a.tipo === 'moneda') {
      await api.post(`${BASE}/moneda`, { cod: props.cod, moneda: a.moneda });
      mensaje.value = `Moneda del pagaré: ${a.moneda === 'VES' ? 'Bs' : 'USD'}. Aplica a los asientos que se generen desde ahora.`;
    } else if (a.tipo === 'reversar') {
      const r = await api.post<{ asientoVisible: number }>(`${BASE}/reversar`, { id: Number(a.asiento.ID), fechaContable: a.fechaContable });
      mensaje.value = `Asiento ${a.asiento.ASIENTOVISIBLE} reversado con el asiento ${r.asientoVisible}.`;
    } else if (a.tipo === 'editar') {
      const f = a.fila;
      const cuerpo: Record<string, unknown> = { cod: props.cod, mes: Number(f.MES), fecha: String(f.FECHA).slice(0, 10) };
      if (a.fecha !== String(f.FECHA).slice(0, 10)) cuerpo.nuevaFecha = a.fecha;
      if (Math.abs(a.capital - Number(f.CAPITAL)) > 0.004) {
        cuerpo.capital = a.capital;
        cuerpo.ajustarIntereses = a.ajustarIntereses;
      }
      if (Math.abs(a.intereses - Number(f.INTERESES)) > 0.004) cuerpo.intereses = a.intereses;
      if (Object.keys(cuerpo).length === 3) {
        accion.value = null;
        return;
      }
      await api.post(`${BASE}/cuotas/editar`, cuerpo);
      mensaje.value = `Cuota ${f.MES} actualizada.`;
    } else if (a.tipo === 'tasa') {
      await api.post(`${BASE}/recalcular`, { cod: props.cod, tasa: a.tasa });
      mensaje.value = `Intereses pendientes recalculados con ${a.tasa} %.`;
    } else {
      await api.post(`${BASE}/anular`, { cod: props.cod, motivo: a.motivo });
      accion.value = null;
      emit('anulado');
      return;
    }
    accion.value = null;
    emit('cambio');
    await cargar();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo completar la operación.';
  } finally {
    trabajando.value = false;
  }
}

const { loading: descargando, descargar } = useReporteDownload();
async function excel() {
  try {
    await descargar(`${BASE}/detalle/excel`, { cod: props.cod, corte: props.corte }, `Pagare ${datos.value?.pagare.PAGARE ?? ''}`.trim());
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo generar el Excel.';
  }
}
</script>

<template>
  <p v-if="cargando && !datos" class="estado"><span class="spinner" aria-hidden="true"></span> Cargando…</p>
  <template v-if="datos">
    <dl class="resumen">
      <div><dt>Empresa</dt><dd>{{ datos.pagare.EMPRESA }}</dd></div>
      <div><dt>Liquidación</dt><dd>{{ fecha(datos.pagare.FECHA) }}</dd></div>
      <div><dt>Monto</dt><dd>{{ numero(datos.pagare.MONTO) }} {{ simbolo }}</dd></div>
      <div><dt>Tasa anual</dt><dd>{{ numero(datos.pagare.TASA) }} %</dd></div>
      <div><dt>Plazo</dt><dd>{{ datos.pagare.PLAZO }} meses</dd></div>
      <div><dt>Capital</dt><dd>{{ datos.pagare.FRECUENCIA || '—' }}</dd></div>
      <div><dt>Intereses</dt><dd>{{ datos.pagare.FRECUENCIA_INTERESES || '—' }}</dd></div>
    </dl>
    <div class="barra">
      <button type="button" class="secundario" :disabled="descargando" @click="excel"><AppIcon name="download" :size="15" /> Excel</button>
      <template v-if="puedeGestionar">
        <button type="button" class="secundario" @click="accion = { tipo: 'tasa', tasa: Number(datos.pagare.TASA) }">Cambiar tasa</button>
        <button type="button" class="secundario" @click="accion = { tipo: 'moneda', moneda: enBs ? 'VES' : 'USD' }">Moneda: {{ simbolo }}</button>
        <button type="button" class="secundario peligro" @click="accion = { tipo: 'anular', motivo: '' }">Anular pagaré</button>
      </template>
    </div>

    <form v-if="accion" class="panel" @submit.prevent="ejecutar">
      <template v-if="accion.tipo === 'pagar'">
        <span>Pagar la cuota {{ accion.fila.MES }} ({{ fecha(accion.fila.FECHA) }})</span>
        <label class="check">
          <input v-model="accion.capital" type="checkbox" :disabled="!pendiente(accion.fila.ESTADO_CAPITAL)" />
          Capital {{ numero(accion.fila.CAPITAL) }} {{ simbolo }}
        </label>
        <label class="check">
          <input v-model="accion.intereses" type="checkbox" :disabled="!pendiente(accion.fila.ESTADO_INTERESES)" />
          Intereses {{ numero(accion.fila.INTERESES) }} {{ simbolo }}
        </label>
        <label class="campo">Fecha contable <input v-model="accion.fechaContable" type="date" required @change="sugerirTasa" /></label>
        <template v-if="datos.contabiliza">
          <label v-if="!enBs" class="campo">Tasa Bs/USD <input v-model.number="accion.tasaCambio" type="number" min="0.0001" step="0.0001" required /></label>
          <div v-if="resumenPago" class="montos-bs">
            <label v-if="accion.capital" class="campo">
              Capital (Bs)
              <input v-model.number="accion.capitalBs" type="number" min="0" step="0.01" :placeholder="numero(resumenPago.capCalc)" />
            </label>
            <label v-if="accion.intereses" class="campo">
              Intereses (Bs)
              <input v-model.number="accion.interesesBs" type="number" min="0" step="0.01" :placeholder="numero(resumenPago.intCalc)" />
            </label>
            <label class="campo">
              IGTF (Bs)
              <input v-model.number="accion.igtfBs" type="number" min="0" step="0.01" :placeholder="numero(resumenPago.igtfCalc)" />
            </label>
            <span class="nota">
              Total debitado por el banco: <strong>{{ numero(resumenPago.total) }} Bs</strong>. Deje vacío un monto para usar el
              calculado, o escriba el del estado de cuenta.
            </span>
          </div>
          <div class="cargos">
            <div v-for="(c, i) in accion.cargos" :key="i" class="cargo">
              <input v-model="c.descripcion" type="text" maxlength="80" placeholder="Concepto (comisión flat, 1x1000…)" />
              <input v-model.number="c.monto" type="number" min="0.01" step="0.01" placeholder="Bs" />
              <button type="button" class="enlace" @click="accion.cargos.splice(i, 1)">quitar</button>
            </div>
            <button type="button" class="enlace" @click="accion.cargos.push({ descripcion: '', monto: '' })">+ otro cargo del banco</button>
          </div>
          <span class="nota">Genera el asiento en la contabilidad del año de la fecha contable.</span>
        </template>
        <span v-else class="nota">No genera asiento (la contabilización está apagada en la configuración): cárguelo en ICG.</span>
      </template>
      <template v-else-if="accion.tipo === 'moneda'">
        <label class="campo">
          Moneda del pagaré
          <select v-model="accion.moneda">
            <option value="USD">USD (indexado)</option>
            <option value="VES">Bs</option>
          </select>
        </label>
        <span class="nota">
          En USD, los asientos convierten a Bs con la tasa del día; en Bs, van por el monto tal cual. No cambia los asientos ya
          generados.
        </span>
      </template>
      <template v-else-if="accion.tipo === 'reversar'">
        <span>
          Reversar el asiento <strong>{{ accion.asiento.ASIENTOVISIBLE }}</strong> ({{ TIPOS_ASIENTO[String(accion.asiento.TIPO)] }}
          {{ accion.asiento.MES ? `cuota ${accion.asiento.MES}` : '' }}, {{ numero(accion.asiento.MONTOBS) }} Bs)
        </span>
        <label class="campo">Fecha del reverso <input v-model="accion.fechaContable" type="date" required /></label>
        <span class="nota">Crea un asiento con Debe y Haber invertidos; si era un pago, la cuota vuelve a quedar pendiente.</span>
      </template>
      <template v-else-if="accion.tipo === 'editar'">
        <span>Cuota {{ accion.fila.MES }}</span>
        <label class="campo">
          Vencimiento
          <input v-model="accion.fecha" type="date" required :disabled="!pendiente(accion.fila.ESTADO_CAPITAL) || accion.fila.ESTADO_INTERESES === 'Pagado'" />
        </label>
        <label class="campo">
          Capital
          <input v-model.number="accion.capital" type="number" min="0" step="0.01" :disabled="!pendiente(accion.fila.ESTADO_CAPITAL)" />
        </label>
        <label class="campo">
          Intereses
          <input v-model.number="accion.intereses" type="number" min="0" step="0.01" :disabled="!pendiente(accion.fila.ESTADO_INTERESES)" />
        </label>
        <label class="check">
          <input v-model="accion.ajustarIntereses" type="checkbox" /> Ajustar intereses de las cuotas siguientes al nuevo saldo
        </label>
        <span class="nota">Si cambia el capital, la diferencia se reparte entre las cuotas siguientes con capital pendiente.</span>
      </template>
      <template v-else-if="accion.tipo === 'tasa'">
        <label class="campo">Nueva tasa anual % <input v-model.number="accion.tasa" type="number" min="0" step="0.01" required /></label>
        <span class="nota">Los intereses pendientes se ajustan en proporción a la tasa nueva; los pagados no cambian.</span>
      </template>
      <template v-else>
        <label class="campo ancho">Motivo <input v-model="accion.motivo" type="text" maxlength="200" placeholder="Registrado por error…" /></label>
        <span class="nota">Solo si no tiene pagos. No borra nada: deja de verse en los reportes y, si se contabilizó el desembolso, se reversa.</span>
      </template>
      <div class="acciones">
        <button type="button" class="secundario" @click="accion = null">Cancelar</button>
        <button type="submit" :class="{ peligro: accion.tipo === 'anular' }" :disabled="trabajando">
          {{ trabajando ? 'Guardando…' : accion.tipo === 'anular' ? 'Anular' : accion.tipo === 'reversar' ? 'Reversar' : 'Confirmar' }}
        </button>
      </div>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="mensaje" class="exito">{{ mensaje }}</p>

    <div class="tabla">
      <table>
        <thead>
          <tr>
            <th>Cuota</th>
            <th>Vencimiento</th>
            <th>Saldo ({{ simbolo }})</th>
            <th>Capital ({{ simbolo }})</th>
            <th>Intereses ({{ simbolo }})</th>
            <th>Total ({{ simbolo }})</th>
            <th>Capital</th>
            <th>Intereses</th>
            <th v-if="puedeGestionar"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in datos.lineas" :key="`${l.MES}-${l.FECHA}`" :class="{ vencida: l.ESTADO_CAPITAL === 'Vencido' || l.ESTADO_INTERESES === 'Vencido' }">
            <td>{{ l.MES }}</td>
            <td>{{ fecha(l.FECHA) }}</td>
            <td class="num">{{ numero(l.SALDO) }}</td>
            <td class="num">{{ numero(l.CAPITAL) }}</td>
            <td class="num">{{ numero(l.INTERESES) }}</td>
            <td class="num">{{ numero(l.TOTAL) }}</td>
            <td>
              <button v-if="puedeGestionar && pendiente(l.ESTADO_CAPITAL)" type="button" class="mini" @click="pagar(l, 'capital')">
                Pagar
              </button>
              <span :class="['estado-cuota', String(l.ESTADO_CAPITAL).toLowerCase()]">{{ l.ESTADO_CAPITAL }}</span>
              <small v-if="l.PAGO_CAPITAL">{{ fecha(l.PAGO_CAPITAL) }}</small>
            </td>
            <td>
              <button v-if="puedeGestionar && pendiente(l.ESTADO_INTERESES)" type="button" class="mini" @click="pagar(l, 'intereses')">
                Pagar
              </button>
              <span :class="['estado-cuota', String(l.ESTADO_INTERESES).toLowerCase()]">{{ l.ESTADO_INTERESES }}</span>
              <small v-if="l.PAGO_INTERESES">{{ fecha(l.PAGO_INTERESES) }}</small>
            </td>
            <td v-if="puedeGestionar">
              <button
                v-if="pendiente(l.ESTADO_CAPITAL) || pendiente(l.ESTADO_INTERESES)"
                type="button"
                class="enlace"
                title="Editar cuota"
                @click="editar(l)"
              >
                Editar
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">Total</td>
            <td class="num">{{ numero(totales.capital) }}</td>
            <td class="num">{{ numero(totales.intereses) }}</td>
            <td class="num">{{ numero(totales.total) }}</td>
            <td :colspan="puedeGestionar ? 3 : 2"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <template v-if="datos.asientos?.length">
      <h3 class="subtitulo">Asientos generados por el Aplicativo</h3>
      <div class="tabla">
        <table>
          <thead>
            <tr>
              <th>Asiento</th>
              <th>Tipo</th>
              <th>Cuota</th>
              <th>Fecha contable</th>
              <th>Contabilidad</th>
              <th>Tasa</th>
              <th>Monto Bs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in datos.asientos" :key="String(a.ID)">
              <td>{{ a.ASIENTOVISIBLE }}</td>
              <td>{{ TIPOS_ASIENTO[String(a.TIPO)] ?? a.TIPO }}</td>
              <td>{{ a.MES ?? '' }}</td>
              <td>{{ fecha(a.FECHACONTABLE) }}</td>
              <td>{{ a.BDCONTABLE }}</td>
              <td class="num">{{ numero(a.TASA) }}</td>
              <td class="num">{{ numero(a.MONTOBS) }}</td>
              <td>
                <span v-if="a.REVERSADOPOR" class="estado-cuota pagado">Reversado</span>
                <button v-else-if="puedeGestionar && a.TIPO === 'PAGO'" type="button" class="enlace" @click="reversar(a)">Reversar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>
  <p v-else-if="error" class="error">{{ error }}</p>
</template>

<style scoped>
.resumen {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  margin: 0 0 var(--space-3);
}
.resumen dt {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.resumen dd {
  margin: 0.15rem 0 0;
  font-size: 0.92rem;
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.panel {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  font-size: 0.88rem;
}
.campo {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
}
.campo input {
  text-transform: none;
  font-weight: 400;
  color: var(--text);
}
.campo.ancho input {
  min-width: 22rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
}
.nota {
  font-size: 0.78rem;
  color: var(--text-muted);
  flex-basis: 100%;
}
.acciones {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
}
.subtitulo {
  font-size: 0.9rem;
  margin: var(--space-4) 0 var(--space-2);
}
.montos-bs {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
  flex-basis: 100%;
}
.montos-bs input {
  width: 10rem;
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
  min-width: 18rem;
}
.cargo input[type='number'] {
  width: 9rem;
}
.tabla {
  max-height: 55vh;
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
tr.vencida td {
  background: color-mix(in srgb, var(--color-error) 7%, transparent);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.estado-cuota.vencido {
  color: var(--color-error);
  font-weight: 600;
}
.estado-cuota.pagado {
  color: var(--text-muted);
}
small {
  margin-left: 0.35rem;
  color: var(--text-faint);
}
button.mini {
  height: 1.6rem;
  padding: 0 0.55rem;
  font-size: 0.75rem;
  margin-right: 0.4rem;
}
.peligro {
  color: var(--color-error);
}
button.peligro:not(.secundario) {
  background: var(--color-error);
  color: #fff;
}
.enlace {
  background: none;
  color: var(--color-brand-darker);
  padding: 0;
  height: auto;
  font-size: 0.8rem;
}
.estado {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.88rem;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: girar 0.7s linear infinite;
}
@keyframes girar {
  to {
    transform: rotate(360deg);
  }
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
}
.exito {
  color: var(--color-success, #2f7d32);
  font-size: 0.85rem;
}
</style>
