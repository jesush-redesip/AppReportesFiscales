import sql from 'mssql';
import { assertSafeDatabaseIdentifier, queryTenantRaw } from '../../shared/db/tenant-pool.js';
import { parseYyyyMMdd } from '../../shared/util/date-format.js';
import { getConfiguracionCuentas } from '../configuracion-cuentas/configuracion-cuentas.repository.js';
import { contextoPeticion, estaDebugActivo, registrarEvento } from '../../shared/debug/debug.js';
import { LLAMADA_COSTO_VENTA, resolveBdContable } from './cajas.repository.js';
/**
 * Ensures the accounting DB has `RIP_ASIENTO` (a 1-row counter table seeding the
 * ASIENTO/ASIENTOVISIBLE sequence) — port of the inline `IF NOT EXISTS` check at the
 * top of `contabilizar.php`. Idempotent: no-ops if the table already exists.
 */
async function ensureRipAsiento(accountingDb) {
    await queryTenantRaw(accountingDb, `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RIP_ASIENTO')
     BEGIN
       CREATE TABLE RIP_ASIENTO([ASIENTO] [int] NULL, [ASIENTOVISIBLE] [int] NULL) ON [PRIMARY]
       DECLARE @ASIENTO AS INT
       DECLARE @ASIENTOVISIBLE AS INT
       SELECT @ASIENTO = ISNULL(MAX(ASIENTO), 0) + 1, @ASIENTOVISIBLE = ISNULL(MAX(ASIENTOVISIBLE), 0) + 1 FROM DIARIOAPUNTES
       INSERT INTO RIP_ASIENTO(ASIENTO, ASIENTOVISIBLE) VALUES (@ASIENTO, @ASIENTOVISIBLE)
     END`);
}
/**
 * Wraps `body` in the same `BEGIN TRY/BEGIN TRANSACTION ... COMMIT / BEGIN CATCH
 * ROLLBACK ... END CATCH SELECT @STATUS` shape every contabilizar/descontabilizar
 * flow in the legacy app used, and returns the resulting status. `body` must not
 * declare `@STATUS` itself.
 */
async function runStatusBatch(bd, body, params) {
    return (await runBatch(bd, body, params, false)).status;
}
/**
 * El batch atrapa sus propios errores (TRY/CATCH + ROLLBACK), así que para el driver la
 * consulta "salió bien" y el motivo real se perdía: la pantalla solo veía 'ERROR' y ni
 * el debug ni la auditoría lo mostraban. Se deja en la consola del backend y, con el
 * modo debug encendido, como un evento de error asociado a la petición.
 */
function reportarErrorDeBatch(bd, mensaje) {
    // eslint-disable-next-line no-console
    console.error(`[CAJAS] Batch rechazado en ${bd}: ${mensaje}`);
    if (!estaDebugActivo())
        return;
    registrarEvento({
        tipo: 'sql',
        bd,
        modo: 'query',
        texto: '(error capturado dentro del batch TRY/CATCH; la transacción se revirtió)',
        parametros: [],
        reqId: contextoPeticion.getStore()?.reqId ?? null,
        script: '',
        ms: 0,
        error: mensaje,
        filas: null,
        filasAfectadas: null,
    });
}
/**
 * Igual que `runStatusBatch`, pero además devuelve `@ASIENTO` y `@ASIENTOVISIBLE` (los
 * dos números con que queda el asiento en DIARIOAPUNTES). `body` debe declarar y
 * asignar ambos, como hacen las tres variantes de contabilizar un cierre.
 */
async function runStatusBatchConAsiento(bd, body, params) {
    return runBatch(bd, body, params, true);
}
async function runBatch(bd, body, params, conAsiento) {
    const rows = await queryTenantRaw(bd, `DECLARE @STATUS AS VARCHAR(30)
     DECLARE @MENSAJE AS NVARCHAR(2048)
     BEGIN TRY
       BEGIN TRANSACTION
         ${body}
       COMMIT TRANSACTION
       SET @STATUS = 'SUCCESS'
     END TRY
     BEGIN CATCH
       IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION
       SET @STATUS = 'ERROR'
       SET @MENSAJE = N'Error ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' (línea ' + CAST(ERROR_LINE() AS NVARCHAR(10)) + N'): ' + ERROR_MESSAGE()
     END CATCH
     SELECT @STATUS AS STATUS, @MENSAJE AS MENSAJE${conAsiento ? ', @ASIENTO AS ASIENTO, @ASIENTOVISIBLE AS ASIENTOVISIBLE' : ''}`, params);
    const status = rows[0]?.STATUS === 'SUCCESS' ? 'SUCCESS' : 'ERROR';
    const mensaje = status === 'ERROR' ? String(rows[0]?.MENSAJE ?? '').trim() || null : null;
    if (mensaje)
        reportarErrorDeBatch(bd, mensaje);
    const num = (v) => (conAsiento && status === 'SUCCESS' && v != null ? Number(v) : null);
    return { status, mensaje, asiento: num(rows[0]?.ASIENTO), asientoVisible: num(rows[0]?.ASIENTOVISIBLE) };
}
/**
 * Port of `contabilizar.php` tipo=1, sin `fechacontable` (cierre normal, se postea con
 * la fecha de venta). The 5 SQL functions that compute each accounting line
 * (`RIP_COBROS_FRONT`, `RIP_DIFERENCIAS_FRONT`, `RIP_VENTAS`, `RIP_COSTOVENTA`,
 * `RIP_IMPUESTOSFRONT`) live in the tenant DB; only `CUENTAS`/`DIARIOAPUNTES`/etc. live
 * in the separate accounting DB, referenced by cross-database qualified name
 * (`${accountingDb}.dbo.X`) exactly like the legacy app did — just with `accountingDb`
 * resolved and validated server-side instead of trusted from the client's POST body.
 * `CUENTACOBRO = '7101010001'` is a hardcoded account from the legacy query, preserved
 * as-is per the 1:1 translation the user asked for — not something to "fix".
 */
