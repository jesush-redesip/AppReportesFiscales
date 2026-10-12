/**
 * Validador de scripts SQL propios (módulo Scripts SQL). Solo deja pasar lo que DEFINE
 * objetos: crear o modificar procedimientos, funciones y vistas (y crear un esquema, o
 * borrar uno de esos objetos). Nada que toque datos: un UPDATE, DELETE, INSERT, DROP
 * TABLE, etc. fuera de la definición de un objeto se rechaza.
 *
 * Por qué alcanza con mirar el inicio de cada lote: SQL Server exige que CREATE/ALTER
 * PROCEDURE|FUNCTION|VIEW sea la PRIMERA sentencia de su lote (separado por GO) y todo
 * lo que sigue hasta el GO es el cuerpo del objeto, que se guarda pero NO se ejecuta al
 * aplicar el script. Así que cada lote debe ser:
 *   - una definición:   CREATE [OR ALTER] | ALTER  PROC|PROCEDURE|FUNCTION|VIEW  nombre …
 *   - o sentencias simples permitidas, una tras otra:
 *       SET ANSI_NULLS|QUOTED_IDENTIFIER|NOCOUNT ON|OFF
 *       IF OBJECT_ID(...) IS NULL EXEC('CREATE PROC|PROCEDURE|FUNCTION|VIEW nombre …')   (stub)
 *       IF SCHEMA_ID('x') IS NULL EXEC('CREATE SCHEMA x')
 *       DROP PROC|PROCEDURE|FUNCTION|VIEW [IF EXISTS] nombre[, nombre…]
 *       IF OBJECT_ID(...) IS NOT NULL DROP PROC|PROCEDURE|FUNCTION|VIEW nombre
 */
