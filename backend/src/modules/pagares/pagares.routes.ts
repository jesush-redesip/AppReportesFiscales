import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { empresasDeSesion, type SessionTokenPayload } from '../auth/auth.service.js';
import { PagaresError, catalogos, detalle } from './pagares.repository.js';
import { COLUMNAS_DETALLE, VISTAS, conMoneda, consultar, excel, excelDetalle, type Consulta, type Vista } from './pagares.service.js';
import { MONEDAS, type Moneda } from './pagares.repository.js';
import * as gestion from './pagares.gestion.js';
import { getModulosUsuario, requireAdminPermisos } from '../../shared/auth/permisos.js';
import { bdContableReferencia, buscarCuentas, guardarConfig, leerConfig, ultimaCuentaDeRaiz, type ConfigContable } from './pagares.contabilidad.js';
import { asientosDePagare, cotizacionUsd } from './pagares.asientos.js';
import { PERMISO_PAGARES_GESTION } from '../../shared/auth/modulos.js';

/**
 * Pagarés (solo consulta). Todo bajo /api/reportes/pagares: el plugin de módulos exige
 * el módulo "pagares" activo en la instalación y asignado al usuario.
 */
interface QueryVista {
  vista: Vista;
  desde: string;
  hasta: string;
  /** SERIES separadas por coma (las de una empresa contable). */
  series?: string;
  banco?: string;
  buscar?: string;
  moneda?: Moneda;
}

const FECHA = { type: 'string', pattern: '^[0-9]{8}$' } as const;
const esquemaVista = {
  querystring: {
    type: 'object',
    required: ['vista', 'desde', 'hasta'],
    properties: {
      vista: { type: 'string', enum: VISTAS },
      desde: FECHA,
      hasta: FECHA,
      series: { type: 'string', pattern: '^[A-Za-z0-9,]*$', maxLength: 300 },
      banco: { type: 'string', maxLength: 200 },
      buscar: { type: 'string', maxLength: 40 },
      moneda: { type: 'string', enum: MONEDAS },
    },
  },
};
const esquemaDetalle = {
  querystring: {
    type: 'object',
    required: ['cod', 'corte'],
    properties: { cod: { type: 'integer' }, corte: FECHA },
  },
};

function aConsulta(q: QueryVista): Consulta {
  if (q.desde > q.hasta) throw new PagaresError('La fecha "desde" es posterior a "hasta".');
  return {
    desde: q.desde,
    hasta: q.hasta,
    series: q.series ? q.series.split(',').filter(Boolean) : undefined,
    banco: q.banco || undefined,
    buscar: q.buscar || undefined,
    moneda: q.moneda || undefined,
  };
}

async function manejar<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PagaresError) return reply.status(400).send({ error: 'BadRequest', message: err.message });
    throw err;
  }
}

async function nombreEmpresa(sesion: SessionTokenPayload): Promise<string> {
  const empresas = await empresasDeSesion(sesion).catch(() => []);
  return empresas.find((e) => e.actual)?.titulo?.trim() ?? '';
}

/** Registrar, pagar, editar y anular: además del módulo, el permiso "pagares-gestion". */
async function requireGestion(req: FastifyRequest, reply: FastifyReply) {
  const modulos = await getModulosUsuario(req.user!.codUsuario);
  if (!modulos.includes(PERMISO_PAGARES_GESTION)) {
    return reply.status(403).send({ error: 'Forbidden', message: 'No tiene permiso para registrar ni modificar pagarés.' });
  }
}

