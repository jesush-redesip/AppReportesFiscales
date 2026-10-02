import sql from 'mssql';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { generalPool, generalPoolConnect } from '../db/general-pool.js';
import { MODULO_CAJAS, PERMISO_CONFIG_CAJAS, PERMISO_SUPERVISOR_INTERNO, esModuloReporte, type ModuloId } from './modulos.js';
import { estaActivo, modulosActivos } from './activacion.js';

const MSJ_CAJAS_INACTIVO = 'El Cierre de Caja no está activo en esta instalación.';

export type PermisoFlag = 'VISUALIZARCAJAS' | 'CONTABILIZAR' | 'DESCONTABILIZAR';

export interface PermisosCaja {
  visualizarCajas: boolean;
  contabilizar: boolean;
  descontabilizar: boolean;
}

const FLAG_TO_KEY: Record<PermisoFlag, keyof PermisosCaja> = {
  VISUALIZARCAJAS: 'visualizarCajas',
  CONTABILIZAR: 'contabilizar',
  DESCONTABILIZAR: 'descontabilizar',
};

/**
 * Reads a user's Cajas permissions straight from `RIP_PERMISOSUSUARIOS` (GENERAL db)
 * on every call — no caching, no trusting the session JWT. The legacy PHP app loads
 * these into `$_SESSION` once at login and never re-checks them on the endpoints that
 * actually contabilizan/descontabilizan, so a permission revoked mid-session (or never
 * granted at all) had zero effect on the server side, only on which buttons the HTML
 * happened to render. `requirePermiso` below exists specifically to close that hole.
 */
export async function getPermisosUsuario(codUsuario: number): Promise<PermisosCaja> {
  await generalPoolConnect;
  const request = generalPool.request();
  request.input('CODUSUARIO', sql.Int, codUsuario);
  const result = await request.query(
    `SELECT VISUALIZARCAJAS, CONTABILIZAR, DESCONTABILIZAR
     FROM dbo.RIP_PERMISOSUSUARIOS
     WHERE CODUSUARIO = @CODUSUARIO`,
  );
  const row = result.recordset[0];
  const truthy = (v: unknown) => v === 1 || v === true || String(v ?? '').trim() === '1';
  return {
    visualizarCajas: truthy(row?.VISUALIZARCAJAS),
    contabilizar: truthy(row?.CONTABILIZAR),
    descontabilizar: truthy(row?.DESCONTABILIZAR),
  };
}

/**
 * Fastify preHandler factory: 403s the request unless the authenticated user has
 * `flag` set in RIP_PERMISOSUSUARIOS. Use on every Cajas route that reads or mutates
 * accounting state — `VISUALIZARCAJAS` for the GETs, `CONTABILIZAR`/`DESCONTABILIZAR`
 * for the matching mutations.
 */
export function requirePermiso(flag: PermisoFlag) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Las tres banderas son del Cierre de Caja: si la instalación no lo tiene, nadie pasa.
    if (!(await estaActivo(MODULO_CAJAS))) {
      reply.status(403).send({ error: 'Forbidden', message: MSJ_CAJAS_INACTIVO });
      return;
    }
    const permisos = await getPermisosUsuario(request.user!.codUsuario);
    if (!permisos[FLAG_TO_KEY[flag]]) {
      reply.status(403).send({ error: 'Forbidden', message: `No tiene el permiso ${flag}.` });
    }
  };
}

/**
 * En ICG el usuario administrador es siempre `CODUSUARIO = 0` (verificado en la base:
 * es la fila USUARIO='SUPERVISOR'). Se compara por código y no por nombre porque el
 * nombre es un dato editable: un usuario cualquiera renombrado a "SUPERVISOR" no debe
 * heredar la administración de permisos.
 */
export const CODUSUARIO_SUPERVISOR = 0;

export function esSupervisor(codUsuario: number): boolean {
  return codUsuario === CODUSUARIO_SUPERVISOR;
}

