<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api';
import { useAuthStore, type EmpresaGeneral, type PermisosCaja } from '../stores/auth.store';
import AppIcon from '../components/icons/AppIcon.vue';

interface PasswordLoginResponse {
  preAuthToken: string;
  usuario: string;
  empresas: EmpresaGeneral[];
}

interface SelectEmpresaResponse {
  token: string;
  usuario: string;
  codUsuario: number;
  empresa: EmpresaGeneral;
  permisos: PermisosCaja;
  modulos: string[];
}

type Step = 'password' | 'empresa';

const step = ref<Step>('password');
const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

const preAuthToken = ref('');
const usuarioNombre = ref('');
const empresas = ref<EmpresaGeneral[]>([]);
const codEmpresaSeleccionada = ref<number | ''>('');

const auth = useAuthStore();
const router = useRouter();

async function onSubmitPassword() {
  loading.value = true;
  error.value = null;
  try {
    const result = await api.post<PasswordLoginResponse>('/api/auth/login', { password: password.value });
    preAuthToken.value = result.preAuthToken;
    usuarioNombre.value = result.usuario;
    empresas.value = result.empresas;
    step.value = 'empresa';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Error al iniciar sesión';
  } finally {
    loading.value = false;
  }
}

async function onSubmitEmpresa() {
  if (codEmpresaSeleccionada.value === '') return;
  loading.value = true;
  error.value = null;
  try {
    const result = await api.post<SelectEmpresaResponse>('/api/auth/select-empresa', {
      preAuthToken: preAuthToken.value,
      codEmpresa: codEmpresaSeleccionada.value,
    });
    auth.setSession(
      result.token,
      result.usuario,
      result.codUsuario,
      result.empresa,
      result.permisos,
      result.modulos,
    );
    router.push('/');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Error al seleccionar la empresa';
  } finally {
    loading.value = false;
  }
}

function volver() {
  step.value = 'password';
  password.value = '';
  error.value = null;
}
</script>

<template>
  <section class="login-page">
    <div class="login-card">
      <div class="brand-mark" aria-hidden="true">
        <AppIcon name="table" :size="22" />
      </div>
      <h1>Reportes Fiscales</h1>
      <p class="subtitulo">Redes IP · Acceso al sistema</p>

      <form v-if="step === 'password'" @submit.prevent="onSubmitPassword">
        <div class="campo">
          <label>Contraseña</label>
          <div class="input-icon">
            <AppIcon name="lock" :size="16" />
            <input v-model="password" type="password" required autocomplete="current-password" autofocus />
          </div>
        </div>
        <button type="submit" :disabled="loading">{{ loading ? 'Verificando...' : 'Ingresar' }}</button>
        <p v-if="error" class="error">{{ error }}</p>
      </form>

      <form v-else @submit.prevent="onSubmitEmpresa">
        <p class="saludo">Hola, <strong>{{ usuarioNombre }}</strong>. Elegí a qué empresa conectarte:</p>
        <div class="campo">
          <label>Empresa</label>
          <select v-model="codEmpresaSeleccionada" required>
            <option value="" disabled>Seleccionar...</option>
            <option v-for="e in empresas" :key="e.codEmpresa" :value="e.codEmpresa">
              {{ e.titulo }}
            </option>
          </select>
        </div>
        <div class="acciones">
          <button type="button" class="secundario" @click="volver">Volver</button>
          <button type="submit" :disabled="loading || codEmpresaSeleccionada === ''">
            {{ loading ? 'Ingresando...' : 'Continuar' }}
          </button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </div>
  </section>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background:
    radial-gradient(circle at 15% 10%, var(--color-brand-bg) 0%, transparent 45%),
    radial-gradient(circle at 85% 90%, var(--color-brand-bg) 0%, transparent 45%),
    var(--bg-subtle);
}
.login-card {
  width: 100%;
  max-width: 380px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-6) var(--space-6) var(--space-5);
  box-shadow: var(--shadow-lg);
}
.brand-mark {
  width: 48px;
  height: 48px;
  border-radius: var(--radius);
  background: var(--color-brand);
  color: var(--color-white);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-4);
}
h1 {
  font-size: 1.35rem;
  margin-bottom: 0.15rem;
}
.subtitulo {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: var(--space-5);
}
form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.campo {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.input-icon {
  position: relative;
  display: flex;
  align-items: center;
}
.input-icon svg {
  position: absolute;
  left: 0.7rem;
  color: var(--text-faint);
  pointer-events: none;
}
.input-icon input {
  width: 100%;
  padding-left: 2.15rem;
}
.saludo {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}
.saludo strong {
  color: var(--text);
}
.acciones {
  display: flex;
  gap: var(--space-2);
}
.acciones button {
  flex: 1;
}
button {
  height: 2.5rem;
}
.error {
  color: var(--color-error);
  background: var(--color-error-bg);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.7rem;
  font-size: 0.83rem;
  margin: 0;
}
</style>
