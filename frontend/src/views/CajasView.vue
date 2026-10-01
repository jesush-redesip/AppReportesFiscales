<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watchEffect } from 'vue';
import { useCajas } from '../composables/useCajas';
import { useAuthStore } from '../stores/auth.store';
import { useDebugStore, type DiagnosticoGrupo } from '../stores/debug.store';
import type { CierreCajaLinea, FormaPagoDisponible, ResultadoContabilizar, Tienda } from '../lib/types';
import BaseModal from '../components/BaseModal.vue';
import AppIcon from '../components/icons/AppIcon.vue';

const cajas = useCajas();
// Instancia propia para la cotización: su error (o su spinner) no debe mezclarse con
// el del cierre. (La pestaña Depósitos se quitó de esta pantalla; sus rutas siguen en
// el backend.)
const cajasCotizacion = useCajas();
const auth = useAuthStore();

const tiendas = ref<Tienda[]>([]);
const serie = ref('');
const fecha = ref(''); // yyyy-MM-dd (input nativo)
const cierre = ref<CierreCajaLinea[]>([]);

function toYyyyMMdd(v: string) {
  return v.replaceAll('-', '');
}

/**
 * Descripción con el ISO de la moneda entre paréntesis. Algunas versiones de
 * `RIP_DIFERENCIAFRONT_WEB` ya devuelven la descripción con el código incluido
 * ("EFECTIVO USD (USD)") y otras no ("EFECTIVO USD"), así que solo se agrega cuando
 * falta — si no, quedaría duplicado.
 */
function descripcionConMoneda(l: CierreCajaLinea): string {
  if (!l.moneda || /\([^()]*\)\s*$/.test(l.descripcion)) return l.descripcion;
  return `${l.descripcion} (${l.moneda})`;
}

onMounted(async () => {
  tiendas.value = (await cajas.cargarTiendas()) ?? [];
});

// --- Calculadora de conversión (rip.PROC_GETCOTIZACION) ---
// Igual que el legacy: aparece al elegir tienda y fecha, y arranca consultando por 1
// para mostrar la tasa del día; el SP devuelve la conversión en los dos sentidos.
const importeCotizacion = ref<number | ''>(1);
const mensajesCotizacion = ref<string[]>([]);

async function calcularCotizacion() {
  if (!fecha.value || importeCotizacion.value === '') return;
  mensajesCotizacion.value =
    (await cajasCotizacion.cargarCotizacion(toYyyyMMdd(fecha.value), Number(importeCotizacion.value))) ?? [];
}

async function cargar() {
  if (!serie.value || !fecha.value) return;
  const f = toYyyyMMdd(fecha.value);
  cierre.value = (await cajas.cargarCierre(serie.value, f)) ?? [];
  await calcularCotizacion();
}

interface GrupoCierre {
  serieCaja: string;
  caja: string;
  z: number;
  cerrado: string;
  contabilizado: boolean;
  lineas: CierreCajaLinea[];
  totalImporte: number;
  totalDeclarado: number;
  totalDiferencia: number;
}

const grupos = computed<GrupoCierre[]>(() => {
  const mapa = new Map<string, GrupoCierre>();
  for (const l of cierre.value) {
    const key = `${l.serieCaja}-${l.z}`;
    let g = mapa.get(key);
    if (!g) {
      g = {
        serieCaja: l.serieCaja,
        caja: l.caja,
        z: l.z,
        cerrado: l.cerrado,
        contabilizado: l.contabilizado,
        lineas: [],
        totalImporte: 0,
        totalDeclarado: 0,
        totalDiferencia: 0,
      };
      mapa.set(key, g);
    }
    g.lineas.push(l);
    g.totalImporte += l.importe;
    g.totalDeclarado += l.declarado;
    g.totalDiferencia += l.diferencia;
  }
  return [...mapa.values()];
});

// --- Editar declarado (solo si el grupo aún no está contabilizado y el usuario
// tiene permiso CONTABILIZAR — mismo gate que usaba el lápiz de edición legacy) ---
function puedeEditarDeclarado(g: GrupoCierre) {
  return !g.contabilizado && auth.permisos.contabilizar;
}

