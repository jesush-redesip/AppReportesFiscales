import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import * as repo from './auth.repository.js';
import { getModulosUsuario, getPermisosUsuario, type PermisosCaja } from '../../shared/auth/permisos.js';

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
  /** Módulos que este usuario puede ver en el menú (el SUPERVISOR ve todos). */
  modulos: string[];
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

  const empresas = await repo.getEmpresasForUsuario(payload.codUsuario);
  const empresa = empresas.find((e) => e.codEmpresa === codEmpresa);
  if (!empresa) throw new LoginError('No tiene acceso a esa empresa.');

  const sessionPayload: SessionTokenPayload = {
    purpose: 'session',
    codUsuario: payload.codUsuario,
    usuario: payload.usuario,
    codEmpresa: empresa.codEmpresa,
    bd: empresa.bd,
  };
  const token = jwt.sign(sessionPayload, env.jwtSecret, { expiresIn: '8h' });
  const [permisos, modulosAsignados] = await Promise.all([
    getPermisosUsuario(payload.codUsuario),
    getModulosUsuario(payload.codUsuario),
  ]);
  // El SUPERVISOR también ve solo los módulos que tenga asignados. Su administración
  // (Permisos de Usuario, Auditoría, Debug) no depende de módulos, así que nunca puede
  // quedarse sin acceso a la pantalla donde se los vuelve a asignar.
  return { token, usuario: payload.usuario, codUsuario: payload.codUsuario, empresa, permisos, modulos: modulosAsignados };
}

export function verifySessionToken(token: string): SessionTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret) as SessionTokenPayload;
  if (payload.purpose !== 'session') throw new Error('Not a session token');
  return payload;
}
