export const movimientoInventarioQuerySchema = {
    type: 'object',
    required: ['desde', 'hasta', 'almacen'],
    properties: {
        desde: { type: 'string', pattern: '^[0-9]{8}$' },
        hasta: { type: 'string', pattern: '^[0-9]{8}$' },
        almacen: { type: 'string', minLength: 1 },
    },
};
//# sourceMappingURL=movimiento-inventario.schema.js.map