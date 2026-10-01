import sql from 'mssql';
import { queryTenantRaw, withTenantTransaction } from '../../shared/db/tenant-pool.js';

/**
 * Cierre de Caja › Configuración › "Formas de pago del asiento".
 *
 * Tres tablas de la base de gestión, que usa dbo.RIP_COBROS_FRONT para armar el comentario
 * de cada línea de cobro ("CIERRE DE CAJA 1 DEL dd/mm/aaaa <nombre>"):
 *   - FORMASPAGO (ICG): las formas de pago reales.
 *   - RIP_FORMASPAGOS (id, descripcion): catálogo de nombres para el asiento.
 *   - RIP_RELACIONFORMASPAGO (CODFORMAPAGO, IDFORMAPAGO): qué nombre lleva cada forma.
 * Sin relación, la forma de pago sale como '***' en el asiento.
 *
 * Funciona aunque no se haya aplicado ALTER_FORMASPAGOS_*.sql: descripcion puede seguir
 * siendo nchar (se recorta al leer y comparar) y las tablas pueden no tener clave ni
 * índice único (se garantiza una relación por código borrando antes de insertar, en una
 * transacción). Las comparaciones de CODFORMAPAGO usan COLLATE DATABASE_DEFAULT porque
 * FORMASPAGO y la tabla puente tienen intercalaciones distintas.
 */

export interface FormaPagoAsiento {
  codFormaPago: string;
  descripcion: string;
  idFormaPago: number | null;
  nombre: string | null;
}

export interface NombreAsiento {
  id: number;
  descripcion: string;
  /** Cuántas formas de pago de ICG lo usan. */
  enUso: number;
}

export interface CambioRelacion {
  codFormaPago: string;
  formaPago: string;
  antes: string | null;
  despues: string | null;
}

export class FormasPagoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormasPagoError';
  }
}

/** Largo máximo del nombre: el de la columna (100) y algo razonable para un comentario. */
export const MAX_NOMBRE = 60;

async function verificarTablas(bd: string): Promise<void> {
  const rows = await queryTenantRaw<{ FALTAN: string | null }>(
    bd,
    `SELECT STUFF(
       CASE WHEN OBJECT_ID('dbo.RIP_FORMASPAGOS') IS NULL THEN ', RIP_FORMASPAGOS' ELSE '' END +
       CASE WHEN OBJECT_ID('dbo.RIP_RELACIONFORMASPAGO') IS NULL THEN ', RIP_RELACIONFORMASPAGO' ELSE '' END, 1, 2, '') AS FALTAN`,
  );
  const faltan = rows[0]?.FALTAN;
  if (faltan) throw new FormasPagoError(`La base "${bd}" no tiene ${faltan}. Ejecute el script de verificación de la instalación.`);
}

