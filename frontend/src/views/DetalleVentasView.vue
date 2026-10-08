<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../lib/api';
import { useCatalogosStore } from '../stores/catalogos.store';
import ReportTable from '../components/ReportTable.vue';
import GraficaBarras from '../components/GraficaBarras.vue';
import BaseModal from '../components/BaseModal.vue';
import AppIcon from '../components/icons/AppIcon.vue';

/**
 * Detalle de Ventas (venía del PHP reportesicg): ventas por tienda → por día → tickets
 * del día → líneas del ticket. Cada nivel usa los mismos filtros y el mismo cálculo, así
 * que los totales de un nivel son la suma del siguiente.
 */
type Fila = Record<string, unknown>;
interface Opcion {
  id: number;
  descripcion: string;
}
interface Resultado {
  filas: Fila[];
  totales: Fila;
}

const catalogosBase = useCatalogosStore();

// --- Filtros ---
function iso(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const hoy = new Date();
const filtros = reactive({
  desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
  hasta: iso(hoy),
  moneda: '' as number | '',
  grupo: '',
  promocion: '' as number | '',
  dpto: '' as number | '',
  seccion: '' as number | '',
  familia: '' as number | '',
  subfamilia: '' as number | '',
  marca: '' as number | '',
  linea: '' as number | '',
});
const referencias = ref<{ referencia: string; descripcion: string }[]>([]);

const catalogo = reactive({
  grupos: [] as { serie: string; descripcion: string }[],
  promociones: [] as Opcion[],
  departamentos: [] as Opcion[],
  marcas: [] as Opcion[],
  secciones: [] as Opcion[],
  familias: [] as Opcion[],
  subfamilias: [] as Opcion[],
  lineas: [] as Opcion[],
});
const filtrosArticuloAbiertos = ref(false);
const errorCatalogos = ref('');

const BASE = '/api/reportes/detalle-ventas';

onMounted(async () => {
  try {
    await catalogosBase.loadBase();
    const principal = catalogosBase.monedas.find((m) => m.principal) ?? catalogosBase.monedas[0];
    if (principal && filtros.moneda === '') filtros.moneda = principal.codMoneda;
    const c = await api.get<typeof catalogo>(`${BASE}/catalogos`);
    catalogo.grupos = c.grupos;
    catalogo.promociones = c.promociones;
    catalogo.departamentos = c.departamentos;
    catalogo.marcas = c.marcas;
  } catch (e) {
    errorCatalogos.value = e instanceof Error ? e.message : 'No se pudieron cargar los filtros.';
  }
});

async function cargarNivel(nivel: 'seccion' | 'familia' | 'subfamilia' | 'linea') {
  return api.get<Opcion[]>(`${BASE}/clasificacion`, {
    nivel,
    dpto: filtros.dpto === '' ? undefined : filtros.dpto,
    seccion: filtros.seccion === '' ? undefined : filtros.seccion,
    familia: filtros.familia === '' ? undefined : filtros.familia,
    marca: filtros.marca === '' ? undefined : filtros.marca,
  });
}
// Cada nivel de la clasificación depende del anterior: al cambiar uno se limpian los de abajo.
watch(
  () => filtros.dpto,
  async () => {
    filtros.seccion = '';
    catalogo.secciones = filtros.dpto === '' ? [] : await cargarNivel('seccion');
  },
);
watch(
  () => filtros.seccion,
  async () => {
    filtros.familia = '';
    catalogo.familias = filtros.seccion === '' ? [] : await cargarNivel('familia');
  },
);
watch(
  () => filtros.familia,
  async () => {
    filtros.subfamilia = '';
    catalogo.subfamilias = filtros.familia === '' ? [] : await cargarNivel('subfamilia');
  },
);
watch(
  () => filtros.marca,
  async () => {
    filtros.linea = '';
    catalogo.lineas = filtros.marca === '' ? [] : await cargarNivel('linea');
  },
);

// Buscador de artículos (por referencia o descripción).
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
      sugerencias.value = await api.get(`${BASE}/articulos`, { q: texto.trim() });
    } catch {
      sugerencias.value = [];
    }
  }, 300);
});
function agregarReferencia(a: { referencia: string; descripcion: string }) {
  if (!referencias.value.some((r) => r.referencia === a.referencia)) referencias.value.push(a);
  busqueda.value = '';
  sugerencias.value = [];
}
function quitarReferencia(ref: string) {
  referencias.value = referencias.value.filter((r) => r.referencia !== ref);
}

