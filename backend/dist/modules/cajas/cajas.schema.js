export const cierreQuerySchema = {
    type: 'object',
    required: ['serie', 'fecha'],
    properties: {
        serie: { type: 'string', minLength: 1, maxLength: 4 },
        fecha: { type: 'string', pattern: '^[0-9]{8}$' },
    },
};
export const asientoQuerySchema = {
    type: 'object',
    required: ['tipo', 'serie', 'serieCaja', 'fecha', 'z'],
    properties: {
        tipo: { type: 'string', enum: ['1', '2'] },
        // The 2-3 char store code (same one used by /tiendas, /cierre, /depositos) —
        // determines which accounting DB this posts against.
        serie: { type: 'string', minLength: 1, maxLength: 4 },
        // The specific physical register (e.g. "FA1"), not the store code above.
        serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
        fecha: { type: 'string', pattern: '^[0-9]{8}$' },
        z: { type: 'string' },
    },
};
export const formasPagoDisponiblesQuerySchema = {
    type: 'object',
    required: ['caja', 'z'],
    properties: {
        caja: { type: 'string', minLength: 1, maxLength: 10 },
        z: { type: 'string' },
    },
};
export const cotizacionQuerySchema = {
    type: 'object',
    required: ['fecha', 'importe'],
    properties: {
        fecha: { type: 'string', pattern: '^[0-9]{8}$' },
        importe: { type: 'number' },
    },
};
export const contabilizarBodySchema = {
    type: 'object',
    required: ['tipo', 'serie', 'serieCaja', 'fecha', 'z'],
    properties: {
        tipo: { type: 'string', enum: ['1', '2', '3'] },
        serie: { type: 'string', minLength: 1, maxLength: 4 },
        serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
        fecha: { type: 'string', pattern: '^[0-9]{8}$' },
        z: { type: 'integer' },
        fechaContable: { type: 'string', pattern: '^[0-9]{8}$' },
        fondoCaja: { type: 'string' },
        fondoN: { type: 'string' },
        fondoNumero: { type: 'string' },
    },
};
export const descontabilizarBodySchema = {
    type: 'object',
    required: ['serie', 'serieCaja', 'fecha', 'z'],
    properties: {
        serie: { type: 'string', minLength: 1, maxLength: 4 },
        serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
        fecha: { type: 'string', pattern: '^[0-9]{8}$' },
        z: { type: 'integer' },
        fechaContable: { type: 'string', pattern: '^[0-9]{8}$' },
    },
};
export const descontabilizarDepositoBodySchema = {
    type: 'object',
    required: ['serie', 'serieCaja', 'fecha', 'fondoCaja', 'fondoN', 'fondoNumero'],
    properties: {
        serie: { type: 'string', minLength: 1, maxLength: 4 },
        serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
        fecha: { type: 'string', pattern: '^[0-9]{8}$' },
        fechaContable: { type: 'string', pattern: '^[0-9]{8}$' },
        fondoCaja: { type: 'string' },
        fondoN: { type: 'string' },
        fondoNumero: { type: 'string' },
    },
};
export const traspasarBodySchema = {
    type: 'object',
    required: ['serieCaja', 'z'],
    properties: {
        serieCaja: { type: 'string', minLength: 1, maxLength: 10 },
        z: { type: 'integer' },
    },
};
export const guardarMontoBodySchema = {
    type: 'object',
    required: ['z', 'codTipoPago', 'caja', 'fecha'],
    properties: {
        z: { type: 'integer' },
        codTipoPago: { type: 'integer' },
        caja: { type: 'string', minLength: 1, maxLength: 10 },
        fecha: { type: 'string', pattern: '^[0-9]{8}$' },
        nuevo: { type: 'number' },
    },
};
export const guardarFormaPagoBodySchema = {
    type: 'object',
    required: ['caja', 'z', 'forma', 'monto'],
    properties: {
        caja: { type: 'string', minLength: 1, maxLength: 10 },
        z: { type: 'integer' },
        forma: { type: 'string', minLength: 1 },
        monto: { type: 'number' },
    },
};
export const eliminarFormaPagoBodySchema = {
    type: 'object',
    required: ['caja', 'z', 'forma'],
    properties: {
        caja: { type: 'string', minLength: 1, maxLength: 10 },
        z: { type: 'integer' },
        forma: { type: 'string', minLength: 1 },
    },
};
//# sourceMappingURL=cajas.schema.js.map