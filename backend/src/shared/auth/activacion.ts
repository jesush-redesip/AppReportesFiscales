import sql from 'mssql';
import { generalPool, generalPoolConnect } from '../db/general-pool.js';
import { MODULOS_ACTIVABLES, MODULOS_EXCLUSIVOS } from './modulos.js';

/**
 * Módulos activos de ESTA instalación (un grupo económico = una base GENERAL). Cada
 * grupo tiene los módulos básicos y algunos tienen otros exclusivos: el código es el
 * mismo para todos y aquí se decide qué existe en cada cliente. Lo cambia solo el
 * SUPERVISOR (la consultora).
 *
 * Sin fila, un módulo vale lo de fábrica: activo, salvo los de `MODULOS_EXCLUSIVOS`.
 * Así las instalaciones existentes siguen igual y un módulo exclusivo nuevo no
 * aparece en los clientes que no lo tienen.
 *
 * Desactivar no borra las asignaciones de los usuarios (RIP_PERMISOSMODULOS): al
 * reactivarlo, cada uno recupera lo que tenía.
 */

export interface EstadoModulo {
  id: string;
  nombre: string;
  grupo: string;
  exclusivo: boolean;
  activo: boolean;
}

export class ActivacionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivacionError';
  }
}

let tablaLista = false;

async function ensureTabla(): Promise<void> {
  if (tablaLista) return;
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
     END`,
  );
  tablaLista = true;
}

/** Se lee en cada petición que lo necesita: unos segundos de caché bastan. */
const CACHE_MS = 15 * 1000;
let cache: { hasta: number; activos: Set<string> } | null = null;

export async function estadoModulos(): Promise<EstadoModulo[]> {
  await ensureTabla();
  const r = await generalPool.request().query('SELECT MODULO, ACTIVO FROM dbo.RIP_MODULOSACTIVOS');
  const guardado = new Map<string, boolean>(
    r.recordset.map((f) => [String(f.MODULO ?? '').trim(), f.ACTIVO === true || f.ACTIVO === 1]),
  );
  return MODULOS_ACTIVABLES.map((m) => {
    const exclusivo = MODULOS_EXCLUSIVOS.has(m.id);
    return { ...m, exclusivo, activo: guardado.get(m.id) ?? !exclusivo };
  });
}

export async function modulosActivos(): Promise<Set<string>> {
  if (cache && cache.hasta > Date.now()) return cache.activos;
  const activos = new Set((await estadoModulos()).filter((m) => m.activo).map((m) => m.id));
  cache = { hasta: Date.now() + CACHE_MS, activos };
  return activos;
}

export async function estaActivo(id: string): Promise<boolean> {
  return (await modulosActivos()).has(id);
}

/** Guarda solo lo que cambió y devuelve esos cambios (para la auditoría). */
export async function guardarActivacion(
  items: { id: string; activo: boolean }[],
  usuario: string | null,
): Promise<{ id: string; nombre: string; antes: boolean; despues: boolean }[]> {
  const actual = new Map((await estadoModulos()).map((m) => [m.id, m]));
  const cambios: { id: string; nombre: string; antes: boolean; despues: boolean }[] = [];
  for (const it of items) {
    const m = actual.get(it.id);
    if (!m) throw new ActivacionError(`El módulo "${it.id}" no existe.`);
    if (m.activo !== it.activo) cambios.push({ id: m.id, nombre: m.nombre, antes: m.activo, despues: it.activo });
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
      // eslint-disable-next-line no-await-in-loop
      await req.query(
        `UPDATE dbo.RIP_MODULOSACTIVOS SET ACTIVO = @ACTIVO, FECHA = GETDATE(), USUARIO = @USUARIO WHERE MODULO = @MODULO;
         IF @@ROWCOUNT = 0 INSERT INTO dbo.RIP_MODULOSACTIVOS (MODULO, ACTIVO, USUARIO) VALUES (@MODULO, @ACTIVO, @USUARIO);`,
      );
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
