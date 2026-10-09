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
  | { tipo: 'pagar'; fila: Fila; que: 'capital' | 'intereses'; fechaContable: string }
  | { tipo: 'editar'; fila: Fila; fecha: string; capital: number; intereses: number; ajustarIntereses: boolean }
  | { tipo: 'tasa'; tasa: number }
  | { tipo: 'anular'; motivo: string };
const accion = ref<Accion | null>(null);
const trabajando = ref(false);

function pagar(fila: Fila, que: 'capital' | 'intereses') {
  mensaje.value = '';
  accion.value = { tipo: 'pagar', fila, que, fechaContable: hoyIso() };
}
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
      await api.post(`${BASE}/cuotas/pagar`, {
        cod: props.cod,
        mes: Number(a.fila.MES),
        fecha: String(a.fila.FECHA).slice(0, 10),
        tipo: a.que,
        fechaContable: a.fechaContable,
      });
      mensaje.value = `Cuota ${a.fila.MES}: ${a.que} marcado como pagado.`;
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
      <div><dt>Monto</dt><dd>{{ numero(datos.pagare.MONTO) }}</dd></div>
      <div><dt>Tasa anual</dt><dd>{{ numero(datos.pagare.TASA) }} %</dd></div>
      <div><dt>Plazo</dt><dd>{{ datos.pagare.PLAZO }} meses</dd></div>
      <div><dt>Capital</dt><dd>{{ datos.pagare.FRECUENCIA || '—' }}</dd></div>
      <div><dt>Intereses</dt><dd>{{ datos.pagare.FRECUENCIA_INTERESES || '—' }}</dd></div>
    </dl>
    <div class="barra">
      <button type="button" class="secundario" :disabled="descargando" @click="excel"><AppIcon name="download" :size="15" /> Excel</button>
      <template v-if="puedeGestionar">
        <button type="button" class="secundario" @click="accion = { tipo: 'tasa', tasa: Number(datos.pagare.TASA) }">Cambiar tasa</button>
        <button type="button" class="secundario peligro" @click="accion = { tipo: 'anular', motivo: '' }">Anular pagaré</button>
      </template>
    </div>

    <form v-if="accion" class="panel" @submit.prevent="ejecutar">
      <template v-if="accion.tipo === 'pagar'">
        <span>
          Marcar como pagado el <strong>{{ accion.que }}</strong> de la cuota {{ accion.fila.MES }} ({{ fecha(accion.fila.FECHA) }}):
          {{ numero(accion.que === 'capital' ? accion.fila.CAPITAL : accion.fila.INTERESES) }}
        </span>
        <label class="campo">Fecha contable <input v-model="accion.fechaContable" type="date" required /></label>
        <span class="nota">No genera asiento: contabilícelo en el PHP o en ICG.</span>
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
        <span class="nota">Solo si no tiene pagos. No borra nada: deja de verse en el Aplicativo (en el PHP sigue apareciendo).</span>
      </template>
      <div class="acciones">
        <button type="button" class="secundario" @click="accion = null">Cancelar</button>
        <button type="submit" :class="{ peligro: accion.tipo === 'anular' }" :disabled="trabajando">
          {{ trabajando ? 'Guardando…' : accion.tipo === 'anular' ? 'Anular' : 'Confirmar' }}
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
            <th>Saldo</th>
            <th>Capital</th>
            <th>Intereses</th>
            <th>Total</th>
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
