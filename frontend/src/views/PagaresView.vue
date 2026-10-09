<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../lib/api';
import { useReporteDownload } from '../composables/useReporteDownload';
import ReportTable from '../components/ReportTable.vue';
import BaseModal from '../components/BaseModal.vue';
import AppIcon from '../components/icons/AppIcon.vue';
import DetallePagare from '../components/pagares/DetallePagare.vue';
import RegistrarPagare from '../components/pagares/RegistrarPagare.vue';
import { useAuthStore } from '../stores/auth.store';
import { PERMISO_PAGARES_GESTION } from '../lib/reportes';

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

// --- Tabla de amortización (ventana) y gestión ---
const auth = useAuthStore();
const puedeGestionar = computed(() => auth.modulos.includes(PERMISO_PAGARES_GESTION));
const detalle = ref<{ titulo: string; cod: number } | null>(null);
const corteDetalle = computed(() => yyyyMMdd(pestana.value === 'deudas' ? filtros.corte : iso(new Date())));
const huboCambios = ref(false);

function abrirDetalle(fila: Fila) {
  if (!conDetalle.value) return;
  huboCambios.value = false;
  detalle.value = { titulo: `Pagaré #${fila.PAGARE} · ${fila.BANCO}`, cod: Number(fila.CODPAGARES) };
}
function cerrarDetalle() {
  detalle.value = null;
  if (huboCambios.value) void consultar();
}
function anulado() {
  detalle.value = null;
  avisoRegistro.value = 'Pagaré anulado.';
  void consultar();
}

const registrando = ref(false);
const avisoRegistro = ref('');
async function registrado(r: { codPagares: number; aviso: string | null }) {
  registrando.value = false;
  avisoRegistro.value = r.aviso ? `Pagaré registrado. ${r.aviso}` : 'Pagaré registrado.';
  // Los catálogos pueden traer un banco o empresa nuevos.
  try {
    const c = await api.get<{ empresas: Empresa[]; bancos: string[] }>(`${BASE}/catalogos`);
    empresas.value = c.empresas;
    bancos.value = c.bancos;
  } catch {
    /* la consulta siguiente mostrará el error si lo hay */
  }
  void consultar();
}
</script>

<template>
  <section>
    <h1>Pagarés</h1>
    <p class="ayuda">
      Préstamos bancarios de la empresa documentados con pagarés: cuotas del período, lo vencido sin pagar y la deuda por
      banco. Haga clic en un pagaré para ver su tabla de amortización.
    </p>

    <div v-if="puedeGestionar" class="barra-gestion">
      <button type="button" @click="(registrando = true), (avisoRegistro = '')">+ Registrar pagaré</button>
      <span v-if="avisoRegistro" class="exito">{{ avisoRegistro }}</span>
    </div>

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

    <BaseModal :open="!!detalle" :title="detalle?.titulo ?? ''" ancho="min(1250px, 96vw)" @close="cerrarDetalle">
      <DetallePagare
        v-if="detalle"
        :key="detalle.cod"
        :cod="detalle.cod"
        :corte="corteDetalle"
        :puede-gestionar="puedeGestionar"
        @cambio="huboCambios = true"
        @anulado="anulado"
      />
    </BaseModal>
    <RegistrarPagare v-if="registrando" @cerrar="registrando = false" @guardado="registrado" />
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
.barra-gestion {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}
.exito {
  color: var(--color-success, #2f7d32);
  font-size: 0.85rem;
}
</style>
