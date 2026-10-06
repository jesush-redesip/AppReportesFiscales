import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import * as repo from './auth.repository.js';
import { accesoEfectivo } from '../../shared/auth/permisos.js';
export class LoginError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LoginError';
    }
}
/** Step 1 — password only, matching the legacy login dialog exactly (no username field). */
export async function loginWithPassword(password) {
    const user = await repo.verifyPasswordOnly(password);
    if (!user)
        throw new LoginError('Contraseña inválida.');
    if (user.bloqueado)
        throw new LoginError('El usuario está deshabilitado.');
    const empresas = await repo.getEmpresasForUsuario(user.codUsuario);
    const payload = { purpose: 'select-empresa', codUsuario: user.codUsuario, usuario: user.usuario };
    const preAuthToken = jwt.sign(payload, env.jwtSecret, { expiresIn: '5m' });
    return { preAuthToken, usuario: user.usuario, empresas };
}
/** Step 2 — user picks which company/tenant DB to connect to; issues the real session JWT. */
export async function selectEmpresa(preAuthToken, codEmpresa) {
    let payload;
    try {
        payload = jwt.verify(preAuthToken, env.jwtSecret);
    }
    catch {
        throw new LoginError('La sesión de login expiró, vuelva a ingresar la contraseña.');
    }
    if (payload.purpose !== 'select-empresa')
        throw new LoginError('Token inválido.');
    return emitirSesion(payload.codUsuario, payload.usuario, codEmpresa);
}
/** Sesión para una empresa a la que el usuario tiene acceso (EMPRESASUSUARIO). */
async function emitirSesion(codUsuario, usuario, codEmpresa) {
    const empresas = await repo.getEmpresasForUsuario(codUsuario);
    const empresa = empresas.find((e) => e.codEmpresa === codEmpresa);
    if (!empresa)
        throw new LoginError('No tiene acceso a esa empresa.');
    const sessionPayload = {
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
export async function empresasDeSesion(sesion) {
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
export async function cambiarEmpresa(sesion, codEmpresa) {
    if (!(await repo.usuarioHabilitado(sesion.codUsuario)))
        throw new LoginError('El usuario está deshabilitado.');
    return emitirSesion(sesion.codUsuario, sesion.usuario, codEmpresa);
}
export function verifySessionToken(token) {
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.purpose !== 'session')
        throw new Error('Not a session token');
    return payload;
}
//# sourceMappingURL=auth.service.js.map