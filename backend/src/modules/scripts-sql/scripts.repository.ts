import sql from 'mssql';
import { generalPool, generalPoolConnect } from '../../shared/db/general-pool.js';
import { assertSafeDatabaseIdentifier, queryTenantRaw, withTenantTransaction } from '../../shared/db/tenant-pool.js';
import { PROPIEDAD, huella, leerScript, olvidarComprobado, scriptsOficiales } from '../../shared/db/procedimientos.js';
import { analizarScript, normalizarNombre, sentenciaRestauracion, type ObjetoAfectado } from './scripts.validar.js';

/**
 * Scripts SQL (solo SUPERVISOR): catálogo de los procedimientos y funciones que usa el
 * aplicativo en cada empresa, instalación de los scripts oficiales (backend/sql) y
 * scripts propios para ajustes de un cliente.
 *
 * Todo cambio se ejecuta en una transacción en la base de GESTIÓN de la empresa:
 *  - antes se guarda la definición actual de cada objeto que toca (RIP_SCRIPTSRESPALDOS),
 *    para poder restaurarla;
 *  - el script queda registrado completo (RIP_SCRIPTSAPLICADOS), con quién y cuándo;
 *  - si un lote falla, se revierte todo y no cambia nada.
 * "Probar" hace lo mismo y revierte siempre.
 */

export class ScriptsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptsError';
  }
}

// --- Qué usa el aplicativo en la base de gestión ---
const P = ['P', 'PC'];
const F = ['FN', 'IF', 'TF', 'FS', 'FT'];
export interface ItemCatalogo {
  nombre: string;
  modulo: string;
  tipos: string[];
}
const CATALOGO: ItemCatalogo[] = [
  { nombre: 'rip.MR_GET_EMPRESAS', modulo: 'Filtros', tipos: P },
  { nombre: 'rip.MR_GET_SUCURSALES', modulo: 'Filtros', tipos: P },
  { nombre: 'rip.MR_GET_ALMACENES', modulo: 'Filtros', tipos: P },
  { nombre: 'rip.MR_GET_MONEDAS', modulo: 'Filtros', tipos: P },
  { nombre: 'rip.MR_GET_PROVEEDORES', modulo: 'Filtros', tipos: P },
  { nombre: 'rip.MR_GET_IMPRESORAS', modulo: 'Filtros', tipos: P },
  { nombre: 'dbo.F_GET_COTIZACION', modulo: 'Filtros', tipos: F },
  { nombre: 'rip.MR_LIBRO_VENTA', modulo: 'Libro de Venta', tipos: P },
  { nombre: 'rip.MR_LIBRO_VENTA2', modulo: 'Libro de Venta', tipos: P },
  { nombre: 'rip.MR_LIBRO_VENTA_AGRUPADO', modulo: 'Libro de Venta Isla', tipos: P },
  { nombre: 'rip.MR_DETALLE_VENTAS', modulo: 'Detalle de Ventas', tipos: P },
  { nombre: 'rip.MR_LIBRO_COMPRA', modulo: 'Libro de Compra', tipos: P },
  { nombre: 'rip.MR_DETALLE_COMPRAS', modulo: 'Detalle de Compras', tipos: P },
  { nombre: 'rip.REPM_MOVIMIENTO_INVENTARIO', modulo: 'Movimiento de Inventario', tipos: P },
  { nombre: 'rip.MR_RETENCIONES_IVA', modulo: 'Retenciones IVA', tipos: P },
  { nombre: 'rip.MR_RETENCIONES_ISLR', modulo: 'Retenciones ISLR', tipos: P },
  { nombre: 'rip.MR_RESUMEN_IGTF', modulo: 'Resumen IGTF', tipos: P },
  { nombre: 'rip.MR_FORMATO_ARCV', modulo: 'ARCV', tipos: P },
  { nombre: 'dbo.RIP_DIFERENCIAFRONT_WEB', modulo: 'Cierre de Caja', tipos: F },
  { nombre: 'dbo.RIP_COBROS_FRONT', modulo: 'Cierre de Caja', tipos: F },
  { nombre: 'dbo.RIP_DIFERENCIAS_FRONT', modulo: 'Cierre de Caja', tipos: F },
  { nombre: 'dbo.RIP_VENTAS', modulo: 'Cierre de Caja', tipos: F },
  { nombre: 'dbo.RIP_COSTOVENTA', modulo: 'Cierre de Caja', tipos: F },
  { nombre: 'dbo.RIP_IMPUESTOSFRONT', modulo: 'Cierre de Caja', tipos: F },
  { nombre: 'rip.PROC_GETCOTIZACION', modulo: 'Cierre de Caja', tipos: P },
];

