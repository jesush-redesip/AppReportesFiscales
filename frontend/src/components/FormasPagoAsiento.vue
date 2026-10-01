<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../lib/api';
import AppIcon from './icons/AppIcon.vue';

/**
 * Cierre de Caja › Configuración › Formas de pago del asiento: qué nombre lleva cada forma
 * de pago de ICG en el comentario de la línea de cobro del asiento
 * ("CIERRE DE CAJA 1 DEL dd/mm/aaaa <nombre>"). Sin nombre, sale '***'.
 */

interface FormaPago {
  codFormaPago: string;
  descripcion: string;
  idFormaPago: number | null;
  nombre: string | null;
}
interface Nombre {
  id: number;
  descripcion: string;
  enUso: number;
}

/** REGISTROAUDITORIA.DESCRIPCION de ICG: el comentario se recorta ahí. */
const LARGO_AUDITORIA = 45;
const PREFIJO_EJEMPLO = 'CIERRE DE CAJA 1 DEL 01/10/2026 ';

const formas = ref<FormaPago[]>([]);
const catalogo = ref<Nombre[]>([]);
/** codFormaPago -> id elegido (null = sin asignar). Solo lo que cambió respecto de la base. */
const pendientes = ref(new Map<string, number | null>());
const soloSinAsignar = ref(false);
const filtro = ref('');
const cargando = ref(false);
const guardando = ref(false);
const error = ref('');
const exito = ref('');

const nuevoNombre = ref('');
const editandoId = ref<number | null>(null);
const textoEdicion = ref('');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const r = await api.get<{ formas: FormaPago[]; catalogo: Nombre[] }>('/api/config/formas-pago');
    formas.value = r.formas;
    catalogo.value = r.catalogo;
    pendientes.value = new Map();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al cargar las formas de pago.';
  } finally {
    cargando.value = false;
  }
}

function elegido(f: FormaPago): number | null {
  return pendientes.value.has(f.codFormaPago) ? (pendientes.value.get(f.codFormaPago) ?? null) : f.idFormaPago;
}

function elegir(f: FormaPago, valor: string) {
  const id = valor === '' ? null : Number(valor);
  const m = new Map(pendientes.value);
  if (id === f.idFormaPago) m.delete(f.codFormaPago);
  else m.set(f.codFormaPago, id);
  pendientes.value = m;
  exito.value = '';
}

function nombreDe(id: number | null): string | null {
  return id == null ? null : (catalogo.value.find((c) => c.id === id)?.descripcion ?? null);
}

function vistaPrevia(f: FormaPago) {
  return PREFIJO_EJEMPLO + (nombreDe(elegido(f)) ?? '***');
}

const formasVisibles = computed(() => {
  const q = filtro.value.trim().toLowerCase();
  return formas.value.filter(
    (f) =>
      (!soloSinAsignar.value || elegido(f) == null) &&
      (!q || f.codFormaPago.toLowerCase().includes(q) || f.descripcion.toLowerCase().includes(q)),
  );
});
const sinAsignar = computed(() => formas.value.filter((f) => elegido(f) == null).length);

/** Nombres con espacios de más (p. ej. el "PAGO MOVIL ... PAGO MOVIL" que rompía el asiento). */
const tieneEspacios = (texto: string) => /\s{2,}/.test(texto) || texto !== texto.trim();

async function guardar() {
  if (pendientes.value.size === 0) return;
  guardando.value = true;
  error.value = '';
  exito.value = '';
  try {
    const items = [...pendientes.value].map(([codFormaPago, idFormaPago]) => ({ codFormaPago, idFormaPago }));
    const r = await api.put<{ cambios: unknown[] }>('/api/config/formas-pago/relaciones', { items });
    exito.value = `${r.cambios.length} forma(s) de pago actualizada(s).`;
    await cargar();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al guardar.';
  } finally {
    guardando.value = false;
  }
}

