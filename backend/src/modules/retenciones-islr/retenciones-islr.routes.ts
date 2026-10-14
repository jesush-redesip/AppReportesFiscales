import type { FastifyInstance } from 'fastify';
import { retencionesIslrQuerySchema, type RetencionesIslrQuery } from './retenciones-islr.schema.js';
import {
  generarFormatoXmlIslr,
  generarRetencionesIslr,
  generarXmlIslr,
  NICE_LABELS,
  RetencionesIslrInvalidasError,
} from './retenciones-islr.service.js';
import { getRetencionesIslr } from './retenciones-islr.repository.js';

export default async function retencionesIslrRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: RetencionesIslrQuery }>(
    '/api/reportes/retenciones-islr',
    { schema: { querystring: retencionesIslrQuerySchema } },
    async (req, reply) => {
      const buffer = await generarRetencionesIslr(req.user!.bd, req.query);
      return reply
        .header('Content-Disposition', `attachment; filename="RetencionesISLR_${req.query.desde}_${req.query.hasta}.xlsx"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(buffer);
    },
  );

  // Excel con el formato de la planilla vieja para migrar a XML (hoja retISLR).
  fastify.get<{ Querystring: RetencionesIslrQuery }>(
    '/api/reportes/retenciones-islr/formato-xml',
    { schema: { querystring: retencionesIslrQuerySchema } },
    async (req, reply) => {
      const buffer = await generarFormatoXmlIslr(req.user!.bd, req.query);
      return reply
        .header('Content-Disposition', `attachment; filename="FormatoXML_ISLR_${req.query.desde}_${req.query.hasta}.xlsx"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(buffer);
    },
  );

  // XML para el portal del SENIAT.
  fastify.get<{ Querystring: RetencionesIslrQuery }>(
    '/api/reportes/retenciones-islr/xml',
    { schema: { querystring: retencionesIslrQuerySchema } },
    async (req, reply) => {
      try {
        const buffer = await generarXmlIslr(req.user!.bd, req.query);
        return reply
          .header('Content-Disposition', `attachment; filename="RetencionesISLR_${req.query.hasta.slice(0, 6)}.xml"`)
          .type('application/xml; charset=ISO-8859-1')
          .send(buffer);
      } catch (e) {
        if (e instanceof RetencionesIslrInvalidasError) {
          return reply.code(422).send({ message: e.message, errores: e.errores });
        }
        throw e;
      }
    },
  );

  fastify.get<{ Querystring: RetencionesIslrQuery }>(
    '/api/reportes/retenciones-islr/preview',
    { schema: { querystring: retencionesIslrQuerySchema } },
    async (req) => {
      const result = await getRetencionesIslr(req.user!.bd, {
        desde: req.query.desde,
        hasta: req.query.hasta,
        codEmpresa: req.query.empresa,
        codSucursal: req.query.sucursal ?? '',
      });
      return {
        columns: result.columns.map((c) => NICE_LABELS[c.name] ?? c.name),
        rows: result.rows.map((r) => {
          const record = r as Record<string, unknown>;
          const mapped: Record<string, unknown> = {};
          for (const col of result.columns) {
            mapped[NICE_LABELS[col.name] ?? col.name] = record[col.name];
          }
          return mapped;
        }),
      };
    },
  );
}
