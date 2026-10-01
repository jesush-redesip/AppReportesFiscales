import sql from 'mssql';
import { generalPool, generalPoolConnect } from '../db/general-pool.js';

/**
 * Registro de auditoría: quién hizo qué y cuándo (inicios de sesión, contabilizar,
 * descontabilizar, cambios de declarado y formas de pago, configuración, permisos,
 * descargas de Excel, modo debug). Vive en GENERAL, igual que los permisos: un mismo
 * usuario trabaja en varias empresas y la auditoría se consulta en un solo lugar.
 * La tabla se crea en el primer uso (mismo criterio que RIP_PERMISOSMODULOS).
 */

export type ResultadoAuditoria = 'OK' | 'ERROR' | 'RECHAZADO';

export interface EntradaAuditoria {
  codUsuario: number | null;
  usuario: string | null;
  codEmpresa: number | null;
  bd: string | null;
  accion: string;
  detalle: unknown;
  resultado: ResultadoAuditoria;
  mensaje: string | null;
  metodo: string;
  ruta: string;
  ip: string | null;
}

export interface FilaAuditoria {
  id: number;
  /** Hora del servidor SQL, 'AAAA-MM-DD HH:MM:SS' (sin zona horaria: no convertir). */
  fecha: string;
  usuario: string;
  codUsuario: number | null;
  empresa: string;
  accion: string;
  resultado: string;
  mensaje: string;
  detalle: string;
  ip: string;
}

let tablaLista: Promise<void> | null = null;

function ensureTabla(): Promise<void> {
  tablaLista ??= (async () => {
    await generalPoolConnect;
    await generalPool.request().query(
      `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RIP_AUDITORIA')
       BEGIN
         CREATE TABLE dbo.RIP_AUDITORIA (
           ID          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RIP_AUDITORIA PRIMARY KEY,
           FECHA       DATETIME2(0)   NOT NULL CONSTRAINT DF_RIP_AUDITORIA_FECHA DEFAULT SYSDATETIME(),
           CODUSUARIO  INT            NULL,
           USUARIO     NVARCHAR(100)  NULL,
           CODEMPRESA  INT            NULL,
           BD          NVARCHAR(128)  NULL,
           ACCION      NVARCHAR(80)   NOT NULL,
           RESULTADO   NVARCHAR(12)   NOT NULL,
           MENSAJE     NVARCHAR(500)  NULL,
           DETALLE     NVARCHAR(MAX)  NULL,
           METODO      NVARCHAR(10)   NULL,
           RUTA        NVARCHAR(300)  NULL,
           IP          NVARCHAR(64)   NULL
         );
         CREATE INDEX IX_RIP_AUDITORIA_FECHA ON dbo.RIP_AUDITORIA (FECHA DESC);
       END`,
    );
  })().catch((err) => {
    tablaLista = null; // reintentar en la próxima llamada
    throw err;
  });
  return tablaLista;
}

/**
 * Guarda una entrada. Nunca lanza: una falla de auditoría se reporta en consola pero no
 * debe tumbar la operación del usuario (que ya se ejecutó cuando se llega aquí).
 */