async function onDeclaradoChange(g: GrupoCierre, linea: CierreCajaLinea, valor: number) {
  if (linea.codTipoPago == null) return;
  const ok = await cajas.guardarDeclarado({
    z: g.z,
    codTipoPago: linea.codTipoPago,
    caja: g.serieCaja,
    fecha: toYyyyMMdd(fecha.value),
    nuevo: valor,
  });
  if (ok?.ok) await cargar();
}

async function onEliminarFormaPago(g: GrupoCierre, linea: CierreCajaLinea) {
  if (!confirm(`¿Eliminar la forma de pago "${linea.descripcion}" de ${g.caja}?`)) return;
  const ok = await cajas.eliminarFormaPago({ caja: g.serieCaja, z: g.z, forma: linea.codFormaPago });
  if (ok?.ok) await cargar();
}

// --- Modal: Agregar forma de pago ---
const formaPagoModalAbierto = ref(false);
const formaPagoGrupo = ref<GrupoCierre | null>(null);
const formasDisponibles = ref<FormaPagoDisponible[]>([]);
const formaPagoSeleccionada = ref<number | ''>('');
const montoFormaPago = ref<number | ''>('');

async function abrirAgregarFormaPago(g: GrupoCierre) {
  formaPagoGrupo.value = g;
  formaPagoSeleccionada.value = '';
  montoFormaPago.value = '';
  formasDisponibles.value = (await cajas.cargarFormasPagoDisponibles(g.serieCaja, g.z)) ?? [];
  formaPagoModalAbierto.value = true;
}

async function confirmarAgregarFormaPago() {
  if (!formaPagoGrupo.value || formaPagoSeleccionada.value === '' || montoFormaPago.value === '') return;
  const ok = await cajas.guardarFormaPago({
    caja: formaPagoGrupo.value.serieCaja,
    z: formaPagoGrupo.value.z,
    forma: String(formaPagoSeleccionada.value),
    monto: Number(montoFormaPago.value),
  });
  if (ok?.ok) {
    formaPagoModalAbierto.value = false;
    await cargar();
  }
}

// --- Modal: Ver asiento ---
const asientoModalAbierto = ref(false);
const asientoGrupoCierre = ref<GrupoCierre | null>(null);
/** Caja/Z cuyo asiento se está consultando: su botón muestra el spinner mientras tanto. */
const asientoCargando = ref<string | null>(null);
const claveGrupo = (g: GrupoCierre) => `${g.serieCaja}-${g.z}`;
const asientoPreview = reactive({ lineas: [] as { cuenta: string; titulo: string; comentario: string; debe: number; haber: number }[], totalDebe: 0, totalHaber: 0, cuadrado: false, contabilizado: false, incluyeCostoVenta: true });

async function abrirAsientoCierre(g: GrupoCierre) {
  if (asientoCargando.value) return; // ya hay una consulta en curso
  asientoCargando.value = claveGrupo(g);
  try {
    asientoGrupoCierre.value = g;
    const preview = await cajas.cargarAsiento('1', serie.value, g.serieCaja, toYyyyMMdd(fecha.value), g.z);
    if (preview) {
      Object.assign(asientoPreview, preview);
      asientoModalAbierto.value = true;
    }
  } finally {
    asientoCargando.value = null;
  }
}

/** Un cierre ya contabilizado no se vuelve a contabilizar: el modal solo muestra el asiento. */
const asientoYaContabilizado = computed(() => asientoGrupoCierre.value?.contabilizado === true);

// --- Diagnóstico para el panel de debug: mismas condiciones que el template ---
const debug = useDebugStore();

function permiso(nombre: 'CONTABILIZAR' | 'DESCONTABILIZAR', tiene: boolean) {
  return `permiso ${nombre} = ${tiene ? 'sí' : 'no'}`;
}

