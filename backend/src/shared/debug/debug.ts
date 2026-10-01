import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sql from 'mssql';

/**
 * Modo debug: el SUPERVISOR lo enciende y apaga en caliente con el botón del header
 * (POST /api/debug/estado). Arrancar con `npm run dev:debug` (flag `--debug`) o con
 * `DEBUG_MODE=1` solo cambia el estado inicial. Apagado, la captura sigue instalada
 * pero no registra nada (una comparación por consulta). El estado vive en memoria: al
 * reiniciar el backend vuelve al valor de arranque.
 */
let activo = process.argv.includes('--debug') || process.env.DEBUG_MODE === '1';

export function estaDebugActivo(): boolean {
  return activo;
}

export function setDebugActivo(valor: boolean): void {
  activo = valor;
  // eslint-disable-next-line no-console
  console.log(valor ? '[33m[DEBUG] Modo debug ACTIVADO[0m' : '[33m[DEBUG] Modo debug desactivado[0m');
}

export interface ContextoPeticion {
  reqId: string;
}

/** Vincula cada consulta SQL con la petición HTTP que la originó. */
export const contextoPeticion = new AsyncLocalStorage<ContextoPeticion>();

export interface ParametroSql {
  nombre: string;
  tipo: string;
  valor: unknown;
}

interface EventoBase {
  id: number;
  fecha: string;
  reqId: string | null;
  ms: number;
  error: string | null;
}

export interface EventoSql extends EventoBase {
  tipo: 'sql';
  bd: string;
  /** `query` (SQL en línea) o `execute` (procedimiento almacenado). */
  modo: 'query' | 'execute';
  texto: string;
  parametros: ParametroSql[];
  filas: number[] | null;
  filasAfectadas: number[] | null;
  /** DECLAREs + consulta, listo para pegar en SSMS y reproducir. */
  script: string;
}

export interface EventoApi extends EventoBase {
  tipo: 'api';
  metodo: string;
  url: string;
  estado: number;
  usuario: string | null;
  bd: string | null;
  cuerpo: unknown;
  respuesta: string | null;
}

export type EventoDebug = EventoSql | EventoApi;

const MAX_EVENTOS = 1000;
const MAX_RESPUESTA = 4000;
const eventos: EventoDebug[] = [];
let ultimoId = 0;

const DIR_LOGS = path.resolve(process.cwd(), 'logs');
let dirLogsListo: Promise<unknown> | null = null;

/** Nombres de parámetros y campos que nunca se muestran ni se escriben al log. */
const SENSIBLE = /pass|clave|contra|token|secret/i;

export function redactar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(redactar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, SENSIBLE.test(k) ? '***' : redactar(v)]),
    );
  }
  return valor;
}

export function registrarEvento(evento: Omit<EventoSql, 'id' | 'fecha'> | Omit<EventoApi, 'id' | 'fecha'>): void {
  const completo = { ...evento, id: ++ultimoId, fecha: new Date().toISOString() } as EventoDebug;
  eventos.push(completo);
  if (eventos.length > MAX_EVENTOS) eventos.splice(0, eventos.length - MAX_EVENTOS);
  imprimirEnConsola(completo);
  void escribirEnArchivo(completo);
}

export function eventosDesde(desde: number): { eventos: EventoDebug[]; ultimoId: number } {
  return { eventos: eventos.filter((e) => e.id > desde), ultimoId };
}

export function limpiarEventos(): void {
  eventos.length = 0;
}

function resumen(texto: string, max = 110): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length > max ? `${plano.slice(0, max)}…` : plano;
}

function imprimirEnConsola(e: EventoDebug): void {
  const rojo = '\x1b[31m';
  const gris = '\x1b[90m';
  const cian = '\x1b[36m';
  const reset = '\x1b[0m';
  const color = e.error ? rojo : cian;
  const linea =
    e.tipo === 'sql'
      ? `${color}[SQL ${e.modo}]${reset} ${e.bd} ${gris}${e.ms}ms${reset} ${e.filas ? `${e.filas.join('+')} filas ` : ''}${resumen(e.texto)}`
      : `${color}[API]${reset} ${e.metodo} ${e.url} → ${e.estado} ${gris}${e.ms}ms${reset}${e.usuario ? ` ${e.usuario}@${e.bd}` : ''}`;
  // eslint-disable-next-line no-console
  console.log(e.error ? `${linea}\n  ${rojo}${e.error}${reset}` : linea);
}

async function escribirEnArchivo(e: EventoDebug): Promise<void> {
  try {
    dirLogsListo ??= mkdir(DIR_LOGS, { recursive: true });
    await dirLogsListo;
    const archivo = path.join(DIR_LOGS, `debug-${e.fecha.slice(0, 10)}.log`);
    await appendFile(archivo, `${JSON.stringify(e)}\n`, 'utf8');
  } catch {
    // Un fallo al escribir el log nunca debe romper la petición que se está depurando.
  }
}

// --- Captura de consultas SQL -------------------------------------------------------