const IDENT = String.raw `(?:\[[^\]]+\]|"[^"]+"|[A-Za-z_#@][\w@$#]*)`;
const NOMBRE = String.raw `${IDENT}(?:\s*\.\s*${IDENT})?`;
const TIPO_MODULO = String.raw `(PROC|PROCEDURE|FUNCTION|VIEW)`;
/** Separa en lotes por las líneas "GO" (como SSMS). */
export function separarLotes(texto) {
    return texto
        .replace(/^﻿/, '')
        .split(/^[ \t]*GO[ \t]*(?:\d+)?[ \t]*(?:--[^\n]*)?$/gim)
        .map((l) => l.replace(/\r/g, ''))
        .filter((l) => sinComentarios(l).trim() !== '');
}
/** Quita comentarios (-- y /* *\/) y cadenas para inspeccionar la estructura. */
function sinComentarios(s) {
    let out = '';
    let i = 0;
    while (i < s.length) {
        if (s.startsWith('--', i)) {
            const fin = s.indexOf('\n', i);
            i = fin < 0 ? s.length : fin;
        }
        else if (s.startsWith('/*', i)) {
            // Los comentarios de bloque de T-SQL se anidan.
            let nivel = 1;
            i += 2;
            while (i < s.length && nivel > 0) {
                if (s.startsWith('/*', i)) {
                    nivel++;
                    i += 2;
                }
                else if (s.startsWith('*/', i)) {
                    nivel--;
                    i += 2;
                }
                else
                    i++;
            }
            out += ' ';
        }
        else {
            out += s[i];
            i++;
        }
    }
    return out;
}
/** Posición donde empieza la primera sentencia (salta espacios y comentarios). */
export function inicioSentencia(s, desde = 0) {
    let i = desde;
    for (;;) {
        while (i < s.length && /[\s;]/.test(s[i]))
            i++;
        if (s.startsWith('--', i)) {
            const fin = s.indexOf('\n', i);
            i = fin < 0 ? s.length : fin;
        }
        else if (s.startsWith('/*', i)) {
            let nivel = 1;
            i += 2;
            while (i < s.length && nivel > 0) {
                if (s.startsWith('/*', i)) {
                    nivel++;
                    i += 2;
                }
                else if (s.startsWith('*/', i)) {
                    nivel--;
                    i += 2;
                }
                else
                    i++;
            }
        }
        else
            return i;
    }
}
/** "[rip].[MR X]" o "rip.MR_X" o "MR_X" -> "rip.MR X" / "dbo.MR_X". */
export function normalizarNombre(crudo) {
    const partes = crudo
        .split(/\s*\.\s*(?=(?:\[|"|[A-Za-z_#@]))/)
        .map((p) => p.trim().replace(/^\[(.*)\]$/, '$1').replace(/^"(.*)"$/, '$1'));
    return partes.length === 1 ? `dbo.${partes[0]}` : `${partes[0]}.${partes[1]}`;
}
const tipoDe = (t) => /^PROC/i.test(t) ? 'PROCEDIMIENTO' : /^FUNC/i.test(t) ? 'FUNCION' : 'VISTA';
/** Sentencias simples permitidas (fuera de una definición). Devuelve el largo consumido. */
function sentenciaSimple(resto) {
    const reglas = [
        { re: /^SET\s+(ANSI_NULLS|QUOTED_IDENTIFIER|NOCOUNT)\s+(ON|OFF)\b/i, objetos: () => [] },
        {
            // IF OBJECT_ID(...) IS NULL EXEC('CREATE PROCEDURE x AS ...')  (stub, se completa con ALTER)
            re: new RegExp(String.raw `^IF\s+OBJECT_ID\s*\(\s*N?'[^']*'\s*(?:,\s*N?'[^']*'\s*)?\)\s+IS\s+NULL\s+(?:BEGIN\s+)?EXEC\s*\(\s*N?'\s*CREATE\s+${TIPO_MODULO}\s+(${NOMBRE})(?:''|[^'])*'\s*\)\s*;?\s*(?:END\b)?`, 'i'),
            objetos: (m) => [{ nombre: normalizarNombre(m[2].replace(/''/g, "'")), tipo: tipoDe(m[1]), accion: 'CREAR' }],
        },
        {
            re: new RegExp(String.raw `^IF\s+SCHEMA_ID\s*\(\s*N?'[^']*'\s*\)\s+IS\s+NULL\s+EXEC\s*\(\s*N?'\s*CREATE\s+SCHEMA\s+(${IDENT})(?:\s+AUTHORIZATION\s+${IDENT})?\s*'\s*\)`, 'i'),
            objetos: (m) => [{ nombre: m[1].replace(/^\[(.*)\]$/, '$1'), tipo: 'ESQUEMA', accion: 'CREAR_ESQUEMA' }],
        },
        {
            re: new RegExp(String.raw `^(?:IF\s+OBJECT_ID\s*\(\s*N?'[^']*'\s*(?:,\s*N?'[^']*'\s*)?\)\s+IS\s+NOT\s+NULL\s+)?DROP\s+${TIPO_MODULO}\s+(?:IF\s+EXISTS\s+)?(${NOMBRE}(?:\s*,\s*${NOMBRE})*)`, 'i'),
            objetos: (m) => m[2].split(/\s*,\s*/).map((n) => ({ nombre: normalizarNombre(n), tipo: tipoDe(m[1]), accion: 'BORRAR' })),
        },
    ];
    for (const r of reglas) {
        const m = r.re.exec(resto);
        if (m)
            return { largo: m[0].length, objetos: r.objetos(m) };
    }
    return null;
}
const DEFINICION = new RegExp(String.raw `^(CREATE\s+OR\s+ALTER|CREATE|ALTER)\s+${TIPO_MODULO}\s+(${NOMBRE})`, 'i');
export function analizarScript(texto) {
    const errores = [];
    const objetos = new Map();
    const agregar = (o) => {
        const previo = objetos.get(o.nombre.toLowerCase());
        // Un stub (CREAR) seguido de ALTER del mismo objeto es "crear o modificar".
        if (previo && previo.accion !== o.accion && previo.accion !== 'BORRAR' && o.accion !== 'BORRAR') {
            objetos.set(o.nombre.toLowerCase(), { ...o, accion: 'CREAR_O_MODIFICAR' });
        }
        else
            objetos.set(o.nombre.toLowerCase(), o);
    };
    if (!texto.trim())
        return { ok: false, errores: ['El script está vacío.'], lotes: [], objetos: [] };
    if (texto.length > 2_000_000)
        return { ok: false, errores: ['El script es demasiado grande (máximo 2 MB).'], lotes: [], objetos: [] };
    const lotes = separarLotes(texto);
    lotes.forEach((lote, n) => {
        const num = n + 1;
        let pos = inicioSentencia(lote);
        const def = DEFINICION.exec(lote.slice(pos));
        if (def) {
            const accion = /^CREATE\s+OR\s+ALTER/i.test(def[1]) ? 'CREAR_O_MODIFICAR' : /^CREATE/i.test(def[1]) ? 'CREAR' : 'MODIFICAR';
            agregar({ nombre: normalizarNombre(def[3]), tipo: tipoDe(def[2]), accion });
            return; // el resto del lote es el cuerpo del objeto
        }
        while (pos < lote.length) {
            const resto = lote.slice(pos);
            const simple = sentenciaSimple(resto);
            if (simple) {
                simple.objetos.forEach(agregar);
                pos = inicioSentencia(lote, pos + simple.largo);
                continue;
            }
            if (DEFINICION.test(resto)) {
                errores.push(`Lote ${num}: el CREATE/ALTER debe ir al principio del lote. Sepárelo con una línea GO.`);
            }
            else {
                const muestra = sinComentarios(resto).trim().split('\n')[0].slice(0, 70);
                errores.push(`Lote ${num}: no permitido «${muestra}». Solo se aceptan scripts que crean o modifican procedimientos, funciones y vistas.`);
            }
            break;
        }
    });
    if (!errores.length && !objetos.size)
        errores.push('El script no crea ni modifica ningún procedimiento, función o vista.');
    return { ok: errores.length === 0, errores, lotes, objetos: [...objetos.values()] };
}
/**
 * Convierte una definición guardada (CREATE … o ALTER …) en la sentencia para
 * restaurarla: ALTER si el objeto existe, CREATE si no.
 */
export function sentenciaRestauracion(definicion, existe) {
    const pos = inicioSentencia(definicion);
    const m = new RegExp(String.raw `^(CREATE\s+OR\s+ALTER|CREATE|ALTER)\s+${TIPO_MODULO}\b`, 'i').exec(definicion.slice(pos));
    if (!m)
        return definicion;
    return definicion.slice(0, pos) + `${existe ? 'ALTER' : 'CREATE'} ${m[2]}` + definicion.slice(pos + m[0].length);
}
//# sourceMappingURL=scripts.validar.js.map