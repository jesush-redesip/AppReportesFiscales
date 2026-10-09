export const MESES_POR = { MENSUAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3 };
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const diasDelMes = (anio, mes0) => new Date(Date.UTC(anio, mes0 + 1, 0)).getUTCDate();
const pad = (n) => String(n).padStart(2, '0');
/** Vencimiento de la cuota k: k meses después del mes de liquidación, el día de pago (o el último del mes). */
export function vencimiento(fechaLiquidacion, diaPago, k) {
    const [a, m] = fechaLiquidacion.split('-').map(Number);
    const total = m - 1 + k;
    const anio = a + Math.floor(total / 12);
    const mes0 = ((total % 12) + 12) % 12;
    const dia = Math.min(diaPago, diasDelMes(anio, mes0));
    return `${anio}-${pad(mes0 + 1)}-${pad(dia)}`;
}
/** Días del mes anterior al del vencimiento (el período que cubre esa cuota). */
function diasPeriodo(fecha) {
    const [a, m] = fecha.split('-').map(Number);
    const mes0Anterior = m - 2;
    return mes0Anterior < 0 ? diasDelMes(a - 1, 11) : diasDelMes(a, mes0Anterior);
}
export function validar(d) {
    if (!(d.monto > 0))
        return 'El monto debe ser mayor que cero.';
    if (!(d.tasa >= 0 && d.tasa <= 1000))
        return 'La tasa no es válida.';
    if (!Number.isInteger(d.plazo) || d.plazo < 1 || d.plazo > 360)
        return 'El plazo debe estar entre 1 y 360 meses.';
    if (!Number.isInteger(d.diaPago) || d.diaPago < 1 || d.diaPago > 31)
        return 'El día de pago debe estar entre 1 y 31.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fechaLiquidacion))
        return 'La fecha de liquidación no es válida.';
    if (d.plazo < MESES_POR[d.frecuenciaCapital])
        return 'El plazo es menor que la frecuencia de pago del capital.';
    if (!Number.isInteger(d.mesesGracia) || d.mesesGracia < 0 || d.mesesGracia >= d.plazo)
        return 'Los meses sin intereses deben ser menos que el plazo.';
    return null;
}
export function generarCuotas(d) {
    const error = validar(d);
    if (error)
        throw new Error(error);
    const f = MESES_POR[d.frecuenciaCapital];
    // Meses en que se abona capital: cada f meses, y el último mes siempre (plazo no múltiplo de f).
    const mesesCapital = new Set();
    for (let k = f; k <= d.plazo; k += f)
        mesesCapital.add(k);
    mesesCapital.add(d.plazo);
    const nCapital = mesesCapital.size;
    const tasaMes = d.tasa / 100 / 12;
    const interesMes = (saldo, fecha) => d.baseInteres === 'MENSUAL' ? saldo * tasaMes : (saldo * (d.tasa / 100) * diasPeriodo(fecha)) / 360;
    // Cuota fija (francés) por período de capital.
    const tasaPeriodo = tasaMes * f;
    const cuotaFija = d.metodo === 'CUOTA_FIJA'
        ? tasaPeriodo > 0
            ? (d.monto * tasaPeriodo) / (1 - Math.pow(1 + tasaPeriodo, -nCapital))
            : d.monto / nCapital
        : 0;
    const capitalFijo = r2(d.monto / nCapital);
    const cuotas = [];
    let saldo = r2(d.monto);
    let interesAcumulado = 0;
    let capitalesPagados = 0;
    for (let k = 1; k <= d.plazo; k++) {
        const fecha = vencimiento(d.fechaLiquidacion, d.diaPago, k);
        const sinIntereses = k <= d.mesesGracia;
        const interes = sinIntereses ? 0 : interesMes(saldo, fecha);
        let capital = 0;
        if (mesesCapital.has(k)) {
            capitalesPagados++;
            if (capitalesPagados === nCapital)
                capital = saldo; // la última cuota cierra el saldo
            // Cuota fija: el capital es la cuota menos el interés del período a la tasa nominal.
            else if (d.metodo === 'CUOTA_FIJA')
                capital = r2(Math.min(saldo, Math.max(0, cuotaFija - saldo * tasaPeriodo)));
            else
                capital = Math.min(capitalFijo, saldo);
        }
        // Intereses trimestrales: se cobran cada 3 meses y en la última cuota.
        interesAcumulado += interes;
        let interesCuota = interesAcumulado;
        if (d.frecuenciaIntereses === 'TRIMESTRAL' && k % 3 !== 0 && k !== d.plazo)
            interesCuota = 0;
        if (interesCuota !== 0 || d.frecuenciaIntereses === 'MENSUAL' || k % 3 === 0 || k === d.plazo)
            interesAcumulado = 0;
        interesCuota = r2(interesCuota);
        cuotas.push({ mes: k, fecha, saldo: r2(saldo), capital: r2(capital), intereses: interesCuota, total: r2(capital + interesCuota), sinIntereses });
        saldo = r2(saldo - capital);
    }
    return cuotas;
}
//# sourceMappingURL=pagares.calculo.js.map