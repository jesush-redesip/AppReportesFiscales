// CUENTAS.CODIGO es NVARCHAR(12) en el esquema real de ICG.
export const configuracionCuentasBodySchema = {
    type: 'object',
    required: ['sobranteVenta', 'faltanteVenta', 'sobranteRedondeo', 'faltanteRedondeo', 'bdContable'],
    properties: {
        sobranteVenta: { type: 'string', maxLength: 12 },
        faltanteVenta: { type: 'string', maxLength: 12 },
        sobranteRedondeo: { type: 'string', maxLength: 12 },
        faltanteRedondeo: { type: 'string', maxLength: 12 },
        bdContable: { type: 'string', maxLength: 128 },
        incluirCostoVenta: { type: 'boolean' },
    },
};
export const cuentasDisponiblesQuerySchema = {
    type: 'object',
    required: ['bdContable'],
    properties: {
        bdContable: { type: 'string', minLength: 1, maxLength: 128 },
    },
};
//# sourceMappingURL=configuracion-cuentas.schema.js.map