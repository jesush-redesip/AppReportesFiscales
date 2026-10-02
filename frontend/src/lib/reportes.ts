import type { IconName } from '../components/icons/AppIcon.vue';

export interface ReporteLink {
  path: string;
  nombre: string;
  /** Sub-permiso asignable en la ventana de permisos (RIP_PERMISOSMODULOS). */
  permisoModulo?: string;
}

/** Acceso a Cierre de Caja › Configuración. Mismo id que `PERMISO_CONFIG_CAJAS` del backend. */
export const PERMISO_CONFIG_CAJAS = 'cajas-configuracion';

/** Supervisor interno del cliente. Mismo id que `PERMISO_SUPERVISOR_INTERNO` del backend. */
export const PERMISO_SUPERVISOR_INTERNO = 'supervisor-interno';

export interface ReporteGroup {
  id: string;
  label: string;
  icon: IconName;
  /** Cuando está presente, el grupo solo se lista si el usuario tiene ese permiso
   * (ver `auth.store.permisos`). Es solo visibilidad de navegación — el backend
   * revalida el permiso real en cada endpoint. */
  permiso?: 'visualizarCajas';
  reportes: ReporteLink[];
}

/** Single source of truth for report navigation — used by the sidebar, the home
 * dashboard, and breadcrumbs, so they never drift out of sync with each other. */
export const REPORT_GROUPS: ReporteGroup[] = [
  {
    id: 'operaciones',
    label: 'Cierre de Caja',
    icon: 'table',
    permiso: 'visualizarCajas',
    reportes: [
      { path: '/cajas', nombre: 'Contabilizar / Descontabilizar' },
      // Antes era la pestaña "Cuentas" del modal del engranaje del header.
      { path: '/cajas/configuracion', nombre: 'Configuración', permisoModulo: PERMISO_CONFIG_CAJAS },
    ],
  },
  {
    id: 'ventas',
    label: 'Ventas',
    icon: 'receipt',
    reportes: [
      { path: '/libro-venta', nombre: 'Libro de Venta' },
      { path: '/libro-venta-isla', nombre: 'Libro de Venta Isla' },
    ],
  },
  {
    id: 'compras',
    label: 'Compras',
    icon: 'cart',
    reportes: [{ path: '/libro-compra', nombre: 'Libro de Compra' }],
  },
  {
    id: 'inventario',
    label: 'Inventario',
    icon: 'box',
    reportes: [{ path: '/movimiento-inventario', nombre: 'Movimiento de Inventario' }],
  },
  {
    id: 'retenciones',
    label: 'Retenciones e Impuestos',
    icon: 'percent',
    reportes: [
      { path: '/retenciones-iva', nombre: 'Retenciones IVA' },
      { path: '/retenciones-islr', nombre: 'Retenciones ISLR' },
      { path: '/resumen-igtf', nombre: 'Resumen IGTF' },
      { path: '/arcv', nombre: 'ARCV (Retenciones)' },
    ],
  },
];

/**
 * Navegación visible para este usuario. Dos reglas distintas conviven:
 *  - Grupos con `permiso` (hoy solo Operaciones/Cajas) dependen de la bandera
 *    correspondiente de RIP_PERMISOSUSUARIOS.
 *  - El resto son módulos asignables uno por uno: se muestra el reporte solo si su
 *    ruta está entre los módulos habilitados, y el grupo desaparece si se queda sin
 *    ningún reporte visible.
 * Criterio restrictivo: sin módulos asignados no se ve nada.
 */
export function gruposVisibles(
  permisos: { visualizarCajas: boolean },
  modulos: string[] = [],
): ReporteGroup[] {
  return REPORT_GROUPS.map((g) => {
    if (g.permiso) {
      // Sin la bandera solo quedan los sub-permisos que el usuario tenga por sí mismos
      // (el supervisor interno configura el cierre sin necesitar "Acceso al módulo").
      const reportes = g.reportes.filter((r) =>
        r.permisoModulo ? modulos.includes(r.permisoModulo) : permisos[g.permiso!],
      );
      return reportes.length > 0 ? { ...g, reportes } : null;
    }
    const reportes = g.reportes.filter((r) => modulos.includes(r.path.replace(/^\//, '')));
    return reportes.length > 0 ? { ...g, reportes } : null;
  }).filter((g): g is ReporteGroup => g !== null);
}

/** Ruta -> id de módulo (`/libro-venta` -> `libro-venta`). */
export function moduloDeRuta(path: string): string {
  return path.replace(/^\//, '');
}

export function findReporte(path: string): { group: ReporteGroup; reporte: ReporteLink } | undefined {
  for (const group of REPORT_GROUPS) {
    const reporte = group.reportes.find((r) => r.path === path);
    if (reporte) return { group, reporte };
  }
  return undefined;
}