interface ParametroMssql {
  name: string;
  type?: { declaration?: string; name?: string };
  length?: number;
  precision?: number;
  scale?: number;
  value: unknown;
}

/** Tipo T-SQL legible (`nvarchar(20)`, `decimal(18,2)`) a partir del parámetro de mssql. */
function tipoSql(p: ParametroMssql): string {
  const base = (p.type?.declaration ?? p.type?.name ?? 'sql_variant').toLowerCase();
  if (/char|binary/.test(base)) {
    const largo = p.length === undefined || p.length > 4000 || p.length === sql.MAX ? 'max' : p.length;
    return `${base}(${largo})`;
  }
  if (/decimal|numeric/.test(base) && p.precision !== undefined) return `${base}(${p.precision},${p.scale ?? 0})`;
  return base;
}

function literalSql(valor: unknown, tipo: string): string {
  if (valor === null || valor === undefined) return 'NULL';
  if (typeof valor === 'boolean') return valor ? '1' : '0';
  if (typeof valor === 'number' || typeof valor === 'bigint') return String(valor);
  if (valor instanceof Date) {
    const iso = valor.toISOString();
    return `'${tipo === 'date' ? iso.slice(0, 10) : iso.replace('T', ' ').replace('Z', '')}'`;
  }
  return `N'${String(valor).replaceAll("'", "''")}'`;
}

function armarScript(bd: string, modo: 'query' | 'execute', texto: string, parametros: ParametroSql[]): string {
  const declaraciones = parametros.map((p) => `DECLARE @${p.nombre} ${p.tipo} = ${literalSql(p.valor, p.tipo)};`);
  const cuerpo =
    modo === 'execute'
      ? `EXEC ${texto} ${parametros.map((p) => `@${p.nombre} = @${p.nombre}`).join(', ')};`
      : texto.trim();
  return [`USE [${bd}];`, ...declaraciones, '', cuerpo].join('\n');
}

/** Base de datos de la conexión de un Request (pool directo o dentro de una transacción). */
function bdDelRequest(req: sql.Request): string {
  const parent = (req as unknown as { parent?: { config?: sql.config; parent?: { config?: sql.config } } }).parent;
  return parent?.config?.database ?? parent?.parent?.config?.database ?? '?';
}

let instrumentado = false;

/**
 * Envuelve `Request.prototype.query` y `.execute` de mssql: así se registra TODA
 * consulta de la app (repositorios, transacciones, pools de GENERAL y de cada
 * empresa) sin tocar ninguno de los ~50 puntos donde se arma un Request.
 */
export function instrumentarMssql(): void {
  if (instrumentado) return;
  instrumentado = true;

  const proto = sql.Request.prototype as unknown as Record<'query' | 'execute', (...args: unknown[]) => unknown>;
  for (const modo of ['query', 'execute'] as const) {
    const original = proto[modo];
    proto[modo] = function envuelto(this: sql.Request, ...args: unknown[]) {
      // Debug apagado, o la forma con callback (no se usa en la app): pasa sin registrar.
      if (!activo || typeof args[args.length - 1] === 'function') return original.apply(this, args);

      const inicio = Date.now();
      const texto = String(args[0] ?? '');
      const bd = bdDelRequest(this);
      const crudos = Object.values((this as unknown as { parameters: Record<string, ParametroMssql> }).parameters ?? {});
      const parametros: ParametroSql[] = crudos.map((p) => ({
        nombre: p.name,
        tipo: tipoSql(p),
        valor: SENSIBLE.test(p.name) ? '***' : p.value,
      }));
      const reqId = contextoPeticion.getStore()?.reqId ?? null;
      const base = { tipo: 'sql' as const, bd, modo, texto, parametros, reqId, script: armarScript(bd, modo, texto, parametros) };

      const promesa = original.apply(this, args) as Promise<sql.IResult<unknown>>;
      return promesa.then(
        (resultado) => {
          registrarEvento({
            ...base,
            ms: Date.now() - inicio,
            error: null,
            filas: (resultado.recordsets as unknown[][] | undefined)?.map((r) => r.length) ?? null,
            filasAfectadas: resultado.rowsAffected ?? null,
          });
          return resultado;
        },
        (err: { message?: string; number?: number; lineNumber?: number }) => {
          const detalle = [err.number ? `Msg ${err.number}` : '', err.lineNumber ? `línea ${err.lineNumber}` : '']
            .filter(Boolean)
            .join(', ');
          registrarEvento({
            ...base,
            ms: Date.now() - inicio,
            error: `${err.message ?? String(err)}${detalle ? ` (${detalle})` : ''}`,
            filas: null,
            filasAfectadas: null,
          });
          throw err;
        },
      );
    };
  }
}

export function recortarRespuesta(payload: unknown): string | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload !== 'string') return '[binario / archivo]';
  let texto = payload;
  try {
    texto = JSON.stringify(redactar(JSON.parse(payload)));
  } catch {
    // No es JSON: se muestra tal cual.
  }
  return texto.length > MAX_RESPUESTA ? `${texto.slice(0, MAX_RESPUESTA)}… (${texto.length} caracteres)` : texto;
}