const filtrosArticuloActivos = computed(
  () =>
    referencias.value.length +
    [filtros.dpto, filtros.marca].filter((v) => v !== '').length,
);

const yyyyMMdd = (isoFecha: string) => isoFecha.replace(/-/g, '');
const ddmmyyyy = (isoFecha: string) => isoFecha.split('-').reverse().join('/');

function parametros(): Record<string, string | number | undefined> {
  const v = (x: number | '') => (x === '' ? undefined : x);
  return {
    desde: yyyyMMdd(filtros.desde),
    hasta: yyyyMMdd(filtros.hasta),
    moneda: v(filtros.moneda),
    grupo: filtros.grupo || undefined,
    promocion: v(filtros.promocion),
    refs: referencias.value.length ? referencias.value.map((r) => r.referencia).join(',') : undefined,
    dpto: v(filtros.dpto),
    seccion: v(filtros.seccion),
    familia: v(filtros.familia),
    subfamilia: v(filtros.subfamilia),
    marca: v(filtros.marca),
    linea: v(filtros.linea),
  };
}

// --- Niveles ---
type Nivel = { tipo: 'tiendas' } | { tipo: 'dias'; tienda: string; nombre: string } | { tipo: 'tickets'; tienda: string; nombre: string; fecha: string };
const nivel = ref<Nivel>({ tipo: 'tiendas' });
const resultado = ref<Resultado | null>(null);
const cargando = ref(false);
const error = ref('');
const vista = ref<'tabla' | 'grafica'>('tabla');
/** Parámetros con que se hizo la última consulta (la navegación entre niveles los reutiliza). */
let ultimos: Record<string, string | number | undefined> | null = null;

const formularioValido = computed(() => Boolean(filtros.desde && filtros.hasta && filtros.moneda !== '' && filtros.desde <= filtros.hasta));
const monedaActual = computed(() => catalogosBase.monedas.find((m) => m.codMoneda === (ultimos?.moneda ?? filtros.moneda)));

async function consultar() {
  if (!formularioValido.value) return;
  ultimos = parametros();
  nivel.value = { tipo: 'tiendas' };
  await cargar();
}

async function cargar() {
  if (!ultimos) return;
  cargando.value = true;
  error.value = '';
  try {
    const n = nivel.value;
    const extra = n.tipo === 'dias' ? { tienda: n.tienda } : n.tipo === 'tickets' ? { tienda: n.tienda, fecha: yyyyMMdd(n.fecha) } : {};
    const ruta = { tiendas: 'tiendas', dias: 'dias', tickets: 'tickets' }[n.tipo];
    resultado.value = await api.get<Resultado>(`${BASE}/${ruta}`, { ...ultimos, ...extra });
  } catch (e) {
    resultado.value = null;
    error.value = e instanceof Error ? e.message : 'No se pudo consultar.';
  } finally {
    cargando.value = false;
  }
}

function irA(n: Nivel) {
  nivel.value = n;
  if (n.tipo === 'tickets') vista.value = 'tabla';
  void cargar();
}

function seleccionar(fila: Fila) {
  const n = nivel.value;
  if (n.tipo === 'tiendas') irA({ tipo: 'dias', tienda: String(fila.TIENDA), nombre: String(fila.DESCRIPCION) });
  else if (n.tipo === 'dias') irA({ tipo: 'tickets', tienda: n.tienda, nombre: n.nombre, fecha: String(fila._fecha) });
  else void abrirTicket(fila);
}

