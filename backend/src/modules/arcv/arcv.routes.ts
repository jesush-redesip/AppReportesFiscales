import type { FastifyInstance } from 'fastify';
import { toPreviewResponse } from '../../shared/db/sp-runner.js';
import { arcvQuerySchema, type ArcvQuery } from './arcv.schema.js';
import { generarArcv } from './arcv.service.js';
import { getArcv } from './arcv.repository.js';

export default async function arcvRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: ArcvQuery }>(
    '/api/reportes/arcv',
    { schema: { querystring: arcvQuerySchema } },
    async (req, reply) => {
      const buffer = await generarArcv(req.user!.bd, req.query);
      reply
        .header('Content-Disposition', `attachment; filename="ARCV_${req.query.desde}_${req.query.hasta}.xlsx"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(buffer);
    },
  );

  fastify.get<{ Querystring: ArcvQuery }>(
    '/api/reportes/arcv/preview',
    { schema: { querystring: arcvQuerySchema } },
    async (req) => {
      const result = await getArcv(req.user!.bd, {
        desde: req.query.desde,
        hasta: req.query.hasta,
        codEmpresa: req.query.empresa,
        codSucursal: req.query.sucursal ?? '',
        codProveedor: req.query.proveedor,
      });
      return toPreviewResponse(result);
    },
  );
}
