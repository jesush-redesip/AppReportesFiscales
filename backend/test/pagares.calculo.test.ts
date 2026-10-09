import { describe, expect, it } from 'vitest';
import { generarCuotas, vencimiento, type DatosAmortizacion } from '../src/modules/pagares/pagares.calculo.js';

// Casos tomados de pagarés reales de BIGBEN (RIP_PAGARESLIN).
const base: Omit<DatosAmortizacion, 'monto' | 'plazo' | 'fechaLiquidacion' | 'diaPago'> = {
  tasa: 16,
  frecuenciaCapital: 'MENSUAL',
  frecuenciaIntereses: 'MENSUAL',
  metodo: 'CAPITAL_FIJO',
  baseInteres: 'DIAS_360',
  mesesGracia: 0,
};

describe('vencimiento', () => {
  it('usa el último día cuando el mes no tiene el día de pago', () => {
    expect(vencimiento('2026-01-30', 31, 1)).toBe('2026-02-28');
    expect(vencimiento('2026-01-30', 31, 2)).toBe('2026-03-31');
    expect(vencimiento('2026-11-15', 15, 3)).toBe('2027-02-15');
  });
});

describe('cuota fija (Banco de Venezuela / Banco Activo)', () => {
  it('pagaré 806: 48.889,48 al 16 % en 12 meses', () => {
    const c = generarCuotas({ ...base, metodo: 'CUOTA_FIJA', baseInteres: 'MENSUAL', monto: 48889.48, plazo: 12, fechaLiquidacion: '2026-06-03', diaPago: 3 });
    expect(c[0]).toMatchObject({ mes: 1, fecha: '2026-07-03', saldo: 48889.48, capital: 3783.92, intereses: 651.86 });
    expect(c[1]).toMatchObject({ capital: 3834.38, intereses: 601.41 });
    expect(c[11].fecha).toBe('2027-06-03');
    expect(c[11].intereses).toBeCloseTo(58.37, 1);
    expect(c.reduce((s, x) => s + x.capital, 0)).toBeCloseTo(48889.48, 2);
  });
  it('pagaré 800: 20.949,02 en 9 meses', () => {
    const c = generarCuotas({ ...base, metodo: 'CUOTA_FIJA', baseInteres: 'MENSUAL', monto: 20949.02, plazo: 9, fechaLiquidacion: '2025-10-05', diaPago: 5 });
    expect(c[0]).toMatchObject({ fecha: '2025-11-05', capital: 2206.27, intereses: 279.32 });
    expect(c[8].intereses).toBeCloseTo(32.71, 1);
  });
});

describe('capital fijo (PHP)', () => {
  it('pagaré 804: 50.000 en 10 meses, intereses por días del mes / 360', () => {
    const c = generarCuotas({ ...base, monto: 50000, plazo: 10, fechaLiquidacion: '2026-04-09', diaPago: 13 });
    expect(c.every((x) => x.capital === 5000)).toBe(true);
    expect(c[0]).toMatchObject({ fecha: '2026-05-13', intereses: 666.67 }); // abril: 30 días
    expect(c[1].intereses).toBe(620); // 45.000 × 16 % × 31 (mayo) / 360
    expect(c[9]).toMatchObject({ fecha: '2027-02-13', intereses: 68.89 }); // 5.000 × 31 (enero)
  });
  it('trimestral: capital cada 3 meses e intereses acumulados', () => {
    const c = generarCuotas({ ...base, frecuenciaCapital: 'TRIMESTRAL', frecuenciaIntereses: 'TRIMESTRAL', baseInteres: 'MENSUAL', monto: 9000, plazo: 7, fechaLiquidacion: '2026-01-10', diaPago: 10 });
    expect(c.map((x) => x.capital)).toEqual([0, 0, 3000, 0, 0, 3000, 3000]);
    expect(c.map((x) => x.intereses)).toEqual([0, 0, 360, 0, 0, 240, 40]);
  });
  it('meses sin intereses', () => {
    const c = generarCuotas({ ...base, baseInteres: 'MENSUAL', mesesGracia: 2, monto: 1200, plazo: 4, fechaLiquidacion: '2026-01-10', diaPago: 10 });
    expect(c.map((x) => x.sinIntereses)).toEqual([true, true, false, false]);
    expect(c[0].intereses).toBe(0);
    expect(c[2].intereses).toBe(8);
  });
});