async function contabilizarCajaSinFechaContable(bd, accountingDb, serieCaja, fecha, z, usuario) {
    const cuentas = await getConfiguracionCuentas(bd);
    return runStatusBatchConAsiento(bd, `UPDATE FACTURASVENTA SET TRASPASADA = 'T' WHERE CAJA = @CAJARAW AND Z = @Z

     DECLARE @ASIENTO AS INT
     DECLARE @ASIENTOVISIBLE AS INT
     DECLARE @DIFERENCIA AS FLOAT
     DECLARE @CC AS INT = 95
     DECLARE @REDONDEO AS INT = 2
     DECLARE @CODMONEDA AS INT
     DECLARE @FACTORMONEDA AS FLOAT
     DECLARE @USUARIO AS NVARCHAR(10) = SUBSTRING(@USUARIONOMBRE, 1, 10)

     SELECT @ASIENTO = MAX(ASIENTO + 1) FROM ${accountingDb}.dbo.CONTROLASIENTO
     SELECT @ASIENTOVISIBLE = VALOR + 1 FROM ${accountingDb}.dbo.PARAMETROS WHERE CLAVE = 'MASIV'
     SELECT TOP 1 @CODMONEDA = CODMONEDA, @FACTORMONEDA = ISNULL(1 / COTDEF, 1) FROM MONEDAS WHERE PRINCIPAL = 'T'

     SET @DIFERENCIA = ISNULL((
       SELECT ROUND(SUM(A.DEBE - A.HABER), @REDONDEO)
       FROM (
         SELECT * FROM RIP_COBROS_FRONT(@REDONDEO, @FECHA, @CAJA, @Z, @SOBRANTEVENTA, @FALTANTEVENTA)
         UNION ALL SELECT *, @CODMONEDA FROM RIP_VENTAS(@REDONDEO, @CAJA, @Z)
         UNION ALL SELECT *, @CODMONEDA FROM ${LLAMADA_COSTO_VENTA} WHERE @INCLUIRCOSTO = 1
         UNION ALL SELECT *, @CODMONEDA FROM RIP_IMPUESTOSFRONT(@REDONDEO, @FECHA, @CAJA, @Z)
       ) A
       INNER JOIN ${accountingDb}.dbo.CUENTAS C ON A.CUENTA = C.CODIGO COLLATE Latin1_General_CS_AI
     ), 0)

     INSERT INTO ${accountingDb}.dbo.DIARIOAPUNTES (
       USUARIO, ASIENTO, APUNTE, NIVEL, FECHA, CUENTA, CONCEPTO, COMENTARIO, SERIEDOCUMENTO, NUMERODOCUMENTO, DEBE, HABER, LIBROIVA,
       COSTES, PUNTEO, RETENCION, CENTROCOSTE, FACTORMONEDA, CODMONEDA, EMPRESAGESTION, DEBE1, HABER1, PNORMA43STR, ASIENTOVISIBLE,
       CODMONEDADC, TIPODOCUMENTO, SERIEFISCAL, CODTERCERO, TERCEROESCLIENTE, NUMEROFISCAL)
     SELECT @USUARIO, @ASIENTO, ROW_NUMBER() OVER (ORDER BY A.DEBE DESC), 'A', A.FECHA,
       A.CUENTACOBRO, A.CONCEPTO, UPPER(A.COMENTARIO), A.SERIEDOCUMENTO, A.NUMERODOCUMENTO,
       (A.DEBE * @FACTORMONEDA), (A.HABER * @FACTORMONEDA), NULL, NULL, NULL,
       'F', A.CENTROCOSTE, 1 / dbo.F_GET_COTIZACION(A.FECHA, A.CODMONEDA), A.CODMONEDA, @EMPRESAGESTION,
       ROUND(A.DEBE * dbo.F_GET_COTIZACION(A.FECHA, A.CODMONEDA), 2), ROUND(A.HABER * dbo.F_GET_COTIZACION(A.FECHA, A.CODMONEDA), 2),
       NULL, @ASIENTOVISIBLE, NULL, NULL, NULL, NULL, NULL, NULL
     FROM (
       SELECT A.FECHA, SUBSTRING(@CAJA, 3, 1) ASIENTO, A.CUENTA AS CUENTACOBRO, C.TITULO, @CC CONCEPTO, A.COMENTARIO,
         SUBSTRING(@CAJA, 1, 3) SERIEDOCUMENTO, '' NUMERODOCUMENTO, A.DEBE, A.HABER, A.CENTROCOSTE, A.CODMONEDA
       FROM (
         SELECT * FROM RIP_COBROS_FRONT(@REDONDEO, @FECHA, @CAJA, @Z, @SOBRANTEVENTA, @FALTANTEVENTA) C
         UNION ALL SELECT *, @CODMONEDA FROM RIP_DIFERENCIAS_FRONT(@REDONDEO, @FECHA, @CAJA, @Z, @SOBRANTEREDONDEO, @FALTANTEREDONDEO, @DIFERENCIA)
         UNION ALL SELECT *, @CODMONEDA FROM RIP_VENTAS(@REDONDEO, @CAJA, @Z)
         UNION ALL SELECT *, @CODMONEDA FROM ${LLAMADA_COSTO_VENTA} WHERE @INCLUIRCOSTO = 1
         UNION ALL SELECT *, @CODMONEDA FROM RIP_IMPUESTOSFRONT(@REDONDEO, @FECHA, @CAJA, @Z)
       ) A
       INNER JOIN ${accountingDb}.dbo.CUENTAS C ON A.CUENTA = C.CODIGO COLLATE Latin1_General_CS_AI
       WHERE (DEBE - HABER) <> 0
     ) AS A
     WHERE (HABER + DEBE <> 0) AND (CUENTACOBRO = '7101010001' OR ((HABER > 0 OR HABER = 0) AND (DEBE > 0 OR DEBE = 0)))

     INSERT INTO ${accountingDb}.dbo.REGISTROAUDITORIA (
       FECHA, HORA, TIPO, CODEMPLEADO, SERIE, NUMERO, N, CODARTICULO, TALLA, COLOR, DESCRIPCION, UDS,
       PRECIO, PRECIOIVA, USUARIO, ASIENTO, APUNTE, NIVEL, CUENTA, CONCEPTO)
     SELECT CAST(GETDATE() AS DATE), GETDATE(), 51, @CODUSUARIO, '', 0, '', 0, '', '',
       LEFT((SELECT TOP 1 COMENTARIO FROM ${accountingDb}.dbo.DIARIOAPUNTES WHERE ASIENTO = @ASIENTO), ISNULL(COL_LENGTH('${accountingDb}.dbo.REGISTROAUDITORIA', 'DESCRIPCION') / 2, 45)), 0, 0, 0, @USUARIO,
       @ASIENTO, 0, 'A', '', 95

     INSERT INTO ${accountingDb}.dbo.CONTROLASIENTO(ASIENTO) VALUES (@ASIENTO)
     UPDATE ${accountingDb}.dbo.PARAMETROS SET VALOR = @ASIENTOVISIBLE WHERE CLAVE = 'MASIV'`, {
        CAJARAW: { type: () => sql.NVarChar(10), value: serieCaja },
        CAJA: { type: () => sql.NVarChar(10), value: `${serieCaja.toUpperCase()}%` },
        FECHA: { type: () => sql.Date, value: parseYyyyMMdd(fecha) },
        Z: { type: () => sql.Int, value: z },
        SOBRANTEVENTA: { type: () => sql.NVarChar(20), value: cuentas.sobranteVenta },
        FALTANTEVENTA: { type: () => sql.NVarChar(20), value: cuentas.faltanteVenta },
        SOBRANTEREDONDEO: { type: () => sql.NVarChar(20), value: cuentas.sobranteRedondeo },
        FALTANTEREDONDEO: { type: () => sql.NVarChar(20), value: cuentas.faltanteRedondeo },
        INCLUIRCOSTO: { type: () => sql.Bit, value: cuentas.incluirCostoVenta },
        USUARIONOMBRE: { type: () => sql.NVarChar(50), value: usuario.usuario },
        CODUSUARIO: { type: () => sql.Int, value: usuario.codUsuario },
        EMPRESAGESTION: { type: () => sql.Int, value: usuario.codEmpresa },
    });
}
/**
 * Port of `contabilizar.php` tipo=1, CON `fechacontable` (cierre "a fecha atrasada" —
 * postea con una fecha contable distinta a la de venta). Prorratea el declarado por
 * forma de pago vía `VENCIMFPAGO.PORCENTAJE`. `'611201019'`/`'611201999'` son cuentas
 * hardcodeadas en el legacy (sobrante/faltante y redondeo), preservadas tal cual.
 */
