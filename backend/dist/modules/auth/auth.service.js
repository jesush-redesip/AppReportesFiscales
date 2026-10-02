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
    const empresas = await repo.getEmpresasForUsuario(payload.codUsuario);
    const empresa = empresas.find((e) => e.codEmpresa === codEmpresa);
    if (!empresa)
        throw new LoginError('No tiene acceso a esa empresa.');
    const sessionPayload = {
        purpose: 'session',
        codUsuario: payload.codUsuario,
        usuario: payload.usuario,
        codEmpresa: empresa.codEmpresa,
        bd: empresa.bd,
    };
    const token = jwt.sign(sessionPayload, env.jwtSecret, { expiresIn: '8h' });
    const acceso = await accesoEfectivo(payload.codUsuario);
    // El SUPERVISOR también ve solo los módulos que tenga asignados. Su administración
    // (Permisos de Usuario, Auditoría, Debug) no depende de módulos, así que nunca puede
    // quedarse sin acceso a la pantalla donde se los vuelve a asignar.
    return { token, usuario: payload.usuario, codUsuario: payload.codUsuario, empresa, ...acceso };
}
export function verifySessionToken(token) {
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.purpose !== 'session')
        throw new Error('Not a session token');
    return payload;
}
//# sourceMappingURL=auth.service.js.map