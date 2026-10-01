export interface UsuarioPermisos {
  codUsuario: number;
  usuario: string;
  visualizarCajas: boolean;
  contabilizar: boolean;
  descontabilizar: boolean;
  /** Ids de módulos habilitados (ver `shared/auth/modulos.ts`). */
  modulos: string[];
}

export interface UpdatePermisosBody {
  items: Array<Omit<UsuarioPermisos, 'usuario'>>;
}

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
} as const;
