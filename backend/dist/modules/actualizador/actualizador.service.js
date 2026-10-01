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
 * Actualizador: GitHub hace de puente. El repositorio público (UPDATE_REPO) lleva el
 * código Y el compilado (backend/dist, frontend/dist); `scripts/publicar.ps1` sube la
 * versión en version.json, compila y hace push a la rama UPDATE_BRANCH (main).
 *
 * El backend compara el version.json de la punta de esa rama con el instalado. Si el
 * SUPERVISOR lo pide, descarga el zip de ESE commit exacto (no de "main", que podría
 * moverse en medio), lo descomprime y lanza scripts/actualizar.ps1 (del paquete NUEVO)
 * fuera del servicio. Ese script detiene el servicio, respalda, reemplaza backend/dist,
 * frontend/dist y templates (nunca .env ni logs), instala dependencias si cambiaron,
 * arranca y, si la versión nueva no responde, vuelve a la anterior.
 *
 * Solo API de GitHub (sin token: 60 consultas/hora por IP; se cachea 10 minutos):
 *   GET /repos/:repo/commits/:rama               commit de la punta
 *   GET /repos/:repo/contents/version.json?ref=  versión de ese commit
 *   GET /repos/:repo/contents/CAMBIOS.md?ref=    novedades (solo si hay versión nueva)
 *   GET /repos/:repo/zipball/:sha                el zip (redirige a codeload.github.com)
 *
 * Carpetas de trabajo dentro de la instalación:
 *   _actualizaciones/v<versión>/  zip descargado y descomprimido
 *   _actualizaciones/estado.json  resultado de la última actualización (lo escribe el script)
 *   _respaldos/<versión>_<fecha>/  copia de lo reemplazado (se guardan las 3 últimas)
 */
