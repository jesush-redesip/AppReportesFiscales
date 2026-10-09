import sql from 'mssql';
import { assertSafeDatabaseIdentifier, queryTenantRaw, withTenantTransaction } from '../../shared/db/tenant-pool.js';
import type { SpParam } from '../../shared/db/sp-runner.js';
import { PagaresError, olvidarEsquema } from './pagares.repository.js';
import { generarCuotas, validar, type DatosAmortizacion } from './pagares.calculo.js';

/**
 * Pagarés › gestión (Fase 2): registrar, pagar cuotas, editarlas, recalcular intereses y
 * anular. SIN asientos contables: convive con el PHP reportesicg, que sigue
 * contabilizando. Por eso lo que se escribe es lo mismo que escribe el PHP:
 *  - RIP_PAGARESCAB / RIP_PAGARESLIN con los mismos campos (CUENTABANCO, CUENTAPAGARE,
 *    DBCONTABLE…), para que el PHP pueda contabilizar los pagos.
 *  - La cuenta del pagaré (210104xxx, "PAGARÉ <banco> #<n>") en la base contable, como
 *    hace el PHP al registrar. Si la base contable no está en este servidor no se crea y
 *    se avisa.
 * Lo que NO hace (queda para la Fase 3 o para el PHP): asientos de desembolso, comisión,
 * intereses, IGTF y pago de capital.
 */

const p = (type: () => unknown, value: unknown): SpParam => ({ type, value });
const RAIZ_CUENTA_PAGARE = '210104';
const CUENTA_COMISION_DEFECTO = '611201035';
const TABLA_ANULADOS = 'RIP_PAGARESANULADOS';

// --- Base contable de cada serie ---

export interface SerieContable {
  serie: string;
  descripcion: string;
  /** Base contable en este servidor, o null si no se pudo resolver. */
  bdContable: string | null;
  origen: 'serie' | 'pagares' | null;
}

/**
 * Series de 2 letras (empresas) con su base contable: la de SERIES.CONTABILIDADB en
 * GENERAL..EMPRESASCONTABLES; si no está, la del último pagaré de esa serie (el PHP
 * actualiza DBCONTABLE al cambiar de ejercicio). Solo vale si la base existe aquí.
 */
export async function seriesContables(bd: string): Promise<SerieContable[]> {
  const filas = await queryTenantRaw<{ SERIE: string; DESCRIPCION: string | null; BD_SERIE: string | null; BD_PAGARES: string | null }>(
    bd,
    `SELECT S.SERIE, S.DESCRIPCION,
            CASE WHEN DB_ID(SUBSTRING(EC.PATHBD, CHARINDEX(':', EC.PATHBD) + 1, 200)) IS NOT NULL
                 THEN SUBSTRING(EC.PATHBD, CHARINDEX(':', EC.PATHBD) + 1, 200) END AS BD_SERIE,
            (SELECT TOP 1 CASE WHEN DB_ID(REPLACE(LTRIM(RTRIM(P.DBCONTABLE)), '.dbo.', '')) IS NOT NULL
                               THEN REPLACE(LTRIM(RTRIM(P.DBCONTABLE)), '.dbo.', '') END
             FROM RIP_PAGARESCAB P WITH (NOLOCK)
             WHERE P.EMPRESA COLLATE DATABASE_DEFAULT = S.SERIE COLLATE DATABASE_DEFAULT AND P.DBCONTABLE LIKE '%_.dbo.'
             ORDER BY P.CODPAGARES DESC) AS BD_PAGARES
     FROM SERIES S WITH (NOLOCK)
     LEFT JOIN GENERAL.dbo.EMPRESASCONTABLES EC WITH (NOLOCK)
       ON EC.CODIGO = TRY_CAST(SUBSTRING(S.CONTABILIDADB, 6, 3) AS INT)
      AND EC.EJERCICIO = TRY_CAST(SUBSTRING(S.CONTABILIDADB, 2, 4) AS INT)
     WHERE S.SERIE LIKE '__' AND (S.SERIE NOT LIKE 'Z%' OR S.SERIE = 'ZIA')
     ORDER BY S.SERIE`,
  );
  return filas.map((f) => {
    const bdContable = f.BD_SERIE?.trim() || f.BD_PAGARES?.trim() || null;
    return {
      serie: f.SERIE.trim(),
      descripcion: (f.DESCRIPCION ?? '').trim(),
      bdContable: bdContable && /^[A-Za-z0-9_]+$/.test(bdContable) ? bdContable : null,
      origen: f.BD_SERIE ? 'serie' : f.BD_PAGARES ? 'pagares' : null,
    };
  });
}

