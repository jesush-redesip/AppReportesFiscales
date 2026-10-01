import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { env } from '../../config/env.js';
import { RAIZ_APP, versionInstalada } from '../../shared/app-info.js';
import { registrarAuditoria } from '../../shared/auditoria/auditoria.js';

/**
 * Actualizador: compara la versión instalada (version.json) con el último Release del
 * repositorio público de GitHub (UPDATE_REPO) y, si el SUPERVISOR lo pide, descarga el
 * .zip, verifica su SHA-256, lo descomprime y lanza scripts/actualizar.ps1 (del paquete
 * NUEVO) fuera del servicio. Ese script detiene el servicio, respalda, reemplaza
 * backend/dist, frontend/dist y templates (nunca .env ni logs), instala dependencias si
 * cambiaron, arranca y, si la versión nueva no responde, vuelve a la anterior.
 *
 * Carpetas de trabajo dentro de la instalación:
 *   _actualizaciones/<tag>/  paquete descargado y descomprimido + log
 *   _actualizaciones/estado.json  resultado de la última actualización (lo escribe el script)
 *   _respaldos/<versión>_<fecha>/  copia de lo reemplazado (se guardan las 3 últimas)
 */

const execFileP = promisify(execFile);

export const DIR_ACTUALIZACIONES = path.join(RAIZ_APP, '_actualizaciones');
const ARCHIVO_ESTADO = path.join(DIR_ACTUALIZACIONES, 'estado.json');
const NOMBRE_TAREA = 'ReportesFiscales-Actualizar';
/** reportes-fiscales-v1.2.3.zip */
const PATRON_ZIP = /^reportes-fiscales-v?(\d+\.\d+\.\d+)\.zip$/i;
const MAX_ZIP = 300 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;

export class ActualizadorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActualizadorError';
  }
}

interface AssetGithub {
  name: string;
  size: number;
  browser_download_url: string;
  /** "sha256:<hex>" (GitHub lo calcula al subir el archivo). */
  digest?: string | null;
}

interface ReleaseGithub {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  assets: AssetGithub[];
}

export interface VersionDisponible {
  version: string;
  tag: string;
  nombre: string;
  notas: string;
  fecha: string | null;
  url: string;
  tamano: number;
}

export interface ResultadoAnterior {
  estado: 'en-curso' | 'ok' | 'error';
  desde?: string;
  hasta?: string;
  mensaje?: string;
  fecha?: string;
  /** Ya quedó en la auditoría (lo marca el backend al arrancar). */
  auditado?: boolean;
}

export interface EstadoActualizador {
  versionActual: string;
  repo: string;
  /** Hay repositorio configurado (UPDATE_REPO). */
  configurado: boolean;
  /** Corre como servicio de Windows: solo así se puede actualizar desde el botón. */
  comoServicio: boolean;
  ultima: VersionDisponible | null;
  hayNueva: boolean;
  enCurso: boolean;
  ultimoResultado: ResultadoAnterior | null;
  error: string | null;
}

