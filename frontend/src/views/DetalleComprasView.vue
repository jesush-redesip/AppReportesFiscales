<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../lib/api';
import { useCatalogosStore } from '../stores/catalogos.store';
import { useAuthStore } from '../stores/auth.store';
import { monedaInicial, recordarMoneda } from '../lib/monedaReporte';
import ReportTable from '../components/ReportTable.vue';
import GraficaBarras from '../components/GraficaBarras.vue';
import BaseModal from '../components/BaseModal.vue';
import AppIcon from '../components/icons/AppIcon.vue';
import FiltrosArticulo from '../components/filtros/FiltrosArticulo.vue';
import { filtrosArticuloVacios, parametrosArticulo, type Opcion } from '../lib/filtrosArticulo';

/**
 * Detalle de Compras: compras por tienda → proveedor → documento → artículos. Montos
 * fiscales como el Libro de Compra (rip.MR_DETALLE_COMPRAS); cada nivel suma lo mismo que
 * el siguiente. Las líneas de artículos son informativas.
 */
type Fila = Record<string, unknown>;
interface Resultado {
  filas: Fila[];
  totales: Fila;
}
interface TipoDocumento {
  id: number;
  descripcion: string;
  documentos: number;
  porDefecto: boolean;
}

const catalogosBase = useCatalogosStore();
const auth = useAuthStore();

function iso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const hoy = new Date();
const filtros = reactive({
  desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
  hasta: iso(hoy),
  moneda: '' as number | '',
});
const articulo = ref(filtrosArticuloVacios());
const tipos = ref<TipoDocumento[]>([]);
const tiposElegidos = ref<number[]>([]);
const tiposAbiertos = ref(false);
const catalogo = reactive({ departamentos: [] as Opcion[], marcas: [] as Opcion[] });
const errorCatalogos = ref('');

const BASE = '/api/reportes/detalle-compras';

onMounted(async () => {
  try {
    await catalogosBase.loadBase();
    const c = await api.get<{ tipos: TipoDocumento[]; departamentos: Opcion[]; marcas: Opcion[]; monedaDefecto: number | null }>(`${BASE}/catalogos`);
    filtros.moneda = monedaInicial(auth.empresa?.codEmpresa, catalogosBase.monedas, c.monedaDefecto);
    tipos.value = c.tipos;
    tiposElegidos.value = c.tipos.filter((t) => t.porDefecto).map((t) => t.id);
    catalogo.departamentos = c.departamentos;
    catalogo.marcas = c.marcas;
  } catch (e) {
    errorCatalogos.value = e instanceof Error ? e.message : 'No se pudieron cargar los filtros.';
  }
});

const resumenTipos = computed(() => {
  const n = tiposElegidos.value.length;
  if (!tipos.value.length) return 'Todos';
  if (n === tipos.value.length) return 'Todos';
  if (n === 0) return 'Ninguno';
  return `${n} de ${tipos.value.length}`;
});

const yyyyMMdd = (isoFecha: string) => isoFecha.replace(/-/g, '');
const ddmmyyyy = (isoFecha: string) => isoFecha.split('-').reverse().join('/');

function parametros(): Record<string, string | number | undefined> {
  return {
    desde: yyyyMMdd(filtros.desde),
    hasta: yyyyMMdd(filtros.hasta),
    moneda: filtros.moneda === '' ? undefined : filtros.moneda,
    // Todos marcados = sin filtro (incluye tipos que aparezcan después).
    tipos: tiposElegidos.value.length && tiposElegidos.value.length < tipos.value.length ? tiposElegidos.value.join(',') : undefined,
    ...parametrosArticulo(articulo.value),
  };
}

// --- Niveles ---
type Nivel =
  | { tipo: 'tiendas' }
  | { tipo: 'proveedores'; tienda: string; nombre: string }
  | { tipo: 'documentos'; tienda: string; nombre: string; proveedor: number; proveedorNombre: string };
const nivel = ref<Nivel>({ tipo: 'tiendas' });
const resultado = ref<Resultado | null>(null);
const cargando = ref(false);
const error = ref('');
const vista = ref<'tabla' | 'grafica'>('tabla');
let ultimos: Record<string, string | number | undefined> | null = null;

const formularioValido = computed(
  () => Boolean(filtros.desde && filtros.hasta && filtros.moneda !== '' && filtros.desde <= filtros.hasta) && (tiposElegidos.value.length > 0 || !tipos.value.length),
);
const monedaActual = computed(() => catalogosBase.monedas.find((m) => m.codMoneda === (ultimos?.moneda ?? filtros.moneda)));