async function serieContable(bd: string, serie: string): Promise<SerieContable> {
  const s = (await seriesContables(bd)).find((x) => x.serie === serie);
  if (!s) throw new PagaresError(`La empresa (serie) "${serie}" no existe.`);
  return s;
}

/**
 * Bancos para registrar: las cuentas 110102* de la base contable (como el PHP) más las
 * que ya usan los pagarés de esa serie (por si la base contable no está en este servidor).
 */
export async function bancos(bd: string, serie: string): Promise<{ cuenta: string; titulo: string }[]> {
  const s = await serieContable(bd, serie);
  const lista = new Map<string, string>();
  if (s.bdContable) {
    assertSafeDatabaseIdentifier(s.bdContable);
    const filas = await queryTenantRaw<{ CODIGO: string; TITULO: string }>(
      bd,
      `SELECT LTRIM(RTRIM(CODIGO)) AS CODIGO, LTRIM(RTRIM(TITULO)) AS TITULO
       FROM [${s.bdContable}].dbo.CUENTAS WITH (NOLOCK)
       WHERE CODIGO LIKE '110102%' AND LEN(LTRIM(RTRIM(CODIGO))) > 6 AND ISNULL(TITULO, '') NOT IN ('', 'Cuenta indefinida')`,
    );
    filas.forEach((f) => lista.set(f.CODIGO, f.TITULO));
  }
  const usados = await queryTenantRaw<{ CUENTA: string; TITULO: string }>(
    bd,
    `SELECT LTRIM(RTRIM(CUENTABANCO)) AS CUENTA, MAX(LTRIM(RTRIM(CODBANCO))) AS TITULO
     FROM RIP_PAGARESCAB WITH (NOLOCK)
     WHERE EMPRESA = @SERIE AND ISNULL(CUENTABANCO, '') LIKE '110102%'
     GROUP BY LTRIM(RTRIM(CUENTABANCO))`,
    { SERIE: p(() => sql.NVarChar(15), serie) },
  );
  usados.forEach((f) => !lista.has(f.CUENTA) && lista.set(f.CUENTA, f.TITULO));
  return [...lista.entries()].map(([cuenta, titulo]) => ({ cuenta, titulo })).sort((a, b) => a.titulo.localeCompare(b.titulo));
}

// --- Registrar ---

export interface NuevoPagare extends DatosAmortizacion {
  pagare: number;
  serie: string;
  cuentaBanco: string;
  /** % de comisión bancaria (informativo: el asiento lo hace el PHP / Fase 3). */
  comision: number;
  cuentaComision?: string;
  /** Las primeras N cuotas se registran con los intereses ya pagados (pagados por adelantado). */
  mesesInteresAdelantado: number;
}

export interface Sesion {
  codUsuario: number;
  codEmpresa: number;
}

export function simular(d: DatosAmortizacion) {
  return generarCuotas(d);
}