// --- Empresas de la instalación ---
export interface EmpresaScripts {
  codEmpresa: number;
  titulo: string;
  bd: string;
  /** La base existe en este servidor. */
  disponible: boolean;
}

export async function empresas(): Promise<EmpresaScripts[]> {
  await generalPoolConnect;
  const r = await generalPool.request().query(
    `SELECT CODEMPRESA, TITULO, LTRIM(RTRIM(SUBSTRING(PATHBD, CHARINDEX(':', PATHBD) + 1, 400))) AS BD,
            CASE WHEN DB_ID(LTRIM(RTRIM(SUBSTRING(PATHBD, CHARINDEX(':', PATHBD) + 1, 400)))) IS NULL THEN 0 ELSE 1 END AS DISPONIBLE
     FROM dbo.EMPRESAS ORDER BY TITULO`,
  );
  return r.recordset.map((f) => ({
    codEmpresa: Number(f.CODEMPRESA),
    titulo: String(f.TITULO ?? '').trim(),
    bd: String(f.BD ?? '').trim(),
    disponible: Boolean(f.DISPONIBLE) && /^[A-Za-z0-9_]+$/.test(String(f.BD ?? '').trim()),
  }));
}

/** Base de gestión de una empresa de la instalación (validada contra GENERAL..EMPRESAS). */
export async function bdDeEmpresa(codEmpresa: number): Promise<string> {
  const e = (await empresas()).find((x) => x.codEmpresa === codEmpresa);
  if (!e) throw new ScriptsError(`La empresa ${codEmpresa} no existe en esta instalación.`);
  if (!e.disponible) throw new ScriptsError(`La base de la empresa ${e.titulo} (${e.bd}) no está en este servidor.`);
  assertSafeDatabaseIdentifier(e.bd);
  return e.bd;
}

// --- Tablas propias (en la base de gestión) ---
const TABLAS = `
  IF OBJECT_ID('dbo.RIP_SCRIPTSAPLICADOS', 'U') IS NULL
    CREATE TABLE dbo.RIP_SCRIPTSAPLICADOS (
      ID INT IDENTITY(1, 1) PRIMARY KEY,
      FECHA DATETIME NOT NULL DEFAULT GETDATE(),
      USUARIO NVARCHAR(100) NULL,
      ORIGEN NVARCHAR(15) NOT NULL,          -- OFICIAL | PROPIO | RESTAURACION
      NOMBRE NVARCHAR(260) NULL,             -- archivo subido u objeto
      OBJETOS NVARCHAR(2000) NULL,
      TEXTO NVARCHAR(MAX) NOT NULL,
      RESULTADO NVARCHAR(10) NOT NULL,       -- OK | ERROR
      MENSAJE NVARCHAR(2000) NULL)
  IF OBJECT_ID('dbo.RIP_SCRIPTSRESPALDOS', 'U') IS NULL
    CREATE TABLE dbo.RIP_SCRIPTSRESPALDOS (
      ID INT IDENTITY(1, 1) PRIMARY KEY,
      IDSCRIPT INT NOT NULL,
      OBJETO NVARCHAR(260) NOT NULL,
      TIPO NVARCHAR(60) NULL,                -- type_desc de sys.objects
      DEFINICION NVARCHAR(MAX) NULL,         -- NULL = el objeto no existía
      FECHA DATETIME NOT NULL DEFAULT GETDATE(),
      RESTAURADO BIT NOT NULL DEFAULT 0)`;

async function asegurarTablas(bd: string) {
  await queryTenantRaw(bd, TABLAS);
}

// --- Catálogo ---
export type EstadoCatalogo = 'AL_DIA' | 'DESACTUALIZADO' | 'MODIFICADO' | 'SIN_VERSION' | 'DEL_CLIENTE' | 'FALTA' | 'FALTA_SIN_SCRIPT' | 'TIPO_DISTINTO';

export interface FilaCatalogo {
  nombre: string;
  modulo: string;
  existe: boolean;
  tipo: string | null;
  modificado: string | null;
  versionInstalada: number | null;
  versionOficial: number | null;
  estado: EstadoCatalogo;
  detalle: string;
}