const diagnosticoCajas = computed<DiagnosticoGrupo[]>(() => {
  const cont = auth.permisos.contabilizar;
  const descont = auth.permisos.descontabilizar;
  return grupos.value.map((g) => {
    const estado = g.contabilizado ? 'cierre contabilizado' : 'cierre sin contabilizar';
    const previewDeEste = asientoGrupoCierre.value === g;
    const cuadrado = previewDeEste
      ? asientoPreview.cuadrado
        ? 'asiento cuadrado'
        : `asiento NO cuadra (debe ${asientoPreview.totalDebe.toFixed(2)} / haber ${asientoPreview.totalHaber.toFixed(2)})`
      : 'cuadre: abre "Ver Asiento" para evaluarlo';
    const puedeContabilizar = cont && !g.contabilizado && (!previewDeEste || asientoPreview.cuadrado);
    return {
      titulo: `${g.caja} — Z ${g.z} (${estado})`,
      acciones: [
        { accion: 'Ver Asiento', disponible: true, motivo: 'siempre visible' },
        {
          accion: 'Contabilizar',
          disponible: puedeContabilizar,
          motivo: `${permiso('CONTABILIZAR', cont)}; ${estado}; ${cuadrado}`,
        },
        {
          accion: 'Contabilizar Compras',
          disponible: puedeContabilizar && asientoPreview.incluyeCostoVenta !== false,
          motivo: `${permiso('CONTABILIZAR', cont)}; ${estado}; ${cuadrado}; costo de venta ${asientoPreview.incluyeCostoVenta === false ? 'desactivado en Configuración' : 'activado'}`,
        },
        {
          accion: 'Descontabilizar',
          disponible: g.contabilizado && descont,
          motivo: `${permiso('DESCONTABILIZAR', descont)}; ${estado}`,
        },
        {
          accion: 'Traspasar Facturas',
          disponible: !(g.contabilizado && descont),
          motivo: 'se muestra en lugar de Descontabilizar cuando éste no aplica',
        },
        {
          accion: 'Agregar Forma de Pago / Modificar declarado',
          disponible: puedeEditarDeclarado(g),
          motivo: `${permiso('CONTABILIZAR', cont)}; ${estado}`,
        },
        {
          accion: 'Eliminar forma de pago',
          disponible: !g.contabilizado && g.lineas.some((l) => l.importe === 0),
          motivo: `solo líneas con importe 0 en un cierre sin contabilizar (${g.lineas.filter((l) => l.importe === 0).length} línea(s))`,
        },
      ],
    };
  });
});

watchEffect(() => {
  if (debug.activo) debug.publicarDiagnostico('Cierre de Caja', diagnosticoCajas.value);
});
onUnmounted(() => debug.quitarDiagnostico('Cierre de Caja'));

// --- Ventana de resultado al contabilizar ---
interface ResultadoAsiento {
  ok: boolean;
  titulo: string;
  datos: { etiqueta: string; valor: string }[];
  nota: string;
}
const resultadoAsiento = ref<ResultadoAsiento | null>(null);

function fechaLegible(yyyyMmDd: string) {
  const [a, m, d] = yyyyMmDd.split('-');
  return a && m && d ? `${d}/${m}/${a}` : yyyyMmDd;
}

/** El listado arma la caja como "Caja 1 (CAJERO)": respaldo si el backend no trae el resumen. */
function separarCaja(texto: string): { caja: string; cajero: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(texto);
  return m ? { caja: m[1], cajero: m[2] } : { caja: texto, cajero: '' };
}

type Dato = { etiqueta: string; valor: string };

/**
 * Muestra el resultado de contabilizar. Antes, si la base rechazaba la operación no se
 * veía nada: el modal del asiento quedaba abierto sin ningún aviso.
 */
