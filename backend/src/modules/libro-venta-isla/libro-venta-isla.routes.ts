import type { FastifyInstance } from 'fastify';
import { libroVentaIslaQuerySchema, type LibroVentaIslaQuery } from './libro-venta-isla.schema.js';
import { generarLibroVentaIsla } from './libro-venta-isla.service.js';
import * as repo from './libro-venta-isla.repository.js';

export default async function libroVentaIslaRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: LibroVentaIslaQuery }>(
    '/api/reportes/libro-venta-isla',
    { schema: { querystring: libroVentaIslaQuerySchema } },
    async (req, reply) => {
      const buffer = await generarLibroVentaIsla(req.user!.bd, req.query);
      return reply
        .header('Content-Disposition', `attachment; filename="LibroVentaIsla_${req.query.desde}_${req.query.hasta}.xlsx"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(buffer);
    },
  );

  // Unlike the other modules, this one has no single flat recordset — it runs one SP
  // call per fiscal printer. The preview concatenates all of them with an extra
  // "IMPRESORA" column so the table still reads as one coherent list.
  fastify.get<{ Querystring: LibroVentaIslaQuery }>(
    '/api/reportes/libro-venta-isla/preview',
    { schema: { querystring: libroVentaIslaQuerySchema } },
    async (req) => {
      const impresoras = await repo.getImpresorasFiscales(req.user!.bd, req.query.desde, req.query.hasta, req.query.almacen);
      const rows: Record<string, unknown>[] = [];
      for (const impresora of impresoras) {
        const impresoraRows = await repo.getLibroVentaAgrupado(req.user!.bd, req.query.desde, req.query.hasta, impresora.serial);
        for (const r of impresoraRows) {
          rows.push({ IMPRESORA: impresora.serial, ...r });
        }
      }
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return { columns, rows };
    },
  );
}
