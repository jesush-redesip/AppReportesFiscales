import ExcelJS from 'exceljs';
import * as repo from './pagares.repository.js';
export const VISTAS = ['general', 'deudas', 'pagos', 'consolidado', 'consolidado-banco'];
const c = (id, titulo, tipo, sinTotal = false) => ({ id, titulo, tipo, sinTotal });
const COLUMNAS = {
    general: [
        c('PAGARE', 'Pagaré', 'texto'),
        c('EMPRESA', 'Empresa', 'texto'),
        c('BANCO', 'Banco', 'texto'),
        c('FECHA', 'Liquidación', 'fecha'),
        c('VENCE', 'Vencimiento', 'fecha'),
        c('PLAZO', 'Plazo (meses)', 'entero', true),
        c('FRECUENCIA', 'Frecuencia', 'texto'),
        c('TASA', 'Tasa %', 'tasa'),
        c('MONTO', 'Monto', 'monto'),
        c('CAPITAL_PAGADO', 'Capital pagado', 'monto'),
        c('SALDO', 'Saldo capital', 'monto'),
        c('PROXIMO', 'Próximo venc.', 'fecha'),
        c('CAPITAL', 'Capital del período', 'monto'),
        c('INTERESES', 'Intereses del período', 'monto'),
        c('TOTAL', 'Total a pagar', 'monto'),
    ],
    deudas: [
        c('PAGARE', 'Pagaré', 'texto'),
        c('EMPRESA', 'Empresa', 'texto'),
        c('BANCO', 'Banco', 'texto'),
        c('MONTO', 'Monto', 'monto'),
        c('SALDO', 'Saldo capital', 'monto'),
        c('CUOTAS', 'Cuotas vencidas', 'entero'),
        c('DESDE', 'Vencido desde', 'fecha'),
        c('DIAS', 'Días de mora', 'entero', true),
        c('CAPITAL', 'Capital vencido', 'monto'),
        c('INTERESES', 'Intereses vencidos', 'monto'),
        c('TOTAL', 'Total vencido', 'monto'),
    ],
    pagos: [
        c('EMPRESA', 'Empresa', 'texto'),
        c('BANCO', 'Banco', 'texto'),
        c('PAGARES', 'Pagarés', 'entero'),
        c('CAPITAL', 'Capital por pagar', 'monto'),
        c('INTERESES', 'Intereses por pagar', 'monto'),
        c('TOTAL', 'Total por pagar', 'monto'),
        c('CAPITAL_PAGADO', 'Capital pagado', 'monto'),
        c('INTERESES_PAGADOS', 'Intereses pagados', 'monto'),
    ],
    consolidado: [
        c('EMPRESA', 'Empresa', 'texto'),
        c('BANCO', 'Banco', 'texto'),
        c('PAGARES', 'Pagarés con deuda', 'entero'),
        c('CAPITAL', 'Capital por pagar', 'monto'),
        c('INTERESES', 'Intereses por pagar', 'monto'),
        c('TOTAL', 'Deuda total', 'monto'),
        c('CAPITAL_PAGADO', 'Capital pagado', 'monto'),
        c('INTERESES_PAGADOS', 'Intereses pagados', 'monto'),
        c('TOTAL_PAGADO', 'Total cancelado', 'monto'),
    ],
    'consolidado-banco': [],
};
COLUMNAS['consolidado-banco'] = COLUMNAS.consolidado.filter((x) => x.id !== 'EMPRESA');
export const COLUMNAS_DETALLE = [
    c('MES', 'Cuota', 'entero', true),
    c('FECHA', 'Vencimiento', 'fecha'),
    c('SALDO', 'Saldo', 'monto', true),
    c('CAPITAL', 'Capital', 'monto'),
    c('INTERESES', 'Intereses', 'monto'),
    c('TOTAL', 'Total', 'monto'),
    c('ESTADO_CAPITAL', 'Capital', 'texto'),
    c('PAGO_CAPITAL', 'Fecha pago capital', 'fecha'),
    c('ESTADO_INTERESES', 'Intereses', 'texto'),
    c('PAGO_INTERESES', 'Fecha pago intereses', 'fecha'),
];
const TITULOS = {
    general: 'Pagarés del período',
    deudas: 'Deudas vencidas',
    pagos: 'Pagos del período',
    consolidado: 'Consolidado por empresa y banco',
    'consolidado-banco': 'Consolidado por banco',
};
export async function consultar(bd, vista, q) {
    const filas = vista === 'general'
        ? await repo.general(bd, q, q.desde, q.hasta)
        : vista === 'deudas'
            ? await repo.deudas(bd, q, q.hasta)
            : vista === 'pagos'
                ? await repo.pagosPeriodo(bd, q, q.desde, q.hasta)
                : await repo.consolidado(bd, q, vista === 'consolidado-banco');
    return { columnas: COLUMNAS[vista], filas };
}
// --- Excel ---
const ddmmyyyy = (yyyyMMdd) => `${yyyyMMdd.slice(6, 8)}/${yyyyMMdd.slice(4, 6)}/${yyyyMMdd.slice(0, 4)}`;
function aFecha(valor) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
const FORMATOS = {
    texto: undefined,
    fecha: 'dd/mm/yyyy',
    monto: '#,##0.00',
    entero: '0',
    tasa: '0.00',
};
function escribirTabla(sheet, filaInicio, columnas, filas, totales) {
    const borde = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
    };
    const cab = sheet.getRow(filaInicio);
    columnas.forEach((col, i) => {
        const celda = cab.getCell(i + 1);
        celda.value = col.titulo;
        celda.font = { bold: true };
        celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
        celda.border = borde;
    });
    filas.forEach((f, r) => {
        const row = sheet.getRow(filaInicio + 1 + r);
        columnas.forEach((col, i) => {
            const celda = row.getCell(i + 1);
            const v = f[col.id];
            celda.value = col.tipo === 'fecha' ? aFecha(v) : col.tipo === 'texto' ? (v == null ? '' : String(v)) : v == null ? null : Number(v);
            if (FORMATOS[col.tipo])
                celda.numFmt = FORMATOS[col.tipo];
            celda.border = borde;
        });
    });
    if (totales && filas.length) {
        const row = sheet.getRow(filaInicio + 1 + filas.length);
        row.getCell(1).value = 'TOTAL';
        columnas.forEach((col, i) => {
            if (i === 0 || col.sinTotal || (col.tipo !== 'monto' && col.tipo !== 'entero'))
                return;
            const celda = row.getCell(i + 1);
            celda.value = filas.reduce((s, f) => s + (Number(f[col.id]) || 0), 0);
            celda.numFmt = FORMATOS[col.tipo];
        });
        row.font = { bold: true };
    }
    columnas.forEach((col, i) => {
        sheet.getColumn(i + 1).width = col.tipo === 'texto' ? Math.max(14, col.titulo.length + 2) : col.tipo === 'fecha' ? 12 : 16;
    });
}
export async function excel(bd, vista, q, nombreEmpresa) {
    const { columnas, filas } = await consultar(bd, vista, q);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Pagarés');
    sheet.getCell('A1').value = nombreEmpresa;
    sheet.getCell('A1').font = { bold: true, size: 13 };
    sheet.getCell('A2').value = TITULOS[vista].toUpperCase();
    sheet.getCell('A2').font = { bold: true };
    sheet.getCell('A3').value =
        vista === 'deudas'
            ? `Vencido al ${ddmmyyyy(q.hasta)}`
            : vista.startsWith('consolidado')
                ? 'Saldos a la fecha'
                : `Del ${ddmmyyyy(q.desde)} al ${ddmmyyyy(q.hasta)}`;
    escribirTabla(sheet, 5, columnas, filas, true);
    return Buffer.from(await wb.xlsx.writeBuffer());
}
export async function excelDetalle(bd, codPagares, corte, nombreEmpresa) {
    const { pagare, lineas } = await repo.detalle(bd, codPagares, corte);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Amortización');
    sheet.getCell('A1').value = nombreEmpresa;
    sheet.getCell('A1').font = { bold: true, size: 13 };
    sheet.getCell('A2').value = `PAGARÉ #${pagare.PAGARE} · ${pagare.BANCO} · ${pagare.EMPRESA}`;
    sheet.getCell('A2').font = { bold: true };
    sheet.getCell('A3').value = `Monto ${Number(pagare.MONTO).toLocaleString('es-VE', { minimumFractionDigits: 2 })} · Tasa ${Number(pagare.TASA)} % · Plazo ${pagare.PLAZO} meses · Liquidación ${String(pagare.FECHA ?? '').split('-').reverse().join('/')}`;
    escribirTabla(sheet, 5, COLUMNAS_DETALLE, lineas, true);
    return Buffer.from(await wb.xlsx.writeBuffer());
}
//# sourceMappingURL=pagares.service.js.map