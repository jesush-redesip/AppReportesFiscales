import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { empresasDeSesion, type SessionTokenPayload } from '../auth/auth.service.js';
import { PagaresError, catalogos, detalle } from './pagares.repository.js';
import { COLUMNAS_DETALLE, VISTAS, consultar, excel, excelDetalle, type Consulta, type Vista } from './pagares.service.js';
import * as gestion from './pagares.gestion.js';
import { getModulosUsuario } from '../../shared/auth/permisos.js';
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

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default async function pagaresRoutes(fastify: FastifyInstance) {
  const base = '/api/reportes/pagares';
  const g = { preHandler: requireGestion };
  const sesion = (req: FastifyRequest) => ({ codUsuario: req.user!.codUsuario, codEmpresa: req.user!.codEmpresa });

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

  fastify.post<{ Body: gestion.NuevoPagare }>(
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
        },
        [...REQ_AMORTIZACION, 'pagare', 'serie', 'cuentaBanco', 'comision', 'mesesInteresAdelantado'],
      ),
    },
    async (req, reply) => manejar(reply, () => gestion.registrar(req.user!.bd, req.body, sesion(req))),
  );

  fastify.post<{ Body: gestion.RefCuota & { cod: number; tipo: 'capital' | 'intereses'; fechaContable: string } }>(
    `${base}/cuotas/pagar`,
    { ...g, schema: cuerpo({ ...REF_CUOTA, tipo: { type: 'string', enum: ['capital', 'intereses'] }, fechaContable: FECHA_ISO }, ['cod', 'mes', 'fecha', 'tipo', 'fechaContable']) },
    async (req, reply) =>
      manejar(reply, async () => {
        const b = req.body;
        await gestion.pagar(req.user!.bd, b.cod, { mes: b.mes, fecha: b.fecha }, b.tipo, b.fechaContable, sesion(req));
        return { ok: true };
      }),
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

  // --- Consulta ---

  fastify.get(`${base}/catalogos`, async (req, reply) => manejar(reply, () => catalogos(req.user!.bd)));

  fastify.get<{ Querystring: QueryVista }>(`${base}/consulta`, { schema: esquemaVista }, async (req, reply) =>
    manejar(reply, () => consultar(req.user!.bd, req.query.vista, aConsulta(req.query))),
  );

  fastify.get<{ Querystring: { cod: number; corte: string } }>(`${base}/detalle`, { schema: esquemaDetalle }, async (req, reply) =>
    manejar(reply, async () => ({ ...(await detalle(req.user!.bd, req.query.cod, req.query.corte)), columnas: COLUMNAS_DETALLE })),
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
