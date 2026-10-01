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
  { id: 'libro-compra', nombre: 'Libro de Compra', grupo: 'Compras' },
  { id: 'movimiento-inventario', nombre: 'Movimiento de Inventario', grupo: 'Inventario' },
  { id: 'retenciones-iva', nombre: 'Retenciones IVA', grupo: 'Retenciones e Impuestos' },
  { id: 'retenciones-islr', nombre: 'Retenciones ISLR', grupo: 'Retenciones e Impuestos' },
  { id: 'resumen-igtf', nombre: 'Resumen IGTF', grupo: 'Retenciones e Impuestos' },
  { id: 'arcv', nombre: 'ARCV (Retenciones)', grupo: 'Retenciones e Impuestos' },
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

const IDS = new Set<string>([...MODULOS.map((m) => m.id), PERMISO_CONFIG_CAJAS]);

/** Id asignable a un usuario: un reporte de `MODULOS` o `PERMISO_CONFIG_CAJAS`. */
export function esModuloValido(id: string): boolean {
  return IDS.has(id);
}

/** Id de un reporte del catálogo (lo que controla /api/reportes/*). */
export function esModuloReporte(id: string): id is ModuloId {
  return MODULOS.some((m) => m.id === id);
}