export async function registrarAuditoria(e: EntradaAuditoria): Promise<void> {
  try {
    await ensureTabla();
    const req = generalPool.request();
    req.input('CODUSUARIO', sql.Int, e.codUsuario);
    req.input('USUARIO', sql.NVarChar(100), e.usuario?.slice(0, 100) ?? null);
    req.input('CODEMPRESA', sql.Int, e.codEmpresa);
    req.input('BD', sql.NVarChar(128), e.bd);
    req.input('ACCION', sql.NVarChar(80), e.accion.slice(0, 80));
    req.input('RESULTADO', sql.NVarChar(12), e.resultado);
    req.input('MENSAJE', sql.NVarChar(500), e.mensaje?.slice(0, 500) ?? null);
    req.input('DETALLE', sql.NVarChar(sql.MAX), e.detalle == null ? null : JSON.stringify(e.detalle));
    req.input('METODO', sql.NVarChar(10), e.metodo);
    req.input('RUTA', sql.NVarChar(300), e.ruta.slice(0, 300));
    req.input('IP', sql.NVarChar(64), e.ip);
    await req.query(
      `INSERT INTO dbo.RIP_AUDITORIA (CODUSUARIO, USUARIO, CODEMPRESA, BD, ACCION, RESULTADO, MENSAJE, DETALLE, METODO, RUTA, IP)
       VALUES (@CODUSUARIO, @USUARIO, @CODEMPRESA, @BD, @ACCION, @RESULTADO, @MENSAJE, @DETALLE, @METODO, @RUTA, @IP)`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[AUDITORIA] No se pudo registrar la acción', e.accion, err);
  }
}

export interface FiltrosAuditoria {
  desde: string; // yyyy-MM-dd
  hasta: string; // yyyy-MM-dd (inclusive)
  usuario?: string;
  accion?: string;
  resultado?: string;
}

/** Tope de filas por consulta: la vista pagina en el navegador. */
export const MAX_FILAS_AUDITORIA = 5000;

export async function consultarAuditoria(f: FiltrosAuditoria): Promise<{ filas: FilaAuditoria[]; truncado: boolean }> {
  await ensureTabla();
  const req = generalPool.request();
  req.input('DESDE', sql.Date, f.desde);
  req.input('HASTA', sql.Date, f.hasta);
  req.input('USUARIO', sql.NVarChar(100), f.usuario?.trim() ? `%${f.usuario.trim()}%` : null);
  req.input('ACCION', sql.NVarChar(80), f.accion?.trim() || null);
  req.input('RESULTADO', sql.NVarChar(12), f.resultado?.trim() || null);
  const result = await req.query(
    // FECHA se devuelve como texto (estilo 120: 'AAAA-MM-DD HH:MM:SS'), tal cual la
    // guardó SYSDATETIME() con la hora del servidor. Como Date, el driver mssql la
    // interpreta como UTC (useUTC por defecto) y el navegador le restaba la zona horaria.
    `SELECT TOP (${MAX_FILAS_AUDITORIA + 1})
       A.ID, CONVERT(VARCHAR(19), A.FECHA, 120) AS FECHA, A.CODUSUARIO, A.USUARIO, A.CODEMPRESA, A.BD, A.ACCION, A.RESULTADO, A.MENSAJE, A.DETALLE, A.IP,
       E.TITULO AS EMPRESA
     FROM dbo.RIP_AUDITORIA A
       LEFT JOIN dbo.EMPRESAS E ON E.CODEMPRESA = A.CODEMPRESA
     WHERE A.FECHA >= @DESDE AND A.FECHA < DATEADD(DAY, 1, @HASTA)
       AND (@USUARIO IS NULL OR A.USUARIO LIKE @USUARIO)
       AND (@ACCION IS NULL OR A.ACCION = @ACCION)
       AND (@RESULTADO IS NULL OR A.RESULTADO = @RESULTADO)
     ORDER BY A.ID DESC`,
  );
  const s = (v: unknown) => String(v ?? '').trim();
  const filas = result.recordset.slice(0, MAX_FILAS_AUDITORIA).map((r) => ({
    id: Number(r.ID),
    fecha: s(r.FECHA),
    usuario: s(r.USUARIO),
    codUsuario: r.CODUSUARIO == null ? null : Number(r.CODUSUARIO),
    empresa: s(r.EMPRESA) || s(r.BD),
    accion: s(r.ACCION),
    resultado: s(r.RESULTADO),
    mensaje: s(r.MENSAJE),
    detalle: s(r.DETALLE),
    ip: s(r.IP),
  }));
  return { filas, truncado: result.recordset.length > MAX_FILAS_AUDITORIA };
}

/** Acciones distintas registradas, para el filtro de la pantalla. */
export async function accionesRegistradas(): Promise<string[]> {
  await ensureTabla();
  const result = await generalPool.request().query('SELECT DISTINCT ACCION FROM dbo.RIP_AUDITORIA ORDER BY ACCION');
  return result.recordset.map((r) => String(r.ACCION ?? '').trim()).filter(Boolean);
}
