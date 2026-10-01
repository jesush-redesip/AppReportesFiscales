export const libroVentaIslaQuerySchema = {
    type: 'object',
    required: ['desde', 'hasta', 'almacen'],
    properties: {
        desde: { type: 'string', pattern: '^[0-9]{8}$' },
        hasta: { type: 'string', pattern: '^[0-9]{8}$' },
        almacen: { type: 'string', minLength: 1 },
    },
};
//# sourceMappingURL=libro-venta-isla.schema.js.map