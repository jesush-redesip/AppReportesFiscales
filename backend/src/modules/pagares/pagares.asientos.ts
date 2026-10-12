import sql from 'mssql';
import { assertSafeDatabaseIdentifier, queryTenantRaw } from '../../shared/db/tenant-pool.js';
import { PagaresError } from './pagares.repository.js';

/**
 * Asientos de pagarés en la contabilidad de ICG (Fase 3).
 *
 * Como los que BIGBEN cargaba a mano (abril-julio 2026): todo en bolívares, en la moneda
 * principal de la base contable y con factor 1 (DEBE = DEBE1). Los pagarés se llevan en
 * USD (créditos indexados): el monto en Bs = USD × tasa, con la tasa de la fecha
 * contable (COTIZACIONES) que el usuario puede corregir por la del banco.
 *
 * Numeración igual que el PHP y el Cierre de Caja: CONTROLASIENTO (interno) y
 * PARAMETROS 'MASIV' (visible), más REGISTROAUDITORIA. Todo dentro de la transacción de
 * quien llama, con bloqueos para que dos usuarios no tomen el mismo número.
 *
 * Cada asiento queda en RIP_PAGARESASIENTOS (base de gestión) con la cuota que pagó:
 * así no se contabiliza dos veces y se puede reversar.
 */

export const CONCEPTO = 8;
const TABLA = 'RIP_PAGARESASIENTOS';

export interface Apunte {
  cuenta: string;
  comentario: string;
  debe: number;
  haber: number;
}

