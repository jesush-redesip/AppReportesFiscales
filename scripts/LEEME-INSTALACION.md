# Reportes Fiscales: instalación y actualizaciones

GitHub hace de puente. El repositorio público
https://github.com/jesush-redesip/AppReportesFiscales lleva el código **y el compilado**
(`backend/dist`, `frontend/dist`). Cuando se publica una versión nueva en la rama `main`,
los clientes la ven en **Actualizaciones** y la descargan como zip.

## Requisitos del equipo servidor
- Windows 10/11 o Windows Server 2016 o posterior (trae `tar.exe`, `robocopy` y `schtasks`).
- Node.js 20 LTS o superior, instalado para todos los usuarios.
- `nssm.exe` (https://nssm.cc, versión 2.24, carpeta win64).
- Acceso al SQL Server de ICG y salida a internet hacia github.com.

## Instalación inicial (una vez por equipo)
1. En GitHub abra **Code → Download ZIP** y descomprímalo en la carpeta final, por ejemplo `C:\ReportesFiscales`.
   Los archivos `version.json`, `backend`, `frontend` y `scripts` deben quedar directamente dentro de esa carpeta.
2. Copie `nssm.exe` en `C:\ReportesFiscales\scripts\`.
3. Abra PowerShell **como Administrador** y ejecute:
   ```
   powershell -ExecutionPolicy Bypass -File C:\ReportesFiscales\scripts\instalar-servicio.ps1 -AbrirFirewall
   ```
   La primera vez el script crea `backend\.env` y lo abre en el Bloc de notas. Complete:
   - `DB_HOST`, `DB_USER`, `DB_PASSWORD`: los datos del SQL Server.
   - `JWT_SECRET`: se genera solo, distinto en cada equipo.
   - `UPDATE_REPO` y `UPDATE_BRANCH`: ya vienen configurados.

   Después ejecute el script otra vez.
4. Abra `http://localhost:3000` en ese equipo, o `http://<ip-del-servidor>:3000` desde las demás PC.

Es **un solo servicio**: el backend sirve también el frontend, así que no hay que instalar nada aparte para el frontend.

**Alternativa sin PowerShell:** con `backend\.env` ya completo, ejecute `scripts\crear-servicio-manual.cmd` como Administrador (clic derecho → Ejecutar como administrador). Crea el mismo servicio con los mismos datos, pero no genera el `.env` ni abre el firewall.

## Publicar una versión nueva (desarrollo)
Con los cambios hechos y probados, en la carpeta del proyecto ejecute:
```
powershell -ExecutionPolicy Bypass -File scripts\publicar.ps1 -Version 1.0.2 -Notas "Arreglo en Libro de Venta; Nueva columna en Cierre de Caja"
```
El script hace lo siguiente:
1. Sube la versión en `version.json`.
2. Agrega las notas a `CAMBIOS.md`.
3. Compila el backend y el frontend.
4. Hace el commit y crea el tag `v1.0.2`.
5. Hace el push a `main`.

Con `-SinPush` deja todo listo sin subirlo.

> Solo `version.json` decide si hay versión nueva. Los commits que no pasan por `publicar.ps1`
> (cambios a medias, documentación) no les aparecen a los clientes.

## Actualizar un cliente
Entre como **SUPERVISOR** y abra el botón de la versión (por ejemplo `v1.0.0`) en la barra superior. Si aparece un punto verde, hay una versión nueva: presione **Actualizar a X.Y.Z**.

Qué hace el actualizador:
1. Descarga de GitHub el zip del commit publicado (siempre ese commit exacto).
2. Detiene el servicio y respalda la versión actual en `_respaldos\` (se guardan las 3 últimas).
3. Reemplaza `backend\dist`, `backend\templates`, `frontend\dist`, `scripts` y `version.json`. **No toca `backend\.env` ni `backend\logs`.**
4. Ejecuta `npm ci` solo si cambiaron las dependencias.
5. Arranca el servicio y comprueba que responda la versión nueva. Si no responde, restaura el respaldo y vuelve a arrancar la versión anterior.

El resultado queda en la pantalla Actualizaciones, en la Auditoría y en `_actualizaciones\actualizar-*.log`.

### Actualizar a mano (sin el botón)
Descargue el zip de GitHub, descomprímalo y ejecute como administrador:
```
powershell -ExecutionPolicy Bypass -File <carpeta descomprimida>\scripts\actualizar.ps1 -Origen <carpeta descomprimida> -Destino C:\ReportesFiscales
```

> El repositorio es público: `.env`, logs y respaldos están en `.gitignore`, y `publicar.ps1` se niega a subir un `.env`. Nunca suba contraseñas.