function mostrarResultado(r: ResultadoContabilizar | null | undefined, tipo: string, datos: Dato[]) {
  const ok = r?.status === 'SUCCESS';
  const asiento: Dato[] = ok
    ? [
        ...(r?.asiento != null ? [{ etiqueta: 'Asiento', valor: String(r.asiento) }] : []),
        ...(r?.asientoVisible != null ? [{ etiqueta: 'Asiento visible', valor: String(r.asientoVisible) }] : []),
      ]
    : [];
  const procesado: Dato[] = ok && r?.procesadoPor ? [{ etiqueta: 'Procesado por', valor: r.procesadoPor }] : [];
  resultadoAsiento.value = {
    ok,
    titulo: ok ? 'Asiento registrado correctamente' : 'No se pudo registrar el asiento',
    datos: [...asiento, { etiqueta: 'Tipo', valor: tipo }, ...datos, ...procesado],
    nota: ok
      ? ''
      : [
          'La base de datos rechazó la operación y no se registró nada.',
          r?.mensaje || cajas.error.value || 'Revise el asiento e intente de nuevo.',
        ].join(' '),
  };
}

async function accionContabilizarCierre(tipo: '1' | '3') {
  const g = asientoGrupoCierre.value;
  if (!g) return;
  const r = await cajas.contabilizar({ tipo, serie: serie.value, serieCaja: g.serieCaja, fecha: toYyyyMMdd(fecha.value), z: g.z });
  const respaldo = separarCaja(g.caja);
  const res = r?.resumen;
  mostrarResultado(r, tipo === '1' ? 'Cierre de caja' : 'Compras (costo de venta)', [
    { etiqueta: 'Caja', valor: res?.caja || respaldo.caja },
    { etiqueta: 'Cajero', valor: res?.cajero || respaldo.cajero || '—' },
    { etiqueta: 'Z', valor: String(res?.z ?? g.z) },
    { etiqueta: 'Fecha', valor: fechaLegible(fecha.value) },
    ...(res
      ? [
          { etiqueta: 'Facturas', valor: String(res.facturas) },
          { etiqueta: 'Notas de crédito', valor: String(res.notasCredito) },
        ]
      : []),
  ]);
  if (r?.status === 'SUCCESS') {
    asientoModalAbierto.value = false;
    await cargar();
  }
}

async function accionDescontabilizarCierre(g: GrupoCierre) {
  if (!confirm(`¿Descontabilizar el cierre de ${g.caja}? Esto revierte el asiento contable.`)) return;
  const r = await cajas.descontabilizar({ serie: serie.value, serieCaja: g.serieCaja, fecha: toYyyyMMdd(fecha.value), z: g.z });
  if (r?.status === 'SUCCESS') await cargar();
  else if (r?.status === 'ERRORCONCILIACION') alert('No se puede descontabilizar: el asiento ya está conciliado.');
}

async function accionTraspasar(g: GrupoCierre) {
  const r = await cajas.traspasar(g.serieCaja, g.z);
  if (r?.ok) await cargar();
}
</script>

