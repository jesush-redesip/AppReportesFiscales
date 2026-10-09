/**
 * Catálogo de módulos que se pueden habilitar por usuario. El `id` es la ruta del
 * frontend sin la barra inicial, así el menú, el router y el gate del backend hablan
 * del mismo identificador y no hay una tabla de traducción que se desincronice.
 *
 * El cierre de caja NO está acá: su visibilidad ya la controla `VISUALIZARCAJAS` en
 * RIP_PERMISOSUSUARIOS (columna que además comparte con el aplicativo PHP legacy), y
 * duplicarla acá dejaría dos fuentes de verdad para el mismo permiso.
 */
export const MODULOS = [
  { id: 'libro-venta', nombre: 'Libro de Venta', grupo: 'Ventas' },
  { id: 'libro-venta-isla', nombre: 'Libro de Venta Isla', grupo: 'Ventas' },
  { id: 'detalle-ventas', nombre: 'Detalle de Ventas', grupo: 'Ventas' },
  { id: 'libro-compra', nombre: 'Libro de Compra', grupo: 'Compras' },
  { id: 'detalle-compras', nombre: 'Detalle de Compras', grupo: 'Compras' },
  { id: 'movimiento-inventario', nombre: 'Movimiento de Inventario', grupo: 'Inventario' },
  { id: 'retenciones-iva', nombre: 'Retenciones IVA', grupo: 'Retenciones e Impuestos' },
  { id: 'retenciones-islr', nombre: 'Retenciones ISLR', grupo: 'Retenciones e Impuestos' },
  { id: 'resumen-igtf', nombre: 'Resumen IGTF', grupo: 'Retenciones e Impuestos' },
  { id: 'arcv', nombre: 'ARCV (Retenciones)', grupo: 'Retenciones e Impuestos' },
  { id: 'pagares', nombre: 'Pagarés', grupo: 'Finanzas' },
] as const;

export type ModuloId = (typeof MODULOS)[number]['id'];

/**
 * Acceso a Cierre de Caja › Configuración (cuentas de sobrante/faltante y costo de
 * venta). Se guarda en RIP_PERMISOSMODULOS como un módulo más, pero NO va en `MODULOS`:
 * ese catálogo es el de reportes (gate de /api/reportes/* y los grupos de la ventana de
 * permisos), y este es un sub-permiso del cierre que la ventana pinta junto a
 * Contabilizar/Descontabilizar. Requiere además VISUALIZARCAJAS.
 */
export const PERMISO_CONFIG_CAJAS = 'cajas-configuracion';

/**
 * Supervisor interno del cliente: un usuario del grupo económico que puede asignar
 * permisos y configurar el cierre, pero no lo reservado al SUPERVISOR (consultora):
 * auditoría, debug, actualizaciones, módulos de la instalación ni nombrar a otros
 * supervisores internos. Se guarda en RIP_PERMISOSMODULOS como un módulo más.
 */
export const PERMISO_SUPERVISOR_INTERNO = 'supervisor-interno';

/**
 * Pagarés › registrar, pagar cuotas, editarlas y anular. Sin él, el módulo "pagares" es
 * solo consulta. Se guarda en RIP_PERMISOSMODULOS y solo vale junto con "pagares".
 */
export const PERMISO_PAGARES_GESTION = 'pagares-gestion';

/** El Cierre de Caja como módulo que se activa o desactiva por instalación. */
export const MODULO_CAJAS = 'cajas';

/**
 * Módulos exclusivos de algunos grupos económicos: llegan DESACTIVADOS en cada
 * instalación hasta que el SUPERVISOR los activa (los demás vienen activos). Al
 * programar un módulo para un solo cliente, agregue aquí su id.
 */
export const MODULOS_EXCLUSIVOS = new Set<string>([
  'detalle-ventas', // tablero de ventas por tienda/día/ticket (venía del PHP reportesicg de algunos clientes)
  'detalle-compras', // compras por tienda/proveedor/documento
  'pagares', // préstamos bancarios con pagarés (tablas RIP_PAGARES* del PHP reportesicg)
]);

/** Lo que se activa por instalación (grupo económico): el cierre y cada reporte. */
export const MODULOS_ACTIVABLES: { id: string; nombre: string; grupo: string }[] = [
  { id: MODULO_CAJAS, nombre: 'Cierre de Caja', grupo: 'Cierre de Caja' },
  ...MODULOS,
];

const IDS = new Set<string>([...MODULOS.map((m) => m.id), PERMISO_CONFIG_CAJAS, PERMISO_SUPERVISOR_INTERNO, PERMISO_PAGARES_GESTION]);

/** Id asignable a un usuario: un reporte de `MODULOS`, `PERMISO_CONFIG_CAJAS` o `PERMISO_SUPERVISOR_INTERNO`. */
export function esModuloValido(id: string): boolean {
  return IDS.has(id);
}

/** Id de un reporte del catálogo (lo que controla /api/reportes/*). */
export function esModuloReporte(id: string): id is ModuloId {
  return MODULOS.some((m) => m.id === id);
}