// --- Tabla de cada nivel ---
const METRICAS = ['MONTO', 'IVA', 'IGTF', 'TOTAL', 'COSTO', 'BENEFICIO', 'MARGEN', 'UNIDADES', 'TICKETS', 'PROMEDIO', 'UPF', 'MONTO_UNIDAD'];
const columnas = computed(() => {
  const n = nivel.value.tipo;
  if (n === 'tiendas') return ['DESCRIPCION', ...METRICAS];
  if (n === 'dias') return ['FECHA', ...METRICAS];
  return ['HORA', 'CAJA', 'TIPO', 'DOCUMENTO', 'NFISCAL', 'ZFISCAL', 'FACAFECTA', 'MONTO', 'IVA', 'IGTF', 'TOTAL', 'COSTO', 'BENEFICIO', 'MARGEN', 'UNIDADES'];
});
const filas = computed(() =>
  (resultado.value?.filas ?? []).map((f) => (nivel.value.tipo === 'dias' ? { ...f, _fecha: f.FECHA, FECHA: ddmmyyyy(String(f.FECHA)) } : f)),
);
const ETIQUETAS: Record<string, string> = {
  DESCRIPCION: 'Tienda',
  FECHA: 'Fecha',
  MONTO: 'Monto (sin IVA)',
  IVA: 'IVA',
  IGTF: 'IGTF',
  TOTAL: 'Total',
  COSTO: 'Costo',
  BENEFICIO: 'Beneficio',
  MARGEN: 'Margen %',
  UNIDADES: 'Unidades',
  TICKETS: 'Tickets',
  PROMEDIO: 'Ticket promedio',
  UPF: 'Unid. por ticket',
  MONTO_UNIDAD: 'Monto por unidad',
  HORA: 'Hora',
  CAJA: 'Caja',
  TIPO: 'Tipo',
  DOCUMENTO: 'Documento',
  NFISCAL: 'N.º fiscal',
  ZFISCAL: 'Z',
  FACAFECTA: 'Factura afectada',
  CAJERO: 'Cajero',
  VENDEDOR: 'Vendedor',
  REFPROVEEDOR: 'Referencia',
  TALLA: 'Talla',
  COLOR: 'Color',
  PRECIO: 'Precio',
  DTO_LINEA: 'Dto. línea %',
  DTO_FACTURA: 'Dto. factura %',
};
const TEXTO = ['DOCUMENTO', 'NFISCAL', 'ZFISCAL', 'CAJA', 'HORA', 'FACAFECTA', 'REFPROVEEDOR', 'TALLA', 'COLOR'];

// --- Gráfica ---
const METRICAS_GRAFICA: { id: string; nombre: string; formato: 'moneda' | 'entero' | 'porcentaje' }[] = [
  { id: 'MONTO', nombre: 'Monto (sin IVA)', formato: 'moneda' },
  { id: 'TOTAL', nombre: 'Total', formato: 'moneda' },
  { id: 'BENEFICIO', nombre: 'Beneficio', formato: 'moneda' },
  { id: 'MARGEN', nombre: 'Margen %', formato: 'porcentaje' },
  { id: 'COSTO', nombre: 'Costo', formato: 'moneda' },
  { id: 'TICKETS', nombre: 'Tickets', formato: 'entero' },
  { id: 'UNIDADES', nombre: 'Unidades', formato: 'entero' },
  { id: 'PROMEDIO', nombre: 'Ticket promedio', formato: 'moneda' },
];
const metricaGrafica = ref('MONTO');
const formatoGrafica = computed(() => METRICAS_GRAFICA.find((m) => m.id === metricaGrafica.value)?.formato ?? 'moneda');
const datosGrafica = computed(() =>
  filas.value.map((f) => ({
    etiqueta: String(nivel.value.tipo === 'tiendas' ? f.DESCRIPCION : f.FECHA),
    valor: f[metricaGrafica.value] == null ? null : Number(f[metricaGrafica.value]),
  })),
);

