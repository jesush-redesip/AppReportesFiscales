import fp from 'fastify-plugin';
import { redactar } from '../shared/debug/debug.js';
import { registrarAuditoria } from '../shared/auditoria/auditoria.js';
const TIPOS_CONTABILIZAR = {
    '1': 'Contabilizar cierre',
    '2': 'Contabilizar depósito',
    '3': 'Contabilizar compras',
};
/**
 * Acciones auditadas, por `MÉTODO ruta` (la ruta registrada en Fastify, sin query).
 * Las consultas (vistas previas, listados) NO se auditan: solo lo que cambia datos,
 * los inicios de sesión, las descargas de Excel y el modo debug.
 */
const REGLAS = {
    // El login es en dos pasos: la contraseña (solo se audita si falla) y la empresa.
    'POST /api/auth/login': { accion: (_b, _q, r) => (r && 'preAuthToken' in r ? null : 'Inicio de sesión fallido'), detalle: () => null },
    'POST /api/auth/select-empresa': {
        accion: (_b, _q, r) => (r && 'token' in r ? 'Inicio de sesión' : 'Inicio de sesión fallido'),
        detalle: (b) => ({ codEmpresa: b?.codEmpresa }),
    },
    // Queda con la empresa de la sesión (la de origen); el detalle dice a cuál pasó.
    'POST /api/auth/cambiar-empresa': {
        accion: () => 'Cambio de empresa',
        detalle: (b) => ({ haciaCodEmpresa: b?.codEmpresa }),
    },
    'POST /api/cajas/contabilizar': { accion: (b) => TIPOS_CONTABILIZAR[String(b?.tipo)] ?? 'Contabilizar' },
    'POST /api/cajas/descontabilizar': { accion: () => 'Descontabilizar cierre' },
    'POST /api/cajas/descontabilizar-deposito': { accion: () => 'Descontabilizar depósito' },
    'POST /api/cajas/traspasar': { accion: () => 'Traspasar facturas' },
    'POST /api/cajas/declarado': { accion: () => 'Modificar declarado' },
    'POST /api/cajas/forma-pago': { accion: () => 'Agregar forma de pago' },
    'DELETE /api/cajas/forma-pago': { accion: () => 'Eliminar forma de pago' },
    'PUT /api/config/cuentas': { accion: () => 'Configuración del cierre' },
    'PUT /api/config/permisos': { accion: () => 'Permisos de usuario' },
    'PUT /api/config/modulos-activos': {
        accion: (_b, _q, r) => (r && Array.isArray(r.cambios) && r.cambios.length === 0 ? null : 'Módulos de la instalación'),
        detalle: () => null,
    },
    // Formas de pago del asiento: el detalle son los `cambios` (antes → después) que devuelve la ruta.
    'PUT /api/config/formas-pago/relaciones': { accion: (_b, _q, r) => (r && Array.isArray(r.cambios) && r.cambios.length === 0 ? null : 'Formas de pago del asiento'), detalle: () => null },
    'POST /api/config/formas-pago/catalogo': { accion: () => 'Nombre de forma de pago (nuevo)', detalle: (b) => ({ descripcion: b?.descripcion }) },
    'PUT /api/config/formas-pago/catalogo/:id': { accion: () => 'Nombre de forma de pago (editado)', detalle: () => null },
    'DELETE /api/config/formas-pago/catalogo/:id': { accion: () => 'Nombre de forma de pago (eliminado)', detalle: () => null },
    'POST /api/debug/estado': { accion: (b) => (b?.activo ? 'Modo debug activado' : 'Modo debug desactivado') },
    // El resultado final (tras reiniciar el servicio) lo registra el actualizador al arrancar.
    'POST /api/actualizador/actualizar': { accion: () => 'Actualización del aplicativo (iniciada)', detalle: () => null },
};
/** Descargas de Excel: GET /api/reportes/<modulo> (la vista previa es /preview y no se audita). */
const RUTA_EXCEL = /^\/api\/reportes\/([a-z0-9-]+)$/;
function parsear(payload) {
    if (!payload)
        return null;
    try {
        const v = JSON.parse(payload);
        return v && typeof v === 'object' ? v : null;
    }
    catch {
        return null;
    }
}
/**
 * Resultado real de la acción: el código HTTP no alcanza, porque varias rutas de cajas
 * responden 200 con `{ status: 'ERROR' }` o `{ ok: false }` cuando la base rechaza la
 * operación.
 */
