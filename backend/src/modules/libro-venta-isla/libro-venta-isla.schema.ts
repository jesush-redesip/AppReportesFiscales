export interface LibroVentaIslaQuery {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  almacen: string;
}

export const libroVentaIslaQuerySchema = {
  type: 'object',
  required: ['desde', 'hasta', 'almacen'],
  properties: {
    desde: { type: 'string', pattern: '^[0-9]{8}$' },
    hasta: { type: 'string', pattern: '^[0-9]{8}$' },
    almacen: { type: 'string', minLength: 1 },
  },
} as const;
