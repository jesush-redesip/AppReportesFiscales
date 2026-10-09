<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../lib/api';
import { useReporteDownload } from '../composables/useReporteDownload';
import ReportTable from '../components/ReportTable.vue';
import BaseModal from '../components/BaseModal.vue';
import AppIcon from '../components/icons/AppIcon.vue';

/**
 * Pagarés (solo consulta): préstamos bancarios de la empresa documentados con pagarés,
 * registrados en el PHP reportesicg (tablas RIP_PAGARESCAB / RIP_PAGARESLIN). Las
 * columnas de cada vista las define el backend (pagares.service.ts).
 */
type Fila = Record<string, unknown>;
type TipoColumna = 'texto' | 'fecha' | 'monto' | 'entero' | 'tasa';
interface Columna {
  id: string;
  titulo: string;
  tipo: TipoColumna;
  sinTotal?: boolean;
}
interface Resultado {
  columnas: Columna[];
  filas: Fila[];
}
interface Empresa {
  id: string;
  nombre: string;
  series: string[];
  pagares: number;
}
type Vista = 'general' | 'deudas' | 'pagos' | 'consolidado' | 'consolidado-banco';

const BASE = '/api/reportes/pagares';
const PESTANAS: { id: 'general' | 'deudas' | 'pagos' | 'consolidado'; nombre: string }[] = [
  { id: 'general', nombre: 'Del período' },
  { id: 'deudas', nombre: 'Vencidos' },
  { id: 'pagos', nombre: 'Pagos del período' },
  { id: 'consolidado', nombre: 'Consolidado' },
];

function iso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const hoy = new Date();
const filtros = reactive({
  desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
  hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)),
  corte: iso(hoy),
  empresa: '',
  banco: '',
  buscar: '',
});
const pestana = ref<(typeof PESTANAS)[number]['id']>('general');
const porBanco = ref(false);
const empresas = ref<Empresa[]>([]);
const bancos = ref<string[]>([]);
const errorCatalogos = ref('');

onMounted(async () => {
  try {
    const c = await api.get<{ empresas: Empresa[]; bancos: string[] }>(`${BASE}/catalogos`);
    empresas.value = c.empresas;
    bancos.value = c.bancos;
    void consultar();
  } catch (e) {
    errorCatalogos.value = e instanceof Error ? e.message : 'No se pudieron cargar los filtros.';
  }
});

const yyyyMMdd = (isoFecha: string) => isoFecha.replace(/-/g, '');
const ddmmyyyy = (valor: unknown) => (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor) ? valor.slice(0, 10).split('-').reverse().join('/') : valor);

const vista = computed<Vista>(() => (pestana.value === 'consolidado' && porBanco.value ? 'consolidado-banco' : pestana.value));
const usaRango = computed(() => pestana.value === 'general' || pestana.value === 'pagos');
const formularioValido = computed(() => (usaRango.value ? Boolean(filtros.desde && filtros.hasta && filtros.desde <= filtros.hasta) : Boolean(filtros.corte)));

function parametros(): Record<string, string | undefined> {
  const corte = yyyyMMdd(filtros.corte);
  return {
    vista: vista.value,
    // Vencidos usa la fecha de corte; consolidado no depende de fechas (saldos a hoy).
    desde: usaRango.value ? yyyyMMdd(filtros.desde) : corte,
    hasta: usaRango.value ? yyyyMMdd(filtros.hasta) : corte,
    series: filtros.empresa || undefined,
    banco: filtros.banco || undefined,
    buscar: filtros.buscar.trim() || undefined,
  };
}

const resultado = ref<Resultado | null>(null);
const cargando = ref(false);
const error = ref('');
let ultimos: Record<string, string | undefined> | null = null;

async function consultar() {
  if (!formularioValido.value) return;
  ultimos = parametros();
  cargando.value = true;
  error.value = '';
  try {
    resultado.value = await api.get<Resultado>(`${BASE}/consulta`, ultimos);
  } catch (e) {
    resultado.value = null;
    error.value = e instanceof Error ? e.message : 'No se pudo consultar.';
  } finally {
    cargando.value = false;
  }
}

function cambiarPestana(id: (typeof PESTANAS)[number]['id']) {
  pestana.value = id;
  void consultar();
}