async function contabilizarCajaConFechaContable(bd, accountingDb, serieCaja, fecha, fechaContable, z, usuario) {
    await queryTenantRaw(bd, `UPDATE FACTURASVENTA SET TRASPASADA = 'T' WHERE CAJA = @CAJARAW AND Z = @Z`, {
        CAJARAW: { type: () => sql.NVarChar(10), value: serieCaja },
        Z: { type: () => sql.Int, value: z },
    });
    return runStatusBatchConAsiento(bd, `DECLARE @ASIENTO AS INT
     DECLARE @ASIENTOVISIBLE AS INT
     DECLARE @REDONDEO AS INT = 2
     DECLARE @DIFERENCIA AS FLOAT
     DECLARE @CODMONEDA AS INT
     DECLARE @FACTORMONEDA AS FLOAT
     DECLARE @USUARIO AS NVARCHAR(10) = SUBSTRING(@USUARIONOMBRE, 1, 10)

     SELECT @ASIENTO = MAX(ASIENTO + 1) FROM ${accountingDb}.dbo.CONTROLASIENTO
     SELECT @ASIENTOVISIBLE = VALOR + 1 FROM ${accountingDb}.dbo.PARAMETROS WHERE CLAVE = 'MASIV'
     SELECT TOP 1 @CODMONEDA = CODMONEDA, @FACTORMONEDA = ISNULL(1 / COTDEF, 1) FROM MONEDAS WHERE PRINCIPAL = 'T'

     SELECT @DIFERENCIA = (SELECT SUM(DEBE) - SUM(HABER) FROM (
       SELECT VFP.CUENTACOBRO CUENTA,
         CASE WHEN ROUND(SUM(DIF.DECLARADO), @REDONDEO) >= 0 THEN ROUND(SUM(DIF.DECLARADO * VFP.PORCENTAJE / 100), @REDONDEO) ELSE 0 END DEBE,
         CASE WHEN ROUND(SUM(DIF.DECLARADO), @REDONDEO) < 0 THEN ROUND(SUM(DIF.DECLARADO * -1 * VFP.PORCENTAJE / 100), @REDONDEO) ELSE 0 END HABER
       FROM RIP_DIFERENCIAFRONT_WEB(@FECHA, @CAJA) DIF
         INNER JOIN VENCIMFPAGO VFP ON DIF.CODFORMAPAGO = VFP.CODFORMAPAGO
         LEFT JOIN ${accountingDb}.dbo.CUENTAS C ON VFP.CUENTACOBRO = C.CODIGO COLLATE Modern_Spanish_CI_AS
       WHERE DIF.DECLARADO <> 0 AND LEN(@CAJA) > 2 AND DIF.Z = @Z
       GROUP BY DIF.FECHA, DIF.CAJA, DIF.SERIECAJA, VFP.CUENTACOBRO, C.TITULO
       UNION ALL
       SELECT ART.CONTRAPARTIDAVENTA,
         CASE WHEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) < 0 THEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) * -1 ELSE 0 END,
         CASE WHEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) >= 0 THEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) ELSE 0 END
       FROM ALBVENTACAB AVC
         INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE = AVL.NUMSERIE AND AVC.NUMALBARAN = AVL.NUMALBARAN AND AVC.N = AVL.N
         LEFT JOIN ARTICULOS ART ON AVL.CODARTICULO = ART.CODARTICULO
         INNER JOIN SERIES S ON SUBSTRING(AVC.NUMSERIE, 1, 3) = S.SERIE
         LEFT JOIN ${accountingDb}.dbo.CUENTAS C ON ART.CONTRAPARTIDACOMPRA = C.CODIGO COLLATE Modern_Spanish_CI_AS
       WHERE AVC.NUMSERIE LIKE @CAJA AND LEN(@CAJA) > 2 AND AVC.FECHA = @FECHA AND AVC.Z = @Z
       GROUP BY ART.CONTRAPARTIDAVENTA, S.DESCRIPCION, SUBSTRING(AVC.NUMSERIE, 1, 3), SUBSTRING(AVC.NUMSERIE, 3, 1), C.TITULO
       HAVING ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) <> 0
       UNION ALL
       SELECT '611201019',
         CASE WHEN ROUND(SUM(DIFERENCIA), @REDONDEO) >= 0 THEN ROUND(SUM(DIFERENCIA), @REDONDEO) ELSE 0 END,
         CASE WHEN ROUND(SUM(DIFERENCIA), @REDONDEO) < 0 THEN ROUND(SUM(DIFERENCIA), @REDONDEO) * -1 ELSE 0 END
       FROM RIP_DIFERENCIAFRONT_WEB(@FECHA, @CAJA) DIF WHERE DIF.Z = @Z
       GROUP BY DIF.FECHA, DIF.CAJA, DIF.SERIECAJA
       UNION ALL
       SELECT IMP.CUENTAIVAREP,
         CASE WHEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) < 0 THEN FLOOR((SUM(AVL.PRECIOIVA * ((100 - AVL.DTO) / 100) * AVL.UNIDADESTOTAL) - SUM(AVL.PRECIOIVA * AVL.UNIDADESTOTAL * AVC.DTOCOMERCIAL / 100) - SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100)) * 100) / 100 * -1 ELSE 0 END,
         CASE WHEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) >= 0 THEN FLOOR((SUM(AVL.PRECIOIVA * ((100 - AVL.DTO) / 100) * AVL.UNIDADESTOTAL) - SUM(AVL.PRECIOIVA * AVL.UNIDADESTOTAL * AVC.DTOCOMERCIAL / 100) - SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100)) * 100) / 100 ELSE 0 END
       FROM ALBVENTACAB AVC
         INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE = AVL.NUMSERIE AND AVC.NUMALBARAN = AVL.NUMALBARAN AND AVC.N = AVL.N
         INNER JOIN IMPUESTOS IMP ON AVL.TIPOIMPUESTO = IMP.TIPOIVA
         INNER JOIN SERIES S ON SUBSTRING(AVC.NUMSERIE, 1, 3) = S.SERIE
         LEFT JOIN ${accountingDb}.dbo.CUENTAS C ON IMP.CUENTAIVAREP = C.CODIGO COLLATE Modern_Spanish_CI_AS
       WHERE AVC.NUMSERIE LIKE @CAJA AND LEN(@CAJA) > 2 AND AVC.FECHA = @FECHA AND AVC.Z = @Z
       GROUP BY IMP.CUENTAIVAREP, S.DESCRIPCION, AVL.IVA, SUBSTRING(AVC.NUMSERIE, 1, 3), SUBSTRING(AVC.NUMSERIE, 3, 1), C.TITULO
     ) A WHERE (HABER + DEBE > 0))

     INSERT INTO ${accountingDb}.dbo.DIARIOAPUNTES (
       USUARIO, ASIENTO, APUNTE, NIVEL, FECHA, CUENTA, CONCEPTO, COMENTARIO, SERIEDOCUMENTO, NUMERODOCUMENTO, DEBE, HABER, LIBROIVA,
       COSTES, PUNTEO, RETENCION, CENTROCOSTE, FACTORMONEDA, CODMONEDA, EMPRESAGESTION, DEBE1, HABER1, PNORMA43STR, ASIENTOVISIBLE,
       CODMONEDADC, TIPODOCUMENTO, SERIEFISCAL, CODTERCERO, TERCEROESCLIENTE, NUMEROFISCAL)
     SELECT @USUARIO, @ASIENTO, ROW_NUMBER() OVER (ORDER BY A.DEBE DESC), 'A', @FECHA2,
       A.CUENTACOBRO, A.CONCEPTO, UPPER(A.COMENTARIO), A.SERIEDOCUMENTO, A.NUMERODOCUMENTO,
       A.DEBE * @FACTORMONEDA, A.HABER * @FACTORMONEDA, NULL, NULL, NULL,
       'F', A.CENTROCOSTE, @FACTORMONEDA, @CODMONEDA, @EMPRESAGESTION,
       A.DEBE, A.HABER, NULL, @ASIENTOVISIBLE, NULL, NULL, NULL, NULL, NULL, NULL
     FROM (
       SELECT DIF.FECHA, SUBSTRING(DIF.SERIECAJA, 3, 1) ASIENTO, VFP.CUENTACOBRO CUENTACOBRO,
         ISNULL(C.TITULO, 'NO DISPONILE') TITULO, 95 CONCEPTO,
         'CIERRE DE ' + DIF.CAJA + ' DEL ' + CONVERT(CHAR(10), @FECHA, 103) + ' ' + RFP.DESCRIPCION COLLATE Modern_Spanish_CI_AS AS COMENTARIO,
         DIF.SERIECAJA SERIEDOCUMENTO, '' NUMERODOCUMENTO,
         CASE WHEN ROUND(SUM(DIF.DECLARADO), @REDONDEO) >= 0 THEN ROUND(SUM(DIF.DECLARADO * VFP.PORCENTAJE / 100), @REDONDEO) ELSE 0 END DEBE,
         CASE WHEN ROUND(SUM(DIF.DECLARADO), @REDONDEO) < 0 THEN ROUND(SUM(DIF.DECLARADO * -1 * VFP.PORCENTAJE / 100), @REDONDEO) ELSE 0 END HABER,
         SUBSTRING(@CAJA, 1, 2) + 'V' CENTROCOSTE
       FROM RIP_DIFERENCIAFRONT_WEB(@FECHA, @CAJA) DIF
         INNER JOIN VENCIMFPAGO VFP ON DIF.CODFORMAPAGO = VFP.CODFORMAPAGO
         LEFT JOIN ${accountingDb}.dbo.CUENTAS C ON VFP.CUENTACOBRO = C.CODIGO COLLATE Modern_Spanish_CI_AS
         LEFT JOIN RIP_RELACIONFORMASPAGO RR ON DIF.CODFORMAPAGO = RR.CODFORMAPAGO
         LEFT JOIN RIP_FORMASPAGOS RFP ON RR.IDFORMAPAGO = RFP.ID
       WHERE DIF.Z = @Z AND DIF.DECLARADO <> 0 AND LEN(@CAJA) > 2
       GROUP BY DIF.FECHA, DIF.CAJA, DIF.SERIECAJA, VFP.CUENTACOBRO, C.TITULO, RR.IDFORMAPAGO, RFP.DESCRIPCION
       UNION ALL
       SELECT MAX(AVC.FECHA), SUBSTRING(AVC.NUMSERIE, 3, 1), ART.CONTRAPARTIDAVENTA, ISNULL(C.TITULO, 'NO DISPONILE'),
         95, 'CIERRE DE ' + S.DESCRIPCION + ' DEL ' + CONVERT(CHAR(10), @FECHA2, 103),
         SUBSTRING(AVC.NUMSERIE, 1, 3), '',
         CASE WHEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) < 0 THEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) * -1 ELSE 0 END,
         CASE WHEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) >= 0 THEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) ELSE 0 END,
         SUBSTRING(@CAJA, 1, 2) + 'V'
       FROM ALBVENTACAB AVC
         INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE = AVL.NUMSERIE AND AVC.NUMALBARAN = AVL.NUMALBARAN AND AVC.N = AVL.N
         LEFT JOIN ARTICULOS ART ON AVL.CODARTICULO = ART.CODARTICULO
         INNER JOIN SERIES S ON SUBSTRING(AVC.NUMSERIE, 1, 3) = S.SERIE
         LEFT JOIN ${accountingDb}.dbo.CUENTAS C ON ART.CONTRAPARTIDACOMPRA = C.CODIGO COLLATE Modern_Spanish_CI_AS
       WHERE AVC.NUMSERIE LIKE @CAJA AND LEN(@CAJA) > 2 AND AVC.FECHA = @FECHA AND AVC.Z = @Z
       GROUP BY ART.CONTRAPARTIDAVENTA, S.DESCRIPCION, SUBSTRING(AVC.NUMSERIE, 1, 3), SUBSTRING(AVC.NUMSERIE, 3, 1), C.TITULO
       HAVING ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) <> 0
       UNION ALL
       SELECT @FECHA, SUBSTRING(DIF.SERIECAJA, 3, 1), '611201019', 'Faltantes y Sobrantes',
         95, 'CIERRE DE ' + DIF.CAJA + ' DEL ' + CONVERT(CHAR(10), @FECHA2, 103),
         SUBSTRING(DIF.SERIECAJA, 1, 3), '',
         CASE WHEN ROUND(SUM(DIFERENCIA), @REDONDEO) >= 0 THEN ROUND(SUM(DIFERENCIA), @REDONDEO) ELSE 0 END,
         CASE WHEN ROUND(SUM(DIFERENCIA), @REDONDEO) < 0 THEN ROUND(SUM(DIFERENCIA), @REDONDEO) * -1 ELSE 0 END,
         SUBSTRING(@CAJA, 1, 2) + 'V'
       FROM RIP_DIFERENCIAFRONT_WEB(@FECHA, @CAJA) DIF WHERE DIF.Z = @Z GROUP BY DIF.FECHA, DIF.CAJA, DIF.SERIECAJA
       UNION ALL
       SELECT MAX(AVC.FECHA), SUBSTRING(AVC.NUMSERIE, 3, 1), IMP.CUENTAIVAREP, ISNULL(C.TITULO, 'NO DISPONILE'),
         95, 'CIERRE DE ' + S.DESCRIPCION + ' DEL ' + CONVERT(CHAR(10), @FECHA2, 103),
         SUBSTRING(AVC.NUMSERIE, 1, 3), '',
         CASE WHEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) < 0 THEN FLOOR((SUM(AVL.PRECIOIVA * ((100 - AVL.DTO) / 100) * AVL.UNIDADESTOTAL) - SUM(AVL.PRECIOIVA * AVL.UNIDADESTOTAL * AVC.DTOCOMERCIAL / 100) - SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100)) * 100) / 100 * -1 ELSE 0 END,
         CASE WHEN ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) >= 0 THEN FLOOR((SUM(AVL.PRECIOIVA * ((100 - AVL.DTO) / 100) * AVL.UNIDADESTOTAL) - SUM(AVL.PRECIOIVA * AVL.UNIDADESTOTAL * AVC.DTOCOMERCIAL / 100) - SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100)) * 100) / 100 ELSE 0 END,
         SUBSTRING(@CAJA, 1, 2) + 'V'
       FROM ALBVENTACAB AVC
         INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE = AVL.NUMSERIE AND AVC.NUMALBARAN = AVL.NUMALBARAN AND AVC.N = AVL.N
         INNER JOIN IMPUESTOS IMP ON AVL.TIPOIMPUESTO = IMP.TIPOIVA
         INNER JOIN SERIES S ON SUBSTRING(AVC.NUMSERIE, 1, 3) = S.SERIE
         LEFT JOIN ${accountingDb}.dbo.CUENTAS C ON IMP.CUENTAIVAREP = C.CODIGO COLLATE Modern_Spanish_CI_AS
       WHERE AVC.NUMSERIE LIKE @CAJA AND LEN(@CAJA) > 2 AND AVC.FECHA = @FECHA AND AVC.Z = @Z
       GROUP BY IMP.CUENTAIVAREP, S.DESCRIPCION, AVL.IVA, SUBSTRING(AVC.NUMSERIE, 1, 3), SUBSTRING(AVC.NUMSERIE, 3, 1), C.TITULO
       UNION ALL
       SELECT TOP (1) @FECHA, SUBSTRING(AVC.NUMSERIE, 3, 1), '611201999', UPPER('Sobrantes y Faltantes por redondeo'),
         95, 'CIERRE DE ' + S.DESCRIPCION + ' DEL ' + CONVERT(CHAR(10), @FECHA2, 103),
         SUBSTRING(AVC.NUMSERIE, 1, 3), '',
         CASE WHEN @DIFERENCIA < 0 THEN ROUND(@DIFERENCIA, 2) * -1 ELSE 0 END,
         CASE WHEN @DIFERENCIA > 0 THEN ROUND(@DIFERENCIA, 2) ELSE 0 END,
         SUBSTRING(@CAJA, 1, 2) + 'V'
       FROM ALBVENTACAB AVC
         INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE = AVL.NUMSERIE AND AVC.NUMALBARAN = AVL.NUMALBARAN AND AVC.N = AVL.N
         INNER JOIN IMPUESTOS IMP ON AVL.TIPOIMPUESTO = IMP.TIPOIVA
         INNER JOIN SERIES S ON SUBSTRING(AVC.NUMSERIE, 1, 3) = S.SERIE
         LEFT JOIN ${accountingDb}.dbo.CUENTAS C ON IMP.CUENTAIVAREP = C.CODIGO COLLATE Modern_Spanish_CI_AS
       WHERE AVC.NUMSERIE LIKE @CAJA AND LEN(@CAJA) > 2 AND AVC.Z = @Z
       GROUP BY IMP.CUENTAIVAREP, S.DESCRIPCION, AVL.IVA, SUBSTRING(AVC.NUMSERIE, 1, 3), SUBSTRING(AVC.NUMSERIE, 3, 1), C.TITULO
     ) A WHERE (HABER + DEBE <> 0) AND (CUENTACOBRO = '611201999' OR ((HABER > 0 OR HABER = 0) AND (DEBE > 0 OR DEBE = 0)))

     INSERT INTO ${accountingDb}.dbo.REGISTROAUDITORIA (
       FECHA, HORA, TIPO, CODEMPLEADO, SERIE, NUMERO, N, CODARTICULO, TALLA, COLOR, DESCRIPCION, UDS,
       PRECIO, PRECIOIVA, USUARIO, ASIENTO, APUNTE, NIVEL, CUENTA, CONCEPTO)
     SELECT CAST(GETDATE() AS DATE), GETDATE(), 51, @CODUSUARIO, '', 0, '', 0, '', '',
       LEFT((SELECT TOP 1 COMENTARIO FROM ${accountingDb}.dbo.DIARIOAPUNTES WHERE ASIENTO = @ASIENTO), ISNULL(COL_LENGTH('${accountingDb}.dbo.REGISTROAUDITORIA', 'DESCRIPCION') / 2, 45)), 0, 0, 0, @USUARIO,
       @ASIENTO, 0, 'A', '', 95

     INSERT INTO ${accountingDb}.dbo.CONTROLASIENTO(ASIENTO) VALUES (@ASIENTO)
     UPDATE ${accountingDb}.dbo.PARAMETROS SET VALOR = @ASIENTOVISIBLE WHERE CLAVE = 'MASIV'`, {
        CAJARAW: { type: () => sql.NVarChar(10), value: serieCaja },
        CAJA: { type: () => sql.NVarChar(10), value: `${serieCaja.toUpperCase()}%` },
        FECHA: { type: () => sql.Date, value: parseYyyyMMdd(fecha) },
        FECHA2: { type: () => sql.Date, value: parseYyyyMMdd(fechaContable) },
        Z: { type: () => sql.Int, value: z },
        USUARIONOMBRE: { type: () => sql.NVarChar(50), value: usuario.usuario },
        CODUSUARIO: { type: () => sql.Int, value: usuario.codUsuario },
        EMPRESAGESTION: { type: () => sql.Int, value: usuario.codEmpresa },
    });
}
/**
 * Port of `contabilizar.php` tipo=2 (depósitos bancarios). The legacy app loops one
 * `INSERT` batch per pending deposit document found for the store/date, each filtered
 * to that document's own DOCUMENTO number — reproduced the same way here.
 * `fondoCaja/fondoN/fondoNumero` come from the caller for the whole batch (same as
 * legacy, which took them once from POST and reused them across every loop
 * iteration) — the UI is expected to pass the fondo triplet that corresponds to the
 * deposits being contabilizados.
 */