async function crear() {
  if (!nuevoNombre.value.trim()) return;
  error.value = '';
  exito.value = '';
  try {
    const r = await api.post<{ nombre: Nombre }>('/api/config/formas-pago/catalogo', { descripcion: nuevoNombre.value });
    nuevoNombre.value = '';
    catalogo.value = [...catalogo.value, r.nombre].sort((a, b) => a.descripcion.localeCompare(b.descripcion));
    exito.value = `Nombre "${r.nombre.descripcion}" agregado.`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al agregar el nombre.';
  }
}

function empezarEdicion(n: Nombre) {
  editandoId.value = n.id;
  textoEdicion.value = n.descripcion.replace(/\s+/g, ' ').trim();
}

async function confirmarEdicion(n: Nombre) {
  error.value = '';
  exito.value = '';
  try {
    await api.put(`/api/config/formas-pago/catalogo/${n.id}`, { descripcion: textoEdicion.value });
    editandoId.value = null;
    exito.value = 'Nombre actualizado.';
    await cargar();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al editar el nombre.';
  }
}

async function eliminar(n: Nombre) {
  if (!confirm(`¿Eliminar el nombre "${n.descripcion}" del catálogo?`)) return;
  error.value = '';
  exito.value = '';
  try {
    await api.delete(`/api/config/formas-pago/catalogo/${n.id}`, {});
    exito.value = `Nombre "${n.descripcion}" eliminado.`;
    await cargar();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al eliminar el nombre.';
  }
}

onMounted(cargar);
</script>

<template>
  <div>
    <p class="ayuda">
      Cómo aparece cada forma de pago de ICG en el comentario de la línea de cobro del asiento del cierre. Las que no
      tienen nombre salen como <b>***</b>.
    </p>

    <p v-if="cargando" class="estado">Cargando...</p>
    <template v-else>
      <div class="barra">
        <input v-model="filtro" type="search" placeholder="Buscar por código o forma de pago..." />
        <label class="check">
          <input v-model="soloSinAsignar" type="checkbox" />
          Solo sin asignar <span class="contador" :class="{ alerta: sinAsignar > 0 }">{{ sinAsignar }}</span>
        </label>
      </div>

      <div class="tabla-wrap">
        <table class="tabla">
          <thead>
            <tr>
              <th>Código</th>
              <th>Forma de pago (ICG)</th>
              <th>Nombre en el asiento</th>
              <th>Así queda el comentario</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in formasVisibles" :key="f.codFormaPago" :class="{ cambiado: pendientes.has(f.codFormaPago) }">
              <td class="codigo">{{ f.codFormaPago }}</td>
              <td>{{ f.descripcion }}</td>
              <td>
                <select :value="elegido(f) ?? ''" @change="elegir(f, ($event.target as HTMLSelectElement).value)">
                  <option value="">(sin asignar → ***)</option>
                  <option v-for="c in catalogo" :key="c.id" :value="c.id">{{ c.descripcion.replace(/\s+/g, ' ') }}</option>
                </select>
                <span v-if="elegido(f) == null" class="aviso" title="Sale *** en el asiento">⚠</span>
              </td>
              <td class="vista" :class="{ largo: vistaPrevia(f).length > LARGO_AUDITORIA }">
                {{ vistaPrevia(f).replace(/\s+/g, ' ') }}
                <small v-if="vistaPrevia(f).length > LARGO_AUDITORIA">
                  ({{ vistaPrevia(f).length }} car.; en la auditoría contable se recorta a {{ LARGO_AUDITORIA }})
                </small>
              </td>
            </tr>
            <tr v-if="formasVisibles.length === 0">
              <td colspan="4" class="estado">Ninguna forma de pago coincide.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="acciones">
        <span class="pendientes">{{ pendientes.size ? `${pendientes.size} cambio(s) sin guardar` : 'Sin cambios' }}</span>
        <button type="button" class="secundario" :disabled="pendientes.size === 0 || guardando" @click="pendientes = new Map()">
          Descartar
        </button>
        <button type="button" :disabled="pendientes.size === 0 || guardando" @click="guardar">
          {{ guardando ? 'Guardando...' : 'Guardar cambios' }}
        </button>
      </div>

      <h3>Nombres disponibles</h3>
      <form class="nuevo" @submit.prevent="crear">
        <input v-model="nuevoNombre" type="text" maxlength="60" placeholder="Nuevo nombre, p. ej. EFECTIVO EUR" />
        <button type="submit" class="secundario" :disabled="!nuevoNombre.trim()">+ Agregar</button>
      </form>
      <ul class="catalogo">
        <li v-for="n in catalogo" :key="n.id" :class="{ sucio: tieneEspacios(n.descripcion) }">
          <template v-if="editandoId === n.id">
            <input v-model="textoEdicion" type="text" maxlength="60" @keyup.enter="confirmarEdicion(n)" @keyup.esc="editandoId = null" />
            <button type="button" class="secundario pequeno" title="Guardar" @click="confirmarEdicion(n)">
              <AppIcon name="check" :size="12" />
            </button>
            <button type="button" class="secundario pequeno" title="Cancelar" @click="editandoId = null">
              <AppIcon name="close" :size="12" />
            </button>
          </template>
          <template v-else>
            <span class="nombre">{{ n.descripcion.replace(/\s+/g, ' ') }}</span>
            <span class="uso" :title="`${n.enUso} forma(s) de pago lo usan`">{{ n.enUso }}</span>
            <span v-if="tieneEspacios(n.descripcion)" class="aviso" title="Tiene espacios de más: edítelo para corregirlo">⚠</span>
            <button type="button" class="enlace" @click="empezarEdicion(n)">editar</button>
            <button v-if="n.enUso === 0" type="button" class="enlace peligro" @click="eliminar(n)">eliminar</button>
          </template>
        </li>
      </ul>
    </template>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="exito && !error" class="exito"><AppIcon name="check" :size="14" /> {{ exito }}</p>
  </div>