export interface Cargo {
  descripcion: string;
  /** Bs */
  monto: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Moneda USD con cotizaciones (la que más tenga) y su tasa a la fecha (la última ≤ fecha). */
export async function cotizacionUsd(bd: string, fechaIso: string): Promise<{ codMoneda: number; tasa: number; fecha: string } | null> {
  const f = await queryTenantRaw<{ CODMONEDA: number; COTIZACION: number; FECHA: Date }>(
    bd,
    `SELECT TOP 1 C.CODMONEDA, C.COTIZACION, C.FECHA
     FROM COTIZACIONES C WITH (NOLOCK)
     WHERE C.CODMONEDA = (SELECT TOP 1 M.CODMONEDA FROM MONEDAS M JOIN COTIZACIONES X ON X.CODMONEDA = M.CODMONEDA
                          WHERE M.CODIGOISO = 'USD' GROUP BY M.CODMONEDA ORDER BY COUNT(*) DESC)
       AND C.FECHA <= @F AND C.COTIZACION > 0
     ORDER BY C.FECHA DESC`,
    { F: { type: () => sql.Date, value: new Date(`${fechaIso}T00:00:00Z`) } },
  );
  if (!f[0]) return null;
  return { codMoneda: Number(f[0].CODMONEDA), tasa: Number(f[0].COTIZACION), fecha: new Date(f[0].FECHA).toISOString().slice(0, 10) };
}

/** Cuentas que no existen (o son "Cuenta indefinida") en la base contable. */
async function cuentasInvalidas(req: () => sql.Request, bdC: string, cuentas: string[]): Promise<string[]> {
  const unicas = [...new Set(cuentas)];
  const r = await req().query(
    `SELECT LTRIM(RTRIM(CODIGO)) AS CODIGO FROM [${bdC}].dbo.CUENTAS
     WHERE LTRIM(RTRIM(CODIGO)) IN (${unicas.map((c) => `'${c.replace(/[^0-9]/g, '')}'`).join(', ')})
       AND ISNULL(TITULO, '') NOT IN ('', 'Cuenta indefinida')`,
  );
  const validas = new Set((r.recordset as { CODIGO: string }[]).map((x) => x.CODIGO));
  return unicas.filter((c) => !validas.has(c));
}

export interface Contexto {
  bdContable: string;
  fecha: string; // yyyy-mm-dd
  serie: string;
  codPagares: number;
  usuario: string;
  codUsuario: number;
  codEmpresa: number;
}

/**
 * Inserta un asiento cuadrado en la base contable y devuelve sus dos números. Los
 * apuntes en 0 se omiten.
 */
export async function postearAsiento(req: () => sql.Request, ctx: Contexto, apuntes: Apunte[]): Promise<{ asiento: number; asientoVisible: number }> {
  const bdC = ctx.bdContable;
  assertSafeDatabaseIdentifier(bdC);
  const lineas = apuntes
    .map((a) => ({ ...a, debe: r2(a.debe), haber: r2(a.haber), comentario: a.comentario.toUpperCase().slice(0, 255) }))
    .filter((a) => a.debe !== 0 || a.haber !== 0);
  if (!lineas.length) throw new PagaresError('El asiento no tiene montos.');
  if (lineas.some((a) => a.debe < 0 || a.haber < 0)) throw new PagaresError('El asiento tiene montos negativos.');
  const dif = r2(lineas.reduce((s, a) => s + a.debe - a.haber, 0));
  if (dif !== 0) throw new PagaresError(`El asiento no cuadra (diferencia ${dif}).`);
  const malas = await cuentasInvalidas(req, bdC, lineas.map((a) => a.cuenta));
  if (malas.length) throw new PagaresError(`Estas cuentas no existen en la contabilidad ${bdC}: ${malas.join(', ')}. Corrija la configuración o el pagaré.`);

  const num = await req().query(
    // CONTROLASIENTO y MASIV pueden quedar atrás de DIARIOAPUNTES (asientos cargados por
    // otra vía, visto en cBIGBEN_TIENDA_2025): se toma el mayor para no chocar.
    `DECLARE @ASIENTO INT, @AV INT, @MAXDA INT, @MAXAV INT
     SELECT @ASIENTO = ISNULL(MAX(ASIENTO), 0) + 1 FROM [${bdC}].dbo.CONTROLASIENTO WITH (UPDLOCK, HOLDLOCK)
     SELECT @MAXDA = ISNULL(MAX(ASIENTO), 0) + 1, @MAXAV = ISNULL(MAX(ASIENTOVISIBLE), 0) + 1
       FROM [${bdC}].dbo.DIARIOAPUNTES WITH (UPDLOCK, HOLDLOCK)
     IF @MAXDA > @ASIENTO SET @ASIENTO = @MAXDA
     UPDATE [${bdC}].dbo.PARAMETROS WITH (UPDLOCK)
        SET @AV = CASE WHEN CAST(VALOR AS INT) + 1 > @MAXAV THEN CAST(VALOR AS INT) + 1 ELSE @MAXAV END,
            VALOR = CAST(CASE WHEN CAST(VALOR AS INT) + 1 > @MAXAV THEN CAST(VALOR AS INT) + 1 ELSE @MAXAV END AS NVARCHAR(60))
      WHERE CLAVE = 'MASIV'
     IF @AV IS NULL THROW 50001, 'La contabilidad no tiene el parámetro MASIV.', 1
     INSERT INTO [${bdC}].dbo.CONTROLASIENTO (ASIENTO) VALUES (@ASIENTO)
     SELECT @ASIENTO AS ASIENTO, @AV AS AV,
            (SELECT TOP 1 CODMONEDA FROM [${bdC}].dbo.MONEDAS WHERE PRINCIPAL = 'T') AS CM`,
  );
  const asiento = Number(num.recordset[0].ASIENTO);
  const asientoVisible = Number(num.recordset[0].AV);
  const codMoneda = Number(num.recordset[0].CM ?? 1);
  const usuario = ctx.usuario.slice(0, 10);

  for (const [i, a] of lineas.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await req()
      .input('USUARIO', sql.NVarChar(10), usuario)
      .input('ASIENTO', sql.Int, asiento)
      .input('APUNTE', sql.Int, i + 1)
      .input('FECHA', sql.DateTime, new Date(`${ctx.fecha}T00:00:00Z`))
      .input('CUENTA', sql.NVarChar(12), a.cuenta)
      .input('CONCEPTO', sql.Int, CONCEPTO)
      .input('COMENTARIO', sql.NVarChar(255), a.comentario)
      .input('SERIE', sql.NVarChar(4), ctx.serie)
      .input('NUMDOC', sql.Int, ctx.codPagares)
      .input('DEBE', sql.Float, a.debe)
      .input('HABER', sql.Float, a.haber)
      .input('CM', sql.Int, codMoneda)
      .input('EMPRESA', sql.Int, ctx.codEmpresa)
      .input('AV', sql.Int, asientoVisible).query(`
        INSERT INTO [${bdC}].dbo.DIARIOAPUNTES (USUARIO, ASIENTO, APUNTE, NIVEL, FECHA, CUENTA, CONCEPTO, COMENTARIO, SERIEDOCUMENTO,
          NUMERODOCUMENTO, DEBE, HABER, LIBROIVA, COSTES, PUNTEO, RETENCION, CENTROCOSTE, FACTORMONEDA, CODMONEDA, EMPRESAGESTION,
          DEBE1, HABER1, PNORMA43STR, ASIENTOVISIBLE, CODMONEDADC, TIPODOCUMENTO, SERIEFISCAL, CODTERCERO, TERCEROESCLIENTE, NUMEROFISCAL)
        VALUES (@USUARIO, @ASIENTO, @APUNTE, 'A', @FECHA, @CUENTA, @CONCEPTO, @COMENTARIO, @SERIE,
          @NUMDOC, @DEBE, @HABER, NULL, NULL, NULL, 'F', '', 1, @CM, @EMPRESA,
          @DEBE, @HABER, NULL, @AV, NULL, NULL, NULL, NULL, NULL, NULL)`);
  }
  await req()
    .input('CODUSUARIO', sql.Int, ctx.codUsuario)
    .input('USUARIO', sql.NVarChar(10), usuario)
    .input('ASIENTO', sql.Int, asiento)
    .input('DESC', sql.NVarChar(45), lineas[0].comentario.slice(0, 45))
    .input('CONCEPTO', sql.Int, CONCEPTO).query(`
      INSERT INTO [${bdC}].dbo.REGISTROAUDITORIA (FECHA, HORA, TIPO, CODEMPLEADO, SERIE, NUMERO, N, CODARTICULO, TALLA, COLOR, DESCRIPCION, UDS,
        PRECIO, PRECIOIVA, USUARIO, ASIENTO, APUNTE, NIVEL, CUENTA, CONCEPTO)
      VALUES (CAST(GETDATE() AS DATE), GETDATE(), 51, @CODUSUARIO, '', 0, '', 0, '', '', @DESC, 0, 0, 0, @USUARIO, @ASIENTO, 0, 'A', '', @CONCEPTO)`);
  return { asiento, asientoVisible };
}

// --- Registro de asientos de cada pagaré ---

export async function asegurarTabla(req: () => sql.Request) {
  await req().query(
    `IF OBJECT_ID('${TABLA}', 'U') IS NULL
       CREATE TABLE ${TABLA} (
         ID INT IDENTITY(1, 1) PRIMARY KEY,
         CODPAGARES INT NOT NULL,
         TIPO NVARCHAR(15) NOT NULL,            -- DESEMBOLSO | PAGO | REVERSO
         MES INT NULL,
         FECHAVENCIMIENTO DATE NULL,
         CAPITAL BIT NOT NULL DEFAULT 0,
         INTERESES BIT NOT NULL DEFAULT 0,
         BDCONTABLE NVARCHAR(128) NOT NULL,
         ASIENTO INT NOT NULL,
         ASIENTOVISIBLE INT NOT NULL,
         FECHACONTABLE DATE NOT NULL,
         TASA FLOAT NOT NULL,
         MONTOBS FLOAT NOT NULL,
         CODUSUARIO INT NOT NULL,
         FECHA DATETIME NOT NULL DEFAULT GETDATE(),
         REVERSADOPOR INT NULL)`,
  );
}

export interface Registro {
  codPagares: number;
  tipo: 'DESEMBOLSO' | 'PAGO' | 'REVERSO';
  mes?: number;
  fechaVencimiento?: string;
  capital?: boolean;
  intereses?: boolean;
  bdContable: string;
  asiento: number;
  asientoVisible: number;
  fechaContable: string;
  tasa: number;
  montoBs: number;
  codUsuario: number;
}

export async function registrarAsiento(req: () => sql.Request, r: Registro): Promise<number> {
  const res = await req()
    .input('COD', sql.Int, r.codPagares)
    .input('TIPO', sql.NVarChar(15), r.tipo)
    .input('MES', sql.Int, r.mes ?? null)
    .input('FV', sql.Date, r.fechaVencimiento ? new Date(`${r.fechaVencimiento}T00:00:00Z`) : null)
    .input('CAP', sql.Bit, Boolean(r.capital))
    .input('INT', sql.Bit, Boolean(r.intereses))
    .input('BD', sql.NVarChar(128), r.bdContable)
    .input('ASIENTO', sql.Int, r.asiento)
    .input('AV', sql.Int, r.asientoVisible)
    .input('FC', sql.Date, new Date(`${r.fechaContable}T00:00:00Z`))
    .input('TASA', sql.Float, r.tasa)
    .input('BS', sql.Float, r.montoBs)
    .input('USUARIO', sql.Int, r.codUsuario).query(`
      INSERT INTO ${TABLA} (CODPAGARES, TIPO, MES, FECHAVENCIMIENTO, CAPITAL, INTERESES, BDCONTABLE, ASIENTO, ASIENTOVISIBLE, FECHACONTABLE, TASA, MONTOBS, CODUSUARIO)
      OUTPUT INSERTED.ID
      VALUES (@COD, @TIPO, @MES, @FV, @CAP, @INT, @BD, @ASIENTO, @AV, @FC, @TASA, @BS, @USUARIO)`);
  return Number(res.recordset[0].ID);
}

/** Asientos generados por el Aplicativo para un pagaré (para la ventana de detalle). */
export async function asientosDePagare(bd: string, codPagares: number) {
  return queryTenantRaw<Record<string, unknown>>(
    bd,
    `IF OBJECT_ID('${TABLA}', 'U') IS NOT NULL
       SELECT ID, TIPO, MES, CONVERT(CHAR(10), FECHAVENCIMIENTO, 23) AS FECHAVENCIMIENTO, CAPITAL, INTERESES, BDCONTABLE,
              ASIENTO, ASIENTOVISIBLE, CONVERT(CHAR(10), FECHACONTABLE, 23) AS FECHACONTABLE, TASA, MONTOBS, REVERSADOPOR
       FROM ${TABLA} WHERE CODPAGARES = @COD ORDER BY ID`,
    { COD: { type: () => sql.Int, value: codPagares } },
  );
}

/** Apuntes de un asiento ya generado (para el reverso). */
export async function apuntesDe(req: () => sql.Request, bdC: string, asiento: number): Promise<Apunte[]> {
  assertSafeDatabaseIdentifier(bdC);
  const r = await req()
    .input('ASIENTO', sql.Int, asiento)
    .query(`SELECT CUENTA, COMENTARIO, DEBE, HABER FROM [${bdC}].dbo.DIARIOAPUNTES WHERE ASIENTO = @ASIENTO ORDER BY APUNTE`);
  return (r.recordset as { CUENTA: string; COMENTARIO: string; DEBE: number; HABER: number }[]).map((a) => ({
    cuenta: a.CUENTA.trim(),
    comentario: a.COMENTARIO ?? '',
    debe: Number(a.DEBE),
    haber: Number(a.HABER),
  }));
}

export const tablaAsientos = TABLA;
