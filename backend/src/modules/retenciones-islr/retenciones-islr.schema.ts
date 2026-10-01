export interface RetencionesIslrQuery {
  desde: string; // yyyyMMdd
  hasta: string; // yyyyMMdd
  empresa: string;
  sucursal?: string;
}

export const retencionesIslrQuerySchema = {
  type: 'object',
  required: ['desde', 'hasta', 'empresa'],
  properties: {
    desde: { type: 'string', pattern: '^[0-9]{8}$' },
    hasta: { type: 'string', pattern: '^[0-9]{8}$' },
    empresa: { type: 'string', minLength: 1 },
    sucursal: { type: 'string' },
  },
} as const;