/**
 * Módulos habilitados a un usuario. Vive en GENERAL y no en la base de gestión porque
 * un mismo usuario puede tener acceso a varias empresas (GENERAL.dbo.EMPRESASUSUARIO) y
 * los módulos que puede ver son los mismos en todas.
 *
 * Modelo fila-por-permiso en vez de una columna por módulo: agregar un reporte nuevo no
 * requiere ALTER TABLE, y evita seguir ensanchando RIP_PERMISOSUSUARIOS, que es una
 * tabla que comparte con el aplicativo legacy.
 *
 * Criterio restrictivo: sin filas, el usuario no ve ningún módulo — el SUPERVISOR
 * incluido. No existe el estado "nadie puede administrar": la administración de
 * permisos no es un módulo (`requireSupervisor`), así que el SUPERVISOR siempre puede
 * volver a asignarse lo que se haya quitado.
 */
async function ensureTablaModulos(): Promise<void> {
  await generalPoolConnect;
  await generalPool.request().query(
    `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RIP_PERMISOSMODULOS')
     BEGIN
       CREATE TABLE dbo.RIP_PERMISOSMODULOS (
         CODUSUARIO INT NOT NULL,
         MODULO NVARCHAR(50) NOT NULL,
         CONSTRAINT PK_RIP_PERMISOSMODULOS PRIMARY KEY (CODUSUARIO, MODULO)
       ) ON [PRIMARY]
     END`,
  );
}

export async function getModulosUsuario(codUsuario: number): Promise<string[]> {
  await ensureTablaModulos();
  const request = generalPool.request();
  request.input('CODUSUARIO', sql.Int, codUsuario);
  const result = await request.query(
    'SELECT MODULO FROM dbo.RIP_PERMISOSMODULOS WHERE CODUSUARIO = @CODUSUARIO',
  );
  return result.recordset.map((r) => String(r.MODULO ?? '').trim()).filter(Boolean);
}

/** Todos los módulos asignados, agrupados por usuario — para la grilla de administración. */
export async function getModulosPorUsuario(): Promise<Map<number, string[]>> {
  await ensureTablaModulos();
  const result = await generalPool.request().query('SELECT CODUSUARIO, MODULO FROM dbo.RIP_PERMISOSMODULOS');
  const mapa = new Map<number, string[]>();
  for (const row of result.recordset) {
    const cod = Number(row.CODUSUARIO);
    const lista = mapa.get(cod) ?? [];
    lista.push(String(row.MODULO ?? '').trim());
    mapa.set(cod, lista);
  }
  return mapa;
}

/** Reemplaza el juego de módulos de un usuario. Debe ejecutarse dentro de una transacción. */
export async function reemplazarModulosUsuario(
  transaction: sql.Transaction,
  codUsuario: number,
  modulos: string[],
): Promise<void> {
  const del = new sql.Request(transaction);
  del.input('CODUSUARIO', sql.Int, codUsuario);
  await del.query('DELETE FROM dbo.RIP_PERMISOSMODULOS WHERE CODUSUARIO = @CODUSUARIO');

  for (const modulo of modulos) {
    const ins = new sql.Request(transaction);
    ins.input('CODUSUARIO', sql.Int, codUsuario);
    ins.input('MODULO', sql.NVarChar(50), modulo);
    // eslint-disable-next-line no-await-in-loop
    await ins.query('INSERT INTO dbo.RIP_PERMISOSMODULOS (CODUSUARIO, MODULO) VALUES (@CODUSUARIO, @MODULO)');
  }
}

/**
 * Fastify preHandler: 403 si el usuario no tiene habilitado ese módulo. Se aplica sobre
 * las rutas del reporte, no solo sobre el menú: esconder el enlace es presentación, el
 * endpoint tiene que rechazar igual a quien lo llame directo.
 */
export function requireModulo(modulo: ModuloId) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const codUsuario = request.user!.codUsuario;
    if (!(await estaActivo(modulo))) {
      reply.status(403).send({ error: 'Forbidden', message: 'Este módulo no está activo en esta instalación.' });
      return;
    }
    const modulos = await getModulosUsuario(codUsuario);
    if (!modulos.includes(modulo)) {
      reply.status(403).send({ error: 'Forbidden', message: 'No tiene acceso a este módulo.' });
    }
  };
}

/**
 * Fastify preHandler de Cierre de Caja › Configuración (cuentas y costo de venta):
 * pasa quien tenga el permiso `PERMISO_CONFIG_CAJAS` y además acceso al cierre
 * (VISUALIZARCAJAS) — el SUPERVISOR incluido, sin excepción. Se lee de la base en cada llamada, igual que el resto de
 * los permisos: un permiso revocado deja de valer sin esperar a que expire la sesión.
 */