export async function registrar(bd: string, n: NuevoPagare, sesion: Sesion) {
  const error = validar(n);
  if (error) throw new PagaresError(error);
  if (!Number.isInteger(n.pagare) || n.pagare <= 0 || n.pagare > 2147483647) throw new PagaresError('El número de pagaré debe ser un entero positivo.');
  if (!(n.comision >= 0 && n.comision < 100)) throw new PagaresError('La comisión no es válida.');
  if (!Number.isInteger(n.mesesInteresAdelantado) || n.mesesInteresAdelantado < 0 || n.mesesInteresAdelantado > n.plazo) {
    throw new PagaresError('Los meses de intereses por adelantado no son válidos.');
  }
  const cuentaComision = (n.cuentaComision || CUENTA_COMISION_DEFECTO).trim();
  if (!/^\d{1,15}$/.test(cuentaComision)) throw new PagaresError('La cuenta de comisión no es válida.');

  const s = await serieContable(bd, n.serie);
  const banco = (await bancos(bd, n.serie)).find((b) => b.cuenta === n.cuentaBanco);
  if (!banco) throw new PagaresError('El banco elegido no es una cuenta 110102 de esa empresa.');
  const titulo = banco.titulo.slice(0, 50);
  const cuotas = generarCuotas(n);
  const cantidadCuotas = cuotas.filter((c) => c.capital > 0).length;

  return withTenantTransaction(bd, async (req) => {
    // Mismo criterio de duplicado que el PHP: número de pagaré + banco.
    const dup = await req()
      .input('PAGARE', sql.Int, n.pagare)
      .input('BANCO', sql.NVarChar(50), titulo)
      .query(`SELECT TOP 1 CODPAGARES FROM RIP_PAGARESCAB WITH (UPDLOCK, HOLDLOCK) WHERE PAGARE = @PAGARE AND CODBANCO = @BANCO`);
    if (dup.recordset.length) throw new PagaresError(`Ya existe el pagaré #${n.pagare} de ${titulo}.`);

    // Cuenta del pagaré en la base contable (como el PHP), si está en este servidor.
    let cuentaPagare: string | null = null;
    if (s.bdContable) {
      assertSafeDatabaseIdentifier(s.bdContable);
      const sig = await req().query(
        `SELECT CAST(ISNULL(MAX(CAST(CODIGO AS BIGINT)) + 1, ${RAIZ_CUENTA_PAGARE}001) AS VARCHAR(20)) AS CODIGO
         FROM [${s.bdContable}].dbo.CUENTAS WITH (UPDLOCK, HOLDLOCK)
         WHERE CODIGO LIKE '${RAIZ_CUENTA_PAGARE}%' AND LEN(LTRIM(RTRIM(CODIGO))) = 9 AND ISNUMERIC(CODIGO) = 1`,
      );
      cuentaPagare = String(sig.recordset[0].CODIGO);
      await req()
        .input('CODIGO', sql.NVarChar(20), cuentaPagare)
        .input('TITULO', sql.NVarChar(100), `PAGARÉ ${titulo} #${n.pagare}`)
        .query(`INSERT INTO [${s.bdContable}].dbo.CUENTAS (CODIGO, TITULO) VALUES (@CODIGO, @TITULO)`);
    }

    const cod = Number(
      (await req().query(`SELECT ISNULL(MAX(CODPAGARES), 0) + 1 AS COD FROM RIP_PAGARESCAB WITH (UPDLOCK, HOLDLOCK)`)).recordset[0].COD,
    );
    await req()
      .input('COD', sql.Int, cod)
      .input('FECHA', sql.Date, new Date(`${n.fechaLiquidacion}T00:00:00Z`))
      .input('DIA', sql.Int, n.diaPago)
      .input('PAGARE', sql.Int, n.pagare)
      .input('SERIE', sql.NVarChar(15), n.serie)
      .input('BANCO', sql.NVarChar(50), titulo)
      .input('MONTO', sql.Float, n.monto)
      .input('COMISION', sql.Float, n.comision)
      .input('PLAZO', sql.Int, n.plazo)
      .input('TASA', sql.Float, n.tasa)
      .input('FRECUENCIA', sql.NVarChar(15), n.frecuenciaCapital)
      .input('CUOTAS', sql.Int, cantidadCuotas)
      .input('CUOTACAPITAL', sql.Float, Math.round((n.monto / cantidadCuotas) * 1000) / 1000)
      .input('TASAMENSUAL', sql.Float, Math.round((n.tasa / 12) * 1000) / 1000)
      .input('EMPRESAICG', sql.Int, sesion.codEmpresa)
      .input('USUARIO', sql.Int, sesion.codUsuario)
      .input('CUENTABANCO', sql.NVarChar(12), n.cuentaBanco)
      .input('CUENTAPAGARE', sql.NVarChar(12), cuentaPagare)
      .input('CUENTACOMISION', sql.NVarChar(15), cuentaComision)
      .input('DBCONTABLE', sql.NVarChar(50), s.bdContable ? `${s.bdContable}.dbo.` : null)
      .input('FRECINTERESES', sql.NVarChar(15), n.frecuenciaIntereses)
      .input('APARTIR', sql.Int, n.mesesGracia > 0 ? n.mesesGracia : -1).query(`
        INSERT INTO RIP_PAGARESCAB (CODPAGARES, FECHA, DIAPAGO, PAGARE, EMPRESA, CODBANCO, MONTO, MONTOCOMISIONBAN, PLAZO, TASA3, TASA,
          FRECUENCIAPAGO, CANTIDADCUOTAS, MONTOCUOTACAPITAL, TASAMENSUAL, ENLACE_EJERCICIO, ENLACE_EMPRESA, ENLACE_USUARIO,
          CUENTABANCO, CUENTAPAGARE, CUENTACOMISIONBAN, DBCONTABLE, FRECUENCIAPAGOINTERESES, COBRARAPARTIRDE)
        VALUES (@COD, @FECHA, @DIA, @PAGARE, @SERIE, @BANCO, @MONTO, @COMISION, @PLAZO, 0, @TASA,
          @FRECUENCIA, @CUOTAS, @CUOTACAPITAL, @TASAMENSUAL, YEAR(GETDATE()), @EMPRESAICG, @USUARIO,
          @CUENTABANCO, @CUENTAPAGARE, @CUENTACOMISION, @DBCONTABLE, @FRECINTERESES, @APARTIR)`);

    for (const c of cuotas) {
      const adelantado = !c.sinIntereses && c.mes <= n.mesesInteresAdelantado;
      // eslint-disable-next-line no-await-in-loop
      await req()
        .input('COD', sql.Int, cod)
        .input('MES', sql.Int, c.mes)
        .input('FV', sql.Date, new Date(`${c.fecha}T00:00:00Z`))
        .input('SALDO', sql.Real, c.saldo)
        .input('CAP', sql.Real, c.capital)
        .input('INT', sql.Real, c.intereses)
        .input('TOTAL', sql.Real, c.total)
        .input('INTPAG', sql.NVarChar(1), c.sinIntereses || adelantado ? 'T' : 'F')
        .input('NOCOBRAR', sql.NVarChar(1), c.sinIntereses ? 'T' : 'F')
        .input('FCI', sql.Date, adelantado ? new Date(`${n.fechaLiquidacion}T00:00:00Z`) : null)
        .input('USUARIO', sql.Int, adelantado ? sesion.codUsuario : null).query(`
          INSERT INTO RIP_PAGARESLIN (NUMPAGARESCAB, MES, FECHAVENCIMIENTO, SALDOPAGARES, PAGOSCAPITAL, PAGOSINTERESES, PAGOTOTAL,
            PAGADO, INTERESESPAGADOS, NOCOBRARINTERESES, FECHACONTABLEINTERES, PAGADOPOR, FECHAOPERACION)
          VALUES (@COD, @MES, @FV, @SALDO, @CAP, @INT, @TOTAL, 'F', @INTPAG, @NOCOBRAR, @FCI, @USUARIO, CASE WHEN @FCI IS NULL THEN NULL ELSE GETDATE() END)`);
    }
    return {
      codPagares: cod,
      cuentaPagare,
      bdContable: s.bdContable,
      aviso: s.bdContable
        ? null
        : 'La base contable de esta empresa no está en este servidor: no se creó la cuenta del pagaré (210104) y el PHP no podrá contabilizar sus pagos hasta que se le asigne.',
    };
  });
}

