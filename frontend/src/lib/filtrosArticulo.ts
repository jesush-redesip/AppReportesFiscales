/** Filtros por artículo compartidos por Detalle de Ventas y Detalle de Compras (ver FiltrosArticulo.vue). */
export interface Opcion {
  id: number;
  descripcion: string;
}

export interface ValorFiltrosArticulo {
  referencias: { referencia: string; descripcion: string }[];
  dpto: number | '';
  seccion: number | '';
  familia: number | '';
  subfamilia: number | '';
  marca: number | '';
  linea: number | '';
}

export function filtrosArticuloVacios(): ValorFiltrosArticulo {
  return { referencias: [], dpto: '', seccion: '', familia: '', subfamilia: '', marca: '', linea: '' };
}

/** Parámetros para la API (sin los vacíos). */
export function parametrosArticulo(v: ValorFiltrosArticulo): Record<string, string | number | undefined> {
  const n = (x: number | '') => (x === '' ? undefined : x);
  return {
    refs: v.referencias.length ? v.referencias.map((r) => r.referencia).join(',') : undefined,
    dpto: n(v.dpto),
    seccion: n(v.seccion),
    familia: n(v.familia),
    subfamilia: n(v.subfamilia),
    marca: n(v.marca),
    linea: n(v.linea),
  };
}