async function consultar() {
  if (!formularioValido.value) return;
  tiposAbiertos.value = false;
  ultimos = parametros();
  recordarMoneda(auth.empresa?.codEmpresa, filtros.moneda);
  nivel.value = { tipo: 'tiendas' };
  await cargar();
}

async function cargar() {
  if (!ultimos) return;
  cargando.value = true;
  error.value = '';
  try {
    const n = nivel.value;
    const extra =
      n.tipo === 'proveedores' ? { tienda: n.tienda } : n.tipo === 'documentos' ? { tienda: n.tienda, proveedor: n.proveedor } : {};
    resultado.value = await api.get<Resultado>(`${BASE}/${n.tipo}`, { ...ultimos, ...extra });
  } catch (e) {
    resultado.value = null;
    error.value = e instanceof Error ? e.message : 'No se pudo consultar.';
  } finally {
    cargando.value = false;
  }
}

function irA(n: Nivel) {
  nivel.value = n;
  if (n.tipo === 'documentos') vista.value = 'tabla';
  void cargar();
}

function seleccionar(fila: Fila) {
  const n = nivel.value;
  if (n.tipo === 'tiendas') irA({ tipo: 'proveedores', tienda: String(fila.TIENDA), nombre: String(fila.DESCRIPCION) });
  else if (n.tipo === 'proveedores')
    irA({ tipo: 'documentos', tienda: n.tienda, nombre: n.nombre, proveedor: Number(fila.CODPROVEEDOR), proveedorNombre: String(fila.PROVEEDOR) });
  else void abrirDocumento(fila);
}

const MONTOS = ['EXENTO', 'BASE', 'IVA', 'TOTAL', 'IGTF', 'RETENIDO'];
const columnas = computed(() => {
  const n = nivel.value.tipo;
  if (n === 'tiendas') return ['DESCRIPCION', 'DOCUMENTOS', 'PROVEEDORES', ...MONTOS];
  if (n === 'proveedores') return ['PROVEEDOR', 'RIF', 'DOCUMENTOS', ...MONTOS];
  return ['FECHA', 'TIPO', 'NUMFAC', 'NUMCONTROL', 'COMPROBANTE', ...MONTOS];
});
const filas = computed(() =>
  (resultado.value?.filas ?? []).map((f) => (nivel.value.tipo === 'documentos' ? { ...f, FECHA: ddmmyyyy(String(f.FECHA)) } : f)),
);
const ETIQUETAS: Record<string, string> = {
  DESCRIPCION: 'Tienda',
  DOCUMENTOS: 'Documentos',
  PROVEEDORES: 'Proveedores',
  PROVEEDOR: 'Proveedor',
  RIF: 'RIF',
  FECHA: 'Fecha factura',
  TIPO: 'Tipo',
  NUMFAC: 'N.º factura',
  NUMCONTROL: 'N.º control',
  COMPROBANTE: 'Comprobante retención',
  EXENTO: 'Exento',
  BASE: 'Base imponible',
  IVA: 'IVA',
  TOTAL: 'Total con IVA',
  IGTF: 'IGTF',
  RETENIDO: 'IVA retenido',
  REFPROVEEDOR: 'Referencia',
  ALMACEN: 'Almacén',
  TALLA: 'Talla',
  COLOR: 'Color',
  UNIDADES: 'Unidades',
  PRECIO: 'Precio',
  DTO_LINEA: 'Dto. línea %',
  DTO_DOCUMENTO: 'Dto. documento %',
  PORC_IVA: '% IVA',
  COSTO_UNITARIO: 'Costo unitario',
};
const TEXTO = ['RIF', 'NUMFAC', 'NUMCONTROL', 'COMPROBANTE', 'REFPROVEEDOR', 'ALMACEN', 'TALLA', 'COLOR'];

const METRICAS_GRAFICA = [
  { id: 'TOTAL', nombre: 'Total con IVA' },
  { id: 'BASE', nombre: 'Base imponible' },
  { id: 'EXENTO', nombre: 'Exento' },
  { id: 'IVA', nombre: 'IVA' },
  { id: 'RETENIDO', nombre: 'IVA retenido' },
  { id: 'DOCUMENTOS', nombre: 'Documentos' },
];
const metricaGrafica = ref('TOTAL');
const datosGrafica = computed(() =>
  filas.value.map((f) => ({
    etiqueta: String(nivel.value.tipo === 'tiendas' ? f.DESCRIPCION : f.PROVEEDOR),
    valor: f[metricaGrafica.value] == null ? null : Number(f[metricaGrafica.value]),
  })),
);

