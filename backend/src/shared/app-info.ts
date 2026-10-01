import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Raíz de la instalación (la carpeta que tiene version.json, backend/ y frontend/).
 * Igual desde src/shared (desarrollo) que desde dist/shared (servicio): tres niveles arriba.
 */
export const RAIZ_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Versión instalada, de version.json. Se relee cada vez: el actualizador la cambia. */
export function versionInstalada(): string {
  try {
    const texto = fs.readFileSync(path.join(RAIZ_APP, 'version.json'), 'utf8').replace(/^﻿/, '');
    const v = JSON.parse(texto)?.version;
    return typeof v === 'string' && v.trim() ? v.trim() : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
