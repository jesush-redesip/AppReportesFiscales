import type { FastifyInstance } from 'fastify';
import { requirePermiso } from '../../shared/auth/permisos.js';
import {
  asientoQuerySchema,
  cierreQuerySchema,
  contabilizarBodySchema,
  cotizacionQuerySchema,
  descontabilizarBodySchema,
  descontabilizarDepositoBodySchema,
  eliminarFormaPagoBodySchema,
  formasPagoDisponiblesQuerySchema,
  guardarFormaPagoBodySchema,
  guardarMontoBodySchema,
  traspasarBodySchema,
  type ContabilizarBody,
  type DescontabilizarBody,
  type DescontabilizarDepositoBody,
  type EliminarFormaPagoBody,
  type GuardarFormaPagoBody,
  type GuardarMontoBody,
  type TraspasarBody,
} from './cajas.schema.js';
import {
  getAsiento,
  getCierre,
  getCotizacion,
  getDepositos,
  getFormasPagoDisponibles,
  getTiendas,
} from './cajas.repository.js';
import {
  contabilizar,
  descontabilizarCierre,
  descontabilizarDeposito,
  eliminarFormaPago,
  guardarFormaPago,
  guardarMontoDeclarado,
  traspasarFacturas,
} from './cajas-mutaciones.repository.js';

export default async function cajasRoutes(fastify: FastifyInstance) {
  const soloVerCajas = { preHandler: requirePermiso('VISUALIZARCAJAS') };

  fastify.get('/api/cajas/tiendas', soloVerCajas, async (req) => getTiendas(req.user!.bd));

  fastify.get<{ Querystring: { serie: string; fecha: string } }>(
    '/api/cajas/cierre',
    { ...soloVerCajas, schema: { querystring: cierreQuerySchema } },
    async (req) => getCierre(req.user!.bd, req.query.serie, req.query.fecha),
  );

  fastify.get<{ Querystring: { serie: string; fecha: string } }>(
    '/api/cajas/depositos',
    { ...soloVerCajas, schema: { querystring: cierreQuerySchema } },
    async (req) => getDepositos(req.user!.bd, req.query.serie, req.query.fecha),
  );

  fastify.get<{ Querystring: { tipo: '1' | '2'; serie: string; serieCaja: string; fecha: string; z: string } }>(
    '/api/cajas/asiento',
    { ...soloVerCajas, schema: { querystring: asientoQuerySchema } },
    async (req) => getAsiento(req.user!.bd, req.query.tipo, req.query.serie, req.query.serieCaja, req.query.fecha, req.query.z),
  );

  fastify.get<{ Querystring: { caja: string; z: string } }>(
    '/api/cajas/formas-pago-disponibles',
    { ...soloVerCajas, schema: { querystring: formasPagoDisponiblesQuerySchema } },
    async (req) => getFormasPagoDisponibles(req.user!.bd, req.query.caja, req.query.z),
  );

  fastify.get<{ Querystring: { fecha: string; importe: number } }>(
    '/api/cajas/cotizacion',
    { ...soloVerCajas, schema: { querystring: cotizacionQuerySchema } },
    async (req) => getCotizacion(req.user!.bd, req.query.fecha, req.query.importe),
  );

  const soloContabilizar = { preHandler: requirePermiso('CONTABILIZAR') };
  const soloDescontabilizar = { preHandler: requirePermiso('DESCONTABILIZAR') };

  fastify.post<{ Body: ContabilizarBody }>(
    '/api/cajas/contabilizar',
    { ...soloContabilizar, schema: { body: contabilizarBodySchema } },
    // { status, asiento }: el número de asiento lo muestra la ventana de confirmación.
    async (req) =>
      contabilizar(
        req.user!.bd,
        { usuario: req.user!.usuario, codUsuario: req.user!.codUsuario, codEmpresa: req.user!.codEmpresa },
        req.body,
      ),
  );

  fastify.post<{ Body: DescontabilizarBody }>(
    '/api/cajas/descontabilizar',
    { ...soloDescontabilizar, schema: { body: descontabilizarBodySchema } },
    async (req) => ({ status: await descontabilizarCierre(req.user!.bd, req.body) }),
  );

  // Legacy gates BOTH contabilizar and descontabilizar of a depósito behind the same
  // `CONTABILIZAR` session flag (`tabla_resultado_contabilizar.php`'s modal footer,
  // tipo=2 branch) — `DESCONTABILIZAR` only gates the cierre-de-caja revert button on
  // the main table, not this one. Preserved as-is, not a typo.
  fastify.post<{ Body: DescontabilizarDepositoBody }>(
    '/api/cajas/descontabilizar-deposito',
    { ...soloContabilizar, schema: { body: descontabilizarDepositoBodySchema } },
    async (req) => ({ status: await descontabilizarDeposito(req.user!.bd, req.body) }),
  );

  // Legacy's TRASPASAR button has no permission gate at all in `vista_cajas.php` —
  // it's the fallback action shown whenever the DESCONTABILIZAR button isn't (i.e. the
  // caja/Z isn't fully contabilizado yet, or the user lacks DESCONTABILIZAR) — so this
  // only requires the base VISUALIZARCAJAS access, matching that.
  fastify.post<{ Body: TraspasarBody }>(
    '/api/cajas/traspasar',
    { ...soloVerCajas, schema: { body: traspasarBodySchema } },
    async (req) => ({ ok: await traspasarFacturas(req.user!.bd, req.body.serieCaja, req.body.z) }),
  );

  fastify.post<{ Body: GuardarMontoBody }>(
    '/api/cajas/declarado',
    { ...soloVerCajas, schema: { body: guardarMontoBodySchema } },
    async (req) => ({ ok: await guardarMontoDeclarado(req.user!.bd, req.body) }),
  );

  fastify.post<{ Body: GuardarFormaPagoBody }>(
    '/api/cajas/forma-pago',
    { ...soloVerCajas, schema: { body: guardarFormaPagoBodySchema } },
    async (req) => ({ ok: await guardarFormaPago(req.user!.bd, req.body) }),
  );

  fastify.delete<{ Body: EliminarFormaPagoBody }>(
    '/api/cajas/forma-pago',
    { ...soloVerCajas, schema: { body: eliminarFormaPagoBodySchema } },
    async (req) => ({ ok: await eliminarFormaPago(req.user!.bd, req.body) }),
  );
}