const execFileP = promisify(execFile);
export const DIR_ACTUALIZACIONES = path.join(RAIZ_APP, '_actualizaciones');
const ARCHIVO_ESTADO = path.join(DIR_ACTUALIZACIONES, 'estado.json');
const NOMBRE_TAREA = 'ReportesFiscales-Actualizar';
const MAX_ZIP = 300 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;
export class ActualizadorError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ActualizadorError';
    }
}
/** 1.10.0 > 1.9.3. Solo números. */
export function compararVersiones(a, b) {
    const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0)
            return d > 0 ? 1 : -1;
    }
    return 0;
}
function cabecerasGithub(accept = 'application/vnd.github+json') {
    const h = {
        Accept: accept,
        'User-Agent': 'reportes-fiscales-actualizador',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (env.actualizador.tokenGithub)
        h.Authorization = `Bearer ${env.actualizador.tokenGithub}`;
    return h;
}
function urlRepo() {
    const repo = env.actualizador.repo;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
        throw new ActualizadorError(`UPDATE_REPO no es válido ("${repo}"); debe ser "usuario/repositorio".`);
    return `${env.actualizador.apiGithub}/repos/${repo}`;
}
async function pedirGithub(url, accept) {
    let resp;
    try {
        resp = await fetch(url, { headers: cabecerasGithub(accept), signal: AbortSignal.timeout(15000) });
    }
    catch (err) {
        throw new ActualizadorError(`No se pudo conectar con GitHub: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (resp.status === 403 || resp.status === 429) {
        throw new ActualizadorError('GitHub rechazó la consulta por límite de peticiones; intente en unos minutos (o configure GITHUB_TOKEN).');
    }
    return resp;
}
/** Contenido de un archivo del repositorio en un commit dado (null si no existe). */
async function archivoDelRepo(ruta, sha) {
    const resp = await pedirGithub(`${urlRepo()}/contents/${ruta}?ref=${sha}`, 'application/vnd.github.raw+json');
    if (resp.status === 404)
        return null;
    if (!resp.ok)
        throw new ActualizadorError(`GitHub respondió ${resp.status} al leer ${ruta}.`);
    return (await resp.text()).replace(/^\uFEFF/, '');
}
let cache = null;
/** Commit de la punta de la rama y la versión que declara su version.json. */
async function puntaDeRama(forzar) {
    if (!forzar && cache && cache.hasta > Date.now())
        return cache.punta;
    const rama = env.actualizador.rama;
    const resp = await pedirGithub(`${urlRepo()}/commits/${encodeURIComponent(rama)}`);
    if (resp.status === 404 || resp.status === 422) {
        throw new ActualizadorError(`No se encontró la rama "${rama}" en ${env.actualizador.repo} (¿repositorio vacío o nombre incorrecto?).`);
    }
    if (!resp.ok)
        throw new ActualizadorError(`GitHub respondió ${resp.status} al consultar la rama ${rama}.`);
    const c = (await resp.json());
    const textoVersion = await archivoDelRepo('version.json', c.sha);
    let version = null;
    try {
        version = textoVersion ? String(JSON.parse(textoVersion).version ?? '').trim() || null : null;
    }
    catch {
        version = null;
    }
    const punta = {
        sha: c.sha,
        mensaje: c.commit.message.split('\n')[0],
        fecha: c.commit.committer?.date ?? null,
        url: c.html_url,
        version,
    };
    cache = { hasta: Date.now() + CACHE_MS, punta };
    return punta;
}
/** De CAMBIOS.md, las secciones "## X.Y.Z" posteriores a la instalada (hasta la nueva). */
export function notasEntre(cambios, instalada, nueva) {
    const partes = cambios.split(/^(?=##\s+v?\d+\.\d+\.\d+)/m);
    return partes
        .filter((p) => {
        const v = /^##\s+v?(\d+\.\d+\.\d+)/.exec(p)?.[1];
        return v && compararVersiones(v, instalada) > 0 && compararVersiones(v, nueva) <= 0;
    })
        .map((p) => p.trim())
        .join('\n\n');
}
function leerResultadoAnterior() {
    try {
        const texto = fs.readFileSync(ARCHIVO_ESTADO, 'utf8').replace(/^\uFEFF/, '');
        return JSON.parse(texto);
    }
    catch {
        return null;
    }
}
async function corriendoComoServicio() {
    const servicio = env.actualizador.servicio;
    if (process.platform !== 'win32' || !env.produccion || !servicio)
        return false;
    try {
        const { stdout } = await execFileP('sc.exe', ['query', servicio], { windowsHide: true });
        return /RUNNING/i.test(stdout);
    }
    catch {
        return false;
    }
}
let enCurso = false;
let notasCache = null;
export async function consultarEstado(forzar) {
    // El script escribe el resultado DESPUÉS de que arranca la versión nueva: se audita aquí
    // (la pantalla consulta el estado al terminar) y no solo al arrancar.
    await auditarResultadoActualizacion();
    const versionActual = versionInstalada();
    const base = {
        versionActual,
        repo: env.actualizador.repo,
        rama: env.actualizador.rama,
        configurado: Boolean(env.actualizador.repo),
        comoServicio: await corriendoComoServicio(),
        ultima: null,
        hayNueva: false,
        enCurso,
        ultimoResultado: leerResultadoAnterior(),
        error: null,
    };
    if (!base.configurado)
        return base;
    try {
        const punta = await puntaDeRama(forzar);
        if (!punta.version) {
            base.error = `El último commit de ${base.rama} no tiene un version.json válido.`;
            return base;
        }
        base.hayNueva = compararVersiones(punta.version, versionActual) > 0;
        let notas = '';
        if (base.hayNueva) {
            if (notasCache && notasCache.sha === punta.sha && notasCache.instalada === versionActual) {
                notas = notasCache.notas;
            }
            else {
                notas = notasEntre((await archivoDelRepo('CAMBIOS.md', punta.sha)) ?? '', versionActual, punta.version);
                notasCache = { sha: punta.sha, instalada: versionActual, notas };
            }
        }
        base.ultima = {
            version: punta.version,
            sha: punta.sha,
            commit: punta.sha.slice(0, 7),
            mensaje: punta.mensaje,
            fecha: punta.fecha,
            notas,
            url: punta.url,
        };
    }
    catch (err) {
        base.error = err instanceof Error ? err.message : String(err);
    }
    return base;
}
async function descargar(url, destino) {
    let resp;
    try {
        resp = await fetch(url, { headers: cabecerasGithub(), signal: AbortSignal.timeout(10 * 60 * 1000) });
    }
    catch (err) {
        throw new ActualizadorError(`No se pudo descargar la versión: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!resp.ok || !resp.body)
        throw new ActualizadorError(`No se pudo descargar la versión (GitHub respondió ${resp.status}).`);
    let bytes = 0;
    const cuerpo = Readable.fromWeb(resp.body);
    cuerpo.on('data', (trozo) => {
        bytes += trozo.length;
        if (bytes > MAX_ZIP)
            cuerpo.destroy(new ActualizadorError('El zip supera el tamaño máximo permitido.'));
    });
    await pipeline(cuerpo, fs.createWriteStream(destino));
}
/** tar.exe de Windows (bsdtar) descomprime .zip y rechaza rutas absolutas o con "..". */
async function descomprimir(zip, destino) {
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    fs.mkdirSync(destino, { recursive: true });
    try {
        await execFileP(tar, ['-xf', zip, '-C', destino], { windowsHide: true, timeout: 5 * 60 * 1000 });
    }
    catch (err) {
        throw new ActualizadorError(`No se pudo descomprimir la versión: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/** El zip de GitHub trae todo dentro de una carpeta "<usuario>-<repo>-<sha>". */
function raizDelZip(dir) {
    if (fs.existsSync(path.join(dir, 'version.json')))
        return dir;
    const carpetas = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (carpetas.length === 1)
        return path.join(dir, carpetas[0].name);
    throw new ActualizadorError('El zip descargado no tiene la estructura esperada.');
}
function validarPaquete(dir, version) {
    const faltan = ['version.json', 'backend/dist/server.js', 'backend/package.json', 'frontend/dist/index.html', 'scripts/actualizar.ps1']
        .filter((rel) => !fs.existsSync(path.join(dir, rel)));
    if (faltan.length) {
        throw new ActualizadorError(`La versión en GitHub está incompleta, falta: ${faltan.join(', ')}. Publíquela con scripts/publicar.ps1 (compila y sube el dist).`);
    }
    const delPaquete = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8').replace(/^\uFEFF/, '')).version;
    if (delPaquete !== version) {
        throw new ActualizadorError(`El zip dice ser la versión ${delPaquete}, pero se esperaba la ${version}.`);
    }
}
/**
 * El script corre como tarea programada (SYSTEM), fuera del árbol de procesos del
 * servicio: al detener el servicio no se lo lleva por delante. Si no se puede crear la
 * tarea, se lanza desacoplado como respaldo.
 */
async function lanzarScript(dirTrabajo, dirNuevo) {
    const script = path.join(dirTrabajo, 'actualizar.ps1');
    fs.copyFileSync(path.join(dirNuevo, 'scripts', 'actualizar.ps1'), script);
    const lanzador = path.join(dirTrabajo, 'ejecutar.cmd');
    const args = `-Origen "${dirNuevo}" -Destino "${RAIZ_APP}" -Servicio "${env.actualizador.servicio}" -Puerto ${env.port}`;
    fs.writeFileSync(lanzador, `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}" ${args}\r\n`, 'ascii');
    try {
        await execFileP('schtasks.exe', ['/Create', '/TN', NOMBRE_TAREA, '/TR', `"${lanzador}"`, '/SC', 'ONCE', '/ST', '00:00', '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/F'], { windowsHide: true });
        await execFileP('schtasks.exe', ['/Run', '/TN', NOMBRE_TAREA], { windowsHide: true });
    }
    catch {
        const hijo = spawn('cmd.exe', ['/c', 'start', '""', '/min', lanzador], { detached: true, stdio: 'ignore', windowsHide: true });
        hijo.unref();
    }
}
/**
 * Descarga el zip del commit de la punta de la rama, lo descomprime y revisa que esté
 * completo. No toca la instalación: solo escribe en _actualizaciones/v<versión>/.
 */
export async function prepararPaquete() {
    const punta = await puntaDeRama(true);
    if (!punta.version)
        throw new ActualizadorError(`El último commit de ${env.actualizador.rama} no tiene un version.json válido.`);
    const desde = versionInstalada();
    if (compararVersiones(punta.version, desde) <= 0)
        throw new ActualizadorError(`Ya tiene la versión ${desde}; no hay nada nuevo.`);
    const dirTrabajo = path.join(DIR_ACTUALIZACIONES, `v${punta.version}`);
    fs.rmSync(dirTrabajo, { recursive: true, force: true });
    fs.mkdirSync(dirTrabajo, { recursive: true });
    const archivoZip = path.join(dirTrabajo, `${punta.sha.slice(0, 7)}.zip`);
    await descargar(`${urlRepo()}/zipball/${punta.sha}`, archivoZip);
    const dirExtraido = path.join(dirTrabajo, 'nuevo');
    await descomprimir(archivoZip, dirExtraido);
    const dirNuevo = raizDelZip(dirExtraido);
    validarPaquete(dirNuevo, punta.version);
    return { desde, version: punta.version, dirTrabajo, dirNuevo };
}
export async function iniciarActualizacion() {
    const anterior = leerResultadoAnterior();
    if (enCurso || (anterior?.estado === 'en-curso' && esReciente(anterior.fecha))) {
        throw new ActualizadorError('Ya hay una actualización en curso.');
    }
    if (!env.actualizador.repo)
        throw new ActualizadorError('No hay repositorio de actualizaciones configurado (UPDATE_REPO en el .env).');
    if (!(await corriendoComoServicio())) {
        throw new ActualizadorError(`Solo se puede actualizar desde aquí cuando el aplicativo corre como servicio de Windows ("${env.actualizador.servicio || 'SERVICE_NAME'}"). ` +
            'En desarrollo actualice con git / npm.');
    }
    enCurso = true;
    try {
        const { desde, version, dirTrabajo, dirNuevo } = await prepararPaquete();
        fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify({ estado: 'en-curso', desde, hasta: version, mensaje: 'Iniciando…', fecha: ahora() }, null, 2));
        await lanzarScript(dirTrabajo, dirNuevo);
        return {
            desde,
            hasta: version,
            mensaje: `Actualizando de la versión ${desde} a la ${version}. El servicio se reiniciará en unos segundos.`,
        };
    }
    catch (err) {
        enCurso = false;
        throw err;
    }
}
function ahora() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** Un "en-curso" de hace más de 15 minutos quedó colgado (p. ej. se apagó el equipo). */
function esReciente(fecha) {
    if (!fecha)
        return false;
    const t = new Date(fecha.replace(' ', 'T')).getTime();
    return Number.isFinite(t) && Date.now() - t < 15 * 60 * 1000;
}
/**
 * Si el script dejó el resultado de una actualización (ok o error) que aún no está en la
 * auditoría, se registra como acción del sistema y se marca para no repetirla.
 */
export async function auditarResultadoActualizacion() {
    const r = leerResultadoAnterior();
    if (!r || r.auditado || (r.estado !== 'ok' && r.estado !== 'error'))
        return;
    // Se marca antes de registrar: dos consultas a la vez no la auditan dos veces.
    try {
        fs.writeFileSync(ARCHIVO_ESTADO, JSON.stringify({ ...r, auditado: true }, null, 2));
    }
    catch {
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
//# sourceMappingURL=actualizador.service.js.map