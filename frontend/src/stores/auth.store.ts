import { defineStore } from 'pinia';
import { api } from '../lib/api';
import { PERMISO_SUPERVISOR_INTERNO } from '../lib/reportes';
import { useCatalogosStore } from './catalogos.store';

const TOKEN_KEY = 'auth_token';
const SESION_KEY = 'auth_sesion';

export interface EmpresaGeneral {
  codEmpresa: number;
  titulo: string;
  bd: string;
}

export interface PermisosCaja {
  visualizarCajas: boolean;
  contabilizar: boolean;
  descontabilizar: boolean;
}

const PERMISOS_VACIOS: PermisosCaja = { visualizarCajas: false, contabilizar: false, descontabilizar: false };

interface SesionPersistida {
  usuario: string;
  codUsuario: number;
  empresa: EmpresaGeneral;
  permisos: PermisosCaja;
  /** Ids de módulos habilitados. Vacío = no ve ningún reporte (criterio restrictivo). */
  modulos: string[];
}

/**
 * El resto de la sesión (usuario, empresa y permisos) se persiste junto al token, no
 * solo en memoria: `isAuthenticated` depende únicamente de que el token sobreviva en
 * localStorage, así que al recargar la página el usuario seguía "dentro" pero con
 * empresa/permisos vacíos — lo que dejaba el header sin datos y ocultaba los módulos
 * gateados por permiso (Cajas desaparecía del menú tras un F5). La sesión se restaura
 * completa o no se restaura.
 */
function leerSesionPersistida(): SesionPersistida | null {
  const raw = localStorage.getItem(SESION_KEY);
  if (!raw) return null;
  try {
    const sesion = JSON.parse(raw) as SesionPersistida;
    if (!sesion?.usuario || sesion?.codUsuario == null || !sesion?.empresa || !sesion?.permisos) return null;
    if (!Array.isArray(sesion.modulos)) return null;
    return sesion;
  } catch {
    return null;
  }
}

/**
 * Estado inicial coherente: token y resto de la sesión van juntos o no van. Un token
 * sin sesión persistida es lo que queda de una sesión abierta ANTES de que la sesión
 * completa se empezara a guardar (o de un localStorage manipulado): dejaba al usuario
 * "dentro" pero sin empresa, sin nombre y sin permisos, o sea con Cajas oculto y sin
 * ninguna pista de por qué. En ese caso se descarta todo y se vuelve a login, que es
 * recuperable con un re-login normal.
 */
function restaurarSesion() {
  const token = localStorage.getItem(TOKEN_KEY);
  const sesion = leerSesionPersistida();
  if (!token || !sesion) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESION_KEY);
    return {
      token: null,
      usuario: null,
      codUsuario: null,
      empresa: null,
      permisos: { ...PERMISOS_VACIOS },
      modulos: [] as string[],
    };
  }
  return {
    token,
    usuario: sesion.usuario,
    codUsuario: sesion.codUsuario,
    empresa: sesion.empresa,
    permisos: sesion.permisos,
    modulos: sesion.modulos,
  };
}

const inicial = restaurarSesion();

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: inicial.token as string | null,
    usuario: inicial.usuario as string | null,
    codUsuario: inicial.codUsuario as number | null,
    empresa: inicial.empresa as EmpresaGeneral | null,
    // Solo para mostrar/ocultar UI — el backend siempre revalida el permiso real en
    // cada mutación de Cajas, este snapshot puede quedar desactualizado durante la
    // sesión si un admin cambia permisos desde el modal de Configuración.
    permisos: inicial.permisos as PermisosCaja,
    modulos: inicial.modulos as string[],
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token),
    /** En ICG el administrador es CODUSUARIO = 0 (la fila SUPERVISOR). Solo él
     * administra los permisos de usuarios; el backend aplica el mismo criterio. */
    esSupervisor: (state) => state.codUsuario === 0,
    /** Supervisor interno del cliente (lo marca el SUPERVISOR): administra permisos y
     * configura el cierre. El backend solo lo incluye en los módulos de quien lo es. */
    esSupervisorInterno: (state) => state.codUsuario !== 0 && state.modulos.includes(PERMISO_SUPERVISOR_INTERNO),
    /** Quién ve el engranaje de Permisos de Usuario. */
    puedeAdministrarPermisos(): boolean {
      return this.esSupervisor || this.esSupervisorInterno;
    },
    /** Sin módulos asignados no se ve ningún reporte; el backend rechaza igual. */
    puedeVerModulo: (state) => (id: string) => state.modulos.includes(id),
  },
  actions: {
    setSession(
      token: string,
      usuario: string,
      codUsuario: number,
      empresa: EmpresaGeneral,
      permisos: PermisosCaja,
      modulos: string[],
    ) {
      // Every session switch (even without an explicit logout in between) points at
      // a different tenant database — catalog data (empresas/almacenes/monedas) is
      // per-tenant and must never leak from a previously selected company.
      useCatalogosStore().$reset();
      this.token = token;
      this.usuario = usuario;
      this.codUsuario = codUsuario;
      this.empresa = empresa;
      this.permisos = permisos;
      this.modulos = modulos;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(
        SESION_KEY,
        JSON.stringify({ usuario, codUsuario, empresa, permisos, modulos } satisfies SesionPersistida),
      );
    },
    /**
     * Refresca los permisos de la sesión en curso sin re-login. Se usa cuando el propio
     * usuario edita sus permisos desde la ventana de Configuración: sin esto, guardaba
     * el cambio en la base pero su menú seguía mostrando el estado anterior hasta
     * volver a entrar, y parecía que el guardado no había hecho nada.
     */
    actualizarPermisosPropios(permisos: PermisosCaja, modulos: string[]) {
      this.permisos = permisos;
      this.modulos = modulos;
      if (!this.usuario || this.codUsuario == null || !this.empresa) return;
      localStorage.setItem(
        SESION_KEY,
        JSON.stringify({
          usuario: this.usuario,
          codUsuario: this.codUsuario,
          empresa: this.empresa,
          permisos,
          modulos,
        } satisfies SesionPersistida),
      );
    },
    /**
     * Vuelve a pedir al backend el acceso real (permisos, módulos activos, supervisor
     * interno). Al abrir la app y tras cambiar permisos o módulos activos: el menú no se
     * queda con lo que había al iniciar sesión. Si falla, se conserva lo que había.
     */
    async refrescarAcceso() {
      if (!this.token) return;
      try {
        const acceso = await api.get<{ permisos: PermisosCaja; modulos: string[] }>('/api/auth/acceso');
        this.actualizarPermisosPropios(acceso.permisos, acceso.modulos);
      } catch {
        /* sin cambios */
      }
    },
    logout() {
      useCatalogosStore().$reset();
      this.token = null;
      this.usuario = null;
      this.codUsuario = null;
      this.empresa = null;
      this.permisos = { ...PERMISOS_VACIOS };
      this.modulos = [];
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SESION_KEY);
    },
  },
});