// --- Artículos del documento (ventana) ---
const documento = ref<{ titulo: string; resultado: Resultado | null; cargando: boolean; error: string } | null>(null);
const COLUMNAS_LINEAS = ['REFPROVEEDOR', 'DESCRIPCION', 'TALLA', 'COLOR', 'ALMACEN', 'UNIDADES', 'PRECIO', 'DTO_LINEA', 'DTO_DOCUMENTO', 'BASE', 'PORC_IVA', 'IVA', 'TOTAL', 'COSTO_UNITARIO'];
const ETIQUETAS_LINEAS = { ...ETIQUETAS, DESCRIPCION: 'Artículo', BASE: 'Base', TOTAL: 'Total' };
async function abrirDocumento(fila: Fila) {
  documento.value = { titulo: `${fila.TIPO} ${fila.NUMFAC || ''} · ${fila.FECHA}`, resultado: null, cargando: true, error: '' };
  try {
    documento.value.resultado = await api.get<Resultado>(`${BASE}/lineas`, {
      ...ultimos,
      numSerie: String(fila.NUMSERIE),
      numFactura: Number(fila.NUMFACTURA),
      n: String(fila.N),
    });
  } catch (e) {
    documento.value.error = e instanceof Error ? e.message : 'No se pudo cargar el documento.';
  } finally {
    documento.value.cargando = false;
  }
}
</script>