async function contabilizarDepositos(bd, accountingDb, serie, fecha, fondoCaja, fondoN, fondoNumero, usuario) {
    const tiendaLike = `${serie.toUpperCase()}%`;
    const fechaDate = parseYyyyMMdd(fecha);
    const depositos = await queryTenantRaw(bd, `SELECT DEP.DOCUMENTO
     FROM RIP_V_DEPOSITOS DEP
       LEFT JOIN SERIES SCL ON SUBSTRING(DEP.CAJA, 1, 2) = SCL.SERIE
       LEFT JOIN RIP_BANCO BANCO ON DEP.BANCO = BANCO.IDBANCO
     WHERE DEP.FECHA_VENTA = @FECHA AND DEP.CAJA LIKE @TIENDA`, { FECHA: { type: () => sql.Date, value: fechaDate }, TIENDA: { type: () => sql.NVarChar(10), value: tiendaLike } });
    let estado = 'SUCCESS';
    for (const deposito of depositos) {
        // eslint-disable-next-line no-await-in-loop
        estado = await runStatusBatch(bd, `DECLARE @ASIENTO AS INT
       DECLARE @ASIENTOVISIBLE AS INT
       DECLARE @CONCEPTOCONTALE AS INT = 8
       DECLARE @CODMONEDA AS INT
       DECLARE @FACTORMONEDA AS FLOAT
       DECLARE @USUARIO AS NVARCHAR(10) = SUBSTRING(@USUARIONOMBRE, 1, 10)

       SELECT @ASIENTO = MAX(ASIENTO + 1) FROM ${accountingDb}.dbo.CONTROLASIENTO
       SELECT @ASIENTOVISIBLE = VALOR + 1 FROM ${accountingDb}.dbo.PARAMETROS WHERE CLAVE = 'MASIV'
       SELECT TOP 1 @CODMONEDA = CODMONEDA, @FACTORMONEDA = ISNULL(1 / COTDEF, 1) FROM MONEDAS WHERE PRINCIPAL = 'T'

       INSERT INTO ${accountingDb}.dbo.DIARIOAPUNTES (
         USUARIO, ASIENTO, APUNTE, NIVEL, FECHA, CUENTA, CONCEPTO, COMENTARIO, SERIEDOCUMENTO, NUMERODOCUMENTO, DEBE, HABER, LIBROIVA,
         COSTES, PUNTEO, RETENCION, CENTROCOSTE, FACTORMONEDA, CODMONEDA, EMPRESAGESTION, DEBE1, HABER1, PNORMA43STR, ASIENTOVISIBLE,
         CODMONEDADC, TIPODOCUMENTO, SERIEFISCAL, CODTERCERO, TERCEROESCLIENTE, NUMEROFISCAL)
       SELECT @USUARIO, @ASIENTO, ROW_NUMBER() OVER (ORDER BY A.DEBE DESC), 'A', A.FECHA_VENTA,
         A.CUENTACONTABLE, @CONCEPTOCONTALE, 'DEP' + CHAR(211) + 'SITO/TRANSF. # ' + A.DOCUMENTO + ' VENTA DEL ' + CONVERT(CHAR(10), A.FECHA_VENTA, 103),
         A.CAJA, A.DOCUMENTO, A.DEBE * @FACTORMONEDA, A.HABER * @FACTORMONEDA, NULL, NULL, NULL,
         'F', '', @FACTORMONEDA, @CODMONEDA, @EMPRESAGESTION,
         A.DEBE, A.HABER, NULL, @ASIENTOVISIBLE, NULL, NULL, NULL, NULL, NULL, NULL
       FROM (
         SELECT BANCO.CUENTACONTABLE, DEP.FECHA_DEPOSITO, DEP.FECHA_VENTA, C.TITULO, DEP.CAJA, DEP.DOCUMENTO, DEP.IMPORTE DEBE, 0 HABER, DEP.CONTABILIZADO
         FROM RIP_V_DEPOSITOS DEP
           INNER JOIN SERIES SCL ON SUBSTRING(DEP.CAJA, 1, 2) = SCL.SERIE
           INNER JOIN RIP_BANCO BANCO ON DEP.BANCO = BANCO.IDBANCO
           INNER JOIN ${accountingDb}.dbo.CUENTAS C ON BANCO.CUENTACONTABLE = C.CODIGO
         WHERE DEP.FECHA_VENTA = @FECHA AND DEP.CAJA LIKE @CAJA AND DEP.DOCUMENTO = @DOCUMENTO
           AND LTRIM(RTRIM(ISNULL(BANCO.CUENTACONTABLE, ''))) <> ''
         UNION ALL
         SELECT BANCO.CONTRAPARTIDA, DEP.FECHA_DEPOSITO, DEP.FECHA_VENTA, C.TITULO, DEP.CAJA, DEP.DOCUMENTO, 0 DEBE, DEP.IMPORTE HABER, DEP.CONTABILIZADO
         FROM RIP_V_DEPOSITOS DEP
           INNER JOIN SERIES SCL ON SUBSTRING(DEP.CAJA, 1, 2) = SCL.SERIE
           INNER JOIN RIP_BANCO BANCO ON DEP.BANCO = BANCO.IDBANCO
           INNER JOIN ${accountingDb}.dbo.CUENTAS C ON BANCO.CONTRAPARTIDA = C.CODIGO
         WHERE DEP.FECHA_VENTA = @FECHA AND DEP.CAJA LIKE @CAJA AND DEP.DOCUMENTO = @DOCUMENTO
           AND LTRIM(RTRIM(ISNULL(BANCO.CUENTACONTABLE, ''))) <> ''
       ) A

       INSERT INTO ${accountingDb}.dbo.REGISTROAUDITORIA (
         FECHA, HORA, TIPO, CODEMPLEADO, SERIE, NUMERO, N, CODARTICULO, TALLA, COLOR, DESCRIPCION, UDS,
         PRECIO, PRECIOIVA, USUARIO, ASIENTO, APUNTE, NIVEL, CUENTA, CONCEPTO)
       SELECT CAST(GETDATE() AS DATE), GETDATE(), 51, @CODUSUARIO, '', 0, '', 0, '', '',
         LEFT((SELECT TOP 1 COMENTARIO FROM ${accountingDb}.dbo.DIARIOAPUNTES WHERE ASIENTO = @ASIENTO), ISNULL(COL_LENGTH('${accountingDb}.dbo.REGISTROAUDITORIA', 'DESCRIPCION') / 2, 45)), 0, 0, 0, @USUARIO,
         @ASIENTO, 0, 'A', '', @CONCEPTOCONTALE

       INSERT INTO ${accountingDb}.dbo.CONTROLASIENTO(ASIENTO) VALUES (@ASIENTO)
       UPDATE ${accountingDb}.dbo.PARAMETROS SET VALOR = @ASIENTOVISIBLE WHERE CLAVE = 'MASIV'
       UPDATE FONDOCAJA SET NUMERODECLARADO = '1' WHERE CAJA = @FONDOCAJA AND NUMERO IN (${fondoNumero.split(',').map((n) => Number(n)).filter((n) => Number.isFinite(n)).join(',') || 'NULL'}) AND N = @FONDON`, {
            CAJA: { type: () => sql.NVarChar(10), value: tiendaLike },
            FECHA: { type: () => sql.Date, value: fechaDate },
            DOCUMENTO: { type: () => sql.NVarChar(50), value: deposito.DOCUMENTO },
            USUARIONOMBRE: { type: () => sql.NVarChar(50), value: usuario.usuario },
            CODUSUARIO: { type: () => sql.Int, value: usuario.codUsuario },
            EMPRESAGESTION: { type: () => sql.Int, value: usuario.codEmpresa },
            FONDOCAJA: { type: () => sql.NVarChar(10), value: fondoCaja },
            FONDON: { type: () => sql.NVarChar(4), value: fondoN },
        });
        if (estado === 'ERROR')
            break;
    }
    return estado;
}
/** Port of `contabilizar.php` tipo=3 (costo de venta / compras). */
async function contabilizarCompras(bd, accountingDb, serieCaja, fecha, z, usuario) {
    return runStatusBatchConAsiento(bd, `DECLARE @ASIENTO AS INT
     DECLARE @ASIENTOVISIBLE AS INT
     DECLARE @REDONDEO AS INT = 2
     DECLARE @CODMONEDA AS INT
     DECLARE @FACTORMONEDA AS FLOAT
     DECLARE @USUARIO AS NVARCHAR(10) = SUBSTRING(@USUARIONOMBRE, 1, 10)

     SELECT @ASIENTO = MAX(ASIENTO + 1) FROM ${accountingDb}.dbo.CONTROLASIENTO
     SELECT @ASIENTOVISIBLE = VALOR + 1 FROM ${accountingDb}.dbo.PARAMETROS WHERE CLAVE = 'MASIV'
     SELECT TOP 1 @CODMONEDA = CODMONEDA, @FACTORMONEDA = ISNULL(1 / COTDEF, 1) FROM MONEDAS WHERE PRINCIPAL = 'T'

     INSERT INTO ${accountingDb}.dbo.DIARIOAPUNTES (
       USUARIO, ASIENTO, APUNTE, NIVEL, FECHA, CUENTA, CONCEPTO, COMENTARIO, SERIEDOCUMENTO, NUMERODOCUMENTO, DEBE, HABER, LIBROIVA,
       COSTES, PUNTEO, RETENCION, CENTROCOSTE, FACTORMONEDA, CODMONEDA, EMPRESAGESTION, DEBE1, HABER1, PNORMA43STR, ASIENTOVISIBLE,
       CODMONEDADC, TIPODOCUMENTO, SERIEFISCAL, CODTERCERO, TERCEROESCLIENTE, NUMEROFISCAL)
     SELECT @USUARIO, @ASIENTO, ROW_NUMBER() OVER (ORDER BY A.DEBE DESC), 'A', A.FECHA,
       A.CUENTA, A.CONCEPTO, UPPER(A.COMENTARIO), A.SERIEDOCUMENTO, A.NUMERODOCUMENTO,
       A.DEBE * @FACTORMONEDA, A.HABER * @FACTORMONEDA, NULL, NULL, NULL,
       'F', A.CENTROCOSTE, @FACTORMONEDA, @CODMONEDA, @EMPRESAGESTION,
       A.DEBE, A.HABER, NULL, @ASIENTOVISIBLE, NULL, NULL, NULL, NULL, NULL, NULL
     FROM (
       SELECT MAX(AVC.FECHA) FECHA, SUBSTRING(AVC.NUMSERIE, 3, 1) ASIENTO, ART.CONTRAPARTIDACOSTEVENTAS CUENTA,
         ISNULL(C.TITULO, 'NO DISPONILE') TITULO, 95 CONCEPTO,
         'CIERRE DE ' + S.DESCRIPCION + '(COMPRAS) DEL ' + CONVERT(CHAR(10), @FECHA, 103) COMENTARIO,
         SUBSTRING(AVC.NUMSERIE, 1, 3) SERIEDOCUMENTO, '' NUMERODOCUMENTO,
         CASE WHEN ROUND(SUM(AVL.COSTE * AVL.UNIDADESTOTAL), @REDONDEO) >= 0 THEN ROUND(SUM(AVL.COSTE * AVL.UNIDADESTOTAL), @REDONDEO) ELSE 0 END DEBE,
         CASE WHEN ROUND(SUM(AVL.COSTE * AVL.UNIDADESTOTAL), @REDONDEO) < 0 THEN ROUND(SUM(AVL.COSTE * AVL.UNIDADESTOTAL), @REDONDEO) * -1 ELSE 0 END HABER,
         SUBSTRING(@CAJA, 1, 2) + 'V' CENTROCOSTE
       FROM ALBVENTACAB AVC
         INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE = AVL.NUMSERIE AND AVC.NUMALBARAN = AVL.NUMALBARAN AND AVC.N = AVL.N
         LEFT JOIN ARTICULOS ART ON AVL.CODARTICULO = ART.CODARTICULO
         INNER JOIN SERIES S ON SUBSTRING(AVC.NUMSERIE, 1, 3) = S.SERIE
         LEFT JOIN ${accountingDb}.dbo.CUENTAS C ON ART.CONTRAPARTIDACOSTEVENTAS = C.CODIGO COLLATE Modern_Spanish_CI_AS
       WHERE AVC.NUMSERIE LIKE @CAJA AND LEN(@CAJA) > 2 AND AVC.FECHA = @FECHA AND ISNULL(ART.CONTRAPARTIDACOMPRA, '') <> ''
       GROUP BY ART.CONTRAPARTIDACOSTEVENTAS, S.DESCRIPCION, SUBSTRING(AVC.NUMSERIE, 1, 3), SUBSTRING(AVC.NUMSERIE, 3, 1), C.TITULO
       HAVING ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) <> 0
       UNION ALL
       SELECT MAX(AVC.FECHA), SUBSTRING(AVC.NUMSERIE, 3, 1), ART.CONTRAPARTIDACOMPRA,
         ISNULL(C.TITULO, 'NO DISPONILE'), 95,
         'CIERRE DE ' + S.DESCRIPCION + '(COMPRAS) DEL ' + CONVERT(CHAR(10), @FECHA, 103),
         SUBSTRING(AVC.NUMSERIE, 1, 3), '',
         CASE WHEN ROUND(SUM(AVL.COSTE * AVL.UNIDADESTOTAL), @REDONDEO) < 0 THEN ROUND(SUM(AVL.COSTE * AVL.UNIDADESTOTAL), @REDONDEO) * -1 ELSE 0 END,
         CASE WHEN ROUND(SUM(AVL.COSTE * AVL.UNIDADESTOTAL), @REDONDEO) >= 0 THEN ROUND(SUM(AVL.COSTE * AVL.UNIDADESTOTAL), @REDONDEO) ELSE 0 END,
         SUBSTRING(@CAJA, 1, 2) + 'V'
       FROM ALBVENTACAB AVC
         INNER JOIN ALBVENTALIN AVL ON AVC.NUMSERIE = AVL.NUMSERIE AND AVC.NUMALBARAN = AVL.NUMALBARAN AND AVC.N = AVL.N
         LEFT JOIN ARTICULOS ART ON AVL.CODARTICULO = ART.CODARTICULO
         INNER JOIN SERIES S ON SUBSTRING(AVC.NUMSERIE, 1, 3) = S.SERIE
         INNER JOIN ${accountingDb}.dbo.CUENTAS C ON ART.CONTRAPARTIDACOMPRA = C.CODIGO COLLATE Modern_Spanish_CI_AS
       WHERE AVC.NUMSERIE LIKE @CAJA AND AVC.Z = @Z AND LEN(@CAJA) > 2 AND AVC.FECHA = @FECHA
       GROUP BY ART.CONTRAPARTIDACOMPRA, S.DESCRIPCION, SUBSTRING(AVC.NUMSERIE, 1, 3), SUBSTRING(AVC.NUMSERIE, 3, 1), C.TITULO
       HAVING ROUND(SUM(AVL.TOTAL) - SUM(AVL.TOTAL * AVC.DTOCOMERCIAL / 100), @REDONDEO) <> 0
     ) A WHERE (HABER + DEBE <> 0) AND (CUENTA = '611201999' OR ((HABER > 0 OR HABER = 0) AND (DEBE > 0 OR DEBE = 0)))

     INSERT INTO ${accountingDb}.dbo.REGISTROAUDITORIA (
       FECHA, HORA, TIPO, CODEMPLEADO, SERIE, NUMERO, N, CODARTICULO, TALLA, COLOR, DESCRIPCION, UDS,
       PRECIO, PRECIOIVA, USUARIO, ASIENTO, APUNTE, NIVEL, CUENTA, CONCEPTO)
     SELECT CAST(GETDATE() AS DATE), GETDATE(), 51, @CODUSUARIO, '', 0, '', 0, '', '',
       LEFT((SELECT TOP 1 COMENTARIO FROM ${accountingDb}.dbo.DIARIOAPUNTES WHERE ASIENTO = @ASIENTO), ISNULL(COL_LENGTH('${accountingDb}.dbo.REGISTROAUDITORIA', 'DESCRIPCION') / 2, 45)), 0, 0, 0, @USUARIO,
       @ASIENTO, 0, 'A', '', 95

     INSERT INTO ${accountingDb}.dbo.CONTROLASIENTO(ASIENTO) VALUES (@ASIENTO)
     UPDATE ${accountingDb}.dbo.PARAMETROS SET VALOR = @ASIENTOVISIBLE WHERE CLAVE = 'MASIV'`, {
        CAJA: { type: () => sql.NVarChar(10), value: `${serieCaja.toUpperCase()}%` },
        FECHA: { type: () => sql.Date, value: parseYyyyMMdd(fecha) },
        Z: { type: () => sql.Int, value: z },
        USUARIONOMBRE: { type: () => sql.NVarChar(50), value: usuario.usuario },
        CODUSUARIO: { type: () => sql.Int, value: usuario.codUsuario },
        EMPRESAGESTION: { type: () => sql.Int, value: usuario.codEmpresa },
    });
}
/**
 * Port of the cursor at the end of `contabilizar.php`: recomputes
 * `GENERAL.dbo.EMPRESASCONTABLES.ASIENTO` for EVERY store in the tenant (not just the
 * one just processed) from each store's own accounting DB `CONTROLASIENTO`. Kept as a
 * faithful 1:1 port per explicit instruction — it is expensive (one dynamic UPDATE per
 * store) but some other part of the legacy suite may depend on this counter staying
 * fresh in real time.
 */