// --- Cuotas ---

/** Identifica una cuota: (MES, FECHAVENCIMIENTO), como el PHP (MES puede repetirse). */
export interface RefCuota {
  mes: number;
  /** yyyy-mm-dd */
  fecha: string;
}

const fechaSql = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new PagaresError(`Fecha inválida: ${iso}`);
  return new Date(`${iso}T00:00:00Z`);
};

/** Tabla propia del Aplicativo (el PHP no la conoce); se crea al anular el primero. */
async function asegurarTablaAnulados(req: () => sql.Request) {
  await req().query(
    `IF OBJECT_ID('${TABLA_ANULADOS}', 'U') IS NULL
       CREATE TABLE ${TABLA_ANULADOS} (
         CODPAGARES INT NOT NULL PRIMARY KEY,
         FECHA DATETIME NOT NULL DEFAULT GETDATE(),
         CODUSUARIO INT NOT NULL,
         MOTIVO NVARCHAR(200) NULL)`,
  );
}

/** El pagaré existe y no está anulado. */
async function verificarVigente(req: () => sql.Request, cod: number) {
  const r = await req()
    .input('COD', sql.Int, cod)
    .query(
      `SELECT (SELECT COUNT(*) FROM RIP_PAGARESCAB WHERE CODPAGARES = @COD) AS EXISTE,
              CASE WHEN OBJECT_ID('${TABLA_ANULADOS}', 'U') IS NULL THEN 0 ELSE 1 END AS HAY_TABLA`,
    );
  if (!r.recordset[0].EXISTE) throw new PagaresError('No se encontró el pagaré.');
  if (!r.recordset[0].HAY_TABLA) return;
  // En otro lote: si la tabla no existiera, la sola mención haría fallar la consulta.
  const a = await req().input('COD', sql.Int, cod).query(`SELECT COUNT(*) AS N FROM ${TABLA_ANULADOS} WHERE CODPAGARES = @COD`);
  if (a.recordset[0].N) throw new PagaresError('El pagaré está anulado.');
}