// --- Líneas del ticket (ventana) ---
const ticket = ref<{ titulo: string; resultado: Resultado | null; cargando: boolean; error: string } | null>(null);
const COLUMNAS_LINEAS = ['CAJERO', 'VENDEDOR', 'REFPROVEEDOR', 'DESCRIPCION', 'TALLA', 'COLOR', 'UNIDADES', 'PRECIO', 'DTO_LINEA', 'DTO_FACTURA', 'MONTO', 'IVA', 'COSTO', 'BENEFICIO', 'MARGEN'];
const ETIQUETAS_LINEAS = { ...ETIQUETAS, DESCRIPCION: 'Artículo' };
async function abrirTicket(fila: Fila) {
  ticket.value = { titulo: `${fila.TIPO} ${fila.DOCUMENTO} · ${fila.HORA ?? ''}`, resultado: null, cargando: true, error: '' };
  try {
    ticket.value.resultado = await api.get<Resultado>(`${BASE}/lineas`, {
      ...ultimos,
      numSerie: String(fila.NUMSERIE),
      numAlbaran: Number(fila.NUMALBARAN),
      n: String(fila.N),
    });
  } catch (e) {
    ticket.value.error = e instanceof Error ? e.message : 'No se pudo cargar el ticket.';
  } finally {
    ticket.value.cargando = false;
  }
}
</script>

