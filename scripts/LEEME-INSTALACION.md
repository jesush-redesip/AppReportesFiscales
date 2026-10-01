# Reportes Fiscales: instalación y actualizaciones

## Requisitos del equipo servidor
- Windows 10/11 o Windows Server 2016 o posterior (trae `tar.exe` y `schtasks.exe`).
- Node.js 20 LTS o superior, instalado para todos los usuarios.
- `nssm.exe` (https://nssm.cc, versión 2.24, carpeta win64).
- Acceso al SQL Server de ICG y salida a internet hacia github.com, para las actualizaciones.

## Instalación inicial (una vez por equipo)
1. Descargue el último `reportes-fiscales-vX.Y.Z.zip` de la página de Releases del repositorio.
2. Descomprímalo en la carpeta final, por ejemplo `C:\ReportesFiscales`.
3. Copie `nssm.exe` en `C:\ReportesFiscales\scripts\`.
4. Abra PowerShell **como Administrador** y ejecute:
   ```
   powershell -ExecutionPolicy Bypass -File C:\ReportesFiscales\scripts\instalar-servicio.ps1 -AbrirFirewall
   ```
   La primera vez el script crea `backend\.env` y lo abre en el Bloc de notas. Complete:
   - `DB_HOST`, `DB_USER`, `DB_PASSWORD`: los datos del SQL Server.
   - `JWT_SECRET`: un texto largo y aleatorio, distinto en cada instalación.
   - `UPDATE_REPO`: ya viene con `jesush-redesip/AppReportesFiscales`.

   Después ejecute el script otra vez.
5. Abra `http://localhost:3000` en ese equipo, o `http://<ip-del-servidor>:3000` desde las demás PC.

## Actualizar
Entre como **SUPERVISOR** y abra el botón de la versión (por ejemplo `v1.0.0`) en la barra superior. Si aparece un punto verde, hay una versión nueva: presione **Actualizar a X.Y.Z**.

Qué hace el actualizador:
1. Descarga el .zip del Release y verifica su SHA-256. Si no coincide, no instala nada.
2. Detiene el servicio y respalda la versión actual en `_respaldos\` (se guardan las 3 últimas).
3. Reemplaza `backend\dist`, `backend\templates`, `frontend\dist`, `scripts` y `version.json`. **No toca `backend\.env` ni `backend\logs`.**
4. Ejecuta `npm ci` solo si cambiaron las dependencias.
5. Arranca el servicio y comprueba que responda la versión nueva. Si no responde, restaura el respaldo y vuelve a arrancar la versión anterior.

El resultado queda en la pantalla de Actualizaciones, en la Auditoría y en `_actualizaciones\actualizar-*.log`.

### Actualizar a mano (sin el botón)
```
powershell -ExecutionPolicy Bypass -File actualizar.ps1 -Origen <carpeta con el zip nuevo descomprimido> -Destino C:\ReportesFiscales
```

## Publicar una versión nueva (desarrollo)
1. En la carpeta del proyecto ejecute:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\empaquetar.ps1 -Version 1.0.1
   ```
   Se generan `release\reportes-fiscales-v1.0.1.zip` y el archivo `.sha256`.
2. En GitHub vaya a **Releases → Draft a new release** y cree el tag `v1.0.1`. Adjunte el `.zip` y el `.sha256`, escriba las novedades (se muestran en el aplicativo) y presione **Publish release**.
   Si tiene GitHub CLI instalado, basta con agregar `-Publicar` al comando del paso 1.

> El repositorio es público: `.env`, logs y respaldos están en `.gitignore` y el empaquetador se niega a incluirlos. Nunca suba contraseñas.