<template>
  <section>
    <h1>Detalle de Compras</h1>
    <p class="ayuda">
      Compras por tienda, proveedor y documento, con los montos del Libro de Compra. Haga clic en una fila (o en una barra
      de la gráfica) para ver el detalle.
    </p>

    <form class="card filtros" @submit.prevent="consultar">
      <div class="fila-filtros">
        <label class="campo">
          Desde
          <input v-model="filtros.desde" type="date" required />
        </label>
        <label class="campo">
          Hasta
          <input v-model="filtros.hasta" type="date" required />
        </label>
        <label class="campo">
          Moneda
          <select v-model="filtros.moneda" required>
            <option v-for="m in catalogosBase.monedas" :key="m.codMoneda" :value="m.codMoneda">{{ m.descripcion.trim() }}</option>
          </select>
        </label>
        <div class="campo tipos">
          Tipos de documento
          <button type="button" class="secundario selector-tipos" :aria-expanded="tiposAbiertos" @click="tiposAbiertos = !tiposAbiertos">
            {{ resumenTipos }} <span aria-hidden="true">▾</span>
          </button>
          <div v-if="tiposAbiertos" class="lista-tipos">
            <label v-for="t in tipos" :key="t.id" class="check">
              <input v-model="tiposElegidos" type="checkbox" :value="t.id" />
              {{ t.descripcion }} <span class="cuenta">({{ t.documentos }})</span>
            </label>
            <div class="acciones-tipos">
              <button type="button" class="enlace" @click="tiposElegidos = tipos.map((t) => t.id)">todos</button>
              <button type="button" class="enlace" @click="tiposElegidos = tipos.filter((t) => t.porDefecto).map((t) => t.id)">
                como el Libro
              </button>
            </div>
          </div>
        </div>
        <button type="submit" :disabled="!formularioValido || cargando">
          <AppIcon name="table" :size="15" />
          Consultar
        </button>
      </div>

      <FiltrosArticulo v-model="articulo" :base="BASE" :departamentos="catalogo.departamentos" :marcas="catalogo.marcas" />
      <p v-if="articulo.referencias.length || articulo.dpto !== '' || articulo.marca !== ''" class="nota">
        Con filtros por artículo se muestran los documentos que traen esos artículos, con sus montos completos.
      </p>
      <p v-if="errorCatalogos" class="error">{{ errorCatalogos }}</p>
      <p v-if="filtros.desde > filtros.hasta" class="error">La fecha "desde" es posterior a "hasta".</p>
      <p v-if="tipos.length && !tiposElegidos.length" class="error">Elija al menos un tipo de documento.</p>
    </form>

    <template v-if="ultimos">
      <div class="barra-nivel">
        <nav class="migas" aria-label="Nivel del detalle">
          <button type="button" class="miga" :class="{ actual: nivel.tipo === 'tiendas' }" @click="irA({ tipo: 'tiendas' })">Tiendas</button>
          <template v-if="nivel.tipo !== 'tiendas'">
            <AppIcon name="chevron-right" :size="13" />
            <button
              type="button"
              class="miga"
              :class="{ actual: nivel.tipo === 'proveedores' }"
              @click="irA({ tipo: 'proveedores', tienda: nivel.tienda, nombre: nivel.nombre })"
            >
              {{ nivel.nombre }}
            </button>
          </template>
          <template v-if="nivel.tipo === 'documentos'">
            <AppIcon name="chevron-right" :size="13" />
            <span class="miga actual">{{ nivel.proveedorNombre }}</span>
          </template>
        </nav>
        <span class="moneda-nota">Importes en {{ monedaActual?.descripcion?.trim() ?? '' }}</span>
        <div v-if="nivel.tipo !== 'documentos'" class="vista-toggle" role="tablist">
          <button type="button" role="tab" :aria-selected="vista === 'tabla'" :class="{ activa: vista === 'tabla' }" @click="vista = 'tabla'">Tabla</button>
          <button type="button" role="tab" :aria-selected="vista === 'grafica'" :class="{ activa: vista === 'grafica' }" @click="vista = 'grafica'">Gráfica</button>
        </div>
      </div>

      <p v-if="cargando" class="estado"><span class="spinner" aria-hidden="true"></span> Consultando…</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else-if="resultado">
        <div v-if="vista === 'grafica' && nivel.tipo !== 'documentos'" class="card panel-grafica">
          <label class="campo metrica">
            Mostrar
            <select v-model="metricaGrafica">
              <option v-for="m in METRICAS_GRAFICA" :key="m.id" :value="m.id">{{ m.nombre }}</option>
            </select>
          </label>
          <p v-if="!datosGrafica.length" class="estado">No hay datos para los filtros seleccionados.</p>
          <GraficaBarras
            v-else
            :datos="datosGrafica"
            :formato="metricaGrafica === 'DOCUMENTOS' ? 'entero' : 'moneda'"
            clicable
            @seleccionar="(i) => seleccionar(filas[i])"
          />
        </div>
        <ReportTable
          v-else
          :columns="columnas"
          :rows="filas"
          :labels="ETIQUETAS"
          :text-columns="TEXTO"
          :integer-columns="['DOCUMENTOS', 'PROVEEDORES']"
          :totales-fijos="resultado.totales"
          clicable
          @seleccionar="seleccionar"
        />
      </template>
    </template>

    <BaseModal :open="!!documento" :title="documento?.titulo ?? ''" ancho="min(1200px, 95vw)" @close="documento = null">
      <p v-if="documento?.cargando" class="estado"><span class="spinner" aria-hidden="true"></span> Cargando…</p>
      <p v-else-if="documento?.error" class="error">{{ documento.error }}</p>
      <template v-else-if="documento?.resultado">
        <p v-if="!documento.resultado.filas.length" class="estado">Este documento no tiene artículos (por ejemplo, un gasto).</p>
        <template v-else>
          <p class="nota">
            Artículos de los albaranes del documento. Son informativos: con precios con IVA incluido, exentos o gastos, pueden
            no sumar igual que los montos fiscales.
          </p>
          <ReportTable
            :columns="COLUMNAS_LINEAS"
            :rows="documento.resultado.filas"
            :labels="ETIQUETAS_LINEAS"
            :text-columns="TEXTO"
            :no-total-columns="['PRECIO', 'DTO_LINEA', 'DTO_DOCUMENTO', 'PORC_IVA', 'COSTO_UNITARIO']"
            :totales-fijos="documento.resultado.totales"
          />
        </template>
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
.barra-nivel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.migas {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text-faint);
}
.miga {
  background: none;
  height: auto;
  padding: 0.2rem 0.3rem;
  color: var(--color-brand-darker);
  font-weight: 600;
  font-size: 0.9rem;
}
.miga:hover:not(:disabled) {
  background: var(--bg-subtle);
}
.miga.actual {
  color: var(--text);
  font-weight: 700;
  font-size: 0.9rem;
}
.moneda-nota {
  font-size: 0.78rem;
  color: var(--text-muted);
}
.vista-toggle {
  margin-left: auto;
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.vista-toggle button {
  background: transparent;
  color: var(--text-muted);
  border-radius: 0;
  height: 2rem;
  padding: 0 0.9rem;
  font-size: 0.82rem;
}
.vista-toggle button.activa {
  background: var(--color-brand-bg-strong);
  color: var(--color-brand-darker);
}
.panel-grafica {
  padding: var(--space-4);
}
.metrica {
  margin-bottom: var(--space-3);
  max-width: 14rem;
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
.nota {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: var(--space-2) 0 0;
}
.tipos {
  position: relative;
}
.selector-tipos {
  height: 2.35rem;
  min-width: 10rem;
  justify-content: space-between;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  color: var(--text);
}
.lista-tipos {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  min-width: 17rem;
  padding: var(--space-3);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text);
  cursor: pointer;
}
.cuenta {
  color: var(--text-faint);
  font-size: 0.75rem;
}
.acciones-tipos {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}
.enlace {
  background: none;
  color: var(--color-brand-darker);
  padding: 0;
  height: auto;
  font-size: 0.78rem;
  text-transform: none;
  letter-spacing: 0;
}
.enlace:hover:not(:disabled) {
  background: none;
  text-decoration: underline;
}
</style>
