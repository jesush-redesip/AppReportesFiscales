import sql from 'mssql';
import { generalPool, generalPoolConnect } from '../db/general-pool.js';
import { MODULOS_ACTIVABLES, MODULOS_EXCLUSIVOS } from './modulos.js';

/**
 * Módulos activos de ESTA instalación (un grupo económico = una base GENERAL). Cada
 * grupo tiene los módulos básicos y algunos tienen otros exclusivos: el código es el
 * mismo para todos y aquí se decide qué existe en cada cliente. Lo cambia solo el
 * SUPERVISOR (la consultora).
 *
 * Dos niveles:
 *  - General (RIP_MODULOSACTIVOS): vale para todas las empresas del grupo. Sin fila, un
 *    módulo vale lo de fábrica: activo, salvo los de `MODULOS_EXCLUSIVOS`.
 *  - Excepciones por empresa (RIP_MODULOSEMPRESA): para una empresa puntual, un
 *    módulo activo o desactivado distinto de lo general. Sin fila, la empresa hereda lo
 *    general. Así las empresas de un grupo que no se manejan igual se configuran sin
 *    afectar a las demás.
 *
 * Desactivar no borra las asignaciones de los usuarios (RIP_PERMISOSMODULOS): al
 * reactivarlo, cada uno recupera lo que tenía. Los permisos de los usuarios son los
 * mismos en todas las empresas; lo que cambia por empresa es qué módulos existen.
 */

export interface EstadoModulo {
  id: string;
  nombre: string;
  grupo: string;
  exclusivo: boolean;
  /** Lo que vale para la empresa pedida (o lo general, si no se pidió empresa). */
  activo: boolean;
  /** Lo general de la instalación. */
  activoGeneral: boolean;
  /** Excepción de la empresa pedida: true/false, o null si hereda lo general. */
  excepcion: boolean | null;
}

export class ActivacionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivacionError';
  }
}

let tablasListas = false;

async function ensureTablas(): Promise<void> {
  if (tablasListas) return;
  await generalPoolConnect;
  await generalPool.request().query(
    `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RIP_MODULOSACTIVOS')
     BEGIN
       CREATE TABLE dbo.RIP_MODULOSACTIVOS (
         MODULO NVARCHAR(50) NOT NULL,
         ACTIVO BIT NOT NULL,
         FECHA DATETIME NOT NULL CONSTRAINT DF_RIP_MODULOSACTIVOS_FECHA DEFAULT (GETDATE()),
         USUARIO NVARCHAR(100) NULL,
         CONSTRAINT PK_RIP_MODULOSACTIVOS PRIMARY KEY (MODULO)
       ) ON [PRIMARY]
     END
     IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RIP_MODULOSEMPRESA')
     BEGIN
       CREATE TABLE dbo.RIP_MODULOSEMPRESA (
         CODEMPRESA INT NOT NULL,
         MODULO NVARCHAR(50) NOT NULL,
         ACTIVO BIT NOT NULL,
         FECHA DATETIME NOT NULL CONSTRAINT DF_RIP_MODULOSEMPRESA_FECHA DEFAULT (GETDATE()),
         USUARIO NVARCHAR(100) NULL,
         CONSTRAINT PK_RIP_MODULOSEMPRESA PRIMARY KEY (CODEMPRESA, MODULO)
       ) ON [PRIMARY]
     END`,
  );
  tablasListas = true;
}

/** Se lee en cada petición que lo necesita: unos segundos de caché bastan. */
const CACHE_MS = 15 * 1000;
let cache: { hasta: number; general: Map<string, boolean>; empresas: Map<number, Map<string, boolean>> } | null = null;

async function leer() {
  if (cache && cache.hasta > Date.now()) return cache;
  await ensureTablas();
  const [g, e] = await Promise.all([
    generalPool.request().query('SELECT MODULO, ACTIVO FROM dbo.RIP_MODULOSACTIVOS'),
    generalPool.request().query('SELECT CODEMPRESA, MODULO, ACTIVO FROM dbo.RIP_MODULOSEMPRESA'),
  ]);
  const bit = (v: unknown) => v === true || v === 1;
  const general = new Map<string, boolean>(g.recordset.map((f) => [String(f.MODULO ?? '').trim(), bit(f.ACTIVO)]));
  const empresas = new Map<number, Map<string, boolean>>();
  for (const f of e.recordset) {
    const cod = Number(f.CODEMPRESA);
    if (!empresas.has(cod)) empresas.set(cod, new Map());
    empresas.get(cod)!.set(String(f.MODULO ?? '').trim(), bit(f.ACTIVO));
  }
  cache = { hasta: Date.now() + CACHE_MS, general, empresas };
  return cache;
}

