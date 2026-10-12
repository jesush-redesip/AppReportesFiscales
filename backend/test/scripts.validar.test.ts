import { describe, expect, it } from 'vitest';
import { analizarScript, sentenciaRestauracion } from '../src/modules/scripts-sql/scripts.validar.js';

describe('analizarScript: lo permitido', () => {
  it('procedimiento con UPDATE y DELETE dentro del cuerpo (no se ejecutan al aplicar)', () => {
    const r = analizarScript(`SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
/* comentario */
ALTER PROCEDURE [rip].[MR_LIBRO_VENTA] @DESDE DATE AS
BEGIN
  DELETE FROM #T
  UPDATE X SET A = 1
END
GO`);
    expect(r.ok).toBe(true);
    expect(r.objetos).toEqual([{ nombre: 'rip.MR_LIBRO_VENTA', tipo: 'PROCEDIMIENTO', accion: 'MODIFICAR' }]);
    expect(r.lotes).toHaveLength(3);
  });

  it('patrón del aplicativo: esquema + stub + ALTER', () => {
    const r = analizarScript(`IF SCHEMA_ID('rip') IS NULL EXEC('CREATE SCHEMA rip');
GO
IF OBJECT_ID('rip.MR_X', 'P') IS NULL
  EXEC('CREATE PROCEDURE rip.MR_X AS RETURN 0');
GO
ALTER PROCEDURE rip.MR_X AS SELECT 1
GO`);
    expect(r.ok).toBe(true);
    expect(r.objetos).toContainEqual({ nombre: 'rip.MR_X', tipo: 'PROCEDIMIENTO', accion: 'CREAR_O_MODIFICAR' });
    expect(r.objetos).toContainEqual({ nombre: 'rip', tipo: 'ESQUEMA', accion: 'CREAR_ESQUEMA' });
  });

  it('función y vista, CREATE OR ALTER, sin esquema (dbo)', () => {
    const r = analizarScript(`CREATE OR ALTER FUNCTION RIP_VENTAS(@A INT) RETURNS TABLE AS RETURN (SELECT 1 AS X)
GO
create view dbo.V_PRUEBA as select 1 as a`);
    expect(r.ok).toBe(true);
    expect(r.objetos.map((o) => `${o.tipo}:${o.nombre}:${o.accion}`)).toEqual([
      'FUNCION:dbo.RIP_VENTAS:CREAR_O_MODIFICAR',
      'VISTA:dbo.V_PRUEBA:CREAR',
    ]);
  });

  it('borrar un procedimiento', () => {
    const r = analizarScript(`IF OBJECT_ID('rip.MR_VIEJO') IS NOT NULL DROP PROCEDURE rip.MR_VIEJO
GO
DROP FUNCTION IF EXISTS dbo.F1, dbo.F2`);
    expect(r.ok).toBe(true);
    expect(r.objetos.map((o) => `${o.nombre}:${o.accion}`)).toEqual(['rip.MR_VIEJO:BORRAR', 'dbo.F1:BORRAR', 'dbo.F2:BORRAR']);
  });
});

describe('analizarScript: lo rechazado', () => {
  it.each([
    ['UPDATE suelto', 'UPDATE FACTURASVENTA SET TRASPASADA = 1'],
    ['DELETE suelto', 'DELETE FROM DIARIOAPUNTES'],
    ['DROP TABLE', 'DROP TABLE CLIENTES'],
    ['USE de otra base', 'USE GENERAL'],
    ['EXEC arbitrario', "EXEC('DELETE FROM T')"],
    ['CREATE TABLE', 'CREATE TABLE T (A INT)'],
    ['TRUNCATE', 'TRUNCATE TABLE T'],
  ])('%s', (_n, sql) => {
    const r = analizarScript(sql);
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatch(/no permitido/);
  });

  it('un DELETE antes del ALTER en el mismo lote', () => {
    const r = analizarScript('DELETE FROM T\nALTER PROCEDURE rip.X AS SELECT 1');
    expect(r.ok).toBe(false);
  });

  it('un UPDATE en un lote aparte, después del procedimiento', () => {
    const r = analizarScript('ALTER PROCEDURE rip.X AS SELECT 1\nGO\nUPDATE T SET A = 1\nGO');
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatch(/Lote 2/);
  });

  it('SET y ALTER en el mismo lote (SQL Server lo rechazaría)', () => {
    const r = analizarScript('SET ANSI_NULLS ON\nALTER PROCEDURE rip.X AS SELECT 1');
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatch(/principio del lote/);
  });

  it('stub de esquema con sentencias extra', () => {
    const r = analizarScript("IF SCHEMA_ID('x') IS NULL EXEC('CREATE SCHEMA x; DROP TABLE T')");
    expect(r.ok).toBe(false);
  });

  it('script sin objetos', () => {
    expect(analizarScript('SET NOCOUNT ON').ok).toBe(false);
    expect(analizarScript('   ').ok).toBe(false);
  });
});

describe('sentenciaRestauracion', () => {
  it('ALTER si existe, CREATE si no, respetando comentarios previos', () => {
    const def = '/* versión del cliente */\nCREATE PROCEDURE rip.X AS SELECT 1';
    expect(sentenciaRestauracion(def, true)).toBe('/* versión del cliente */\nALTER PROCEDURE rip.X AS SELECT 1');
    expect(sentenciaRestauracion('ALTER FUNCTION dbo.F() RETURNS INT AS BEGIN RETURN 1 END', false)).toMatch(/^CREATE FUNCTION/);
  });
});
