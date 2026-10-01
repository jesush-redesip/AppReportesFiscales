import { requireConfiguracionCajas } from '../../shared/auth/permisos.js';
import { FormasPagoError, MAX_NOMBRE, crearNombre, eliminarNombre, guardarRelaciones, listarFormasPago, renombrar, } from './formas-pago-asiento.repository.js';
/**
 * Cierre de Caja › Configuración › Formas de pago del asiento. Mismo permiso que las
 * cuentas del cierre (Configuración del Cierre de Caja). Las respuestas de los cambios
 * traen `cambios`, que la auditoría guarda como detalle (antes → después).
 */
export default async function formasPagoAsientoRoutes(fastify) {
    const conAcceso = { preHandler: requireConfiguracionCajas };
    async function manejar(reply, fn) {
        try {
            return await fn();
        }
        catch (err) {
            if (err instanceof FormasPagoError)
                return reply.status(400).send({ error: 'BadRequest', message: err.message });
            throw err;
        }
    }
    fastify.get('/api/config/formas-pago', conAcceso, async (req, reply) => manejar(reply, () => listarFormasPago(req.user.bd)));
    fastify.put('/api/config/formas-pago/relaciones', {
        ...conAcceso,
        schema: {
            body: {
                type: 'object',
                required: ['items'],
                properties: {
                    items: {
                        type: 'array',
                        maxItems: 500,
                        items: {
                            type: 'object',
                            required: ['codFormaPago', 'idFormaPago'],
                            properties: {
                                codFormaPago: { type: 'string', minLength: 1, maxLength: 12 },
                                idFormaPago: { type: ['integer', 'null'] },
                            },
                        },
                    },
                },
            },
        },
    }, async (req, reply) => manejar(reply, async () => ({ ok: true, cambios: await guardarRelaciones(req.user.bd, req.body.items) })));
    const cuerpoNombre = {
        type: 'object',
        required: ['descripcion'],
        properties: { descripcion: { type: 'string', minLength: 1, maxLength: MAX_NOMBRE * 2 } },
    };
    fastify.post('/api/config/formas-pago/catalogo', { ...conAcceso, schema: { body: cuerpoNombre } }, async (req, reply) => manejar(reply, async () => {
        const nombre = await crearNombre(req.user.bd, req.body.descripcion);
        return { ok: true, nombre, cambios: [{ antes: null, despues: nombre.descripcion }] };
    }));
    fastify.put('/api/config/formas-pago/catalogo/:id', { ...conAcceso, schema: { body: cuerpoNombre, params: { type: 'object', properties: { id: { type: 'string', pattern: '^\\d+$' } } } } }, async (req, reply) => manejar(reply, async () => {
        const r = await renombrar(req.user.bd, Number(req.params.id), req.body.descripcion);
        return { ok: true, cambios: [{ id: Number(req.params.id), ...r }] };
    }));
    fastify.delete('/api/config/formas-pago/catalogo/:id', { ...conAcceso, schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: '^\\d+$' } } } } }, async (req, reply) => manejar(reply, async () => {
        const r = await eliminarNombre(req.user.bd, Number(req.params.id));
        return { ok: true, cambios: [{ id: Number(req.params.id), antes: r.eliminado, despues: null }] };
    }));
}
//# sourceMappingURL=formas-pago-asiento.routes.js.map