async function recalcularAsientosGlobal(bd) {
    await queryTenantRaw(bd, `DECLARE @CODEMPRESA AS INT
     DECLARE @BD AS NVARCHAR(30)
     DECLARE BD_CURSOR CURSOR FOR
       SELECT EC.CODIGO, SUBSTRING(EC.PATHBD, CHARINDEX(':', EC.PATHBD) + 1, LEN(EC.PATHBD)) + '.dbo.'
       FROM SERIES S
         INNER JOIN GENERAL.dbo.EMPRESASCONTABLES EC
           ON EC.CODIGO = CAST(SUBSTRING(S.CONTABILIDADB, 6, 3) AS INT) AND EC.EJERCICIO = CAST(SUBSTRING(S.CONTABILIDADB, 2, 4) AS INT)
         INNER JOIN SERIESCAMPOSLIBRES SCL ON S.SERIE = SCL.SERIE
       WHERE S.SERIE LIKE '__' AND (S.SERIE NOT LIKE 'Z%' OR S.SERIE LIKE 'ZIA')
     OPEN BD_CURSOR
     FETCH NEXT FROM BD_CURSOR INTO @CODEMPRESA, @BD
     WHILE @@FETCH_STATUS = 0
     BEGIN
       EXEC('UPDATE GENERAL.DBO.EMPRESASCONTABLES SET ASIENTO = ISNULL((SELECT MAX(ASIENTO) FROM ' + @BD + 'CONTROLASIENTO), 0) WHERE CODIGO = ' + @CODEMPRESA)
       FETCH NEXT FROM BD_CURSOR INTO @CODEMPRESA, @BD
     END
     CLOSE BD_CURSOR
     DEALLOCATE BD_CURSOR`);
}
export async function contabilizar(bd, usuario, params) {
    const accountingDb = await resolveBdContable(bd, params.serie);
    assertSafeDatabaseIdentifier(accountingDb);
    await ensureRipAsiento(accountingDb);
    let resultado;
    if (params.tipo === '1' && !params.fechaContable) {
        resultado = await contabilizarCajaSinFechaContable(bd, accountingDb, params.serieCaja, params.fecha, params.z, usuario);
    }
    else if (params.tipo === '1') {
        resultado = await contabilizarCajaConFechaContable(bd, accountingDb, params.serieCaja, params.fecha, params.fechaContable, params.z, usuario);
    }
    else if (params.tipo === '2') {
        // Un asiento por depósito: no hay un único número que mostrar.
        resultado = { asiento: null, asientoVisible: null, status: await contabilizarDepositos(bd, accountingDb, params.serie, params.fecha, params.fondoCaja ?? '', params.fondoN ?? '', params.fondoNumero ?? '', usuario) };
    }
    else {
        // La UI ya oculta el botón, pero una empresa sin costo de ventas no debe poder
        // postear el asiento de compras ni llamando a la API directamente.
        const { incluirCostoVenta } = await getConfiguracionCuentas(bd);
        if (!incluirCostoVenta)
            return { status: 'ERROR', asiento: null, asientoVisible: null };
        resultado = await contabilizarCompras(bd, accountingDb, params.serieCaja, params.fecha, params.z, usuario);
    }
    await recalcularAsientosGlobal(bd);
    resultado.procesadoPor = usuario.usuario;
    if (resultado.status === 'SUCCESS' && params.tipo !== '2') {
        resultado.resumen = await resumenCierre(bd, params.serieCaja, params.z);
    }
    return resultado;
}
/**
 * Caja, cajero y documentos de la caja/Z contabilizada, para la ventana de confirmación.
 * Mismo universo que marca el contabilizar (`FACTURASVENTA` con esa CAJA y Z); las de
 * total negativo son notas de crédito, mismo criterio que el Libro de Venta. Si la
 * consulta falla se devuelve null: el asiento ya quedó registrado y eso no debe verse
 * como un error.
 */