export async function listarFormasPago(bd: string): Promise<{ formas: FormaPagoAsiento[]; catalogo: NombreAsiento[] }> {
  await verificarTablas(bd);
  const formas = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT F.CODFORMAPAGO, F.DESCRIPCION, P.id AS IDFORMAPAGO, LTRIM(RTRIM(P.descripcion)) AS NOMBRE
     FROM dbo.FORMASPAGO F
       OUTER APPLY (SELECT TOP 1 R.IDFORMAPAGO FROM dbo.RIP_RELACIONFORMASPAGO R
                    WHERE R.CODFORMAPAGO COLLATE DATABASE_DEFAULT = F.CODFORMAPAGO COLLATE DATABASE_DEFAULT) R
       LEFT JOIN dbo.RIP_FORMASPAGOS P ON P.id = R.IDFORMAPAGO
     ORDER BY TRY_CAST(F.CODFORMAPAGO AS INT), F.CODFORMAPAGO`,
  );
  const catalogo = await queryTenantRaw<Record<string, unknown>>(
    bd,
    `SELECT P.id, LTRIM(RTRIM(P.descripcion)) AS DESCRIPCION,
            (SELECT COUNT(*) FROM dbo.RIP_RELACIONFORMASPAGO R WHERE R.IDFORMAPAGO = P.id) AS ENUSO
     FROM dbo.RIP_FORMASPAGOS P
     ORDER BY LTRIM(RTRIM(P.descripcion))`,
  );
  return {
    formas: formas.map((r) => ({
      codFormaPago: String(r.CODFORMAPAGO ?? '').trim(),
      descripcion: String(r.DESCRIPCION ?? '').trim(),
      idFormaPago: r.IDFORMAPAGO == null ? null : Number(r.IDFORMAPAGO),
      nombre: r.NOMBRE == null ? null : String(r.NOMBRE),
    })),
    catalogo: catalogo.map((r) => ({ id: Number(r.id), descripcion: String(r.DESCRIPCION ?? ''), enUso: Number(r.ENUSO ?? 0) })),
  };
}

/**
 * Guarda las relaciones indicadas (solo las que cambiaron, las manda el frontend).
 * `idFormaPago = null` quita la relación (la forma sale '***'). Todo o nada.
 */
export async function guardarRelaciones(
  bd: string,
  items: { codFormaPago: string; idFormaPago: number | null }[],
): Promise<CambioRelacion[]> {
  await verificarTablas(bd);
  const actual = await listarFormasPago(bd);
  const porCodigo = new Map(actual.formas.map((f) => [f.codFormaPago, f]));
  const nombres = new Map(actual.catalogo.map((c) => [c.id, c.descripcion]));

  const cambios: CambioRelacion[] = [];
  for (const it of items) {
    const forma = porCodigo.get(it.codFormaPago.trim());
    if (!forma) throw new FormasPagoError(`La forma de pago "${it.codFormaPago}" no existe en FORMASPAGO.`);
    if (it.idFormaPago != null && !nombres.has(it.idFormaPago)) {
      throw new FormasPagoError(`El nombre con id ${it.idFormaPago} no existe en el catálogo.`);
    }
    if (forma.idFormaPago === it.idFormaPago) continue;
    cambios.push({
      codFormaPago: forma.codFormaPago,
      formaPago: forma.descripcion,
      antes: forma.nombre,
      despues: it.idFormaPago == null ? null : (nombres.get(it.idFormaPago) ?? null),
    });
  }
  if (cambios.length === 0) return [];

  await withTenantTransaction(bd, async (nuevaRequest) => {
    for (const c of cambios) {
      const del = nuevaRequest();
      del.input('COD', sql.NVarChar(12), c.codFormaPago);
      // eslint-disable-next-line no-await-in-loop
      await del.query(
        'DELETE FROM dbo.RIP_RELACIONFORMASPAGO WHERE CODFORMAPAGO COLLATE DATABASE_DEFAULT = @COD COLLATE DATABASE_DEFAULT',
      );
      const id = items.find((i) => i.codFormaPago.trim() === c.codFormaPago)?.idFormaPago ?? null;
      if (id != null) {
        const ins = nuevaRequest();
        ins.input('COD', sql.NVarChar(12), c.codFormaPago);
        ins.input('ID', sql.Int, id);
        // eslint-disable-next-line no-await-in-loop
        await ins.query('INSERT INTO dbo.RIP_RELACIONFORMASPAGO (CODFORMAPAGO, IDFORMAPAGO) VALUES (@COD, @ID)');
      }
    }
  });
  return cambios;
}

function limpiarNombre(texto: string): string {
  // Sin espacios sobrantes: fue lo que dejó "PAGO MOVIL <66 espacios> PAGO MOVIL".
  const limpio = texto.replace(/\s+/g, ' ').trim().toUpperCase();
  if (!limpio) throw new FormasPagoError('El nombre no puede estar vacío.');
  if (limpio.length > MAX_NOMBRE) throw new FormasPagoError(`El nombre no puede pasar de ${MAX_NOMBRE} caracteres.`);
  return limpio;
}

async function nombreRepetido(nuevaRequest: () => sql.Request, nombre: string, excluirId: number | null): Promise<boolean> {
  const req = nuevaRequest();
  req.input('NOMBRE', sql.NVarChar(100), nombre);
  req.input('ID', sql.Int, excluirId);
  const r = await req.query(
    `SELECT TOP 1 1 AS X FROM dbo.RIP_FORMASPAGOS WITH (UPDLOCK, HOLDLOCK)
     WHERE UPPER(LTRIM(RTRIM(descripcion))) = @NOMBRE AND (@ID IS NULL OR id <> @ID)`,
  );
  return r.recordset.length > 0;
}

/** Agrega un nombre al catálogo. El id es MAX + 1 (la tabla no tiene IDENTITY). */
export async function crearNombre(bd: string, texto: string): Promise<NombreAsiento> {
  await verificarTablas(bd);
  const nombre = limpiarNombre(texto);
  return withTenantTransaction(bd, async (nuevaRequest) => {
    if (await nombreRepetido(nuevaRequest, nombre, null)) throw new FormasPagoError(`Ya existe el nombre "${nombre}".`);
    const req = nuevaRequest();
    req.input('NOMBRE', sql.NVarChar(100), nombre);
    const r = await req.query(
      `DECLARE @ID INT = (SELECT ISNULL(MAX(id), 0) + 1 FROM dbo.RIP_FORMASPAGOS WITH (UPDLOCK, HOLDLOCK));
       INSERT INTO dbo.RIP_FORMASPAGOS (id, descripcion) VALUES (@ID, @NOMBRE);
       SELECT @ID AS ID;`,
    );
    return { id: Number(r.recordset[0].ID), descripcion: nombre, enUso: 0 };
  });
}

/** Cambia el texto de un nombre; afecta a todas las formas de pago que lo usan. */
export async function renombrar(bd: string, id: number, texto: string): Promise<{ antes: string; despues: string }> {
  await verificarTablas(bd);
  const nombre = limpiarNombre(texto);
  return withTenantTransaction(bd, async (nuevaRequest) => {
    const sel = nuevaRequest();
    sel.input('ID', sql.Int, id);
    const actual = await sel.query('SELECT LTRIM(RTRIM(descripcion)) AS D FROM dbo.RIP_FORMASPAGOS WITH (UPDLOCK) WHERE id = @ID');
    if (actual.recordset.length === 0) throw new FormasPagoError(`El nombre con id ${id} no existe.`);
    if (await nombreRepetido(nuevaRequest, nombre, id)) throw new FormasPagoError(`Ya existe el nombre "${nombre}".`);
    const upd = nuevaRequest();
    upd.input('ID', sql.Int, id);
    upd.input('NOMBRE', sql.NVarChar(100), nombre);
    await upd.query('UPDATE dbo.RIP_FORMASPAGOS SET descripcion = @NOMBRE WHERE id = @ID');
    return { antes: String(actual.recordset[0].D ?? ''), despues: nombre };
  });
}

/** Borra un nombre del catálogo, solo si ninguna forma de pago lo usa. */
export async function eliminarNombre(bd: string, id: number): Promise<{ eliminado: string }> {
  await verificarTablas(bd);
  return withTenantTransaction(bd, async (nuevaRequest) => {
    const req = nuevaRequest();
    req.input('ID', sql.Int, id);
    const r = await req.query(
      `SELECT LTRIM(RTRIM(descripcion)) AS D,
              (SELECT COUNT(*) FROM dbo.RIP_RELACIONFORMASPAGO WITH (UPDLOCK, HOLDLOCK) WHERE IDFORMAPAGO = @ID) AS USO
       FROM dbo.RIP_FORMASPAGOS WHERE id = @ID`,
    );
    if (r.recordset.length === 0) throw new FormasPagoError(`El nombre con id ${id} no existe.`);
    if (Number(r.recordset[0].USO) > 0) {
      throw new FormasPagoError('No se puede eliminar: hay formas de pago que usan este nombre. Cámbielas primero.');
    }
    const del = nuevaRequest();
    del.input('ID', sql.Int, id);
    await del.query('DELETE FROM dbo.RIP_FORMASPAGOS WHERE id = @ID');
    return { eliminado: String(r.recordset[0].D ?? '') };
  });
}