export async function catalogo(bd: string): Promise<FilaCatalogo[]> {
  const oficiales = new Map(scriptsOficiales().map((s) => [s.nombre.toLowerCase(), s.version]));
  const items = [...CATALOGO];
  for (const o of scriptsOficiales()) if (!items.some((i) => i.nombre.toLowerCase() === o.nombre.toLowerCase())) items.push({ nombre: o.nombre, modulo: 'Aplicativo', tipos: [...P, ...F, 'V'] });

  const filas = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT X.NOMBRE, RTRIM(O.type) AS TIPO, O.type_desc AS TIPODESC, CONVERT(CHAR(16), O.modify_date, 120) AS MODIFICADO,
            OBJECT_DEFINITION(O.object_id) AS DEF,
            (SELECT CAST(value AS NVARCHAR(400)) FROM sys.extended_properties
             WHERE class = 1 AND major_id = O.object_id AND minor_id = 0 AND name = @PROP) AS PROP
     FROM (VALUES ${items.map((_, i) => `(@N${i})`).join(', ')}) X(NOMBRE)
     LEFT JOIN sys.objects O ON O.object_id = OBJECT_ID(X.NOMBRE)`,
    {
      PROP: { type: () => sql.NVarChar(128), value: PROPIEDAD },
      ...Object.fromEntries(items.map((it, i) => [`N${i}`, { type: () => sql.NVarChar(260), value: it.nombre }])),
    },
  );
  const porNombre = new Map(filas.map((f) => [String(f.NOMBRE).toLowerCase(), f]));

  return items.map((it) => {
    const f = porNombre.get(it.nombre.toLowerCase()) ?? {};
    const existe = Boolean(f.TIPO);
    const versionOficial = oficiales.get(it.nombre.toLowerCase()) ?? null;
    let registro: { v: number; h: string } | null = null;
    try {
      registro = f.PROP ? JSON.parse(String(f.PROP)) : null;
    } catch {
      registro = null;
    }
    const intacto = registro && f.DEF != null ? registro.h === huella(String(f.DEF)) : false;
    let estado: EstadoCatalogo;
    let detalle: string;
    if (!existe) {
      estado = versionOficial ? 'FALTA' : 'FALTA_SIN_SCRIPT';
      detalle = versionOficial ? 'No está instalado. Se puede instalar el script oficial.' : 'No está instalado y el aplicativo no trae script: súbalo como script propio.';
    } else if (!it.tipos.includes(String(f.TIPO))) {
      estado = 'TIPO_DISTINTO';
      detalle = `Existe como ${String(f.TIPODESC)}, pero el aplicativo espera otro tipo de objeto.`;
    } else if (!versionOficial) {
      estado = 'DEL_CLIENTE';
      detalle = 'Instalado. El aplicativo no trae script oficial de este objeto: es la versión del cliente.';
    } else if (!registro) {
      estado = 'SIN_VERSION';
      detalle = 'Instalado sin registro de versión (a mano o por una versión vieja): el aplicativo no lo actualiza solo.';
    } else if (!intacto) {
      estado = 'MODIFICADO';
      detalle = `Instalada la versión ${registro.v}, modificada después: el aplicativo no la reemplaza.`;
    } else if (registro.v < versionOficial) {
      estado = 'DESACTUALIZADO';
      detalle = `Versión ${registro.v}; el aplicativo trae la ${versionOficial} (se actualiza sola al usar el módulo).`;
    } else {
      estado = 'AL_DIA';
      detalle = `Versión ${registro.v} (la del aplicativo).`;
    }
    return {
      nombre: it.nombre,
      modulo: it.modulo,
      existe,
      tipo: existe ? String(f.TIPODESC) : null,
      modificado: existe && f.MODIFICADO ? String(f.MODIFICADO) : null,
      versionInstalada: registro?.v ?? null,
      versionOficial,
      estado,
      detalle,
    };
  });
}

/** Definición actual del objeto y, si existe, el script oficial. */
export async function definicion(bd: string, nombre: string) {
  const n = normalizarNombre(nombre);
  const r = await queryTenantRaw<{ DEF: string | null }>(bd, 'SELECT OBJECT_DEFINITION(OBJECT_ID(@N)) AS DEF', {
    N: { type: () => sql.NVarChar(260), value: n },
  });
  const oficial = scriptsOficiales().find((s) => s.nombre.toLowerCase() === n.toLowerCase());
  return { nombre: n, actual: r[0]?.DEF ?? null, oficial: oficial ? leerScript(oficial.nombre).texto : null };
}

// --- Ejecutar ---
export interface ResultadoEjecucion {
  ok: boolean;
  mensaje: string;
  idScript: number | null;
  objetos: ObjetoAfectado[];
}

class Reversion extends Error {}

/**
 * Ejecuta los lotes en una transacción con respaldo de los objetos que tocan. Con
 * `probar` revierte al final siempre. `alTerminar` corre dentro de la transacción (por
 * ejemplo, registrar la versión de un script oficial).
 */
async function ejecutar(
  bd: string,
  datos: { lotes: string[]; objetos: ObjetoAfectado[]; texto: string; origen: 'OFICIAL' | 'PROPIO' | 'RESTAURACION'; nombre: string; usuario: string },
  opciones: { probar?: boolean; alTerminar?: (req: () => sql.Request) => Promise<void> } = {},
): Promise<ResultadoEjecucion> {
  const nombresObjetos = datos.objetos.map((o) => `${o.nombre} (${o.accion.toLowerCase().replace(/_/g, ' ')})`).join(', ');
  if (!opciones.probar) await asegurarTablas(bd);
  let idScript: number | null = null;
  let loteActual = 0;
  try {
    await withTenantTransaction(bd, async (req) => {
      if (opciones.probar) await req().batch(TABLAS);
      const ins = await req()
        .input('USUARIO', sql.NVarChar(100), datos.usuario.slice(0, 100))
        .input('ORIGEN', sql.NVarChar(15), datos.origen)
        .input('NOMBRE', sql.NVarChar(260), datos.nombre.slice(0, 260))
        .input('OBJETOS', sql.NVarChar(2000), nombresObjetos.slice(0, 2000))
        .input('TEXTO', sql.NVarChar(sql.MAX), datos.texto)
        .query(
          `INSERT INTO dbo.RIP_SCRIPTSAPLICADOS (USUARIO, ORIGEN, NOMBRE, OBJETOS, TEXTO, RESULTADO)
           OUTPUT INSERTED.ID VALUES (@USUARIO, @ORIGEN, @NOMBRE, @OBJETOS, @TEXTO, 'OK')`,
        );
      idScript = Number(ins.recordset[0].ID);
      // Respaldo de lo que hay ahora (NULL = no existía).
      for (const o of datos.objetos.filter((x) => x.tipo !== 'ESQUEMA')) {
        // eslint-disable-next-line no-await-in-loop
        await req()
          .input('ID', sql.Int, idScript)
          .input('OBJ', sql.NVarChar(260), o.nombre)
          .query(
            `INSERT INTO dbo.RIP_SCRIPTSRESPALDOS (IDSCRIPT, OBJETO, TIPO, DEFINICION)
             SELECT @ID, @OBJ, (SELECT type_desc FROM sys.objects WHERE object_id = OBJECT_ID(@OBJ)), OBJECT_DEFINITION(OBJECT_ID(@OBJ))`,
          );
      }
      for (const [i, lote] of datos.lotes.entries()) {
        loteActual = i + 1;
        // eslint-disable-next-line no-await-in-loop
        await req().batch(lote);
      }
      loteActual = 0;
      if (opciones.alTerminar) await opciones.alTerminar(req);
      if (opciones.probar) throw new Reversion();
    });
    return { ok: true, mensaje: 'Aplicado correctamente.', idScript, objetos: datos.objetos };
  } catch (err) {
    if (err instanceof Reversion) {
      return { ok: true, mensaje: 'La prueba se ejecutó sin errores (no se guardó nada).', idScript: null, objetos: datos.objetos };
    }
    const texto = err instanceof Error ? err.message : String(err);
    const mensaje = `${loteActual ? `Lote ${loteActual}: ` : ''}${texto}`;
    if (!opciones.probar) {
      // El intento fallido también queda en el historial (la transacción ya se revirtió).
      await queryTenantRaw(
        bd,
        `INSERT INTO dbo.RIP_SCRIPTSAPLICADOS (USUARIO, ORIGEN, NOMBRE, OBJETOS, TEXTO, RESULTADO, MENSAJE)
         VALUES (@USUARIO, @ORIGEN, @NOMBRE, @OBJETOS, @TEXTO, 'ERROR', @MENSAJE)`,
        {
          USUARIO: { type: () => sql.NVarChar(100), value: datos.usuario.slice(0, 100) },
          ORIGEN: { type: () => sql.NVarChar(15), value: datos.origen },
          NOMBRE: { type: () => sql.NVarChar(260), value: datos.nombre.slice(0, 260) },
          OBJETOS: { type: () => sql.NVarChar(2000), value: nombresObjetos.slice(0, 2000) },
          TEXTO: { type: () => sql.NVarChar(sql.MAX), value: datos.texto },
          MENSAJE: { type: () => sql.NVarChar(2000), value: mensaje.slice(0, 2000) },
        },
      ).catch(() => undefined);
    }
    return { ok: false, mensaje, idScript: null, objetos: datos.objetos };
  }
}

/** Script propio: valida, y prueba (revierte) o aplica. */
export async function scriptPropio(bd: string, texto: string, nombre: string, usuario: string, probar: boolean) {
  const a = analizarScript(texto);
  if (!a.ok) return { ok: false, mensaje: a.errores.join(' '), idScript: null, objetos: a.objetos };
  const r = await ejecutar(bd, { lotes: a.lotes, objetos: a.objetos, texto, origen: 'PROPIO', nombre: nombre || 'script.sql', usuario }, { probar });
  if (r.ok && !probar) a.objetos.forEach((o) => olvidarComprobado(bd, o.nombre));
  return r;
}

/** Instala (o reinstala) el script oficial de un objeto y registra su versión. */
export async function instalarOficial(bd: string, nombre: string, usuario: string) {
  const oficial = scriptsOficiales().find((s) => s.nombre.toLowerCase() === normalizarNombre(nombre).toLowerCase());
  if (!oficial) throw new ScriptsError(`El aplicativo no trae script oficial de ${nombre}.`);
  const { texto, version } = leerScript(oficial.nombre);
  const a = analizarScript(texto);
  if (!a.ok) throw new ScriptsError(`El script oficial de ${oficial.nombre} no pasa la validación: ${a.errores.join(' ')}`);
  const [esquema, objeto] = oficial.nombre.split('.');
  const r = await ejecutar(
    bd,
    { lotes: a.lotes, objetos: a.objetos, texto, origen: 'OFICIAL', nombre: `${oficial.nombre} (versión ${version})`, usuario },
    {
      alTerminar: async (req) => {
        const def = await req().input('N', sql.NVarChar(260), oficial.nombre).query('SELECT OBJECT_DEFINITION(OBJECT_ID(@N)) AS DEF');
        await req()
          .input('PROP', sql.NVarChar(128), PROPIEDAD)
          .input('VALOR', sql.NVarChar(400), JSON.stringify({ v: version, h: huella(String(def.recordset[0].DEF ?? '')) }))
          .input('ESQ', sql.NVarChar(128), esquema)
          .input('OBJ', sql.NVarChar(128), objeto)
          .query(
            `IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID(@ESQ + '.' + @OBJ) AND minor_id = 0 AND name = @PROP)
               EXEC sys.sp_updateextendedproperty @name = @PROP, @value = @VALOR, @level0type = 'SCHEMA', @level0name = @ESQ, @level1type = 'PROCEDURE', @level1name = @OBJ;
             ELSE
               EXEC sys.sp_addextendedproperty @name = @PROP, @value = @VALOR, @level0type = 'SCHEMA', @level0name = @ESQ, @level1type = 'PROCEDURE', @level1name = @OBJ;`,
          );
      },
    },
  );
  if (r.ok) olvidarComprobado(bd, oficial.nombre);
  return r;
}

// --- Historial y restauración ---
export async function historial(bd: string) {
  const existe = await queryTenantRaw<{ T: number | null }>(bd, "SELECT OBJECT_ID('dbo.RIP_SCRIPTSAPLICADOS', 'U') AS T");
  if (!existe[0]?.T) return [];
  const scripts = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT TOP 200 ID, CONVERT(CHAR(16), FECHA, 120) AS FECHA, USUARIO, ORIGEN, NOMBRE, OBJETOS, RESULTADO, MENSAJE
     FROM dbo.RIP_SCRIPTSAPLICADOS ORDER BY ID DESC`,
  );
  const respaldos = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT R.ID, R.IDSCRIPT, R.OBJETO, R.TIPO, CASE WHEN R.DEFINICION IS NULL THEN 0 ELSE 1 END AS EXISTIA, R.RESTAURADO
     FROM dbo.RIP_SCRIPTSRESPALDOS R
     WHERE R.IDSCRIPT IN (SELECT TOP 200 ID FROM dbo.RIP_SCRIPTSAPLICADOS ORDER BY ID DESC)`,
  );
  return scripts.map((s) => ({
    id: Number(s.ID),
    fecha: String(s.FECHA ?? ''),
    usuario: String(s.USUARIO ?? ''),
    origen: String(s.ORIGEN ?? ''),
    nombre: String(s.NOMBRE ?? ''),
    objetos: String(s.OBJETOS ?? ''),
    resultado: String(s.RESULTADO ?? ''),
    mensaje: s.MENSAJE ? String(s.MENSAJE) : null,
    respaldos: respaldos
      .filter((r) => Number(r.IDSCRIPT) === Number(s.ID))
      .map((r) => ({ id: Number(r.ID), objeto: String(r.OBJETO), tipo: r.TIPO ? String(r.TIPO) : null, existia: Boolean(r.EXISTIA), restaurado: Boolean(r.RESTAURADO) })),
  }));
}

export async function textoScript(bd: string, id: number) {
  const r = await queryTenantRaw<{ TEXTO: string }>(bd, 'SELECT TEXTO FROM dbo.RIP_SCRIPTSAPLICADOS WHERE ID = @ID', {
    ID: { type: () => sql.Int, value: id },
  });
  if (!r[0]) throw new ScriptsError('No se encontró el script.');
  return r[0].TEXTO;
}

const PALABRA_TIPO: Record<string, string> = {
  SQL_STORED_PROCEDURE: 'PROCEDURE',
  SQL_SCALAR_FUNCTION: 'FUNCTION',
  SQL_INLINE_TABLE_VALUED_FUNCTION: 'FUNCTION',
  SQL_TABLE_VALUED_FUNCTION: 'FUNCTION',
  VIEW: 'VIEW',
};

/**
 * Deja un objeto como estaba antes de un script: vuelve a la definición respaldada, o lo
 * borra si el script lo había creado. La restauración también se respalda (se puede
 * deshacer) y queda en el historial.
 */
export async function restaurar(bd: string, idRespaldo: number, usuario: string) {
  const r = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT R.OBJETO, R.TIPO, R.DEFINICION, R.RESTAURADO,
            (SELECT type_desc FROM sys.objects WHERE object_id = OBJECT_ID(R.OBJETO)) AS TIPOACTUAL
     FROM dbo.RIP_SCRIPTSRESPALDOS R WHERE R.ID = @ID`,
    { ID: { type: () => sql.Int, value: idRespaldo } },
  );
  const f = r[0];
  if (!f) throw new ScriptsError('No se encontró el respaldo.');
  const objeto = String(f.OBJETO);
  const existe = Boolean(f.TIPOACTUAL);
  let sentencia: string;
  if (f.DEFINICION == null) {
    if (!existe) throw new ScriptsError(`${objeto} ya no existe: no hay nada que restaurar.`);
    const palabra = PALABRA_TIPO[String(f.TIPOACTUAL)];
    if (!palabra) throw new ScriptsError(`No se puede borrar ${objeto} (${String(f.TIPOACTUAL)}).`);
    const [esq, nom] = objeto.split('.');
    sentencia = `DROP ${palabra} [${esq.replace(/]/g, ']]')}].[${nom.replace(/]/g, ']]')}]`;
  } else {
    sentencia = sentenciaRestauracion(String(f.DEFINICION), existe);
  }
  const tipoObj = /FUNCTION/.test(String(f.TIPOACTUAL ?? f.TIPO)) ? 'FUNCION' : /VIEW/.test(String(f.TIPOACTUAL ?? f.TIPO)) ? 'VISTA' : 'PROCEDIMIENTO';
  const res = await ejecutar(bd, {
    lotes: [sentencia],
    objetos: [{ nombre: objeto, tipo: tipoObj, accion: f.DEFINICION == null ? 'BORRAR' : existe ? 'MODIFICAR' : 'CREAR' }],
    texto: sentencia,
    origen: 'RESTAURACION',
    nombre: `${objeto} (respaldo ${idRespaldo})`,
    usuario,
  });
  if (res.ok) {
    await queryTenantRaw(bd, 'UPDATE dbo.RIP_SCRIPTSRESPALDOS SET RESTAURADO = 1 WHERE ID = @ID', { ID: { type: () => sql.Int, value: idRespaldo } });
    olvidarComprobado(bd, objeto);
  }
  return res;
}
