export const updatePermisosBodySchema = {
    type: 'object',
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: ['codUsuario', 'visualizarCajas', 'contabilizar', 'descontabilizar', 'modulos'],
                properties: {
                    codUsuario: { type: 'integer' },
                    visualizarCajas: { type: 'boolean' },
                    contabilizar: { type: 'boolean' },
                    descontabilizar: { type: 'boolean' },
                    modulos: { type: 'array', items: { type: 'string', maxLength: 50 } },
                },
            },
        },
    },
};
//# sourceMappingURL=permisos.schema.js.map