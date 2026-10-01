import { requireConfiguracionCajas } from '../../shared/auth/permisos.js';
import { configuracionCuentasBodySchema, cuentasDisponiblesQuerySchema, } from './configuracion-cuentas.schema.js';
import { BaseContableInvalidaError, getConfiguracionCuentas, listarBasesContables, listarCuentasContables, updateConfiguracionCuentas, } from './configuracion-cuentas.repository.js';
/**
 * Cierre de Caja › Configuración: define contra qué cuentas contables se postean los
 * sobrantes y faltantes de cada cierre, así que es configuración sensible. Pasa el
 * SUPERVISOR o quien tenga el permiso "Configuración" del cierre asignado en la ventana
 * de permisos (ver `requireConfiguracionCajas`). El gate cubre solo las rutas HTTP — el
 * motor de cajas sigue leyendo la configuración por llamada interna
 * (`getConfiguracionCuentas`) para armar y contabilizar el asiento, sin pasar por acá,
 * de modo que un cajero sin este permiso puede seguir cerrando su caja.
 */
export default async function configuracionCuentasRoutes(fastify) {
    const conAccesoConfig = { preHandler: requireConfiguracionCajas };
    fastify.get('/api/config/cuentas', conAccesoConfig, async (req) => getConfiguracionCuentas(req.user.bd));
    fastify.put('/api/config/cuentas', { ...conAccesoConfig, schema: { body: configuracionCuentasBodySchema } }, async (req, reply) => {
        try {
            await updateConfiguracionCuentas(req.user.bd, req.body);
            return { ok: true };
        }
        catch (err) {
            if (err instanceof BaseContableInvalidaError) {
                return reply.status(400).send({ error: 'BadRequest', message: err.message });
            }
            throw err;
        }
    });
    /** Bases contables disponibles para elegir de dónde traer el plan de cuentas. */
    fastify.get('/api/config/bases-contables', conAccesoConfig, async () => listarBasesContables());
    fastify.get('/api/config/cuentas-disponibles', { ...conAccesoConfig, schema: { querystring: cuentasDisponiblesQuerySchema } }, async (req, reply) => {
        try {
            return await listarCuentasContables(req.query.bdContable);
        }
        catch (err) {
            if (err instanceof BaseContableInvalidaError) {
                return reply.status(400).send({ error: 'BadRequest', message: err.message });
            }
            throw err;
        }
    });
}
//# sourceMappingURL=configuracion-cuentas.routes.js.map