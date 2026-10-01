export interface LibroCompraQuery {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  empresa: string;
  sucursal?: string;
  moneda: number;
  almacen?: string;
}

export const libroCompraQuerySchema = {
  type: 'object',
  required: ['desde', 'hasta', 'empresa', 'moneda'],
  properties: {
    desde: { type: 'string', pattern: '^[0-9]{8}$' },
    hasta: { type: 'string', pattern: '^[0-9]{8}$' },
    empresa: { type: 'string', minLength: 1 },
    sucursal: { type: 'string' },
    moneda: { type: 'integer' },
    almacen: { type: 'string' },
  },
} as const;
