<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';
import BaseModal from '../components/BaseModal.vue';
import AppIcon from '../components/icons/AppIcon.vue';

/**
 * Scripts SQL (solo SUPERVISOR): catálogo de los procedimientos y funciones que usa el
 * aplicativo en cada empresa, instalación de los scripts oficiales y scripts propios
 * (crear o modificar procedimientos, funciones y vistas), con prueba previa, respaldo,
 * historial y restauración.
 */
interface Empresa {
  codEmpresa: number;
  titulo: string;
  bd: string;
  disponible: boolean;
}
interface FilaCatalogo {
  nombre: string;
  modulo: string;
  existe: boolean;
  tipo: string | null;
  modificado: string | null;
  versionInstalada: number | null;
  versionOficial: number | null;
  estado: string;
  detalle: string;
}
interface Objeto {
  nombre: string;
  tipo: string;
  accion: string;
}
interface Resultado {
  codEmpresa: number;
  empresa: string;
  ok: boolean;
  mensaje: string;
  objetos: Objeto[];
}
interface Respaldo {
  id: number;
  objeto: string;
  tipo: string | null;
  existia: boolean;
  restaurado: boolean;
}
interface EntradaHistorial {
  id: number;
  fecha: string;
  usuario: string;
  origen: string;
  nombre: string;
  objetos: string;
  resultado: string;
  mensaje: string | null;
  respaldos: Respaldo[];
}

const auth = useAuthStore();
const BASE = '/api/scripts';
const pestana = ref<'catalogo' | 'subir' | 'historial'>('catalogo');
const empresas = ref<Empresa[]>([]);
const disponibles = computed(() => empresas.value.filter((e) => e.disponible));
const codEmpresa = ref<number | ''>('');
const nombreEmpresa = (cod: number) => empresas.value.find((e) => e.codEmpresa === cod)?.titulo ?? String(cod);
const error = ref('');

onMounted(async () => {
  try {
    empresas.value = await api.get<Empresa[]>(`${BASE}/empresas`);
    const actual = auth.empresa?.codEmpresa;
    const elegida = disponibles.value.some((e) => e.codEmpresa === actual) ? (actual as number) : disponibles.value[0]?.codEmpresa;
    codEmpresa.value = elegida ?? '';
    empresasScript.value = elegida === undefined ? [] : [elegida];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar las empresas.';
  }
});

/**
 * Descarga un texto como archivo .sql (UTF-8 con BOM, para que SSMS respete los acentos;
 * saltos de línea de Windows).
 */
