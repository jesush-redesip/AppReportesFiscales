/**
 * Formato de la declaración de retenciones de ISLR del SENIAT (archivo XML
 * `RelacionRetencionesISLR`). Reproduce lo que hacía la planilla vieja
 * (`retISLR`, macro "Rutina XML Seniat"): una fila por retención con RIF del
 * retenido, factura, control, fecha, código de concepto, monto y porcentaje.
 */
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const numero = (v) => {
    const n = typeof v === 'number' ? v : Number(texto(v).replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
};
/** RIF sin guiones ni espacios, en mayúsculas: "J-30235147-2" -> "J302351472". */
export const rifSinGuiones = (v) => texto(v).replace(/[^0-9a-z]/gi, '').toUpperCase();
/** El SP arma la descripción como "(083) PUBLICIDAD ..."; el código va entre paréntesis. */
export function codigoConcepto(descripcion) {
    const m = /^\s*\((\d{1,3})\)/.exec(texto(descripcion));
    return m ? m[1].padStart(3, '0') : '';
}
/** Período de la declaración (AAAAMM) a partir de la fecha final del rango (yyyyMMdd). */
export const periodoDe = (hasta) => hasta.slice(0, 6);
export function aDetalle(r) {
    return {
        rifRetenido: rifSinGuiones(r.RIF_PROVEEDOR),
        numeroFactura: texto(r.NUMFAC).replace(/[^0-9a-z]/gi, '').toUpperCase(),
        // En ICG el control viene como "00-000370"; el SENIAT lo pide sin guiones.
        numeroControl: texto(r.NUMCONTROL).replace(/[^0-9a-z]/gi, '').toUpperCase(),
        fechaOperacion: texto(r.FECHARETISLR),
        codigoConcepto: codigoConcepto(r.DESCRIPCION),
        montoOperacion: Math.round(numero(r.BASE) * 100) / 100,
        porcentajeRetencion: numero(r.PORCRETENCION),
    };
}
/** Las mismas validaciones que hacía la macro antes de generar el XML. */
export function validarDetalles(detalles, rifAgente, periodo) {
    const errores = [];
    const rifValido = (r) => /^[VEJPGC]\d{9}$/.test(r);
    if (!rifValido(rifAgente)) {
        errores.push({ fila: 0, campo: 'rifRetenido', mensaje: `RIF del agente de retención inválido: "${rifAgente}".` });
    }
    if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) {
        errores.push({ fila: 0, campo: 'fechaOperacion', mensaje: `Período inválido: "${periodo}".` });
    }
    detalles.forEach((d, i) => {
        const fila = i + 1;
        const err = (campo, mensaje) => errores.push({ fila, campo, mensaje });
        if (!rifValido(d.rifRetenido))
            err('rifRetenido', `RIF inválido: "${d.rifRetenido}".`);
        if (!d.numeroFactura)
            err('numeroFactura', 'Falta el número de factura.');
        else if (d.numeroFactura.length > 10)
            err('numeroFactura', `Número de factura de más de 10 caracteres: "${d.numeroFactura}".`);
        if (!d.numeroControl)
            err('numeroControl', 'Falta el número de control.');
        if (!/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/.test(d.fechaOperacion)) {
            err('fechaOperacion', `Fecha inválida: "${d.fechaOperacion}".`);
        }
        if (!/^\d{3}$/.test(d.codigoConcepto))
            err('codigoConcepto', 'Falta el código del concepto de retención.');
        if (!(d.montoOperacion > 0))
            err('montoOperacion', 'El monto de la operación debe ser mayor que cero.');
        if (!(d.porcentajeRetencion >= 0 && d.porcentajeRetencion <= 100)) {
            err('porcentajeRetencion', 'El porcentaje debe estar entre 0 y 100.');
        }
    });
    return errores;
}
const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Monto con punto decimal y 2 decimales; porcentaje sin ceros de sobra (3, 1.5). */
const fmtMonto = (n) => n.toFixed(2);
const fmtPorcentaje = (n) => String(Math.round(n * 100) / 100);
export function construirXml(detalles, rifAgente, periodo) {
    const lineas = [
        '<?xml version="1.0" encoding="ISO-8859-1"?>',
        `<RelacionRetencionesISLR RifAgente="${escapar(rifAgente)}" Periodo="${escapar(periodo)}">`,
    ];
    for (const d of detalles) {
        lineas.push('<DetalleRetencion>', `<RifRetenido>${escapar(d.rifRetenido)}</RifRetenido>`, `<NumeroFactura>${escapar(d.numeroFactura)}</NumeroFactura>`, `<NumeroControl>${escapar(d.numeroControl)}</NumeroControl>`, `<FechaOperacion>${escapar(d.fechaOperacion)}</FechaOperacion>`, `<CodigoConcepto>${escapar(d.codigoConcepto)}</CodigoConcepto>`, `<MontoOperacion>${fmtMonto(d.montoOperacion)}</MontoOperacion>`, `<PorcentajeRetencion>${fmtPorcentaje(d.porcentajeRetencion)}</PorcentajeRetencion>`, '</DetalleRetencion>');
    }
    lineas.push('</RelacionRetencionesISLR>');
    return lineas.join('\r\n') + '\r\n';
}
//# sourceMappingURL=retenciones-islr.xml.js.map