<template>
  <div class="cajas-view">
    <h1>Cierre de Caja</h1>

    <div class="filtro card">
      <div class="campo">
        <label>Tienda</label>
        <select v-model="serie" @change="cargar">
          <option value="" disabled>Seleccionar...</option>
          <option v-for="t in tiendas" :key="t.serie" :value="t.serie">{{ t.descripcion }}</option>
        </select>
      </div>
      <div class="campo">
        <label>Fecha</label>
        <input v-model="fecha" type="date" @change="cargar" />
      </div>

      <div v-if="serie && fecha" class="cotizacion">
        <label>Cotización</label>
        <div class="cotizacion-fila">
          <input
            v-model="importeCotizacion"
            type="number"
            step="0.01"
            placeholder="Valor"
            @keyup.enter="calcularCotizacion"
          />
          <button type="button" class="secundario" :disabled="cajasCotizacion.loading.value" @click="calcularCotizacion">
            {{ cajasCotizacion.loading.value ? '...' : 'Calcular' }}
          </button>
        </div>
        <ul v-if="mensajesCotizacion.length" class="cotizacion-resultado">
          <li v-for="(m, i) in mensajesCotizacion" :key="i">{{ m }}</li>
        </ul>
        <p v-else-if="cajasCotizacion.error.value" class="error pequeno">{{ cajasCotizacion.error.value }}</p>
      </div>
    </div>

    <p v-if="cajas.error.value" class="error">{{ cajas.error.value }}</p>
    <p v-if="cajas.loading.value && !asientoCargando" class="estado">Cargando...</p>

    <div>
      <p v-if="!cajas.loading.value && grupos.length === 0" class="estado">Sin resultados para esta tienda/fecha.</p>
      <div v-for="g in grupos" :key="`${g.serieCaja}-${g.z}`" class="grupo card">
        <header class="grupo-header">
          <h2>{{ g.caja }} — Z {{ g.z }}</h2>
          <div class="acciones">
            <button
              type="button"
              class="secundario boton-ver-asiento"
              :disabled="asientoCargando !== null"
              :aria-busy="asientoCargando === claveGrupo(g)"
              @click="abrirAsientoCierre(g)"
            >
              <span v-if="asientoCargando === claveGrupo(g)" class="spinner" aria-hidden="true"></span>
              {{ asientoCargando === claveGrupo(g) ? 'Cargando asiento...' : 'Ver Asiento' }}
            </button>
            <button
              v-if="g.contabilizado && auth.permisos.descontabilizar"
              type="button"
              class="secundario"
              @click="accionDescontabilizarCierre(g)"
            >
              Descontabilizar
            </button>
            <button v-else type="button" class="secundario" @click="accionTraspasar(g)">Traspasar Facturas</button>
            <button v-if="puedeEditarDeclarado(g)" type="button" class="secundario" @click="abrirAgregarFormaPago(g)">
              Agregar Forma de Pago
            </button>
          </div>
        </header>
        <table class="tabla-cierre">
          <thead>
            <tr>
              <th>Descripción</th>
              <th>Importe</th>
              <th>Declarado</th>
              <th>Diferencia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in g.lineas" :key="l.codFormaPago">
              <td>{{ descripcionConMoneda(l) }}</td>
              <!-- El equivalente en moneda local se muestra al pasar el mouse, igual
                   que en el aplicativo anterior: el valor lo calcula la propia función
                   de cierre (IMPORTE_LOCAL / DECLARADO_LOCAL), no se recalcula acá. -->
              <td align="right" class="con-tooltip">
                <span v-if="l.importeLocal" class="tooltip-bs">{{ l.importeLocal }}</span>
                {{ l.importe.toFixed(2) }}
              </td>
              <td align="right" class="con-tooltip">
                <span v-if="l.declaradoLocal" class="tooltip-bs">{{ l.declaradoLocal }}</span>
                <input
                  v-if="puedeEditarDeclarado(g)"
                  type="number"
                  step="0.01"
                  :value="l.declarado"
                  class="input-declarado"
                  @change="onDeclaradoChange(g, l, Number(($event.target as HTMLInputElement).value))"
                />
                <span v-else>{{ l.declarado.toFixed(2) }}</span>
              </td>
              <td align="right" :class="{ danger: l.diferencia !== 0 }">{{ l.diferencia.toFixed(2) }}</td>
              <td>
                <button
                  v-if="!g.contabilizado && l.importe === 0"
                  type="button"
                  class="secundario pequeno"
                  @click="onEliminarFormaPago(g, l)"
                >
                  <AppIcon name="close" :size="12" />
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td><b>Total</b></td>
              <td align="right"><b>{{ g.totalImporte.toFixed(2) }}</b></td>
              <td align="right"><b>{{ g.totalDeclarado.toFixed(2) }}</b></td>
              <td align="right"><b>{{ g.totalDiferencia.toFixed(2) }}</b></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Más ancho y menos alto que el modal por defecto: cada línea del asiento cabe en
         una sola fila (comentarios como "CIERRE DE CAJA 2 DEL 06/09/2026 TDC TER 2 …"). -->
    <BaseModal
      :open="asientoModalAbierto"
      title="Asiento"
      ancho="1200px"
      alto-max="70vh"
      @close="asientoModalAbierto = false"
    >
      <p v-if="asientoYaContabilizado" class="aviso-contabilizado">
        <AppIcon name="check" :size="14" /> Este cierre ya está contabilizado: el asiento se muestra solo como consulta.
      </p>
      <table class="tabla-asiento">
        <thead>
          <tr>
            <th>Cuenta</th>
            <th>Título</th>
            <th>Comentario</th>
            <th>Debe</th>
            <th>Haber</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in asientoPreview.lineas" :key="i">
            <td>{{ l.cuenta }}</td>
            <td>{{ l.titulo }}</td>
            <td>{{ l.comentario }}</td>
            <td align="right">{{ l.debe.toFixed(2) }}</td>
            <td align="right">{{ l.haber.toFixed(2) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3"><b>Total</b></td>
            <td align="right"><b>{{ asientoPreview.totalDebe.toFixed(2) }}</b></td>
            <td align="right"><b>{{ asientoPreview.totalHaber.toFixed(2) }}</b></td>
          </tr>
        </tfoot>
      </table>
      <template #footer>
        <template v-if="auth.permisos.contabilizar && asientoPreview.cuadrado && !asientoYaContabilizado">
          <button
            v-if="asientoPreview.incluyeCostoVenta !== false"
            type="button"
            class="secundario"
            @click="accionContabilizarCierre('3')"
          >
            Contabilizar Compras
          </button>
          <button type="button" @click="accionContabilizarCierre('1')">Contabilizar</button>
        </template>
      </template>
    </BaseModal>

    <BaseModal :open="formaPagoModalAbierto" title="Agregar Forma de Pago" @close="formaPagoModalAbierto = false">
      <div class="campo">
        <label>Descripción</label>
        <select v-model="formaPagoSeleccionada">
          <option value="" disabled>Seleccionar...</option>
          <option v-for="f in formasDisponibles" :key="f.codTipoPago" :value="f.codTipoPago">{{ f.descripcion }}</option>
        </select>
      </div>
      <div class="campo">
        <label>Monto Declarado</label>
        <input v-model="montoFormaPago" type="number" step="0.01" />
      </div>
      <template #footer>
        <button type="button" class="secundario" @click="formaPagoModalAbierto = false">Cancelar</button>
        <button type="button" :disabled="formaPagoSeleccionada === '' || montoFormaPago === ''" @click="confirmarAgregarFormaPago">
          Guardar
        </button>
      </template>
    </BaseModal>

    <!-- Resultado de contabilizar (cierre o compras). -->
    <BaseModal
      :open="resultadoAsiento !== null"
      :title="resultadoAsiento?.ok ? 'Contabilización' : 'Contabilización fallida'"
      ancho="440px"
      @close="resultadoAsiento = null"
    >
      <div v-if="resultadoAsiento" class="resultado-asiento" :class="{ fallo: !resultadoAsiento.ok }" role="status">
        <span class="resultado-icono" aria-hidden="true">
          <AppIcon :name="resultadoAsiento.ok ? 'check' : 'close'" :size="26" />
        </span>
        <p class="resultado-titulo">{{ resultadoAsiento.titulo }}</p>
        <dl class="resultado-datos">
          <template v-for="d in resultadoAsiento.datos" :key="d.etiqueta">
            <dt>{{ d.etiqueta }}</dt>
            <dd>{{ d.valor }}</dd>
          </template>
        </dl>
        <p v-if="resultadoAsiento.nota" class="resultado-nota">{{ resultadoAsiento.nota }}</p>
      </div>
      <template #footer>
        <button type="button" @click="resultadoAsiento = null">Aceptar</button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.cajas-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
/* Barra de filtros + cotización fija: al recorrer varias cajas/Z hacia abajo, la
   tienda, la fecha y la calculadora siguen accesibles sin volver arriba. El ancestro
   con scroll es `.app-content`, así que sticky se ancla a él. */
.filtro {
  display: flex;
  gap: var(--space-4);
  align-items: flex-end;
  padding: var(--space-5);
  position: sticky;
  top: calc(var(--space-6) * -1);
  z-index: 20;
  background: var(--bg-elevated);
}
.campo {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 10rem;
}
.campo label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
/* La calculadora se separa a la derecha del filtro, como en el aplicativo original. */
.cotizacion {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 14rem;
}
.cotizacion > label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.cotizacion-fila {
  display: flex;
  gap: var(--space-2);
}
.cotizacion-fila input {
  width: 7rem;
}
.cotizacion-resultado {
  list-style: none;
  margin: 0.15rem 0 0;
  padding: 0;
  font-size: 0.8rem;
  color: var(--text);
  font-weight: 600;
}
.cotizacion-resultado li {
  padding: 0.05rem 0;
}
.error {
  color: var(--color-error);
}
.error.pequeno {
  font-size: 0.78rem;
  margin: 0.15rem 0 0;
}
.estado {
  color: var(--text-muted);
}
.grupo {
  padding: var(--space-5);
}
.grupo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
  gap: var(--space-2);
}
.grupo-header h2 {
  margin: 0;
}
.acciones {
  display: flex;
  gap: var(--space-2);
}
.tabla-cierre,
.tabla-asiento {
  width: 100%;
  border-collapse: collapse;
}
.tabla-cierre th,
.tabla-cierre td,
.tabla-asiento th,
.tabla-asiento td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  text-align: left;
}
/* Asiento: todo en una línea. Si no cabe, el cuerpo del modal (overflow auto) hace
   scroll horizontal, y la cabecera queda fija al hacer scroll vertical. */