export async function pagar(bd: string, cod: number, cuota: RefCuota, tipo: 'capital' | 'intereses', fechaContable: string, sesion: Sesion) {
  return withTenantTransaction(bd, async (req) => {
    await verificarVigente(req, cod);
    const sets =
      tipo === 'capital'
        ? `PAGADO = 'T', FECHACONTABLE = @FC`
        : `INTERESESPAGADOS = 'T', FECHACONTABLEINTERES = @FC`;
    const pendiente = tipo === 'capital' ? `PAGADO <> 'T' AND ISNULL(PAGOSCAPITAL, 0) > 0` : `ISNULL(INTERESESPAGADOS, 'F') <> 'T' AND PAGOSINTERESES > 0`;
    const r = await req()
      .input('COD', sql.Int, cod)
      .input('MES', sql.Int, cuota.mes)
      .input('FV', sql.Date, fechaSql(cuota.fecha))
      .input('FC', sql.Date, fechaSql(fechaContable))
      .input('USUARIO', sql.Int, sesion.codUsuario)
      .query(
        `UPDATE RIP_PAGARESLIN SET ${sets}, FECHAOPERACION = GETDATE(), PAGADOPOR = @USUARIO
         WHERE NUMPAGARESCAB = @COD AND MES = @MES AND FECHAVENCIMIENTO = @FV AND ${pendiente}`,
      );
    if (!r.rowsAffected[0]) throw new PagaresError(`Esa cuota no tiene ${tipo === 'capital' ? 'capital' : 'intereses'} pendiente (quizá ya se pagó).`);
  });
}

interface LineaBd {
  MES: number;
  FV: Date;
  SALDO: number;
  CAP: number;
  INTE: number;
  PAGADO: string;
  INTPAG: string;
  NOCOBRAR: string;
}

