import type { Moneda } from './types';

/**
 * Moneda con que arrancan los Detalles de Ventas y Compras: la última que eligió el
 * usuario en esa empresa (en este navegador); si no, la que sugiere el servidor (el
 * dólar); si no, la principal de la empresa.
 */
const clave = (codEmpresa: number | null | undefined) => `detalle_moneda_${codEmpresa ?? 0}`;

export function monedaInicial(codEmpresa: number | null | undefined, monedas: Moneda[], sugerida: number | null | undefined): number | '' {
  const existe = (c: number | null | undefined) => c != null && monedas.some((m) => m.codMoneda === c);
  let guardada: number | null = null;
  try {
    const v = localStorage.getItem(clave(codEmpresa));
    guardada = v == null ? null : Number(v);
  } catch {
    guardada = null;
  }
  if (existe(guardada)) return guardada as number;
  if (existe(sugerida)) return sugerida as number;
  return (monedas.find((m) => m.principal) ?? monedas[0])?.codMoneda ?? '';
}

export function recordarMoneda(codEmpresa: number | null | undefined, codMoneda: number | '') {
  if (codMoneda === '') return;
  try {
    localStorage.setItem(clave(codEmpresa), String(codMoneda));
  } catch {
    /* sin almacenamiento */
  }
}