export async function requireConfiguracionCajas(request: FastifyRequest, reply: FastifyReply) {
  const codUsuario = request.user!.codUsuario;
  if (!(await estaActivo(MODULO_CAJAS))) {
    reply.status(403).send({ error: 'Forbidden', message: MSJ_CAJAS_INACTIVO });
    return;
  }
  const [permisos, modulos] = await Promise.all([getPermisosUsuario(codUsuario), getModulosUsuario(codUsuario)]);
  // El supervisor interno configura el cierre por su rol, sin necesitar los permisos sueltos.
  if (tieneSupervisorInterno(codUsuario, modulos)) return;
  if (!permisos.visualizarCajas || !modulos.includes(PERMISO_CONFIG_CAJAS)) {
    reply
      .status(403)
      .send({ error: 'Forbidden', message: 'No tiene acceso a la configuración del Cierre de Caja.' });
  }
}

/**
 * Fastify preHandler: reserva una ruta al SUPERVISOR. Se usa para la administración de
 * permisos de usuarios y de cuentas contables — quién puede contabilizar o contra qué
 * cuentas se postea no debe poder cambiárselo cualquiera.
 */
export async function requireSupervisor(request: FastifyRequest, reply: FastifyReply) {
  if (!esSupervisor(request.user!.codUsuario)) {
    reply
      .status(403)
      .send({ error: 'Forbidden', message: 'Solo el SUPERVISOR puede acceder a la configuración del sistema.' });
  }
}

/** Supervisor interno: marcado por el SUPERVISOR; el propio SUPERVISOR nunca lo es. */
function tieneSupervisorInterno(codUsuario: number, modulos: string[]): boolean {
  return !esSupervisor(codUsuario) && modulos.includes(PERMISO_SUPERVISOR_INTERNO);
}

export async function esSupervisorInterno(codUsuario: number): Promise<boolean> {
  if (esSupervisor(codUsuario)) return false;
  return tieneSupervisorInterno(codUsuario, await getModulosUsuario(codUsuario));
}

/**
 * Fastify preHandler de Permisos de Usuario: el SUPERVISOR o un supervisor interno. Lo
 * que el interno NO puede hacer ahí (tocar al SUPERVISOR, nombrar supervisores
 * internos) lo controla `updatePermisos`.
 */
export async function requireAdminPermisos(request: FastifyRequest, reply: FastifyReply) {
  const codUsuario = request.user!.codUsuario;
  if (esSupervisor(codUsuario) || (await esSupervisorInterno(codUsuario))) return;
  reply.status(403).send({ error: 'Forbidden', message: 'Solo el SUPERVISOR o un supervisor interno pueden administrar permisos.' });
}

export interface AccesoEfectivo {
  permisos: PermisosCaja;
  /** Lo que el usuario puede usar de verdad: sus asignaciones, menos lo que no está
   * activo en la instalación, más la Configuración del cierre si es supervisor interno. */
  modulos: string[];
  supervisorInterno: boolean;
}

/** Acceso real del usuario, para la sesión del frontend (menú y rutas). */
export async function accesoEfectivo(codUsuario: number): Promise<AccesoEfectivo> {
  const [permisos, asignados, activos] = await Promise.all([
    getPermisosUsuario(codUsuario),
    getModulosUsuario(codUsuario),
    modulosActivos(),
  ]);
  const cajasActivo = activos.has(MODULO_CAJAS);
  const supervisorInterno = tieneSupervisorInterno(codUsuario, asignados);
  const modulos = asignados.filter((m) => {
    if (esModuloReporte(m)) return activos.has(m);
    if (m === PERMISO_CONFIG_CAJAS) return cajasActivo;
    return m === PERMISO_SUPERVISOR_INTERNO ? supervisorInterno : true;
  });
  if (supervisorInterno && cajasActivo && !modulos.includes(PERMISO_CONFIG_CAJAS)) modulos.push(PERMISO_CONFIG_CAJAS);
  return {
    permisos: cajasActivo ? permisos : { visualizarCajas: false, contabilizar: false, descontabilizar: false },
    modulos,
    supervisorInterno,
  };
}