async function lineas(req: () => sql.Request, cod: number): Promise<LineaBd[]> {
  const r = await req()
    .input('COD', sql.Int, cod)
    .query(
      `SELECT MES, FECHAVENCIMIENTO AS FV, SALDOPAGARES AS SALDO, ISNULL(PAGOSCAPITAL, 0) AS CAP, PAGOSINTERESES AS INTE,
              PAGADO, ISNULL(INTERESESPAGADOS, 'F') AS INTPAG, ISNULL(NOCOBRARINTERESES, 'F') AS NOCOBRAR
       FROM RIP_PAGARESLIN WITH (UPDLOCK, HOLDLOCK) WHERE NUMPAGARESCAB = @COD ORDER BY FECHAVENCIMIENTO, MES`,
    );
  return r.recordset as LineaBd[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const mismaCuota = (l: LineaBd, c: RefCuota) => l.MES === c.mes && iso(l.FV) === c.fecha;

async function guardarLinea(req: () => sql.Request, cod: number, l: LineaBd, cambios: { saldo?: number; cap?: number; inte?: number; fecha?: string }) {
  const cap = cambios.cap ?? Number(l.CAP);
  const inte = cambios.inte ?? Number(l.INTE);
  await req()
    .input('COD', sql.Int, cod)
    .input('MES', sql.Int, l.MES)
    .input('FV', sql.Date, l.FV)
    .input('NFV', sql.Date, cambios.fecha ? fechaSql(cambios.fecha) : l.FV)
    .input('SALDO', sql.Real, cambios.saldo ?? Number(l.SALDO))
    .input('CAP', sql.Real, cap)
    .input('INT', sql.Real, inte)
    .input('TOTAL', sql.Real, r2(cap + inte))
    .query(
      `UPDATE RIP_PAGARESLIN SET FECHAVENCIMIENTO = @NFV, SALDOPAGARES = @SALDO, PAGOSCAPITAL = @CAP, PAGOSINTERESES = @INT, PAGOTOTAL = @TOTAL
       WHERE NUMPAGARESCAB = @COD AND MES = @MES AND FECHAVENCIMIENTO = @FV`,
    );
}

export interface EdicionCuota {
  fecha?: string;
  capital?: number;
  intereses?: number;
  /** Al cambiar el capital, ajustar en proporción los intereses pendientes de las cuotas siguientes. */
  ajustarIntereses?: boolean;
}

/**
 * Edita una cuota pendiente. Cambiar el capital reparte la diferencia en partes iguales
 * entre las cuotas siguientes con capital pendiente (como el PHP), recalcula sus saldos y,
 * si se pide, ajusta sus intereses pendientes en proporción al nuevo saldo.
 */
export async function editarCuota(bd: string, cod: number, cuota: RefCuota, e: EdicionCuota) {
  return withTenantTransaction(bd, async (req) => {
    await verificarVigente(req, cod);
    const todas = await lineas(req, cod);
    const i = todas.findIndex((l) => mismaCuota(l, cuota));
    if (i < 0) throw new PagaresError('No se encontró la cuota.');
    const l = todas[i];

    if (e.fecha !== undefined) {
      if (l.PAGADO === 'T' || (l.INTPAG === 'T' && l.NOCOBRAR !== 'T')) throw new PagaresError('Solo se puede cambiar la fecha de una cuota sin pagos.');
      if (todas.some((x, j) => j !== i && x.MES === l.MES && iso(x.FV) === e.fecha)) throw new PagaresError('Ya hay otra cuota con esa fecha.');
    }
    if (e.intereses !== undefined) {
      if (!(e.intereses >= 0)) throw new PagaresError('Los intereses no son válidos.');
      if (l.INTPAG === 'T') throw new PagaresError('Los intereses de esa cuota ya están pagados.');
    }
    if (e.capital !== undefined) {
      if (!(e.capital >= 0)) throw new PagaresError('El capital no es válido.');
      if (l.PAGADO === 'T') throw new PagaresError('El capital de esa cuota ya está pagado.');
    }

    await guardarLinea(req, cod, l, {
      fecha: e.fecha,
      cap: e.capital !== undefined ? r2(e.capital) : undefined,
      inte: e.intereses !== undefined ? r2(e.intereses) : undefined,
    });
    if (e.capital === undefined) return;

    // Reparte el saldo que queda entre las cuotas siguientes con capital pendiente.
    const siguientes = todas.slice(i + 1);
    const conCapital = siguientes.filter((x) => x.PAGADO !== 'T' && Number(x.CAP) > 0);
    const resto = r2(Number(l.SALDO) - r2(e.capital));
    if (resto < -0.005) throw new PagaresError('El capital no puede ser mayor que el saldo de la cuota.');
    const pagadoDespues = siguientes.filter((x) => x.PAGADO === 'T').reduce((s, x) => s + Number(x.CAP), 0);
    const aRepartir = r2(resto - pagadoDespues);
    if (!conCapital.length && Math.abs(aRepartir) > 0.005) throw new PagaresError('No hay cuotas siguientes con capital pendiente para repartir la diferencia.');
    const parte = conCapital.length ? r2(aRepartir / conCapital.length) : 0;

    let saldo = resto;
    let repartido = 0;
    for (const x of siguientes) {
      let cap = Number(x.CAP);
      if (conCapital.includes(x)) {
        repartido++;
        cap = repartido === conCapital.length ? r2(aRepartir - parte * (conCapital.length - 1)) : parte;
      }
      let inte = Number(x.INTE);
      if (e.ajustarIntereses && x.INTPAG !== 'T' && x.NOCOBRAR !== 'T' && Number(x.SALDO) > 0) inte = r2((inte * saldo) / Number(x.SALDO));
      // eslint-disable-next-line no-await-in-loop
      await guardarLinea(req, cod, x, { saldo: r2(saldo), cap: r2(cap), inte });
      saldo = r2(saldo - cap);
    }
  });
}

/**
 * Nueva tasa: los intereses pendientes (no pagados ni de gracia) se ajustan en proporción
 * (tasa nueva / tasa anterior), así se respeta cómo se calcularon (días/360, mensual o
 * cargados a mano). Si la tasa anterior era 0 no hay base para la proporción.
 */
export async function recalcularIntereses(bd: string, cod: number, tasaNueva: number) {
  if (!(tasaNueva >= 0 && tasaNueva <= 1000)) throw new PagaresError('La tasa no es válida.');
  return withTenantTransaction(bd, async (req) => {
    await verificarVigente(req, cod);
    const cab = await req().input('COD', sql.Int, cod).query(`SELECT ISNULL(TASA, 0) AS TASA FROM RIP_PAGARESCAB WITH (UPDLOCK) WHERE CODPAGARES = @COD`);
    const anterior = Number(cab.recordset[0].TASA);
    if (!(anterior > 0)) throw new PagaresError('El pagaré no tiene tasa registrada: edite los intereses de cada cuota.');
    const factor = tasaNueva / anterior;
    for (const x of await lineas(req, cod)) {
      if (x.INTPAG === 'T' || x.NOCOBRAR === 'T') continue;
      // eslint-disable-next-line no-await-in-loop
      await guardarLinea(req, cod, x, { inte: r2(Number(x.INTE) * factor) });
    }
    await req()
      .input('COD', sql.Int, cod)
      .input('TASA', sql.Float, tasaNueva)
      .input('TM', sql.Float, Math.round((tasaNueva / 12) * 1000) / 1000)
      .query(`UPDATE RIP_PAGARESCAB SET TASA = @TASA, TASAMENSUAL = @TM WHERE CODPAGARES = @COD`);
  });
}

/**
 * Anula un pagaré registrado por error: queda en RIP_PAGARESANULADOS y deja de verse en
 * el Aplicativo. No borra nada (ni sus cuotas, ni la cuenta 210104, ni asientos). Solo si
 * no tiene cuotas pagadas: un pagaré con pagos no se anula, se termina de pagar.
 */
export async function anular(bd: string, cod: number, motivo: string, sesion: Sesion) {
  const r = await withTenantTransaction(bd, async (req) => {
    await asegurarTablaAnulados(req);
    await verificarVigente(req, cod);
    const pagos = await req()
      .input('COD', sql.Int, cod)
      .query(
        // Los intereses pagados por adelantado al registrar (fecha = liquidación) no cuentan.
        `SELECT COUNT(*) AS N FROM RIP_PAGARESLIN L JOIN RIP_PAGARESCAB C ON C.CODPAGARES = L.NUMPAGARESCAB
         WHERE L.NUMPAGARESCAB = @COD
           AND (L.PAGADO = 'T'
                OR (L.INTERESESPAGADOS = 'T' AND ISNULL(L.NOCOBRARINTERESES, 'F') <> 'T'
                    AND ISNULL(L.FECHACONTABLEINTERES, '19000101') <> C.FECHA))`,
      );
    if (pagos.recordset[0].N > 0) throw new PagaresError('El pagaré tiene cuotas pagadas: no se puede anular.');
    await req()
      .input('COD', sql.Int, cod)
      .input('USUARIO', sql.Int, sesion.codUsuario)
      .input('MOTIVO', sql.NVarChar(200), motivo.trim().slice(0, 200) || null)
      .query(`INSERT INTO ${TABLA_ANULADOS} (CODPAGARES, CODUSUARIO, MOTIVO) VALUES (@COD, @USUARIO, @MOTIVO)`);
  });
  olvidarEsquema(bd);
  return r;
}

