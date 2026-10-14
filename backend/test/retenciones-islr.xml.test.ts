import { describe, expect, it } from 'vitest';
import {
  aDetalle,
  codigoConcepto,
  construirXml,
  periodoDe,
  rifSinGuiones,
  validarDetalles,
} from '../src/modules/retenciones-islr/retenciones-islr.xml.js';

// Filas reales del ejemplo de BIGBEN (01/10/2026 al 14/10/2026, planilla vieja).
const FILA_PNR = {
  RIF_PROVEEDOR: 'V272612036',
  NUMFAC: '000370',
  NUMCONTROL: '00-000370',
  DESCRIPCION: '(083) PUBLICIDAD Y PROPAGANDA (PNR)',
  FECHARETISLR: '02/10/2026',
  BASE: 681751,
  PORCRETENCION: 3,
};
const FILA_PJD = {
  RIF_PROVEEDOR: 'J403887284',
  NUMFAC: 'A00685351',
  NUMCONTROL: '00-00995747',
  DESCRIPCION: '(055) SERVICIOS (PJD) (Incluyendo suministro de bienes)',
  FECHARETISLR: '07/10/2026',
  BASE: 34886.9812,
  PORCRETENCION: 2,
};

describe('retenciones ISLR: formato XML', () => {
  it('convierte las filas del SP igual que la planilla vieja', () => {
    expect(aDetalle(FILA_PNR)).toEqual({
      rifRetenido: 'V272612036',
      numeroFactura: '000370',
      numeroControl: '00000370',
      fechaOperacion: '02/10/2026',
      codigoConcepto: '083',
      montoOperacion: 681751,
      porcentajeRetencion: 3,
    });
    expect(aDetalle(FILA_PJD).numeroControl).toBe('0000995747');
    expect(aDetalle(FILA_PJD).montoOperacion).toBe(34886.98);
  });

  it('código de concepto, RIF y período', () => {
    expect(codigoConcepto('(53) SERVICIOS')).toBe('053');
    expect(codigoConcepto('SERVICIOS')).toBe('');
    expect(rifSinGuiones('J-30235147-2')).toBe('J302351472');
    expect(periodoDe('20261014')).toBe('202610');
  });

  it('valida como la macro', () => {
    const ok = [aDetalle(FILA_PNR), aDetalle(FILA_PJD)];
    expect(validarDetalles(ok, 'J302351472', '202610')).toEqual([]);
    const malos = validarDetalles(
      [aDetalle({ ...FILA_PNR, RIF_PROVEEDOR: 'J', DESCRIPCION: 'SIN CODIGO', BASE: 0 })],
      'J-3023',
      '202613',
    );
    expect(malos.map((e) => `${e.fila}:${e.campo}`)).toEqual([
      '0:rifRetenido',
      '0:fechaOperacion',
      '1:rifRetenido',
      '1:codigoConcepto',
      '1:montoOperacion',
    ]);
  });

  it('arma el XML del SENIAT', () => {
    const xml = construirXml([aDetalle(FILA_PNR), aDetalle(FILA_PJD)], 'J302351472', '202610');
    expect(xml).toContain('<RelacionRetencionesISLR RifAgente="J302351472" Periodo="202610">');
    expect(xml).toContain(
      '<DetalleRetencion>\r\n<RifRetenido>V272612036</RifRetenido>\r\n<NumeroFactura>000370</NumeroFactura>\r\n' +
        '<NumeroControl>00000370</NumeroControl>\r\n<FechaOperacion>02/10/2026</FechaOperacion>\r\n' +
        '<CodigoConcepto>083</CodigoConcepto>\r\n<MontoOperacion>681751.00</MontoOperacion>\r\n' +
        '<PorcentajeRetencion>3</PorcentajeRetencion>\r\n</DetalleRetencion>',
    );
    expect(xml).toContain('<MontoOperacion>34886.98</MontoOperacion>');
    expect(xml.trimEnd().endsWith('</RelacionRetencionesISLR>')).toBe(true);
  });
});
