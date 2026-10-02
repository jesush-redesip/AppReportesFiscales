import sql from 'mssql';
import { generalPool, generalPoolConnect } from '../../shared/db/general-pool.js';
import {
  esModuloReporte,
  esModuloValido,
  MODULO_CAJAS,
  PERMISO_CONFIG_CAJAS,
  PERMISO_SUPERVISOR_INTERNO,
} from '../../shared/auth/modulos.js';
import { CODUSUARIO_SUPERVISOR, getModulosPorUsuario, reemplazarModulosUsuario } from '../../shared/auth/permisos.js';
import { modulosActivos } from '../../shared/auth/activacion.js';
import type { UsuarioPermisos } from './permisos.schema.js';

export class ModuloInvalidoError extends Error {
  constructor(modulo: string) {
    super(`El módulo "${modulo}" no existe.`);
    this.name = 'ModuloInvalidoError';
  }
}

/** Lo que el supervisor interno no puede hacer en esta pantalla. */
export class PermisoDenegadoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermisoDenegadoError';
  }
}

/** Quién está guardando: el SUPERVISOR o un supervisor interno. */
export interface Administrador {
  codUsuario: number;
  esSupervisor: boolean;
}

const truthy = (v: unknown) => v === 1 || String(v ?? '').trim() === '1';

/**
 * Driven from GENERAL.dbo.USUARIOS (the real ICG identity Aplicativo-Web logs in
 * against — see auth.repository.ts), LEFT JOINed to RIP_PERMISOSUSUARIOS, not from
 * RIP_LOGUEO (reportesicg's own bolted-on login table, unrelated to how this app
 * authenticates). Confirmed live against a representative production GENERAL: most
 * users have no RIP_PERMISOSUSUARIOS row at all (only CODUSUARIO=0 "SUPERVISOR" did)
 * — those show up here with all three flags false, and saving upserts (see
 * updatePermisos) instead of assuming the row already exists.
 *
 * RIP_PERMISOSUSUARIOS mixes column types for historical reasons: VISUALIZARCAJAS
 * and DESCONTABILIZAR are INT (0/1), but CONTABILIZAR is NVARCHAR(1) ('0'/'1') —
 * confirmed live, not a typo to "fix".
 */
export async function listUsuariosConPermisos(admin: Administrador): Promise<UsuarioPermisos[]> {
  await generalPoolConnect;
  const [result, modulosPorUsuario] = await Promise.all([
    generalPool.request().query(`
      SELECT U.CODUSUARIO, U.USUARIO, P.VISUALIZARCAJAS, P.CONTABILIZAR, P.DESCONTABILIZAR
      FROM dbo.USUARIOS U
      LEFT JOIN dbo.RIP_PERMISOSUSUARIOS P ON P.CODUSUARIO = U.CODUSUARIO
      ORDER BY U.USUARIO
    `),
    getModulosPorUsuario(),
  ]);
  // El supervisor interno no ve (ni puede editar) al SUPERVISOR de la consultora.
  const filas = admin.esSupervisor ? result.recordset : result.recordset.filter((r) => r.CODUSUARIO !== CODUSUARIO_SUPERVISOR);
  return filas.map((r) => ({
    codUsuario: r.CODUSUARIO,
    usuario: String(r.USUARIO ?? '').trim(),
    visualizarCajas: truthy(r.VISUALIZARCAJAS),
    contabilizar: truthy(r.CONTABILIZAR),
    descontabilizar: truthy(r.DESCONTABILIZAR),
    modulos: modulosPorUsuario.get(r.CODUSUARIO) ?? [],
  }));
}

/**
 * Upserts each user's 3 Cajas flags inside a single transaction. The legacy
 * `guardar_configuracion_usuarios.php` looped a bare UPDATE per user with no
 * transaction and reported success based only on the LAST iteration's row count —
 * a failure partway through left some users updated and others not, unreported.
 * Other columns on INSERT (VISUALIZARPAGARES, etc.) all have DB-level defaults
 * (confirmed live), so omitting them here is safe.
 */
