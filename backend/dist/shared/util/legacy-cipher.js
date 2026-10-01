const NORMAL_KEY = 'NORMALKEY';
/**
 * Port of the legacy `encriptar(String)` used across the ICG desktop apps
 * (`conexionbd.Conector`, `login.Login`) to obfuscate passwords: for each character,
 * add the ASCII code of the corresponding letter of "NORMALKEY" (cycling), then
 * hex-encode. It's a reversible obfuscation, not real cryptography — kept here only
 * to authenticate against the EXISTING `GENERAL.dbo.USUARIOS.NEWPASS` values, not
 * reused for anything new. Verified against a real stored value earlier in this
 * migration (via reflection on the compiled `Conector.class`).
 */
export function legacyEncrypt(value) {
    let out = '';
    for (let i = 0; i < value.length; i++) {
        const keyChar = NORMAL_KEY.charCodeAt(i % NORMAL_KEY.length);
        const sum = value.charCodeAt(i) + keyChar;
        out += sum.toString(16).toUpperCase();
    }
    return out;
}
//# sourceMappingURL=legacy-cipher.js.map