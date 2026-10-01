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
};
//# sourceMappingURL=libro-compra.schema.js.map