/** Estado de cada módulo: lo general y, si se indica `codEmpresa`, su excepción y lo que vale ahí. */
export async function estadoModulos(codEmpresa?: number): Promise<EstadoModulo[]> {
  const { general, empresas } = await leer();
  const propias = codEmpresa === undefined ? undefined : empresas.get(codEmpresa);
  return MODULOS_ACTIVABLES.map((m) => {
    const exclusivo = MODULOS_EXCLUSIVOS.has(m.id);
    const activoGeneral = general.get(m.id) ?? !exclusivo;
    const excepcion = propias?.has(m.id) ? propias.get(m.id)! : null;
    return { ...m, exclusivo, activoGeneral, excepcion, activo: excepcion ?? activoGeneral };
  });
}

/**
 * Módulos activos para una empresa (lo general más sus excepciones). Sin empresa: lo
 * general.
 */
export async function modulosActivos(codEmpresa?: number): Promise<Set<string>> {
  return new Set((await estadoModulos(codEmpresa)).filter((m) => m.activo).map((m) => m.id));
}

/**
 * Módulos activos en AL MENOS una empresa (lo general o alguna excepción). Para la
 * ventana de permisos: un módulo que solo tiene una empresa se puede asignar igual.
 */
export async function modulosActivosEnAlguna(): Promise<Set<string>> {
  const { empresas } = await leer();
  const activos = await modulosActivos();
  for (const propias of empresas.values()) for (const [id, activo] of propias) if (activo) activos.add(id);
  return activos;
}

export async function estaActivo(id: string, codEmpresa?: number): Promise<boolean> {
  return (await modulosActivos(codEmpresa)).has(id);
}

/** Cuántas excepciones tiene cada empresa (para marcar en la lista de empresas). */
export async function excepcionesPorEmpresa(): Promise<Record<number, number>> {
  const { empresas } = await leer();
  return Object.fromEntries([...empresas.entries()].map(([cod, m]) => [cod, m.size]));
}

export interface CambioActivacion {
  id: string;
  nombre: string;
  /** null = hereda lo general (solo en excepciones por empresa). */
  antes: boolean | null;
  despues: boolean | null;
}

/**
 * Guarda solo lo que cambió y devuelve esos cambios (para la auditoría).
 *  - Sin `codEmpresa`: lo general (activo true/false).
 *  - Con `codEmpresa`: la excepción de esa empresa; `activo: null` la quita (vuelve a
 *    heredar lo general).
 */
export async function guardarActivacion(
  items: { id: string; activo: boolean | null }[],
  usuario: string | null,
  codEmpresa?: number,
): Promise<CambioActivacion[]> {
  const actual = new Map((await estadoModulos(codEmpresa)).map((m) => [m.id, m]));
  const cambios: CambioActivacion[] = [];
  for (const it of items) {
    const m = actual.get(it.id);
    if (!m) throw new ActivacionError(`El módulo "${it.id}" no existe.`);
    if (codEmpresa === undefined) {
      if (it.activo === null) throw new ActivacionError('Lo general no puede quedar sin valor.');
      if (m.activoGeneral !== it.activo) cambios.push({ id: m.id, nombre: m.nombre, antes: m.activoGeneral, despues: it.activo });
    } else if (m.excepcion !== it.activo) {
      cambios.push({ id: m.id, nombre: m.nombre, antes: m.excepcion, despues: it.activo });
    }
  }
  if (cambios.length === 0) return [];

  const transaction = new sql.Transaction(generalPool);
  await transaction.begin();
  try {
    for (const c of cambios) {
      const req = new sql.Request(transaction);
      req.input('MODULO', sql.NVarChar(50), c.id);
      req.input('ACTIVO', sql.Bit, c.despues);
      req.input('USUARIO', sql.NVarChar(100), usuario?.slice(0, 100) ?? null);
      if (codEmpresa === undefined) {
        // eslint-disable-next-line no-await-in-loop
        await req.query(
          `UPDATE dbo.RIP_MODULOSACTIVOS SET ACTIVO = @ACTIVO, FECHA = GETDATE(), USUARIO = @USUARIO WHERE MODULO = @MODULO;
           IF @@ROWCOUNT = 0 INSERT INTO dbo.RIP_MODULOSACTIVOS (MODULO, ACTIVO, USUARIO) VALUES (@MODULO, @ACTIVO, @USUARIO);`,
        );
      } else {
        req.input('CODEMPRESA', sql.Int, codEmpresa);
        // eslint-disable-next-line no-await-in-loop
        await req.query(
          c.despues === null
            ? `DELETE FROM dbo.RIP_MODULOSEMPRESA WHERE CODEMPRESA = @CODEMPRESA AND MODULO = @MODULO;`
            : `UPDATE dbo.RIP_MODULOSEMPRESA SET ACTIVO = @ACTIVO, FECHA = GETDATE(), USUARIO = @USUARIO
                 WHERE CODEMPRESA = @CODEMPRESA AND MODULO = @MODULO;
               IF @@ROWCOUNT = 0 INSERT INTO dbo.RIP_MODULOSEMPRESA (CODEMPRESA, MODULO, ACTIVO, USUARIO)
                 VALUES (@CODEMPRESA, @MODULO, @ACTIVO, @USUARIO);`,
        );
      }
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  } finally {
    cache = null;
  }
  return cambios;
}