function descargarSql(nombre: string, texto: string) {
  const limpio = nombre.replace(/[\\/:*?"<>|]+/g, '_').replace(/\.sql$/i, '') + '.sql';
  const blob = new Blob(['\uFEFF' + texto.replace(/\r?\n/g, '\r\n')], { type: 'application/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = limpio;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const bdActual = () => empresas.value.find((e) => e.codEmpresa === codEmpresa.value)?.bd ?? 'empresa';

// --- Catálogo ---
const catalogo = ref<FilaCatalogo[]>([]);
const cargandoCatalogo = ref(false);
async function cargarCatalogo() {
  if (codEmpresa.value === '') return;
  cargandoCatalogo.value = true;
  error.value = '';
  try {
    catalogo.value = await api.get<FilaCatalogo[]>(`${BASE}/catalogo`, { codEmpresa: codEmpresa.value });
  } catch (e) {
    catalogo.value = [];
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el catálogo.';
  } finally {
    cargandoCatalogo.value = false;
  }
}

const ETIQUETA_ESTADO: Record<string, string> = {
  AL_DIA: 'Al día',
  DESACTUALIZADO: 'Versión vieja',
  MODIFICADO: 'Modificado para el cliente',
  SIN_VERSION: 'Sin versión',
  DEL_CLIENTE: 'Del cliente',
  FALTA: 'Falta',
  FALTA_SIN_SCRIPT: 'Falta (sin script)',
  TIPO_DISTINTO: 'Tipo distinto',
};
const CLASE_ESTADO: Record<string, string> = {
  AL_DIA: 'ok',
  DEL_CLIENTE: 'neutro',
  DESACTUALIZADO: 'aviso',
  MODIFICADO: 'aviso',
  SIN_VERSION: 'aviso',
  FALTA: 'mal',
  FALTA_SIN_SCRIPT: 'mal',
  TIPO_DISTINTO: 'mal',
};
const instalable = (f: FilaCatalogo) => f.versionOficial != null && f.estado !== 'AL_DIA';

// Ver definición
const verDef = ref<{ nombre: string; actual: string | null; oficial: string | null; vista: 'actual' | 'oficial'; cargando: boolean } | null>(null);
async function verDefinicion(f: FilaCatalogo) {
  verDef.value = { nombre: f.nombre, actual: null, oficial: null, vista: 'actual', cargando: true };
  try {
    const d = await api.get<{ actual: string | null; oficial: string | null }>(`${BASE}/definicion`, { codEmpresa: codEmpresa.value, nombre: f.nombre });
    verDef.value = { ...verDef.value, ...d, vista: d.actual ? 'actual' : 'oficial', cargando: false };
  } catch (e) {
    verDef.value = { ...verDef.value, actual: e instanceof Error ? e.message : 'No se pudo leer.', cargando: false };
  }
}

// Instalar oficial
const instalar = ref<{ fila: FilaCatalogo; todas: boolean; trabajando: boolean; resultados: Resultado[] | null } | null>(null);
async function confirmarInstalar() {
  const i = instalar.value;
  if (!i || codEmpresa.value === '') return;
  i.trabajando = true;
  try {
    const cods = i.todas ? disponibles.value.map((e) => e.codEmpresa) : [codEmpresa.value];
    const r = await api.post<{ resultados: Resultado[] }>(`${BASE}/instalar-oficial`, { nombre: i.fila.nombre, codEmpresas: cods });
    i.resultados = r.resultados;
    await cargarCatalogo();
  } catch (e) {
    i.resultados = [{ codEmpresa: 0, empresa: '', ok: false, mensaje: e instanceof Error ? e.message : 'No se pudo instalar.', objetos: [] }];
  } finally {
    i.trabajando = false;
  }
}

// --- Subir script ---
const texto = ref('');
const nombreArchivo = ref('');
const empresasScript = ref<number[]>([]);
const analisis = ref<{ ok: boolean; errores: string[]; lotes: number; objetos: Objeto[] } | null>(null);
const analizando = ref(false);
const resultadosScript = ref<{ tipo: 'probar' | 'aplicar'; resultados: Resultado[] } | null>(null);
/** Firma de lo último que se probó con éxito: solo se puede aplicar eso. */
const probadoOk = ref('');
const firma = computed(() => `${texto.value.length}:${hashSimple(texto.value)}:${[...empresasScript.value].sort().join(',')}`);
const confirmarAplicar = ref(false);
const trabajandoScript = ref(false);

function hashSimple(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

async function leerArchivo(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  if (f.size > 2_000_000) {
    error.value = 'El archivo es demasiado grande (máximo 2 MB).';
    return;
  }
  const buf = new Uint8Array(await f.arrayBuffer());
  let t: string;
  // SSMS guarda a veces en "Unicode" (UTF-16); si no, UTF-8 o, en último caso, ANSI.
  if (buf[0] === 0xff && buf[1] === 0xfe) t = new TextDecoder('utf-16le').decode(buf);
  else if (buf[0] === 0xfe && buf[1] === 0xff) t = new TextDecoder('utf-16be').decode(buf);
  else {
    try {
      t = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      t = new TextDecoder('windows-1252').decode(buf);
    }
  }
  texto.value = t.replace(/^﻿/, '');
  nombreArchivo.value = f.name;
  (ev.target as HTMLInputElement).value = '';
}

let temporizador: ReturnType<typeof setTimeout> | undefined;
watch(texto, () => {
  resultadosScript.value = null;
  confirmarAplicar.value = false;
  clearTimeout(temporizador);
  if (!texto.value.trim()) {
    analisis.value = null;
    return;
  }
  temporizador = setTimeout(analizar, 400);
});
watch(empresasScript, () => (confirmarAplicar.value = false), { deep: true });

async function analizar() {
  analizando.value = true;
  try {
    analisis.value = await api.post(`${BASE}/analizar`, { texto: texto.value });
  } catch (e) {
    analisis.value = { ok: false, errores: [e instanceof Error ? e.message : 'No se pudo analizar.'], lotes: 0, objetos: [] };
  } finally {
    analizando.value = false;
  }
}

async function ejecutarScript(tipo: 'probar' | 'aplicar') {
  if (!analisis.value?.ok || !empresasScript.value.length) return;
  trabajandoScript.value = true;
  error.value = '';
  try {
    const r = await api.post<{ ok: boolean; resultados: Resultado[] }>(`${BASE}/${tipo}`, {
      texto: texto.value,
      nombre: nombreArchivo.value || undefined,
      codEmpresas: empresasScript.value,
    });
    resultadosScript.value = { tipo, resultados: r.resultados };
    if (tipo === 'probar') probadoOk.value = r.ok ? firma.value : '';
    if (tipo === 'aplicar') {
      confirmarAplicar.value = false;
      probadoOk.value = '';
      if (codEmpresa.value !== '' && empresasScript.value.includes(codEmpresa.value)) void cargarCatalogo();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo ejecutar.';
  } finally {
    trabajandoScript.value = false;
  }
}
const puedeAplicar = computed(() => Boolean(analisis.value?.ok) && probadoOk.value === firma.value && !trabajandoScript.value);

const ACCION: Record<string, string> = {
  CREAR: 'crea',
  MODIFICAR: 'modifica',
  CREAR_O_MODIFICAR: 'crea o modifica',
  BORRAR: 'borra',
  CREAR_ESQUEMA: 'crea el esquema',
};
const TIPO: Record<string, string> = { PROCEDIMIENTO: 'procedimiento', FUNCION: 'función', VISTA: 'vista', ESQUEMA: 'esquema' };

// --- Historial ---
const historial = ref<EntradaHistorial[]>([]);
const cargandoHistorial = ref(false);
async function cargarHistorial() {
  if (codEmpresa.value === '') return;
  cargandoHistorial.value = true;
  try {
    historial.value = await api.get<EntradaHistorial[]>(`${BASE}/historial`, { codEmpresa: codEmpresa.value });
  } catch (e) {
    historial.value = [];
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el historial.';
  } finally {
    cargandoHistorial.value = false;
  }
}
const verTexto = ref<{ titulo: string; archivo: string; texto: string } | null>(null);
/** Nombre de archivo para un script del historial. */
const archivoHistorial = (h: EntradaHistorial) =>
  `${(h.nombre || `script_${h.id}`).replace(/\.sql$/i, '').replace(/\s*\((versión|respaldo)[^)]*\)/i, '')}_${bdActual()}_${h.fecha.slice(0, 10)}`;
async function verScript(h: EntradaHistorial) {
  try {
    const r = await api.get<{ texto: string }>(`${BASE}/texto`, { codEmpresa: codEmpresa.value, id: h.id });
    verTexto.value = { titulo: `${h.nombre} · ${h.fecha}`, archivo: archivoHistorial(h), texto: r.texto };
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo leer el script.';
  }
}
const restaurarSel = ref<{ respaldo: Respaldo; entrada: EntradaHistorial; trabajando: boolean; mensaje: string; ok: boolean | null } | null>(null);
async function descargarScript(h: EntradaHistorial) {
  try {
    const r = await api.get<{ texto: string }>(`${BASE}/texto`, { codEmpresa: codEmpresa.value, id: h.id });
    descargarSql(archivoHistorial(h), r.texto);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo descargar el script.';
  }
}
async function confirmarRestaurar() {
  const r = restaurarSel.value;
  if (!r) return;
  r.trabajando = true;
  try {
    const res = await api.post<{ ok: boolean; mensaje: string }>(`${BASE}/restaurar`, { codEmpresa: codEmpresa.value, idRespaldo: r.respaldo.id });
    r.ok = res.ok;
    r.mensaje = res.ok ? 'Restaurado.' : res.mensaje;
    await Promise.all([cargarHistorial(), cargarCatalogo()]);
  } catch (e) {
    r.ok = false;
    r.mensaje = e instanceof Error ? e.message : 'No se pudo restaurar.';
  } finally {
    r.trabajando = false;
  }
}

watch([pestana, codEmpresa], () => {
  if (pestana.value === 'catalogo') void cargarCatalogo();
  if (pestana.value === 'historial') void cargarHistorial();
});
</script>

<template>
  <section>
    <h1>Scripts SQL</h1>
    <p class="ayuda">
      Procedimientos y funciones que usa el aplicativo en cada empresa, y scripts propios para ajustar o crear procedimientos,
      funciones y vistas. Antes de cada cambio se respalda la versión anterior, y todo queda en el historial.
    </p>

    <div class="barra">
      <label class="campo">
        Empresa
        <select v-model="codEmpresa">
          <option v-for="e in disponibles" :key="e.codEmpresa" :value="e.codEmpresa">{{ e.titulo }} ({{ e.bd }})</option>
        </select>
      </label>
      <div class="pestanas" role="tablist">
        <button type="button" role="tab" :aria-selected="pestana === 'catalogo'" :class="{ activa: pestana === 'catalogo' }" @click="pestana = 'catalogo'">Catálogo</button>
        <button type="button" role="tab" :aria-selected="pestana === 'subir'" :class="{ activa: pestana === 'subir' }" @click="pestana = 'subir'">Subir script</button>
        <button type="button" role="tab" :aria-selected="pestana === 'historial'" :class="{ activa: pestana === 'historial' }" @click="pestana = 'historial'">Historial</button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <!-- Catálogo -->
    <div v-if="pestana === 'catalogo'" class="card">
      <p v-if="cargandoCatalogo" class="estado">Cargando…</p>
      <div v-else class="tabla">
        <table>
          <thead>
            <tr>
              <th>Objeto</th>
              <th>Módulo</th>
              <th>Estado</th>
              <th>Versión</th>
              <th>Modificado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in catalogo" :key="f.nombre">
              <td class="mono">{{ f.nombre }}</td>
              <td>{{ f.modulo }}</td>
              <td>
                <span class="chip" :class="CLASE_ESTADO[f.estado]" :title="f.detalle">{{ ETIQUETA_ESTADO[f.estado] ?? f.estado }}</span>
              </td>
              <td class="num">
                {{ f.versionInstalada ?? '—' }}<span v-if="f.versionOficial" class="tenue"> / {{ f.versionOficial }}</span>
              </td>
              <td>{{ f.modificado ?? '' }}</td>
              <td class="acciones">
                <button v-if="f.existe || f.versionOficial" type="button" class="enlace" @click="verDefinicion(f)">Ver</button>
                <button
                  v-if="instalable(f)"
                  type="button"
                  class="enlace"
                  @click="instalar = { fila: f, todas: false, trabajando: false, resultados: null }"
                >
                  {{ f.existe ? 'Actualizar' : 'Instalar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="nota">
        "Versión" es la instalada / la que trae el aplicativo. "Del cliente": el aplicativo no trae script oficial de ese objeto;
        para cambiarlo, use Subir script.
      </p>
    </div>

    <!-- Subir script -->
    <div v-else-if="pestana === 'subir'" class="card subir">
      <div class="fila-archivo">
        <label class="boton-archivo secundario">
          <AppIcon name="download" :size="15" /> Elegir archivo .sql
          <input type="file" accept=".sql,.txt" @change="leerArchivo" />
        </label>
        <span v-if="nombreArchivo" class="tenue">{{ nombreArchivo }}</span>
      </div>
      <label class="campo">
        Script
        <textarea v-model="texto" rows="14" spellcheck="false" placeholder="Pegue aquí el script, o elija un archivo .sql"></textarea>
      </label>
      <p class="nota">
        Solo se aceptan scripts que crean o modifican procedimientos, funciones y vistas (CREATE / ALTER, separados con GO). No se
        permiten sentencias que cambien datos (UPDATE, DELETE, INSERT, DROP TABLE…) fuera de la definición de un objeto.
      </p>

      <div v-if="analizando" class="estado">Analizando…</div>
      <div v-else-if="analisis" class="analisis" :class="{ mal: !analisis.ok }">
        <template v-if="analisis.ok">
          <b>El script ({{ analisis.lotes }} lote{{ analisis.lotes === 1 ? '' : 's' }}):</b>
          <ul>
            <li v-for="o in analisis.objetos" :key="o.nombre">{{ ACCION[o.accion] }} {{ TIPO[o.tipo] }} <span class="mono">{{ o.nombre }}</span></li>
          </ul>
        </template>
        <template v-else>
          <b>No se puede aplicar:</b>
          <ul>
            <li v-for="(e, i) in analisis.errores" :key="i">{{ e }}</li>
          </ul>
        </template>
      </div>

      <fieldset class="empresas">
        <legend>Empresas</legend>
        <label v-for="e in disponibles" :key="e.codEmpresa" class="check">
          <input v-model="empresasScript" type="checkbox" :value="e.codEmpresa" /> {{ e.titulo }} <span class="tenue">({{ e.bd }})</span>
        </label>
        <div class="enlaces">
          <button type="button" class="enlace" @click="empresasScript = disponibles.map((e) => e.codEmpresa)">todas</button>
          <button type="button" class="enlace" @click="empresasScript = []">ninguna</button>
        </div>
      </fieldset>

      <div class="botones">
        <button type="button" class="secundario tono-info" :disabled="!analisis?.ok || !empresasScript.length || trabajandoScript" @click="ejecutarScript('probar')">
          {{ trabajandoScript && !confirmarAplicar ? 'Probando…' : 'Probar' }}
        </button>
        <button type="button" :disabled="!puedeAplicar" :title="puedeAplicar ? '' : 'Primero pruébelo sin errores en estas empresas'" @click="confirmarAplicar = true">
          Aplicar
        </button>
      </div>
      <div v-if="confirmarAplicar" class="confirmar">
        <span>
          ¿Aplicar el script en {{ empresasScript.length }} empresa{{ empresasScript.length === 1 ? '' : 's' }}? Se respalda la versión
          actual de cada objeto y se puede restaurar desde el Historial.
        </span>
        <button type="button" class="secundario" @click="confirmarAplicar = false">Cancelar</button>
        <button type="button" :disabled="trabajandoScript" @click="ejecutarScript('aplicar')">{{ trabajandoScript ? 'Aplicando…' : 'Confirmar' }}</button>
      </div>

      <div v-if="resultadosScript" class="resultados">
        <b>{{ resultadosScript.tipo === 'probar' ? 'Resultado de la prueba' : 'Resultado' }}</b>
        <ul>
          <li v-for="r in resultadosScript.resultados" :key="r.codEmpresa" :class="r.ok ? 'ok' : 'mal'">
            <AppIcon :name="r.ok ? 'check' : 'close'" :size="14" /> {{ r.empresa }}: {{ r.mensaje }}
          </li>
        </ul>
      </div>
    </div>

    <!-- Historial -->
    <div v-else class="card">
      <p v-if="cargandoHistorial" class="estado">Cargando…</p>
      <p v-else-if="!historial.length" class="estado">No se ha aplicado ningún script en esta empresa.</p>
      <div v-else class="tabla">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Origen</th>
              <th>Script</th>
              <th>Resultado</th>
              <th>Respaldos</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in historial" :key="h.id">
              <td class="nowrap">{{ h.fecha }}</td>
              <td>{{ h.usuario }}</td>
              <td>{{ { OFICIAL: 'Oficial', PROPIO: 'Propio', RESTAURACION: 'Restauración' }[h.origen] ?? h.origen }}</td>
              <td>
                <button type="button" class="enlace" @click="verScript(h)">{{ h.nombre || '(sin nombre)' }}</button>
                <button type="button" class="enlace descargar" title="Descargar el script (.sql)" @click="descargarScript(h)">
                  <AppIcon name="download" :size="13" /> .sql
                </button>
                <small class="tenue bloque">{{ h.objetos }}</small>
              </td>
              <td>
                <span class="chip" :class="h.resultado === 'OK' ? 'ok' : 'mal'">{{ h.resultado }}</span>
                <small v-if="h.mensaje" class="error bloque">{{ h.mensaje }}</small>
              </td>
              <td>
                <div v-for="b in h.respaldos" :key="b.id" class="respaldo">
                  <span class="mono">{{ b.objeto }}</span>
                  <span v-if="b.restaurado" class="tenue">restaurado</span>
                  <button
                    v-else-if="h.resultado === 'OK'"
                    type="button"
                    class="enlace"
                    @click="restaurarSel = { respaldo: b, entrada: h, trabajando: false, mensaje: '', ok: null }"
                  >
                    {{ b.existia ? 'Restaurar versión anterior' : 'Quitar (no existía)' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Ventanas -->
    <BaseModal :open="!!verDef" :title="verDef?.nombre ?? ''" ancho="min(1000px, 95vw)" @close="verDef = null">
      <template v-if="verDef">
        <div class="pestanas chicas">
          <button type="button" :class="{ activa: verDef.vista === 'actual' }" :disabled="!verDef.actual" @click="verDef.vista = 'actual'">Instalado</button>
          <button type="button" :class="{ activa: verDef.vista === 'oficial' }" :disabled="!verDef.oficial" @click="verDef.vista = 'oficial'">Script oficial</button>
          <button
            type="button"
            class="secundario tono-info boton-descargar"
            :disabled="verDef.cargando || !(verDef.vista === 'actual' ? verDef.actual : verDef.oficial)"
            @click="
              descargarSql(
                verDef.vista === 'actual' ? `${verDef.nombre}_${bdActual()}` : `${verDef.nombre}_oficial`,
                (verDef.vista === 'actual' ? verDef.actual : verDef.oficial) ?? '',
              )
            "
          >
            <AppIcon name="download" :size="14" /> Descargar .sql
          </button>
        </div>
        <p v-if="verDef.cargando" class="estado">Cargando…</p>
        <pre v-else class="codigo">{{ (verDef.vista === 'actual' ? verDef.actual : verDef.oficial) ?? 'No hay.' }}</pre>
      </template>
    </BaseModal>

    <BaseModal :open="!!instalar" :title="instalar ? `${instalar.fila.existe ? 'Actualizar' : 'Instalar'} ${instalar.fila.nombre}` : ''" ancho="560px" @close="instalar = null">
      <template v-if="instalar">
        <p>Se instala el script oficial (versión {{ instalar.fila.versionOficial }}) en <b>{{ nombreEmpresa(codEmpresa as number) }}</b>.</p>
        <p v-if="instalar.fila.estado === 'MODIFICADO' || instalar.fila.estado === 'SIN_VERSION'" class="aviso">
          Esta empresa tiene una versión propia de este objeto: se reemplaza por la oficial. La actual queda respaldada y se puede
          restaurar desde el Historial.
        </p>
        <label class="check"><input v-model="instalar.todas" type="checkbox" /> Instalar también en todas las demás empresas</label>
        <ul v-if="instalar.resultados" class="resultados">
          <li v-for="r in instalar.resultados" :key="r.codEmpresa" :class="r.ok ? 'ok' : 'mal'">
            <AppIcon :name="r.ok ? 'check' : 'close'" :size="14" /> {{ r.empresa }}: {{ r.mensaje }}
          </li>
        </ul>
        <div class="botones fin">
          <button type="button" class="secundario" @click="instalar = null">{{ instalar.resultados ? 'Cerrar' : 'Cancelar' }}</button>
          <button v-if="!instalar.resultados" type="button" :disabled="instalar.trabajando" @click="confirmarInstalar">
            {{ instalar.trabajando ? 'Instalando…' : 'Instalar' }}
          </button>
        </div>
      </template>
    </BaseModal>

    <BaseModal :open="!!verTexto" :title="verTexto?.titulo ?? ''" ancho="min(1000px, 95vw)" @close="verTexto = null">
      <template v-if="verTexto">
        <div class="botones fin arriba">
          <button type="button" class="secundario tono-info" @click="descargarSql(verTexto.archivo, verTexto.texto)">
            <AppIcon name="download" :size="14" /> Descargar .sql
          </button>
        </div>
        <pre class="codigo">{{ verTexto.texto }}</pre>
      </template>
    </BaseModal>

    <BaseModal :open="!!restaurarSel" title="Restaurar" ancho="520px" @close="restaurarSel = null">
      <template v-if="restaurarSel">
        <p v-if="restaurarSel.respaldo.existia">
          <span class="mono">{{ restaurarSel.respaldo.objeto }}</span> vuelve a la versión que tenía antes del script
          «{{ restaurarSel.entrada.nombre }}» ({{ restaurarSel.entrada.fecha }}).
        </p>
        <p v-else>
          <span class="mono">{{ restaurarSel.respaldo.objeto }}</span> no existía antes del script «{{ restaurarSel.entrada.nombre }}»: se
          borra.
        </p>
        <p class="nota">La versión actual también se respalda, así que la restauración se puede deshacer.</p>
        <p v-if="restaurarSel.mensaje" :class="restaurarSel.ok ? 'exito' : 'error'">{{ restaurarSel.mensaje }}</p>
        <div class="botones fin">
          <button type="button" class="secundario" @click="restaurarSel = null">{{ restaurarSel.ok ? 'Cerrar' : 'Cancelar' }}</button>
          <button v-if="!restaurarSel.ok" type="button" :disabled="restaurarSel.trabajando" @click="confirmarRestaurar">
            {{ restaurarSel.trabajando ? 'Restaurando…' : 'Restaurar' }}
          </button>
        </div>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped>
.ayuda {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0 0 var(--space-4);
  max-width: 70ch;
}
.barra {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3) var(--space-5);
  margin-bottom: var(--space-3);
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
.campo textarea {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  color: var(--text);
}
.campo select {
  min-width: 16rem;
}
.campo textarea {
  font: 0.8rem/1.5 ui-monospace, Consolas, monospace;
  width: 100%;
  resize: vertical;
}
.pestanas {
  display: flex;
  gap: 0.25rem;
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
.pestanas.chicas {
  margin-bottom: var(--space-3);
}
.card {
  padding: var(--space-4);
}
.subir {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.tabla {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
th,
td {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
th {
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  background: var(--bg-subtle);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.mono {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.82rem;
}
.nowrap {
  white-space: nowrap;
}
.tenue {
  color: var(--text-faint);
}
.bloque {
  display: block;
}
.acciones {
  white-space: nowrap;
  display: flex;
  gap: var(--space-3);
}
.chip {
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 999px;
  padding: 0.1rem 0.55rem;
  white-space: nowrap;
  background: var(--bg-subtle);
  color: var(--text-muted);
}
.chip.ok {
  background: var(--color-brand-bg-strong);
  color: var(--color-brand-darker);
}
.chip.aviso {
  background: rgba(214, 140, 20, 0.15);
  color: var(--color-warning, #9a5b00);
}
.chip.mal {
  background: var(--color-error-bg, rgba(200, 40, 40, 0.12));
  color: var(--color-error);
}
.enlace {
  background: none;
  color: var(--color-brand-darker);
  padding: 0;
  height: auto;
  font-size: 0.82rem;
  text-align: left;
}
.enlace:hover:not(:disabled) {
  background: none;
  text-decoration: underline;
}
.nota {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: var(--space-2) 0 0;
}
.aviso {
  font-size: 0.85rem;
  color: var(--color-warning, #9a5b00);
}
.estado {
  color: var(--text-muted);
  font-size: 0.88rem;
}
.error {
  color: var(--color-error);
  font-size: 0.82rem;
}
.exito {
  color: var(--color-success, #2f7d32);
  font-size: 0.85rem;
}
.fila-archivo {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.boton-archivo {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
}
.boton-archivo input {
  display: none;
}
.analisis {
  border-left: 3px solid var(--color-brand);
  background: var(--color-brand-bg);
  padding: var(--space-2) var(--space-3);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 0.85rem;
}
.analisis.mal {
  border-left-color: var(--color-error);
  background: var(--color-error-bg, rgba(200, 40, 40, 0.08));
}
.analisis ul,
.resultados ul,
ul.resultados {
  margin: 0.3rem 0 0;
  padding-left: 1.1rem;
}
.empresas {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: 0;
}
.empresas legend {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
}
.enlaces {
  display: flex;
  gap: var(--space-3);
  flex-basis: 100%;
}
.botones {
  display: flex;
  gap: var(--space-3);
}
.botones.fin {
  justify-content: flex-end;
  margin-top: var(--space-3);
}
.confirmar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-warning, #9a5b00);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}
.resultados li {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  font-size: 0.85rem;
  list-style: none;
}
.resultados li.ok {
  color: var(--color-brand-darker);
}
.resultados li.mal {
  color: var(--color-error);
}
.respaldo {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.6rem;
  align-items: baseline;
  margin-bottom: 0.2rem;
}
.codigo {
  max-height: 65vh;
  overflow: auto;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-3);
  font: 0.78rem/1.5 ui-monospace, Consolas, monospace;
  white-space: pre;
}
.boton-descargar {
  margin-left: auto;
  height: 2rem;
  font-size: 0.82rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.enlace.descargar {
  margin-left: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.75rem;
}
.botones.arriba {
  margin: 0 0 var(--space-2);
}
</style>