/** Props de ReportTable a partir de las columnas que manda el backend. */
function propsTabla(columnas: Columna[], filas: Fila[]) {
  const fechas = columnas.filter((c) => c.tipo === 'fecha').map((c) => c.id);
  return {
    columns: columnas.map((c) => c.id),
    labels: Object.fromEntries(columnas.map((c) => [c.id, c.titulo])),
    textColumns: columnas.filter((c) => c.tipo === 'texto' || c.tipo === 'fecha').map((c) => c.id),
    integerColumns: columnas.filter((c) => c.tipo === 'entero').map((c) => c.id),
    noTotalColumns: columnas.filter((c) => c.sinTotal || c.tipo === 'tasa').map((c) => c.id),
    rows: fechas.length ? filas.map((f) => ({ ...f, ...Object.fromEntries(fechas.map((id) => [id, ddmmyyyy(f[id])])) })) : filas,
  };
}
const tabla = computed(() => (resultado.value ? propsTabla(resultado.value.columnas, resultado.value.filas) : null));
const conDetalle = computed(() => pestana.value === 'general' || pestana.value === 'deudas');

const { loading: descargando, descargar } = useReporteDownload();
const errorDescarga = ref('');
async function descargarExcel() {
  if (!ultimos) return;
  errorDescarga.value = '';
  const nombre = { general: 'Pagares', deudas: 'Pagares vencidos', pagos: 'Pagos de pagares', consolidado: 'Pagares consolidado' }[pestana.value];
  try {
    await descargar(`${BASE}/excel`, ultimos, nombre);
  } catch (e) {
    errorDescarga.value = e instanceof Error ? e.message : 'No se pudo generar el Excel.';
  }
}

// --- Tabla de amortización (ventana) ---
interface Detalle {
  pagare: Fila;
  lineas: Fila[];
  columnas: Columna[];
}
const detalle = ref<{ titulo: string; cod: number; datos: Detalle | null; cargando: boolean; error: string } | null>(null);
const corteDetalle = computed(() => yyyyMMdd(pestana.value === 'deudas' ? filtros.corte : iso(new Date())));

