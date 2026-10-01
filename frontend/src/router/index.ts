import { createRouter, createWebHistory } from 'vue-router';
import ReportesMenu from '../views/ReportesMenu.vue';
import LibroCompraView from '../views/LibroCompraView.vue';
import MovimientoInventarioView from '../views/MovimientoInventarioView.vue';
import LibroVentaView from '../views/LibroVentaView.vue';
import LibroVentaIslaView from '../views/LibroVentaIslaView.vue';
import RetencionesIvaView from '../views/RetencionesIvaView.vue';
import ResumenIgtfView from '../views/ResumenIgtfView.vue';
import RetencionesIslrView from '../views/RetencionesIslrView.vue';
import ArcvView from '../views/ArcvView.vue';
import CajasView from '../views/CajasView.vue';
import CajasConfiguracionView from '../views/CajasConfiguracionView.vue';
import AuditoriaView from '../views/AuditoriaView.vue';
import ActualizacionesView from '../views/ActualizacionesView.vue';
import LoginView from '../views/LoginView.vue';
import { useAuthStore } from '../stores/auth.store';
import { PERMISO_CONFIG_CAJAS, moduloDeRuta } from '../lib/reportes';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true } },
    { path: '/', component: ReportesMenu },
    { path: '/libro-compra', component: LibroCompraView },
    { path: '/movimiento-inventario', component: MovimientoInventarioView },
    { path: '/libro-venta', component: LibroVentaView },
    { path: '/libro-venta-isla', component: LibroVentaIslaView },
    { path: '/retenciones-iva', component: RetencionesIvaView },
    { path: '/resumen-igtf', component: ResumenIgtfView },
    { path: '/retenciones-islr', component: RetencionesIslrView },
    { path: '/arcv', component: ArcvView },
    { path: '/cajas', component: CajasView },
    { path: '/cajas/configuracion', component: CajasConfiguracionView },
    { path: '/auditoria', component: AuditoriaView },
    { path: '/actualizaciones', component: ActualizacionesView },
  ],
});

/** Rutas que no son un módulo asignable: no pasan por el chequeo de permisos. */
const RUTAS_SIN_MODULO = new Set(['/', '/login']);

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) {
    return { path: '/login' };
  }
  if (to.path === '/login' && auth.isAuthenticated) {
    return { path: '/' };
  }

  // Auditoría: solo SUPERVISOR (el backend también rechaza /api/auditoria a los demás).
  if (to.path === '/auditoria' || to.path === '/actualizaciones') return auth.esSupervisor ? true : { path: '/' };

  // Configuración del cierre: quien tenga el permiso "Configuración" del Cierre de Caja
  // además del acceso al cierre (el backend valida lo mismo). El SUPERVISOR incluido.
  if (to.path === '/cajas/configuracion') {
    const permitido = auth.permisos.visualizarCajas && auth.modulos.includes(PERMISO_CONFIG_CAJAS);
    return permitido ? true : { path: '/' };
  }

  // Escribir la URL a mano no debe saltear los permisos. El backend igual responde 403,
  // pero sin esto el usuario vería la pantalla del reporte y un error recién al
  // generarlo. Cajas tiene su propia bandera; el resto son módulos asignables.
  // Sin excepción para el SUPERVISOR: también respeta sus permisos (su administración
  // —Permisos de Usuario, Auditoría, Debug— no depende de módulos).
  if (auth.isAuthenticated && !RUTAS_SIN_MODULO.has(to.path)) {
    const permitido =
      to.path === '/cajas' ? auth.permisos.visualizarCajas : auth.puedeVerModulo(moduloDeRuta(to.path));
    if (!permitido) return { path: '/' };
  }
});