<template>
  <section>
    <h1>Detalle de Ventas</h1>
    <p class="ayuda">
      Ventas por tienda, día y ticket. Haga clic en una fila (o en una barra de la gráfica) para ver el detalle.
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
        <label class="campo">
          Grupo de empresas
          <select v-model="filtros.grupo">
            <option value="">Todos</option>
            <option v-for="g in catalogo.grupos" :key="g.serie" :value="g.serie">{{ g.descripcion }} ({{ g.serie }})</option>
          </select>
        </label>
        <label class="campo">
          Promoción
          <select v-model="filtros.promocion" :disabled="!catalogo.promociones.length">
            <option value="">{{ catalogo.promociones.length ? 'Todas' : 'Sin promociones' }}</option>
            <option v-for="p in catalogo.promociones" :key="p.id" :value="p.id">{{ p.descripcion }}</option>
          </select>
        </label>
        <button type="submit" :disabled="!formularioValido || cargando">
          <AppIcon name="table" :size="15" />
          Consultar
        </button>
      </div>

      <button type="button" class="enlace-filtros" :aria-expanded="filtrosArticuloAbiertos" @click="filtrosArticuloAbiertos = !filtrosArticuloAbiertos">
        {{ filtrosArticuloAbiertos ? '▾' : '▸' }} Filtros por artículo
        <span v-if="filtrosArticuloActivos" class="badge">{{ filtrosArticuloActivos }}</span>
      </button>
      <div v-if="filtrosArticuloAbiertos" class="filtros-articulo">
        <div class="campo referencias">
          Artículos (referencia o descripción)
          <div class="buscador">
            <input v-model="busqueda" type="text" placeholder="Escriba al menos 2 letras…" autocomplete="off" />
            <ul v-if="sugerencias.length" class="sugerencias">
              <li v-for="s in sugerencias" :key="s.referencia">
                <button type="button" @click="agregarReferencia(s)">
                  <strong>{{ s.referencia }}</strong> {{ s.descripcion }}
                </button>
              </li>
            </ul>
          </div>
          <div v-if="referencias.length" class="chips">
            <span v-for="r in referencias" :key="r.referencia" class="chip" :title="r.descripcion">
              {{ r.referencia }}
              <button type="button" :aria-label="`Quitar ${r.referencia}`" @click="quitarReferencia(r.referencia)">×</button>
            </span>
          </div>
        </div>
        <div class="fila-filtros">
          <label class="campo">
            Departamento
            <select v-model="filtros.dpto">
              <option value="">Todos</option>
              <option v-for="o in catalogo.departamentos" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
            </select>
          </label>
          <label class="campo">
            Sección
            <select v-model="filtros.seccion" :disabled="filtros.dpto === ''">
              <option value="">Todas</option>
              <option v-for="o in catalogo.secciones" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
            </select>
          </label>
          <label class="campo">
            Familia
            <select v-model="filtros.familia" :disabled="filtros.seccion === ''">
              <option value="">Todas</option>
              <option v-for="o in catalogo.familias" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
            </select>
          </label>
          <label class="campo">
            Subfamilia
            <select v-model="filtros.subfamilia" :disabled="filtros.familia === ''">
              <option value="">Todas</option>
              <option v-for="o in catalogo.subfamilias" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
            </select>
          </label>
          <label class="campo">
            Marca
            <select v-model="filtros.marca" :disabled="!catalogo.marcas.length">
              <option value="">{{ catalogo.marcas.length ? 'Todas' : 'Sin marcas' }}</option>
              <option v-for="o in catalogo.marcas" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
            </select>
          </label>
          <label class="campo">
            Línea
            <select v-model="filtros.linea" :disabled="filtros.marca === ''">
              <option value="">Todas</option>
              <option v-for="o in catalogo.lineas" :key="o.id" :value="o.id">{{ o.descripcion }}</option>
            </select>
          </label>
        </div>
      </div>
      <p v-if="errorCatalogos" class="error">{{ errorCatalogos }}</p>
      <p v-if="filtros.desde > filtros.hasta" class="error">La fecha "desde" es posterior a "hasta".</p>
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
              :class="{ actual: nivel.tipo === 'dias' }"
              @click="irA({ tipo: 'dias', tienda: nivel.tienda, nombre: nivel.nombre })"
            >
              {{ nivel.nombre }}
            </button>
          </template>
          <template v-if="nivel.tipo === 'tickets'">
            <AppIcon name="chevron-right" :size="13" />
            <span class="miga actual">{{ ddmmyyyy(nivel.fecha) }}</span>
          </template>
        </nav>
        <span class="moneda-nota">Importes en {{ monedaActual?.descripcion?.trim() ?? '' }}</span>
        <div v-if="nivel.tipo !== 'tickets'" class="vista-toggle" role="tablist">
          <button type="button" role="tab" :aria-selected="vista === 'tabla'" :class="{ activa: vista === 'tabla' }" @click="vista = 'tabla'">Tabla</button>
          <button type="button" role="tab" :aria-selected="vista === 'grafica'" :class="{ activa: vista === 'grafica' }" @click="vista = 'grafica'">Gráfica</button>
        </div>
      </div>

      <p v-if="cargando" class="estado"><span class="spinner" aria-hidden="true"></span> Consultando…</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <template v-else-if="resultado">
        <div v-if="vista === 'grafica' && nivel.tipo !== 'tickets'" class="card panel-grafica">
          <label class="campo metrica">
            Mostrar
            <select v-model="metricaGrafica">
              <option v-for="m in METRICAS_GRAFICA" :key="m.id" :value="m.id">{{ m.nombre }}</option>
            </select>
          </label>
          <p v-if="!datosGrafica.length" class="estado">No hay datos para los filtros seleccionados.</p>
          <GraficaBarras v-else :datos="datosGrafica" :formato="formatoGrafica" clicable @seleccionar="(i) => seleccionar(filas[i])" />
        </div>
        <ReportTable
          v-else
          :columns="columnas"
          :rows="filas"
          :labels="ETIQUETAS"
          :text-columns="TEXTO"
          :integer-columns="['TICKETS']"
          :totales-fijos="resultado.totales"
          clicable
          @seleccionar="seleccionar"
        />
      </template>
    </template>

    <BaseModal :open="!!ticket" :title="ticket?.titulo ?? ''" ancho="min(1200px, 95vw)" @close="ticket = null">
      <p v-if="ticket?.cargando" class="estado"><span class="spinner" aria-hidden="true"></span> Cargando…</p>
      <p v-else-if="ticket?.error" class="error">{{ ticket.error }}</p>
      <ReportTable
        v-else-if="ticket?.resultado"
        :columns="COLUMNAS_LINEAS"
        :rows="ticket.resultado.filas"
        :labels="ETIQUETAS_LINEAS"
        :text-columns="TEXTO"
        :no-total-columns="['PRECIO', 'DTO_LINEA', 'DTO_FACTURA']"
        :totales-fijos="ticket.resultado.totales"
      />
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
</style>