async function abrirDetalle(fila: Fila) {
  if (!conDetalle.value) return;
  const cod = Number(fila.CODPAGARES);
  detalle.value = { titulo: `Pagaré #${fila.PAGARE} · ${fila.BANCO}`, cod, datos: null, cargando: true, error: '' };
  try {
    detalle.value.datos = await api.get<Detalle>(`${BASE}/detalle`, { cod, corte: corteDetalle.value });
  } catch (e) {
    detalle.value.error = e instanceof Error ? e.message : 'No se pudo cargar el pagaré.';
  } finally {
    detalle.value.cargando = false;
  }
}
const tablaDetalle = computed(() => (detalle.value?.datos ? propsTabla(detalle.value.datos.columnas, detalle.value.datos.lineas) : null));
const numero = (v: unknown, dec = 2) => Number(v ?? 0).toLocaleString('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: dec });

async function descargarDetalle() {
  if (!detalle.value) return;
  try {
    await descargar(`${BASE}/detalle/excel`, { cod: detalle.value.cod, corte: corteDetalle.value }, `Pagare ${detalle.value.datos?.pagare.PAGARE ?? ''}`.trim());
  } catch (e) {
    detalle.value.error = e instanceof Error ? e.message : 'No se pudo generar el Excel.';
  }
}
</script>

<template>
  <section>
    <h1>Pagarés</h1>
    <p class="ayuda">
      Préstamos bancarios de la empresa documentados con pagarés: cuotas del período, lo vencido sin pagar y la deuda por
      banco. Haga clic en un pagaré para ver su tabla de amortización.
    </p>

    <div class="pestanas" role="tablist">
      <button
        v-for="t in PESTANAS"
        :key="t.id"
        type="button"
        role="tab"
        :aria-selected="pestana === t.id"
        :class="{ activa: pestana === t.id }"
        @click="cambiarPestana(t.id)"
      >
        {{ t.nombre }}
      </button>
    </div>

    <form class="card filtros" @submit.prevent="consultar">
      <div class="fila-filtros">
        <template v-if="usaRango">
          <label class="campo">
            Desde
            <input v-model="filtros.desde" type="date" required />
          </label>
          <label class="campo">
            Hasta
            <input v-model="filtros.hasta" type="date" required />
          </label>
        </template>
        <label v-else-if="pestana === 'deudas'" class="campo">
          Vencido al
          <input v-model="filtros.corte" type="date" required />
        </label>
        <label class="campo">
          Empresa
          <select v-model="filtros.empresa">
            <option value="">Todas</option>
            <option v-for="e in empresas" :key="e.id" :value="e.id">{{ e.nombre }} ({{ e.series.join(', ') }})</option>
          </select>
        </label>
        <label class="campo">
          Banco
          <select v-model="filtros.banco">
            <option value="">Todos</option>
            <option v-for="b in bancos" :key="b" :value="b">{{ b }}</option>
          </select>
        </label>
        <label v-if="pestana !== 'consolidado' && pestana !== 'pagos'" class="campo">
          N.º pagaré
          <input v-model="filtros.buscar" type="search" maxlength="40" placeholder="Buscar" />
        </label>
        <label v-if="pestana === 'consolidado'" class="campo">
          Agrupar
          <select v-model="porBanco">
            <option :value="false">Empresa y banco</option>
            <option :value="true">Solo banco</option>
          </select>
        </label>
        <button type="submit" :disabled="!formularioValido || cargando">
          <AppIcon name="table" :size="15" />
          Consultar
        </button>
        <button type="button" class="secundario" :disabled="!resultado || descargando" @click="descargarExcel">
          <AppIcon name="download" :size="15" />
          Excel
        </button>
      </div>
      <p v-if="errorCatalogos" class="error">{{ errorCatalogos }}</p>
      <p v-if="usaRango && filtros.desde > filtros.hasta" class="error">La fecha "desde" es posterior a "hasta".</p>
      <p v-if="errorDescarga" class="error">{{ errorDescarga }}</p>
    </form>

    <p v-if="cargando" class="estado"><span class="spinner" aria-hidden="true"></span> Consultando…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else-if="tabla">
      <p v-if="!tabla.rows.length" class="estado">No hay pagarés para los filtros seleccionados.</p>
      <ReportTable
        v-else
        :columns="tabla.columns"
        :rows="tabla.rows"
        :labels="tabla.labels"
        :text-columns="tabla.textColumns"
        :integer-columns="tabla.integerColumns"
        :no-total-columns="tabla.noTotalColumns"
        :clicable="conDetalle"
        @seleccionar="abrirDetalle"
      />
    </template>

    <BaseModal :open="!!detalle" :title="detalle?.titulo ?? ''" ancho="min(1200px, 95vw)" @close="detalle = null">
      <p v-if="detalle?.cargando" class="estado"><span class="spinner" aria-hidden="true"></span> Cargando…</p>
      <p v-else-if="detalle?.error" class="error">{{ detalle.error }}</p>
      <template v-else-if="detalle?.datos && tablaDetalle">
        <dl class="resumen">
          <div><dt>Empresa</dt><dd>{{ detalle.datos.pagare.EMPRESA }}</dd></div>
          <div><dt>Liquidación</dt><dd>{{ ddmmyyyy(detalle.datos.pagare.FECHA) }}</dd></div>
          <div><dt>Monto</dt><dd>{{ numero(detalle.datos.pagare.MONTO) }}</dd></div>
          <div><dt>Tasa anual</dt><dd>{{ numero(detalle.datos.pagare.TASA) }} %</dd></div>
          <div><dt>Plazo</dt><dd>{{ detalle.datos.pagare.PLAZO }} meses</dd></div>
          <div><dt>Capital</dt><dd>{{ detalle.datos.pagare.FRECUENCIA || '—' }}</dd></div>
          <div><dt>Intereses</dt><dd>{{ detalle.datos.pagare.FRECUENCIA_INTERESES || '—' }}</dd></div>
          <div class="acciones-detalle">
            <button type="button" class="secundario" :disabled="descargando" @click="descargarDetalle">
              <AppIcon name="download" :size="15" />
              Excel
            </button>
          </div>
        </dl>
        <ReportTable
          :columns="tablaDetalle.columns"
          :rows="tablaDetalle.rows"
          :labels="tablaDetalle.labels"
          :text-columns="tablaDetalle.textColumns"
          :integer-columns="tablaDetalle.integerColumns"
          :no-total-columns="tablaDetalle.noTotalColumns"
        />
      </template>
    </BaseModal>
  </section>
</template>

<style scoped>
.ayuda {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0 0 var(--space-4);
}
.pestanas {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}
.pestanas button {
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  height: 2.2rem;
  padding: 0 1rem;
  font-size: 0.88rem;
  border-bottom: 2px solid transparent;
}
.pestanas button.activa {
  color: var(--color-brand-darker);
  border-bottom-color: var(--color-brand-darker);
  font-weight: 700;
}
.filtros {
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-4);
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
.fila-filtros > button {
  height: 2.35rem;
  padding: 0 1rem;
}
.estado {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.88rem;
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin: var(--space-3) 0 0;
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
.resumen {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2) var(--space-5);
  margin: 0 0 var(--space-4);
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
.acciones-detalle {
  margin-left: auto;
}
</style>
