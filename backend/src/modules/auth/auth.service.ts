import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import * as repo from './auth.repository.js';
import { accesoEfectivo, type PermisosCaja } from '../../shared/auth/permisos.js';

export interface SessionTokenPayload {
  purpose: 'session';
  codUsuario: number;
  usuario: string;
  codEmpresa: number;
  bd: string;
}

interface PreAuthTokenPayload {
  purpose: 'select-empresa';
  codUsuario: number;
  usuario: string;
}

export interface PasswordLoginResult {
  preAuthToken: string;
  usuario: string;
  empresas: repo.EmpresaGeneral[];
}

export interface SelectEmpresaResult {
  token: string;
  usuario: string;
  /** Lo necesita el front para saber si un cambio de permisos afecta a la sesión actual. */
  codUsuario: number;
  empresa: repo.EmpresaGeneral;
  /** Solo para mostrar/ocultar UI (menú, botones) — la autorización real de cada
   * mutación de Cajas siempre se revalida fresca contra la BD en el backend
   * (`requirePermiso`), nunca confiando en este snapshot de sesión. */
  permisos: PermisosCaja;
  /** Módulos que este usuario puede usar (asignados y activos en la instalación). */
  modulos: string[];
  /** Supervisor interno del cliente: administra permisos y configura el cierre. */
  supervisorInterno: boolean;
}

export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginError';
  }
}

/** Step 1 — password only, matching the legacy login dialog exactly (no username field). */
export async function loginWithPassword(password: string): Promise<PasswordLoginResult> {
  const user = await repo.verifyPasswordOnly(password);
  if (!user) throw new LoginError('Contraseña inválida.');
  if (user.bloqueado) throw new LoginError('El usuario está deshabilitado.');

  const empresas = await repo.getEmpresasForUsuario(user.codUsuario);
  const payload: PreAuthTokenPayload = { purpose: 'select-empresa', codUsuario: user.codUsuario, usuario: user.usuario };
  const preAuthToken = jwt.sign(payload, env.jwtSecret, { expiresIn: '5m' });

  return { preAuthToken, usuario: user.usuario, empresas };
}

/** Step 2 — user picks which company/tenant DB to connect to; issues the real session JWT. */
export async function selectEmpresa(preAuthToken: string, codEmpresa: number): Promise<SelectEmpresaResult> {
  let payload: PreAuthTokenPayload;
  try {
    payload = jwt.verify(preAuthToken, env.jwtSecret) as PreAuthTokenPayload;
  } catch {
    throw new LoginError('La sesión de login expiró, vuelva a ingresar la contraseña.');
  }
  if (payload.purpose !== 'select-empresa') throw new LoginError('Token inválido.');

  return emitirSesion(payload.codUsuario, payload.usuario, codEmpresa);
}

/** Sesión para una empresa a la que el usuario tiene acceso (EMPRESASUSUARIO). */
async function emitirSesion(codUsuario: number, usuario: string, codEmpresa: number): Promise<SelectEmpresaResult> {
  const empresas = await repo.getEmpresasForUsuario(codUsuario);
  const empresa = empresas.find((e) => e.codEmpresa === codEmpresa);
  if (!empresa) throw new LoginError('No tiene acceso a esa empresa.');

  const sessionPayload: SessionTokenPayload = {
    purpose: 'session',
    codUsuario,
    usuario,
    codEmpresa: empresa.codEmpresa,
    bd: empresa.bd,
  };
  const token = jwt.sign(sessionPayload, env.jwtSecret, { expiresIn: '8h' });
  const acceso = await accesoEfectivo(codUsuario);
  // El SUPERVISOR también ve solo los módulos que tenga asignados. Su administración
  // (Permisos de Usuario, Auditoría, Debug) no depende de módulos, así que nunca puede
  // quedarse sin acceso a la pantalla donde se los vuelve a asignar.
  return { token, usuario, codUsuario, empresa, ...acceso };
}

/** Empresas a las que puede pasar el usuario de la sesión (sin la base de datos: no hace falta en el menú). */
export async function empresasDeSesion(sesion: SessionTokenPayload): Promise<{ codEmpresa: number; titulo: string; actual: boolean }[]> {
  const empresas = await repo.getEmpresasForUsuario(sesion.codUsuario);
  return empresas
    .map((e) => ({ codEmpresa: e.codEmpresa, titulo: e.titulo, actual: e.codEmpresa === sesion.codEmpresa }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
}

/**
 * Cambiar de empresa sin cerrar sesión: el token de la sesión fija la base de datos, así
 * que se emite uno nuevo para la empresa elegida. Se revalida que el usuario siga
 * habilitado y tenga acceso a esa empresa, como en el login.
 */
export async function cambiarEmpresa(sesion: SessionTokenPayload, codEmpresa: number): Promise<SelectEmpresaResult> {
  if (!(await repo.usuarioHabilitado(sesion.codUsuario))) throw new LoginError('El usuario está deshabilitado.');
  return emitirSesion(sesion.codUsuario, sesion.usuario, codEmpresa);
}

export function verifySessionToken(token: string): SessionTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret) as SessionTokenPayload;
  if (payload.purpose !== 'session') throw new Error('Not a session token');
  return payload;
}