async function resumenCierre(bd, serieCaja, z) {
    try {
        const rows = await queryTenantRaw(bd, `SELECT
         (SELECT TOP 1 S.DESCRIPCION FROM SERIES S WHERE S.SERIE = @CAJA) AS CAJA,
         (SELECT TOP 1 V.NOMVENDEDOR
            FROM FACTURASVENTA F2 INNER JOIN VENDEDORES V ON F2.CODVENDEDOR = V.CODVENDEDOR
            WHERE F2.CAJA = @CAJA AND F2.Z = @Z
            GROUP BY V.NOMVENDEDOR ORDER BY COUNT(*) DESC) AS CAJERO,
         SUM(CASE WHEN FV.TOTALNETO >= 0 THEN 1 ELSE 0 END) AS FACTURAS,
         SUM(CASE WHEN FV.TOTALNETO < 0 THEN 1 ELSE 0 END) AS NOTASCREDITO
       FROM FACTURASVENTA FV
       WHERE FV.CAJA = @CAJA AND FV.Z = @Z`, {
            CAJA: { type: () => sql.NVarChar(10), value: serieCaja },
            Z: { type: () => sql.Int, value: z },
        });
        const r = rows[0] ?? {};
        return {
            caja: String(r.CAJA ?? serieCaja).trim(),
            cajero: String(r.CAJERO ?? '').trim(),
            z,
            facturas: Number(r.FACTURAS ?? 0),
            notasCredito: Number(r.NOTASCREDITO ?? 0),
        };
    }
    catch {
        return null;
    }
}
/**
 * Port of `descontabilizar.php`. **Fix over the legacy query**: the "already
 * reconciled, refuse to descontabilizar" guard used `PNORMA43STR != NULL` — in T-SQL
 * that comparison is never true regardless of the column's value, so the guard never
 * actually fired. Rewritten as `IS NOT NULL`, which is what the check clearly intended.
 */
