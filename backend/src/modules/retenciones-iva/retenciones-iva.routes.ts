import type { FastifyInstance } from 'fastify';
import { toPreviewResponse } from '../../shared/db/sp-runner.js';
import { retencionesIvaQuerySchema, type RetencionesIvaQuery } from './retenciones-iva.schema.js';
import { generarRetencionesIva } from './retenciones-iva.service.js';
import { getRetencionesIva } from './retenciones-iva.repository.js';

export default async function retencionesIvaRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: RetencionesIvaQuery }>(
    '/api/reportes/retenciones-iva',
    { schema: { querystring: retencionesIvaQuerySchema } },
    async (req, reply) => {
      const buffer = await generarRetencionesIva(req.user!.bd, req.query);
      reply
        .header('Content-Disposition', `attachment; filename="RetencionesIVA_${req.query.desde}_${req.query.hasta}.xlsx"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(buffer);
    },
  );

  fastify.get<{ Querystring: RetencionesIvaQuery }>(
    '/api/reportes/retenciones-iva/preview',
    { schema: { querystring: retencionesIvaQuerySchema } },
    async (req) => {
      const result = await getRetencionesIva(req.user!.bd, {
        desde: req.query.desde,
        hasta: req.query.hasta,
        codEmpresa: req.query.empresa,
        codSucursal: req.query.sucursal ?? '',
      });
      return toPreviewResponse(result);
    },
  );
}