function resultadoDe(estado, r) {
    // `message`: errores HTTP; `mensaje`: el error de SQL Server que devuelve contabilizar.
    const mensaje = typeof r?.message === 'string' ? r.message : typeof r?.mensaje === 'string' ? r.mensaje : null;
    if (estado === 401 || estado === 403)
        return { resultado: 'RECHAZADO', mensaje };
    if (estado >= 400)
        return { resultado: 'ERROR', mensaje };
    if (typeof r?.status === 'string' && r.status !== 'SUCCESS')
        return { resultado: 'ERROR', mensaje: mensaje ?? `Estado ${r.status}` };
    if (r?.ok === false)
        return { resultado: 'ERROR', mensaje };
    return { resultado: 'OK', mensaje: null };
}
/** Usuario de la acción: la sesión, o (en el login) lo que devolvió el propio login. */
function quien(request, r) {
    if (request.user) {
        return { codUsuario: request.user.codUsuario, usuario: request.user.usuario, codEmpresa: request.user.codEmpresa, bd: request.user.bd };
    }
    const empresa = (r?.empresa ?? null);
    return {
        codUsuario: typeof r?.codUsuario === 'number' ? r.codUsuario : null,
        usuario: typeof r?.usuario === 'string' ? r.usuario : null,
        codEmpresa: empresa?.codEmpresa ?? null,
        bd: empresa?.bd ?? null,
    };
}
async function auditoriaPlugin(fastify) {
    fastify.addHook('onSend', async (request, _reply, payload) => {
        if (typeof payload === 'string' && payload.length < 20000)
            request.auditoriaRespuesta = payload;
        return payload;
    });
    fastify.addHook('onResponse', async (request, reply) => {
        const ruta = request.routeOptions?.url ?? request.url.split('?')[0];
        const clave = `${request.method} ${ruta}`;
        const body = (request.body ?? undefined);
        const query = (request.query ?? {});
        const respuesta = parsear(request.auditoriaRespuesta);
        let accion = null;
        let detalle = body ?? null;
        const regla = REGLAS[clave];
        if (regla) {
            accion = regla.accion(body, query, respuesta);
            if (regla.detalle)
                detalle = regla.detalle(body, query);
        }
        else if (request.method === 'GET') {
            const m = RUTA_EXCEL.exec(ruta);
            if (m) {
                accion = 'Descarga Excel';
                detalle = { reporte: m[1], ...query };
            }
        }
        if (!accion)
            return;
        // Rutas que devuelven `cambios` (antes → después): eso es lo que se audita.
        if (respuesta && Array.isArray(respuesta.cambios)) {
            detalle = { ...(detalle && typeof detalle === 'object' ? detalle : {}), cambios: respuesta.cambios };
        }
        // Contabilizar devuelve los números del asiento creado: quedan junto al detalle.
        if (typeof respuesta?.asiento === 'number' && detalle && typeof detalle === 'object') {
            detalle = { ...detalle, asiento: respuesta.asiento, asientoVisible: respuesta.asientoVisible };
        }
        const { resultado, mensaje } = resultadoDe(reply.statusCode, respuesta);
        // Sin esperar: la respuesta ya se envió y la auditoría no debe demorar nada.
        void registrarAuditoria({
            ...quien(request, respuesta),
            accion,
            detalle: detalle == null ? null : redactar(detalle),
            resultado,
            mensaje,
            metodo: request.method,
            ruta: request.url.slice(0, 300),
            ip: request.ip ?? null,
        });
    });
}
export default fp(auditoriaPlugin);
//# sourceMappingURL=auditoria.js.map