.tabla-asiento th,
.tabla-asiento td {
  white-space: nowrap;
  padding: 0.35rem var(--space-3);
}
.tabla-asiento thead th {
  position: sticky;
  /* El cuerpo del modal tiene padding: con top 0 la cabecera quedaba 22px por debajo
     del borde y las filas se veían pasar por encima de ella. */
  top: calc(-1 * var(--space-5));
  background: var(--bg-elevated);
  z-index: 1;
}
.danger {
  color: var(--color-error);
  font-weight: 700;
}
/* Tooltip con el equivalente en moneda local. Se hace a mano y no con `title` nativo
   porque este aparece al instante, sin el retardo de ~1s del navegador. */
.con-tooltip {
  position: relative;
}
.tooltip-bs {
  position: absolute;
  bottom: 100%;
  right: var(--space-3);
  transform: translateY(0.2rem);
  background: var(--color-brand);
  color: var(--color-white);
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
  padding: 0.1rem 0.45rem;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s var(--ease);
  z-index: 10;
}
.con-tooltip:hover .tooltip-bs {
  opacity: 1;
}
.input-declarado {
  width: 7rem;
  text-align: right;
}
button.pequeno {
  height: 1.6rem;
  width: 1.6rem;
  padding: 0;
  border-radius: 50%;
}
/* Botón "Ver Asiento" mientras se consulta */
.boton-ver-asiento {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--color-brand);
  border-radius: 50%;
  animation: girar 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes girar {
  to {
    transform: rotate(360deg);
  }
}
.aviso-contabilizado {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 var(--space-3);
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--color-success-bg);
  color: var(--color-success);
  font-size: 0.85rem;
  font-weight: 600;
}
/* Ventana de resultado al contabilizar */
.resultado-asiento {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
}
.resultado-icono {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-success);
  background: var(--color-success-bg);
}
.resultado-asiento.fallo .resultado-icono {
  color: var(--color-error);
  background: var(--color-error-bg);
}
.resultado-titulo {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text);
}
.resultado-datos {
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.3rem var(--space-4);
  margin: 0;
  font-size: 0.88rem;
}
.resultado-datos dt {
  color: var(--text-muted);
  text-align: right;
}
.resultado-datos dd {
  margin: 0;
  font-weight: 600;
  text-align: left;
  font-variant-numeric: tabular-nums;
}
.resultado-nota {
  margin: 0;
  color: var(--color-error);
  font-size: 0.85rem;
}
</style>
