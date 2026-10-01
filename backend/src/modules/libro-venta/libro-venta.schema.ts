export interface LibroVentaQuery {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  empresa: string;
  sucursal?: string;
  moneda: number;
}

export const libroVentaQuerySchema = {
  type: 'object',
  required: ['desde', 'hasta', 'empresa', 'moneda'],
  properties: {
    desde: { type: 'string', pattern: '^[0-9]{8}$' },
    hasta: { type: 'string', pattern: '^[0-9]{8}$' },
    empresa: { type: 'string', minLength: 1 },
    sucursal: { type: 'string' },
    moneda: { type: 'integer' },
  },
} as const;
