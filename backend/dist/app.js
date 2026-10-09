import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import debugPlugin from './plugins/debug.js';
import auditoriaPlugin from './plugins/auditoria.js';
import authPlugin from './plugins/auth.js';
import modulosPlugin from './plugins/modulos.js';
import authRoutes from './modules/auth/auth.routes.js';
import catalogosRoutes from './modules/catalogos/catalogos.routes.js';
import libroCompraRoutes from './modules/libro-compra/libro-compra.routes.js';
import movimientoInventarioRoutes from './modules/movimiento-inventario/movimiento-inventario.routes.js';
import libroVentaRoutes from './modules/libro-venta/libro-venta.routes.js';
import libroVentaIslaRoutes from './modules/libro-venta-isla/libro-venta-isla.routes.js';
import retencionesIvaRoutes from './modules/retenciones-iva/retenciones-iva.routes.js';
import resumenIgtfRoutes from './modules/resumen-igtf/resumen-igtf.routes.js';
import retencionesIslrRoutes from './modules/retenciones-islr/retenciones-islr.routes.js';
import arcvRoutes from './modules/arcv/arcv.routes.js';
import configuracionCuentasRoutes from './modules/configuracion-cuentas/configuracion-cuentas.routes.js';
import permisosRoutes from './modules/permisos/permisos.routes.js';
import cajasRoutes from './modules/cajas/cajas.routes.js';
import auditoriaRoutes from './modules/auditoria/auditoria.routes.js';
import formasPagoAsientoRoutes from './modules/formas-pago-asiento/formas-pago-asiento.routes.js';
import actualizadorRoutes from './modules/actualizador/actualizador.routes.js';
import detalleVentasRoutes from './modules/detalle-ventas/detalle-ventas.routes.js';
import detalleComprasRoutes from './modules/detalle-compras/detalle-compras.routes.js';
import frontendEstatico from './plugins/frontend-estatico.js';
import { versionInstalada } from './shared/app-info.js';
import { auditarResultadoActualizacion } from './modules/actualizador/actualizador.service.js';
export async function build() {
    const fastify = Fastify({
        logger: {
            transport: { target: 'pino-pretty' },
        },
    });
    await fastify.register(cors, { origin: env.corsOrigin });
    // Antes que auth: el contexto de cada petición debe existir desde el primer hook.
    await fastify.register(debugPlugin);
    await fastify.register(auditoriaPlugin);
    await fastify.register(errorHandlerPlugin);
    await fastify.register(authPlugin);
    await fastify.register(modulosPlugin);
    await fastify.register(authRoutes);
    await fastify.register(catalogosRoutes);
    await fastify.register(libroCompraRoutes);
    await fastify.register(movimientoInventarioRoutes);
    await fastify.register(libroVentaRoutes);
    await fastify.register(libroVentaIslaRoutes);
    await fastify.register(retencionesIvaRoutes);
    await fastify.register(resumenIgtfRoutes);
    await fastify.register(retencionesIslrRoutes);
    await fastify.register(arcvRoutes);
    await fastify.register(configuracionCuentasRoutes);
    await fastify.register(permisosRoutes);
    await fastify.register(cajasRoutes);
    await fastify.register(auditoriaRoutes);
    await fastify.register(formasPagoAsientoRoutes);
    await fastify.register(actualizadorRoutes);
    await fastify.register(detalleVentasRoutes);
    await fastify.register(detalleComprasRoutes);
    // Instalado como servicio sirve también el frontend compilado (un solo puerto).
    if (env.produccion)
        await fastify.register(frontendEstatico);
    // El actualizador consulta /health para confirmar que arrancó la versión nueva.
    fastify.get('/health', async () => ({ status: 'ok', version: versionInstalada() }));
    fastify.addHook('onReady', async () => {
        void auditarResultadoActualizacion();
    });
    return fastify;
}
//# sourceMappingURL=app.js.map