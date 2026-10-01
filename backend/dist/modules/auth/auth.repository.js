import sql from 'mssql';
import { generalPool, generalPoolConnect } from '../../shared/db/general-pool.js';
import { legacyEncrypt } from '../../shared/util/legacy-cipher.js';
/**
 * Mirrors `login.Login.verificarPermisoEnICG` (decompiled) exactly: the legacy login
 * dialog (`DialogoLoginGeneral`) has NO username field, only a password — whichever
 * row in `GENERAL.dbo.USUARIOS` matches that password (obfuscated `NEWPASS`, or
 * legacy plaintext `PASS` for accounts never migrated) is the logged-in user. If more
 * than one account shares a password, the original just takes the first match
 * (`rs.next()`) — reproduced here the same way, since it's an existing-data quirk,
 * not something a new query can safely resolve differently.
 */
export async function verifyPasswordOnly(password) {
    await generalPoolConnect;
    const request = generalPool.request();
    request.input('NEWPASS', sql.NVarChar(128), legacyEncrypt(password));
    request.input('PASS', sql.NVarChar(128), password);
    const result = await request.query(`SELECT TOP 1 CODUSUARIO, USUARIO, BLOQUEADO FROM dbo.USUARIOS
     WHERE NEWPASS = @NEWPASS OR PASS = @PASS`);
    const row = result.recordset[0];
    if (!row)
        return null;
    return {
        codUsuario: row.CODUSUARIO,
        usuario: row.USUARIO,
        bloqueado: String(row.BLOQUEADO ?? '').trim().toUpperCase() === 'T',
    };
}
/** Mirrors `login.Empresa.getEmpresas(int)` — companies this user is authorized for. */
export async function getEmpresasForUsuario(codUsuario) {
    await generalPoolConnect;
    const request = generalPool.request();
    request.input('CODUSUARIO', sql.Int, codUsuario);
    const result = await request.query(`SELECT EMP.CODEMPRESA, EMP.TITULO, EMP.PATHBD
     FROM dbo.EMPRESAS EMP
     INNER JOIN dbo.EMPRESASUSUARIO EMPUSR ON EMP.CODEMPRESA = EMPUSR.CODEMPRESA
     WHERE EMPUSR.CODUSUARIO = @CODUSUARIO`);
    return result.recordset.map((r) => ({
        codEmpresa: r.CODEMPRESA,
        titulo: String(r.TITULO ?? '').trim(),
        // PATHBD looks like "127.0.0.1:EMPORIOP" — BD name is everything after the first colon.
        bd: String(r.PATHBD ?? '').split(':').slice(1).join(':').trim(),
    }));
}
//# sourceMappingURL=auth.repository.js.map