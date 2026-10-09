import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { RAIZ_APP } from '../app-info.js';
import { queryTenantRaw } from './tenant-pool.js';
/**
 * Procedimientos propios del Aplicativo Web (rip.MR_DETALLE_VENTAS, rip.MR_DETALLE_COMPRAS…),
 * con su script en backend/sql/<nombre>.sql. La primera línea del script es "-- VERSION: n".
 *
 *  - Si la base no lo tiene, se crea la primera vez que se usa.
 *  - Al instalarlo se guarda en la base (propiedad extendida "AplicativoWeb") la versión y
 *    una huella (SHA-256) de su texto.
 *  - Si el aplicativo trae una versión más nueva, se actualiza SOLO si el texto sigue
 *    igual a lo que se instaló (nadie lo modificó). Si se ajustó para un cliente, se
 *    respeta y se deja aviso en el log; para pasarlo a la versión nueva hay que ejecutar
 *    el script a mano (y volver a hacer el ajuste si hace falta).
 */
export class ProcedimientoError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProcedimientoError';
    }
}
const PROPIEDAD = 'AplicativoWeb';
/** bd|procedimiento ya comprobados en esta ejecución del servicio. */
const comprobados = new Set();
const huella = (texto) => createHash('sha256').update(texto).digest('hex');
function leerScript(nombre) {
    const archivo = path.join(RAIZ_APP, 'backend', 'sql', `${nombre}.sql`);
    let texto;
    try {
        texto = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '');
    }
    catch {
        throw new ProcedimientoError(`No se encontró el script ${archivo}.`);
    }
    const version = Number(/^--\s*VERSION:\s*(\d+)/m.exec(texto)?.[1] ?? 1);
    return { texto, version };
}
async function estado(bd, nombre) {
    const req = {
        NOMBRE: { type: () => sql.NVarChar(256), value: nombre },
        PROP: { type: () => sql.NVarChar(128), value: PROPIEDAD },
    };
    const r = await queryTenantRaw(bd, `SELECT OBJECT_ID(@NOMBRE, 'P') AS ID,
            OBJECT_DEFINITION(OBJECT_ID(@NOMBRE, 'P')) AS DEF,
            (SELECT CAST(value AS NVARCHAR(400)) FROM sys.extended_properties
             WHERE class = 1 AND major_id = OBJECT_ID(@NOMBRE, 'P') AND minor_id = 0 AND name = @PROP) AS PROP`, req);
    const fila = r[0];
    let registro = null;
    try {
        registro = fila?.PROP ? JSON.parse(fila.PROP) : null;
    }
    catch {
        registro = null;
    }
    return { existe: fila?.ID != null, definicion: fila?.DEF ?? '', registro };
}
async function instalar(bd, nombre, texto, version) {
    try {
        for (const lote of texto.split(/^\s*GO\s*$/m).filter((l) => l.trim())) {
            // eslint-disable-next-line no-await-in-loop
            await queryTenantRaw(bd, lote);
        }
    }
    catch (err) {
        throw new ProcedimientoError(`No se pudo instalar ${nombre} en la base "${bd}" (${err instanceof Error ? err.message : String(err)}). ` +
            `Ejecute backend/sql/${nombre}.sql en esa base con un usuario con permiso para crear procedimientos.`);
    }
    // Registra versión y huella del texto recién instalado.
    const { definicion } = await estado(bd, nombre);
    const [esquema, objeto] = nombre.split('.');
    const valor = JSON.stringify({ v: version, h: huella(definicion) });
    const params = {
        PROP: { type: () => sql.NVarChar(128), value: PROPIEDAD },
        VALOR: { type: () => sql.NVarChar(400), value: valor },
        ESQ: { type: () => sql.NVarChar(128), value: esquema },
        OBJ: { type: () => sql.NVarChar(128), value: objeto },
    };
    await queryTenantRaw(bd, `IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID(@ESQ + '.' + @OBJ) AND minor_id = 0 AND name = @PROP)
       EXEC sys.sp_updateextendedproperty @name = @PROP, @value = @VALOR, @level0type = 'SCHEMA', @level0name = @ESQ, @level1type = 'PROCEDURE', @level1name = @OBJ;
     ELSE
       EXEC sys.sp_addextendedproperty @name = @PROP, @value = @VALOR, @level0type = 'SCHEMA', @level0name = @ESQ, @level1type = 'PROCEDURE', @level1name = @OBJ;`, params);
}
export async function asegurarProcedimiento(bd, nombre) {
    const clave = `${bd}|${nombre}`;
    if (comprobados.has(clave))
        return;
    if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(nombre))
        throw new ProcedimientoError(`Nombre de procedimiento inválido: ${nombre}`);
    const { texto, version } = leerScript(nombre);
    const actual = await estado(bd, nombre);
    if (!actual.existe) {
        await instalar(bd, nombre, texto, version);
    }
    else if (actual.registro && actual.registro.v < version) {
        if (actual.registro.h === huella(actual.definicion)) {
            await instalar(bd, nombre, texto, version);
        }
        else {
            // eslint-disable-next-line no-console
            console.warn(`[PROCEDIMIENTOS] ${nombre} en "${bd}" fue modificado después de instalarlo: no se actualiza a la versión ${version}. ` +
                `Para actualizarlo, ejecute backend/sql/${nombre}.sql en esa base.`);
        }
    }
    else if (!actual.registro) {
        // Creado a mano o por una versión del aplicativo sin control de versiones: se respeta.
        // eslint-disable-next-line no-console
        console.warn(`[PROCEDIMIENTOS] ${nombre} en "${bd}" no tiene registro de versión: se usa tal cual.`);
    }
    comprobados.add(clave);
}
//# sourceMappingURL=procedimientos.js.map