export async function descontabilizarCierre(bd, params) {
    const accountingDb = await resolveBdContable(bd, params.serie);
    assertSafeDatabaseIdentifier(accountingDb);
    const fechaEfectiva = parseYyyyMMdd(params.fechaContable ?? params.fecha);
    const conciliados = await queryTenantRaw(bd, `SELECT * FROM ${accountingDb}.dbo.DIARIOAPUNTES
     WHERE FECHA = @FECHA AND SERIEDOCUMENTO = @CAJA AND COMENTARIO LIKE 'CIERRE DE CAJA%' AND CONCEPTO = 95
       AND PNORMA43STR IS NOT NULL AND PNORMA43STR != ''`, { FECHA: { type: () => sql.Date, value: fechaEfectiva }, CAJA: { type: () => sql.NVarChar(10), value: params.serieCaja } });
    if (conciliados.length > 0)
        return 'ERRORCONCILIACION';
    return runStatusBatch(bd, `UPDATE FACTURASVENTA SET TRASPASADA = 'F' WHERE CAJA = @CAJA AND Z = @Z AND TRASPASADA = 'T'
     DECLARE @ASIENTO AS INT
     SET @ASIENTO = (SELECT TOP (1) ASIENTO FROM ${accountingDb}.dbo.DIARIOAPUNTES WHERE FECHA = @FECHA AND SERIEDOCUMENTO = @CAJA AND COMENTARIO LIKE 'CIERRE DE CAJA%' AND CONCEPTO = 95)
     DELETE FROM ${accountingDb}.dbo.DIARIOAPUNTES WHERE FECHA = @FECHA AND SERIEDOCUMENTO = @CAJA AND COMENTARIO LIKE 'CIERRE DE CAJA%' AND CONCEPTO = 95
     DELETE FROM ${accountingDb}.dbo.REGISTROAUDITORIA WHERE ASIENTO = @ASIENTO AND CONCEPTO = 95`, {
        CAJA: { type: () => sql.NVarChar(10), value: params.serieCaja },
        FECHA: { type: () => sql.Date, value: fechaEfectiva },
        Z: { type: () => sql.Int, value: params.z },
    });
}
/** Port of `descontabilizar_deposito.php` — same `IS NOT NULL` fix as above. */
export async function descontabilizarDeposito(bd, params) {
    const accountingDb = await resolveBdContable(bd, params.serie);
    assertSafeDatabaseIdentifier(accountingDb);
    const fechaEfectiva = parseYyyyMMdd(params.fechaContable ?? params.fecha);
    const cajaLike = `${params.serieCaja.toUpperCase()}%`;
    const conciliados = await queryTenantRaw(bd, `SELECT * FROM ${accountingDb}.dbo.DIARIOAPUNTES
     WHERE FECHA = @FECHA AND SERIEDOCUMENTO LIKE @CAJA AND COMENTARIO LIKE 'DEP' + CHAR(211) + 'SITO/TRANSF. # %' AND CONCEPTO = 8
       AND PNORMA43STR IS NOT NULL AND PNORMA43STR != ''`, { FECHA: { type: () => sql.Date, value: fechaEfectiva }, CAJA: { type: () => sql.NVarChar(10), value: cajaLike } });
    if (conciliados.length > 0)
        return 'ERRORCONCILIACION';
    const fondoNumeroList = params.fondoNumero
        .split(',')
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n));
    return runStatusBatch(bd, `UPDATE FONDOCAJA SET NUMERODECLARADO = '0' WHERE CAJA = @FONDOCAJA AND NUMERO IN (${fondoNumeroList.join(',') || 'NULL'}) AND N = @FONDON
     DECLARE @ASIENTO AS INT
     SET @ASIENTO = (SELECT TOP (1) ASIENTO FROM ${accountingDb}.dbo.DIARIOAPUNTES WHERE FECHA = @FECHA AND SERIEDOCUMENTO LIKE @CAJA AND COMENTARIO LIKE 'DEP' + CHAR(211) + 'SITO/TRANSF. # %' AND CONCEPTO = 8)
     DELETE FROM ${accountingDb}.dbo.DIARIOAPUNTES WHERE FECHA = @FECHA AND SERIEDOCUMENTO LIKE @CAJA AND COMENTARIO LIKE 'DEP' + CHAR(211) + 'SITO/TRANSF. # %' AND CONCEPTO = 8
     DELETE FROM ${accountingDb}.dbo.REGISTROAUDITORIA WHERE ASIENTO = @ASIENTO AND CONCEPTO = 8`, {
        CAJA: { type: () => sql.NVarChar(10), value: cajaLike },
        FECHA: { type: () => sql.Date, value: fechaEfectiva },
        FONDOCAJA: { type: () => sql.NVarChar(10), value: params.fondoCaja },
        FONDON: { type: () => sql.NVarChar(4), value: params.fondoN },
    });
}
/** Port of `traspasar.php` — marks pending invoices as traspasada, no accounting entry. */
export async function traspasarFacturas(bd, serieCaja, z) {
    const result = await queryTenantRaw(bd, `UPDATE FACTURASVENTA SET TRASPASADA = 'T' OUTPUT 1 AS AFECTADAS WHERE CAJA = @CAJA AND Z = @Z AND TRASPASADA = 'F'`, { CAJA: { type: () => sql.NVarChar(10), value: serieCaja }, Z: { type: () => sql.Int, value: z } });
    return result.length > 0;
}
/** Port of `guardar_monto.php` — edits the declared amount for a (caja, z, tipo-de-pago). */
export async function guardarMontoDeclarado(bd, params) {
    const monedaRows = await queryTenantRaw(bd, `SELECT DISTINCT CODMONEDA
     FROM FORMASPAGO FP
       INNER JOIN VENCIMFPAGO VP ON FP.CODFORMAPAGO = VP.CODFORMAPAGO
       INNER JOIN TIPOSPAGO TP ON VP.CODTIPOPAGO = TP.CODTIPOPAGO
     WHERE TP.CODTIPOPAGO = @CODTIPOPAGO`, { CODTIPOPAGO: { type: () => sql.Int, value: params.codTipoPago } });
    const codMoneda = monedaRows[0]?.CODMONEDA ?? 1;
    const importe = params.nuevo; // legacy multiplies by FACTORMONEDA, which it hardcodes to 1 here
    const existentes = await queryTenantRaw(bd, `SELECT * FROM DECLARADOZ WHERE TIPO = 0 AND CODMONEDA = @CODMONEDA AND CAJA = @CAJA AND CODMEDIOPAGO = @CODTIPOPAGO AND NUMZ = @Z`, {
        CODMONEDA: { type: () => sql.Int, value: codMoneda },
        CAJA: { type: () => sql.NVarChar(10), value: params.caja },
        CODTIPOPAGO: { type: () => sql.NVarChar(6), value: String(params.codTipoPago) },
        Z: { type: () => sql.Int, value: params.z },
    });
    if (existentes.length === 0) {
        await queryTenantRaw(bd, `INSERT INTO DECLARADOZ (TIPO, CAJA, NUMZ, CODMONEDA, IMPORTE, CODMEDIOPAGO, OBSERVACIONES, IDMOTIVO, AUTO)
       VALUES ('0', @CAJA, @Z, @CODMONEDA, @IMPORTE, @CODTIPOPAGO, '', '0', '0')`, {
            CAJA: { type: () => sql.NVarChar(10), value: params.caja },
            Z: { type: () => sql.Int, value: params.z },
            CODMONEDA: { type: () => sql.Int, value: codMoneda },
            IMPORTE: { type: () => sql.Float, value: importe },
            CODTIPOPAGO: { type: () => sql.NVarChar(6), value: String(params.codTipoPago) },
        });
    }
    else {
        await queryTenantRaw(bd, `UPDATE DECLARADOZ SET IMPORTE = @IMPORTE
       WHERE TIPO = 0 AND CODMONEDA = @CODMONEDA AND CAJA = @CAJA AND CODMEDIOPAGO = @CODTIPOPAGO AND NUMZ = @Z`, {
            IMPORTE: { type: () => sql.Float, value: importe },
            CODMONEDA: { type: () => sql.Int, value: codMoneda },
            CAJA: { type: () => sql.NVarChar(10), value: params.caja },
            CODTIPOPAGO: { type: () => sql.NVarChar(6), value: String(params.codTipoPago) },
            Z: { type: () => sql.Int, value: params.z },
        });
    }
    return true;
}
/** Port of `guardar_forma_pago.php` — adds/edits a declared payment method (keyed by CODFORMAPAGO, not CODTIPOPAGO). */
export async function guardarFormaPago(bd, params) {
    const existentes = await queryTenantRaw(bd, `SELECT * FROM DECLARADOZ
     WHERE TIPO = 0 AND CAJA = @CAJA AND NUMZ = @Z
       AND CODMONEDA = (SELECT CODMONEDA FROM FORMASPAGO WHERE CODFORMAPAGO = @FORMA) AND CODMEDIOPAGO = @FORMA`, {
        CAJA: { type: () => sql.NVarChar(10), value: params.caja },
        Z: { type: () => sql.Int, value: params.z },
        FORMA: { type: () => sql.NVarChar(6), value: params.forma },
    });
    if (existentes.length > 0) {
        await queryTenantRaw(bd, `UPDATE DECLARADOZ SET IMPORTE = @MONTO
       WHERE TIPO = 0 AND CAJA = @CAJA AND NUMZ = @Z
         AND CODMONEDA = (SELECT CODMONEDA FROM FORMASPAGO WHERE CODFORMAPAGO = @FORMA) AND CODMEDIOPAGO = @FORMA`, {
            MONTO: { type: () => sql.Float, value: params.monto },
            CAJA: { type: () => sql.NVarChar(10), value: params.caja },
            Z: { type: () => sql.Int, value: params.z },
            FORMA: { type: () => sql.NVarChar(6), value: params.forma },
        });
    }
    else {
        await queryTenantRaw(bd, `INSERT INTO DECLARADOZ (TIPO, CAJA, NUMZ, CODMONEDA, IMPORTE, CODMEDIOPAGO, OBSERVACIONES, IDMOTIVO, AUTO)
       VALUES ('0', @CAJA, @Z, (SELECT CODMONEDA FROM FORMASPAGO WHERE CODFORMAPAGO = @FORMA), @MONTO, @FORMA, '', '0', '0')`, {
            CAJA: { type: () => sql.NVarChar(10), value: params.caja },
            Z: { type: () => sql.Int, value: params.z },
            FORMA: { type: () => sql.NVarChar(6), value: params.forma },
            MONTO: { type: () => sql.Float, value: params.monto },
        });
    }
    return true;
}
/** Port of `eliminar_forma_pago.php`. */
export async function eliminarFormaPago(bd, params) {
    await queryTenantRaw(bd, `DELETE FROM DECLARADOZ WHERE CAJA = @CAJA AND NUMZ = @Z AND CODMEDIOPAGO = @FORMA`, {
        CAJA: { type: () => sql.NVarChar(10), value: params.caja },
        Z: { type: () => sql.Int, value: params.z },
        FORMA: { type: () => sql.NVarChar(6), value: params.forma },
    });
    return true;
}
//# sourceMappingURL=cajas-mutaciones.repository.js.map