const FECHA_ISO = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' } as const;
const NUM = { type: 'number' } as const;
const ENT = { type: 'integer' } as const;
const DATOS_AMORTIZACION = {
  monto: NUM,
  tasa: NUM,
  plazo: ENT,
  fechaLiquidacion: FECHA_ISO,
  diaPago: ENT,
  frecuenciaCapital: { type: 'string', enum: ['MENSUAL', 'BIMESTRAL', 'TRIMESTRAL'] },
  frecuenciaIntereses: { type: 'string', enum: ['MENSUAL', 'TRIMESTRAL'] },
  metodo: { type: 'string', enum: ['CAPITAL_FIJO', 'CUOTA_FIJA'] },
  baseInteres: { type: 'string', enum: ['DIAS_360', 'MENSUAL'] },
  mesesGracia: ENT,
} as const;
const REQ_AMORTIZACION = Object.keys(DATOS_AMORTIZACION);
const cuerpo = (properties: Record<string, unknown>, required: string[]) => ({
  body: { type: 'object', additionalProperties: false, required, properties },
});
const REF_CUOTA = { cod: ENT, mes: ENT, fecha: FECHA_ISO };
const CARGOS = {
  type: 'array',
  maxItems: 20,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['descripcion', 'monto'],
    properties: { descripcion: { type: 'string', minLength: 1, maxLength: 80 }, monto: NUM },
  },
} as const;
const TASA = { type: 'number', exclusiveMinimum: 0 } as const;
const BS = { type: 'number', minimum: 0 } as const;
const MONEDA = { type: 'string', enum: MONEDAS } as const;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default async function pagaresRoutes(fastify: FastifyInstance) {
  const base = '/api/reportes/pagares';
  const g = { preHandler: requireGestion };
  const sesion = (req: FastifyRequest) => ({ codUsuario: req.user!.codUsuario, codEmpresa: req.user!.codEmpresa, usuario: req.user!.usuario });

  // --- Gestión ---
  fastify.get(`${base}/registro/series`, g, async (req, reply) => manejar(reply, () => gestion.seriesContables(req.user!.bd)));

  fastify.get<{ Querystring: { serie: string } }>(
    `${base}/registro/bancos`,
    { ...g, schema: { querystring: { type: 'object', required: ['serie'], properties: { serie: { type: 'string', maxLength: 15 } } } } },
    async (req, reply) => manejar(reply, () => gestion.bancos(req.user!.bd, req.query.serie)),
  );

  fastify.post<{ Body: gestion.NuevoPagare }>(
    `${base}/registro/simular`,
    { ...g, schema: cuerpo(DATOS_AMORTIZACION, REQ_AMORTIZACION) },
    async (req, reply) =>
      manejar(reply, async () => {
        try {
          return gestion.simular(req.body);
        } catch (e) {
          throw new PagaresError(e instanceof Error ? e.message : String(e));
        }
      }),
  );

  fastify.post<{ Body: gestion.NuevoPagare & gestion.DatosAsiento }>(
    `${base}/registro`,
    {
      ...g,
      schema: cuerpo(
        {
          ...DATOS_AMORTIZACION,
          pagare: ENT,
          serie: { type: 'string', minLength: 1, maxLength: 15 },
          cuentaBanco: { type: 'string', minLength: 1, maxLength: 12 },
          comision: NUM,
          cuentaComision: { type: 'string', maxLength: 15 },
          mesesInteresAdelantado: ENT,
          tasaCambio: TASA,
          cargos: CARGOS,
          moneda: MONEDA,
          montoBs: BS,
          comisionBs: BS,
        },
        [...REQ_AMORTIZACION, 'pagare', 'serie', 'cuentaBanco', 'comision', 'mesesInteresAdelantado'],
      ),
    },
    async (req, reply) =>
      manejar(reply, () => {
        const { tasaCambio, cargos, montoBs, comisionBs, ...nuevo } = req.body;
        return gestion.registrar(req.user!.bd, nuevo, sesion(req), { tasaCambio, cargos, montoBs, comisionBs });
      }),
  );

  fastify.post<{ Body: gestion.RefCuota & gestion.Pago & { cod: number } }>(
    `${base}/cuotas/pagar`,
    {
      ...g,
      schema: cuerpo(
        { ...REF_CUOTA, capital: { type: 'boolean' }, intereses: { type: 'boolean' }, fechaContable: FECHA_ISO, tasaCambio: TASA, cargos: CARGOS,
          montosBs: { type: 'object', additionalProperties: false, properties: { capital: BS, intereses: BS, igtf: BS } } },
        ['cod', 'mes', 'fecha', 'capital', 'intereses', 'fechaContable'],
      ),
    },
    async (req, reply) =>
      manejar(reply, () => {
        const { cod, mes, fecha, ...pago } = req.body;
        return gestion.pagar(req.user!.bd, cod, { mes, fecha }, pago, sesion(req));
      }),
  );

  fastify.post<{ Body: { id: number; fechaContable: string } }>(
    `${base}/reversar`,
    { ...g, schema: cuerpo({ id: ENT, fechaContable: FECHA_ISO }, ['id', 'fechaContable']) },
    async (req, reply) => manejar(reply, () => gestion.reversar(req.user!.bd, req.body.id, req.body.fechaContable, sesion(req))),
  );

  fastify.get<{ Querystring: { fecha: string } }>(
    `${base}/cotizacion`,
    { ...g, schema: { querystring: { type: 'object', required: ['fecha'], properties: { fecha: FECHA_ISO } } } },
    async (req) => (await cotizacionUsd(req.user!.bd, req.query.fecha)) ?? { codMoneda: null, tasa: null, fecha: null },
  );

  fastify.post<{ Body: gestion.RefCuota & gestion.EdicionCuota & { cod: number; nuevaFecha?: string } }>(
    `${base}/cuotas/editar`,
    {
      ...g,
      schema: cuerpo({ ...REF_CUOTA, nuevaFecha: FECHA_ISO, capital: NUM, intereses: NUM, ajustarIntereses: { type: 'boolean' } }, ['cod', 'mes', 'fecha']),
    },
    async (req, reply) =>
      manejar(reply, async () => {
        const b = req.body;
        await gestion.editarCuota(req.user!.bd, b.cod, { mes: b.mes, fecha: b.fecha }, {
          fecha: b.nuevaFecha,
          capital: b.capital,
          intereses: b.intereses,
          ajustarIntereses: b.ajustarIntereses,
        });
        return { ok: true };
      }),
  );

  fastify.post<{ Body: { cod: number; tasa: number } }>(
    `${base}/recalcular`,
    { ...g, schema: cuerpo({ cod: ENT, tasa: NUM }, ['cod', 'tasa']) },
    async (req, reply) =>
      manejar(reply, async () => {
        await gestion.recalcularIntereses(req.user!.bd, req.body.cod, req.body.tasa);
        return { ok: true };
      }),
  );

  fastify.post<{ Body: { cod: number; motivo: string } }>(
    `${base}/anular`,
    { ...g, schema: cuerpo({ cod: ENT, motivo: { type: 'string', maxLength: 200 } }, ['cod', 'motivo']) },
    async (req, reply) =>
      manejar(reply, async () => {
        await gestion.anular(req.user!.bd, req.body.cod, req.body.motivo, sesion(req));
        return { ok: true };
      }),
  );

  fastify.post<{ Body: { cod: number; moneda: Moneda } }>(
    `${base}/moneda`,
    { ...g, schema: cuerpo({ cod: ENT, moneda: MONEDA }, ['cod', 'moneda']) },
    async (req, reply) =>
      manejar(reply, async () => {
        await gestion.cambiarMoneda(req.user!.bd, req.body.cod, req.body.moneda);
        return { ok: true };
      }),
  );

  // --- Configuración contable (Fase 3) ---
  fastify.get(`${base}/config`, g, async (req, reply) => manejar(reply, () => leerConfig(req.user!.bd)));

  fastify.put<{ Body: ConfigContable }>(
    `${base}/config`,
    {
      preHandler: [requireGestion, requireAdminPermisos],
      schema: cuerpo(
        {
          contabilizar: { type: 'boolean' },
          cuentaIntereses: { type: 'string', maxLength: 12 },
          cuentaIgtf: { type: 'string', maxLength: 12 },
          tasaIgtf: NUM,
          cuentaComision: { type: 'string', maxLength: 12 },
          raizPagare: { type: 'string', maxLength: 9 },
        },
        ['contabilizar', 'cuentaIntereses', 'cuentaIgtf', 'tasaIgtf', 'cuentaComision', 'raizPagare'],
      ),
    },
    async (req, reply) =>
      manejar(reply, async () => {
        await guardarConfig(req.user!.bd, req.body);
        return leerConfig(req.user!.bd);
      }),
  );

  /** Plan de cuentas (de la contabilidad del año en curso) para elegir las cuentas. */
  fastify.get<{ Querystring: { q?: string; codigos?: string; raiz?: string } }>(
    `${base}/config/cuentas`,
    {
      ...g,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 60 },
            codigos: { type: 'string', pattern: '^[0-9,]*$', maxLength: 300 },
            raiz: { type: 'string', pattern: '^[0-9]*$', maxLength: 9 },
          },
        },
      },
    },
    async (req, reply) =>
      manejar(reply, async () => {
        const bdContable = await bdContableReferencia(req.user!.bd);
        if (!bdContable) return { bdContable: null, cuentas: [], ultimaDeRaiz: null };
        const codigos = req.query.codigos ? req.query.codigos.split(',').filter(Boolean) : [];
        return {
          bdContable,
          cuentas: await buscarCuentas(bdContable, req.query.q ?? '', codigos),
          ultimaDeRaiz: req.query.raiz ? await ultimaCuentaDeRaiz(bdContable, req.query.raiz) : null,
        };
      }),
  );

  // --- Consulta ---

  fastify.get(`${base}/catalogos`, async (req, reply) => manejar(reply, () => catalogos(req.user!.bd)));

  fastify.get<{ Querystring: QueryVista }>(`${base}/consulta`, { schema: esquemaVista }, async (req, reply) =>
    manejar(reply, () => consultar(req.user!.bd, req.query.vista, aConsulta(req.query))),
  );

  fastify.get<{ Querystring: { cod: number; corte: string } }>(`${base}/detalle`, { schema: esquemaDetalle }, async (req, reply) =>
    manejar(reply, async () => {
      const d = await detalle(req.user!.bd, req.query.cod, req.query.corte);
      return {
        ...d,
        columnas: conMoneda(COLUMNAS_DETALLE, (d.pagare.MONEDA as Moneda) ?? 'USD'),
        asientos: await asientosDePagare(req.user!.bd, req.query.cod),
        ...(await leerConfig(req.user!.bd).then((c) => ({ contabiliza: c.contabilizar, tasaIgtf: c.tasaIgtf }))),
      };
    }),
  );

  fastify.get<{ Querystring: QueryVista }>(`${base}/excel`, { schema: esquemaVista }, async (req, reply) =>
    manejar(reply, async () => {
      const buffer = await excel(req.user!.bd, req.query.vista, aConsulta(req.query), await nombreEmpresa(req.user!));
      return reply.header('Content-Disposition', 'attachment; filename="Pagares.xlsx"').type(XLSX).send(buffer);
    }),
  );

  fastify.get<{ Querystring: { cod: number; corte: string } }>(`${base}/detalle/excel`, { schema: esquemaDetalle }, async (req, reply) =>
    manejar(reply, async () => {
      const buffer = await excelDetalle(req.user!.bd, req.query.cod, req.query.corte, await nombreEmpresa(req.user!));
      return reply.header('Content-Disposition', 'attachment; filename="Pagare.xlsx"').type(XLSX).send(buffer);
    }),
  );
}