/** 1.10.0 > 1.9.3. Solo números (los Releases marcados como pre-release no llegan aquí). */
export function compararVersiones(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function cabecerasGithub(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'reportes-fiscales-actualizador',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (env.actualizador.tokenGithub) h.Authorization = `Bearer ${env.actualizador.tokenGithub}`;
  return h;
}

let cache: { hasta: number; release: ReleaseGithub | null } | null = null;

async function ultimoRelease(forzar: boolean): Promise<ReleaseGithub | null> {
  if (!forzar && cache && cache.hasta > Date.now()) return cache.release;
  const repo = env.actualizador.repo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ActualizadorError(`UPDATE_REPO no es válido ("${repo}"); debe ser "usuario/repositorio".`);
  let resp: Response;
  try {
    resp = await fetch(`${env.actualizador.apiGithub}/repos/${repo}/releases/latest`, {
      headers: cabecerasGithub(),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new ActualizadorError(`No se pudo conectar con GitHub: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (resp.status === 404) {
    // Repositorio sin Releases publicados (o inexistente).
    cache = { hasta: Date.now() + CACHE_MS, release: null };
    return null;
  }
  if (resp.status === 403 || resp.status === 429) {
    throw new ActualizadorError('GitHub rechazó la consulta por límite de peticiones; intente en unos minutos (o configure GITHUB_TOKEN).');
  }
  if (!resp.ok) throw new ActualizadorError(`GitHub respondió ${resp.status} al consultar el último Release.`);
  const release = (await resp.json()) as ReleaseGithub;
  cache = { hasta: Date.now() + CACHE_MS, release };
  return release;
}

function zipDe(release: ReleaseGithub): { asset: AssetGithub; version: string } | null {
  for (const asset of release.assets ?? []) {
    const m = PATRON_ZIP.exec(asset.name);
    if (m) return { asset, version: m[1] };
  }
  return null;
}

function aDisponible(release: ReleaseGithub): VersionDisponible | null {
  const zip = zipDe(release);
  if (!zip) return null;
  return {
    version: zip.version,
    tag: release.tag_name,
    nombre: release.name || release.tag_name,
    notas: release.body ?? '',
    fecha: release.published_at,
    url: release.html_url,
    tamano: zip.asset.size,
  };
}

function leerResultadoAnterior(): ResultadoAnterior | null {
  try {
    const texto = fs.readFileSync(ARCHIVO_ESTADO, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(texto) as ResultadoAnterior;
  } catch {
    return null;
  }
}

async function corriendoComoServicio(): Promise<boolean> {
  const servicio = env.actualizador.servicio;
  if (process.platform !== 'win32' || !env.produccion || !servicio) return false;
  try {
    const { stdout } = await execFileP('sc.exe', ['query', servicio], { windowsHide: true });
    return /RUNNING/i.test(stdout);
  } catch {
    return false;
  }
}

let enCurso = false;

export async function consultarEstado(forzar: boolean): Promise<EstadoActualizador> {
  const versionActual = versionInstalada();
  // El script escribe el resultado DESPUÉS de que arranca la versión nueva: se audita aquí
  // (la pantalla consulta el estado al terminar) y no solo al arrancar.
  await auditarResultadoActualizacion();
  const base: EstadoActualizador = {
    versionActual,
    repo: env.actualizador.repo,
    configurado: Boolean(env.actualizador.repo),
    comoServicio: await corriendoComoServicio(),
    ultima: null,
    hayNueva: false,
    enCurso,
    ultimoResultado: leerResultadoAnterior(),
    error: null,
  };
  if (!base.configurado) return base;
  try {
    const release = await ultimoRelease(forzar);
    if (release) {
      base.ultima = aDisponible(release);
      if (!base.ultima) base.error = `El Release ${release.tag_name} no trae un archivo reportes-fiscales-vX.Y.Z.zip.`;
    }
    base.hayNueva = Boolean(base.ultima && compararVersiones(base.ultima.version, versionActual) > 0);
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
  }
  return base;
}

/** SHA-256 esperado: el que calcula GitHub (digest) o, si no viene, el archivo .sha256 del Release. */
async function shaEsperado(release: ReleaseGithub, asset: AssetGithub): Promise<string> {
  const digest = asset.digest?.match(/^sha256:([0-9a-f]{64})$/i)?.[1];
  if (digest) return digest.toLowerCase();
  const archivoSha = release.assets.find((a) => a.name.toLowerCase() === `${asset.name.toLowerCase()}.sha256`);
  if (!archivoSha) throw new ActualizadorError(`El Release no trae ${asset.name}.sha256 para verificar el paquete.`);
  const resp = await fetch(archivoSha.browser_download_url, { headers: { 'User-Agent': 'reportes-fiscales-actualizador' }, signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new ActualizadorError(`No se pudo descargar ${archivoSha.name} (${resp.status}).`);
  const hex = (await resp.text()).match(/[0-9a-f]{64}/i)?.[0];
  if (!hex) throw new ActualizadorError(`${archivoSha.name} no contiene un SHA-256 válido.`);
  return hex.toLowerCase();
}

async function descargar(url: string, destino: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'User-Agent': 'reportes-fiscales-actualizador' }, signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!resp.ok || !resp.body) throw new ActualizadorError(`No se pudo descargar el paquete (${resp.status}).`);
  const hash = createHash('sha256');
  let bytes = 0;
  const cuerpo = Readable.fromWeb(resp.body as import('node:stream/web').ReadableStream);
  cuerpo.on('data', (trozo: Buffer) => {
    bytes += trozo.length;
    if (bytes > MAX_ZIP) cuerpo.destroy(new ActualizadorError('El paquete supera el tamaño máximo permitido.'));
    hash.update(trozo);
  });
  await pipeline(cuerpo, fs.createWriteStream(destino));
  return hash.digest('hex');
}

/** tar.exe de Windows (bsdtar) descomprime .zip y rechaza rutas absolutas o con "..". */
async function descomprimir(zip: string, destino: string): Promise<void> {
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  fs.mkdirSync(destino, { recursive: true });
  try {
    await execFileP(tar, ['-xf', zip, '-C', destino], { windowsHide: true, timeout: 5 * 60 * 1000 });
  } catch (err) {
    throw new ActualizadorError(`No se pudo descomprimir el paquete: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validarPaquete(dir: string, version: string): void {
  const faltan = ['version.json', 'backend/dist/server.js', 'backend/package.json', 'frontend/dist/index.html', 'scripts/actualizar.ps1']
    .filter((rel) => !fs.existsSync(path.join(dir, rel)));
  if (faltan.length) throw new ActualizadorError(`El paquete está incompleto, falta: ${faltan.join(', ')}.`);
  const delPaquete = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8').replace(/^\uFEFF/, '')).version;
  if (delPaquete !== version) {
    throw new ActualizadorError(`El paquete dice ser la versión ${delPaquete}, pero el archivo es de la ${version}.`);
  }
}

/**
 * El script corre como tarea programada (SYSTEM), fuera del árbol de procesos del
 * servicio: al detener el servicio no se lo lleva por delante. Si no se puede crear la
 * tarea, se lanza desacoplado como respaldo.
 */
async function lanzarScript(dirTrabajo: string, dirNuevo: string): Promise<void> {
  const script = path.join(dirTrabajo, 'actualizar.ps1');
  fs.copyFileSync(path.join(dirNuevo, 'scripts', 'actualizar.ps1'), script);
  const lanzador = path.join(dirTrabajo, 'ejecutar.cmd');
  const args = `-Origen "${dirNuevo}" -Destino "${RAIZ_APP}" -Servicio "${env.actualizador.servicio}" -Puerto ${env.port}`;
  fs.writeFileSync(
    lanzador,
    `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}" ${args}\r\n`,
    'ascii',
  );
  try {
    await execFileP('schtasks.exe', ['/Create', '/TN', NOMBRE_TAREA, '/TR', `"${lanzador}"`, '/SC', 'ONCE', '/ST', '00:00', '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/F'], { windowsHide: true });
    await execFileP('schtasks.exe', ['/Run', '/TN', NOMBRE_TAREA], { windowsHide: true });
  } catch {
    const hijo = spawn('cmd.exe', ['/c', 'start', '""', '/min', lanzador], { detached: true, stdio: 'ignore', windowsHide: true });
    hijo.unref();
  }
}

/**
 * Descarga el .zip del último Release, verifica su SHA-256, lo descomprime y revisa que
 * esté completo. No toca la instalación: solo escribe en _actualizaciones/v<versión>/.
 */
export async function prepararPaquete(): Promise<{ desde: string; version: string; dirTrabajo: string; dirNuevo: string }> {
  const release = await ultimoRelease(true);
  if (!release) throw new ActualizadorError('El repositorio no tiene Releases publicados.');
  const zip = zipDe(release);
  if (!zip) throw new ActualizadorError(`El Release ${release.tag_name} no trae un archivo reportes-fiscales-vX.Y.Z.zip.`);
  const desde = versionInstalada();
  if (compararVersiones(zip.version, desde) <= 0) throw new ActualizadorError(`Ya tiene la versión ${desde}; no hay nada nuevo.`);
  if (zip.asset.size > MAX_ZIP) throw new ActualizadorError('El paquete supera el tamaño máximo permitido.');

  const dirTrabajo = path.join(DIR_ACTUALIZACIONES, `v${zip.version}`);
  fs.rmSync(dirTrabajo, { recursive: true, force: true });
  fs.mkdirSync(dirTrabajo, { recursive: true });
  const archivoZip = path.join(dirTrabajo, zip.asset.name);

  const esperado = await shaEsperado(release, zip.asset);
  const obtenido = await descargar(zip.asset.browser_download_url, archivoZip);
  if (obtenido !== esperado) {
    throw new ActualizadorError('El paquete descargado no coincide con su SHA-256: puede estar dañado o alterado. No se instaló nada.');
  }
  const dirNuevo = path.join(dirTrabajo, 'nuevo');
  await descomprimir(archivoZip, dirNuevo);
  validarPaquete(dirNuevo, zip.version);

  return { desde, version: zip.version, dirTrabajo, dirNuevo };
}

export async function iniciarActualizacion(): Promise<{ desde: string; hasta: string; mensaje: string }> {
  const anterior = leerResultadoAnterior();
  if (enCurso || (anterior?.estado === 'en-curso' && esReciente(anterior.fecha))) {
    throw new ActualizadorError('Ya hay una actualización en curso.');
  }
  if (!env.actualizador.repo) throw new ActualizadorError('No hay repositorio de actualizaciones configurado (UPDATE_REPO en el .env).');
  if (!(await corriendoComoServicio())) {
    throw new ActualizadorError(
      `Solo se puede actualizar desde aquí cuando el aplicativo corre como servicio de Windows ("${env.actualizador.servicio || 'SERVICE_NAME'}"). ` +
        'En desarrollo actualice con git / npm.',
    );
  }
  enCurso = true;
  try {
    const { desde, version, dirTrabajo, dirNuevo } = await prepararPaquete();
    fs.writeFileSync(
      ARCHIVO_ESTADO,
      JSON.stringify({ estado: 'en-curso', desde, hasta: version, mensaje: 'Iniciando…', fecha: ahora() } satisfies ResultadoAnterior, null, 2),
    );
    await lanzarScript(dirTrabajo, dirNuevo);
    return {
      desde,
      hasta: version,
      mensaje: `Actualizando de la versión ${desde} a la ${version}. El servicio se reiniciará en unos segundos.`,
    };
  } catch (err) {
    enCurso = false;
    throw err;
  }
}

function ahora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Un "en-curso" de hace más de 15 minutos quedó colgado (p. ej. se apagó el equipo). */
function esReciente(fecha: string | undefined): boolean {
  if (!fecha) return false;
  const t = new Date(fecha.replace(' ', 'T')).getTime();
  return Number.isFinite(t) && Date.now() - t < 15 * 60 * 1000;
}

/**
 * Al arrancar: si el script dejó el resultado de una actualización (ok o error) que aún no
 * está en la auditoría, se registra como acción del sistema y se marca para no repetirla.
 */
export async function auditarResultadoActualizacion(): Promise<void> {
  const r = leerResultadoAnterior();
  if (!r || r.auditado || (r.estado !== 'ok' && r.estado !== 'error')) return;
  // Se marca antes de registrar: dos consultas a la vez no la auditan dos veces.
  try {
    fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify({ ...r, auditado: true }, null, 2));
  } catch {
    return; // Sin permiso de escritura no se audita (se repetiría en cada consulta).
  }
  await registrarAuditoria({
    codUsuario: null,
    usuario: 'SISTEMA',
    codEmpresa: null,
    bd: null,
    accion: 'Actualización del aplicativo (resultado)',
    detalle: { cambios: [{ antes: r.desde ?? null, despues: r.hasta ?? null }], fecha: r.fecha ?? null },
    resultado: r.estado === 'ok' ? 'OK' : 'ERROR',
    mensaje: r.mensaje ?? null,
    metodo: '-',
    ruta: 'actualizar.ps1',
    ip: null,
  });
}
