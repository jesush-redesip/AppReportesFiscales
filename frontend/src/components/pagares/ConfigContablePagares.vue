<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../lib/api';
import BaseModal from '../BaseModal.vue';
import CuentaBuscador from '../CuentaBuscador.vue';

/** Configuración contable de Pagarés (SUPERVISOR o supervisor interno). */
const emit = defineEmits<{ cerrar: [] }>();

interface Config {
  contabilizar: boolean;
  cuentaIntereses: string;
  cuentaIgtf: string;
  tasaIgtf: number;
  cuentaComision: string;
  raizPagare: string;
}
interface Cuenta {
  codigo: string;
  titulo: string;
}
interface RespuestaCuentas {
  bdContable: string | null;
  cuentas: Cuenta[];
  ultimaDeRaiz: Cuenta | null;
}
const BASE = '/api/reportes/pagares';
const c = ref<Config | null>(null);
const error = ref('');
const guardado = ref(false);
const guardando = ref(false);

/** Base contable de la que salen las cuentas, títulos de las elegidas y cuentas que no existen. */
const bdContable = ref<string | null>(null);
const titulos = reactive<Record<string, string>>({});
const verificadas = ref(false);
const ultimaDeRaiz = ref<Cuenta | null>(null);

async function cargarTitulos() {
  if (!c.value) return;
  const codigos = [c.value.cuentaIntereses, c.value.cuentaIgtf, c.value.cuentaComision].filter(Boolean);
  try {
    const r = await api.get<RespuestaCuentas>(`${BASE}/config/cuentas`, { codigos: codigos.join(','), raiz: c.value.raizPagare });
    bdContable.value = r.bdContable;
    r.cuentas.forEach((x) => (titulos[x.codigo] = x.titulo));
    ultimaDeRaiz.value = r.ultimaDeRaiz;
    verificadas.value = Boolean(r.bdContable);
  } catch {
    verificadas.value = false;
  }
}

onMounted(async () => {
  try {
    c.value = await api.get<Config>(`${BASE}/config`);
    await cargarTitulos();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar la configuración.';
  }
});

let temporizadorRaiz: ReturnType<typeof setTimeout> | undefined;
watch(
  () => c.value?.raizPagare,
  (raiz, antes) => {
    if (antes === undefined || !raiz) return;
    clearTimeout(temporizadorRaiz);
    temporizadorRaiz = setTimeout(async () => {
      try {
        ultimaDeRaiz.value = (await api.get<RespuestaCuentas>(`${BASE}/config/cuentas`, { raiz })).ultimaDeRaiz;
      } catch {
        ultimaDeRaiz.value = null;
      }
    }, 400);
  },
);

const noExiste = (codigo: string) => verificadas.value && Boolean(codigo) && !titulos[codigo];
const elegida = (x: Cuenta) => (titulos[x.codigo] = x.titulo);

async function guardar() {
  if (!c.value) return;
  guardando.value = true;
  error.value = '';
  guardado.value = false;
  try {
    c.value = await api.put<Config>(`${BASE}/config`, { ...c.value, tasaIgtf: Number(c.value.tasaIgtf) || 0 });
    guardado.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo guardar.';
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <BaseModal :open="true" title="Pagarés · Configuración contable" ancho="620px" @close="emit('cerrar')">
    <form v-if="c" class="config" @submit.prevent="guardar">
      <label class="check">
        <input v-model="c.contabilizar" type="checkbox" />
        Generar los asientos contables desde el Aplicativo
      </label>
      <p class="nota">
        Encendido (lo normal): al registrar un pagaré y al pagar sus cuotas se genera el asiento en la contabilidad de ICG.
        Apáguelo solo si esta empresa prefiere cargar esos asientos a mano en ICG.
      </p>
      <p v-if="bdContable" class="nota">Cuentas de la contabilidad <strong>{{ bdContable }}</strong>.</p>
      <p v-else-if="verificadas === false" class="aviso">
        No se encontró la contabilidad del año en curso de esta empresa en el servidor: no se pueden verificar las cuentas.
      </p>

      <div class="campo">
        Gasto por intereses
        <CuentaBuscador v-model="c.cuentaIntereses" :titulo="titulos[c.cuentaIntereses]" :invalida="noExiste(c.cuentaIntereses)" @elegida="elegida" />
        <small v-if="noExiste(c.cuentaIntereses)" class="error">La cuenta {{ c.cuentaIntereses }} no existe en la contabilidad.</small>
      </div>
      <div class="campo">
        Comisión bancaria y otros cargos
        <CuentaBuscador v-model="c.cuentaComision" :titulo="titulos[c.cuentaComision]" :invalida="noExiste(c.cuentaComision)" @elegida="elegida" />
        <small v-if="noExiste(c.cuentaComision)" class="error">La cuenta {{ c.cuentaComision }} no existe en la contabilidad.</small>
      </div>
      <div class="fila">
        <div class="campo crece">
          Cuenta del IGTF
          <CuentaBuscador v-model="c.cuentaIgtf" :titulo="titulos[c.cuentaIgtf]" :invalida="noExiste(c.cuentaIgtf)" @elegida="elegida" />
          <small v-if="noExiste(c.cuentaIgtf)" class="error">La cuenta {{ c.cuentaIgtf }} no existe en la contabilidad.</small>
        </div>
        <label class="campo corto">Tasa IGTF % <input v-model.number="c.tasaIgtf" type="number" min="0" max="99" step="0.01" /></label>
      </div>
      <p class="nota">IGTF en 0 % = no se genera el IGTF en los pagos.</p>
      <label class="campo">
        Raíz de la cuenta de cada pagaré
        <input v-model="c.raizPagare" maxlength="9" inputmode="numeric" required />
        <small class="nota">
          Cada pagaré nuevo crea su cuenta debajo de esta raíz.
          <template v-if="ultimaDeRaiz">Última: {{ ultimaDeRaiz.codigo }} — {{ ultimaDeRaiz.titulo }}.</template>
          <template v-else-if="bdContable">Todavía no hay cuentas con esa raíz.</template>
        </small>
      </label>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="guardado" class="exito">Guardado.</p>
      <div class="acciones">
        <button type="button" class="secundario" @click="emit('cerrar')">Cerrar</button>
        <button type="submit" :disabled="guardando">{{ guardando ? 'Guardando…' : 'Guardar' }}</button>
      </div>
    </form>
    <p v-else-if="error" class="error">{{ error }}</p>
  </BaseModal>
</template>

<style scoped>
.config {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
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
}
.campo input {
  text-transform: none;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--text);
}
.campo small {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}
.fila {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.crece {
  flex: 1;
}
.campo.corto input {
  width: 7rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 600;
}
.nota {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
}
.aviso {
  font-size: 0.82rem;
  color: var(--color-warning, #a15c00);
  margin: 0;
}
.error {
  color: var(--color-error);
  font-size: 0.8rem;
  margin: 0;
}
.exito {
  color: var(--color-success, #2f7d32);
  font-size: 0.85rem;
  margin: 0;
}
.acciones {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