export async function updatePermisos(items: Array<Omit<UsuarioPermisos, 'usuario'>>, admin: Administrador): Promise<void> {
  // Se validan TODOS los módulos antes de abrir la transacción: así un id inválido
  // falla sin haber tocado nada, en vez de a mitad del guardado.
  for (const item of items) {
    if (!admin.esSupervisor && item.codUsuario === CODUSUARIO_SUPERVISOR) {
      throw new PermisoDenegadoError('No puede modificar los permisos del SUPERVISOR.');
    }
    for (const modulo of item.modulos) {
      if (!esModuloValido(modulo)) throw new ModuloInvalidoError(modulo);
    }
  }

  // Lo que no se ve en la pantalla se conserva tal cual estaba: los módulos desactivados
  // en la instalación, el Cierre de Caja si está desactivado, y la marca de supervisor
  // interno cuando quien guarda no es el SUPERVISOR.
  const [actuales, activos] = await Promise.all([listUsuariosConPermisos({ ...admin, esSupervisor: true }), modulosActivos()]);
  const porCodigo = new Map(actuales.map((u) => [u.codUsuario, u]));
  const cajasActivo = activos.has(MODULO_CAJAS);
  items = items.map((item) => {
    const previo = porCodigo.get(item.codUsuario);
    const antes = previo?.modulos ?? [];
    const flags = cajasActivo
      ? { visualizarCajas: item.visualizarCajas, contabilizar: item.contabilizar, descontabilizar: item.descontabilizar }
      : {
          visualizarCajas: previo?.visualizarCajas ?? false,
          contabilizar: previo?.contabilizar ?? false,
          descontabilizar: previo?.descontabilizar ?? false,
        };
    const oculto = (m: string) =>
      (esModuloReporte(m) && !activos.has(m)) ||
      (m === PERMISO_CONFIG_CAJAS && !cajasActivo) ||
      (m === PERMISO_SUPERVISOR_INTERNO && (!admin.esSupervisor || item.codUsuario === CODUSUARIO_SUPERVISOR));
    const modulos = [...new Set([...item.modulos.filter((m) => !oculto(m)), ...antes.filter((m) => oculto(m))])].filter(
      // El SUPERVISOR nunca es supervisor interno: ya lo puede todo.
      (m) => !(m === PERMISO_SUPERVISOR_INTERNO && item.codUsuario === CODUSUARIO_SUPERVISOR),
    );
    return { codUsuario: item.codUsuario, ...flags, modulos };
  });

  await generalPoolConnect;
  const transaction = new sql.Transaction(generalPool);
  await transaction.begin();
  try {
    for (const item of items) {
      const updateRequest = new sql.Request(transaction);
      updateRequest.input('CODUSUARIO', sql.Int, item.codUsuario);
      updateRequest.input('VISUALIZARCAJAS', sql.Int, item.visualizarCajas ? 1 : 0);
      updateRequest.input('CONTABILIZAR', sql.NVarChar(1), item.contabilizar ? '1' : '0');
      updateRequest.input('DESCONTABILIZAR', sql.Int, item.descontabilizar ? 1 : 0);
      const result = await updateRequest.query(`
        UPDATE dbo.RIP_PERMISOSUSUARIOS
        SET VISUALIZARCAJAS = @VISUALIZARCAJAS, CONTABILIZAR = @CONTABILIZAR, DESCONTABILIZAR = @DESCONTABILIZAR
        WHERE CODUSUARIO = @CODUSUARIO
      `);

      if (result.rowsAffected[0] === 0) {
        const insertRequest = new sql.Request(transaction);
        insertRequest.input('CODUSUARIO', sql.Int, item.codUsuario);
        insertRequest.input('VISUALIZARCAJAS', sql.Int, item.visualizarCajas ? 1 : 0);
        insertRequest.input('CONTABILIZAR', sql.NVarChar(1), item.contabilizar ? '1' : '0');
        insertRequest.input('DESCONTABILIZAR', sql.Int, item.descontabilizar ? 1 : 0);
        await insertRequest.query(`
          INSERT INTO dbo.RIP_PERMISOSUSUARIOS (CODUSUARIO, VISUALIZARCAJAS, CONTABILIZAR, DESCONTABILIZAR)
          VALUES (@CODUSUARIO, @VISUALIZARCAJAS, @CONTABILIZAR, @DESCONTABILIZAR)
        `);
      }

      // eslint-disable-next-line no-await-in-loop
      // Sin acceso al Cierre de Caja, su Configuración no tiene sentido: se descarta en vez
      // de dejar un permiso que reaparecería activo si se rehabilita el cierre.
      const modulos = item.visualizarCajas ? item.modulos : item.modulos.filter((m) => m !== PERMISO_CONFIG_CAJAS);
      await reemplazarModulosUsuario(transaction, item.codUsuario, modulos);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
