export const arcvQuerySchema = {
    type: 'object',
    required: ['desde', 'hasta', 'empresa', 'proveedor'],
    properties: {
        desde: { type: 'string', pattern: '^[0-9]{8}$' },
        hasta: { type: 'string', pattern: '^[0-9]{8}$' },
        empresa: { type: 'string', minLength: 1 },
        sucursal: { type: 'string' },
        proveedor: { type: 'integer' },
    },
};
//# sourceMappingURL=arcv.schema.js.map