</template>

<style scoped>
.ayuda {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0 0 var(--space-4);
}
.estado {
  color: var(--text-muted);
  font-size: 0.85rem;
}
.barra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}
.barra input[type='search'] {
  flex: 1;
  min-width: 14rem;
  max-width: 24rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  cursor: pointer;
}
.contador {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0 0.45rem;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
}
.contador.alerta {
  background: var(--color-error-bg);
  color: var(--color-error);
}
.tabla-wrap {
  max-height: 55vh;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.83rem;
}
.tabla th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-subtle);
  text-align: left;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  padding: 0.5rem var(--space-3);
  border-bottom: 1px solid var(--border-strong);
}
.tabla td {
  padding: 0.35rem var(--space-3);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tabla tr.cambiado td {
  background: var(--color-brand-bg);
}
.codigo {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.tabla select {
  height: 2.1rem;
  padding-top: 0;
  padding-bottom: 0;
  font-size: 0.82rem;
  line-height: 1.2;
  min-width: 14rem;
}
.aviso {
  color: var(--color-error);
  margin-left: 0.35rem;
}
.vista {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.76rem;
  color: var(--text-muted);
}
.vista small {
  display: block;
  font-family: inherit;
  color: var(--color-error);
}
.acciones {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-3) 0 var(--space-5);
}
.pendientes {
  margin-right: auto;
  font-size: 0.82rem;
  color: var(--text-muted);
}
h3 {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin: 0 0 var(--space-2);
}
.nuevo {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.nuevo input {
  flex: 1;
  max-width: 24rem;
}
.catalogo {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.catalogo li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.8rem;
}
.catalogo li.sucio {
  border-color: var(--color-error);
}
.catalogo li input {
  height: 1.7rem;
  font-size: 0.8rem;
  width: 14rem;
}
.uso {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-muted);
  background: var(--bg-subtle);
  border-radius: 999px;
  padding: 0 0.4rem;
}
.enlace {
  background: none;
  border: none;
  padding: 0;
  height: auto;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-brand-darker);
  cursor: pointer;
}
.enlace.peligro {
  color: var(--color-error);
}
button.pequeno {
  height: 1.6rem;
  width: 1.6rem;
  padding: 0;
  border-radius: 50%;
}
.error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin-top: var(--space-3);
}
.exito {
  color: var(--color-success);
  font-size: 0.85rem;
  margin-top: var(--space-3);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
</style>
