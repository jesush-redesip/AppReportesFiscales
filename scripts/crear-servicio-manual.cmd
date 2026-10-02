@echo off
rem ============================================================================
rem  Reportes Fiscales - crear el servicio de Windows A MANO con NSSM.
rem
rem  Un solo servicio: el backend sirve tambien el frontend (frontend\dist) en el
rem  mismo puerto. Abrir http://localhost:3000 (o http://<ip-del-equipo>:3000).
rem
rem  Uso: clic derecho > "Ejecutar como administrador", o desde una consola de
rem  administrador:   C:\ReportesFiscales\scripts\crear-servicio-manual.cmd
rem
rem  Antes: Node.js LTS instalado, nssm.exe en esta carpeta (scripts\) y
rem  backend\.env completo (DB_HOST, DB_USER, DB_PASSWORD, JWT_SECRET).
rem  Alternativa automatica (hace lo mismo y genera el .env): instalar-servicio.ps1
rem ============================================================================
setlocal
set "SERVICIO=ReportesFiscales"
set "RAIZ=%~dp0.."
for %%I in ("%RAIZ%") do set "RAIZ=%%~fI"
set "BACKEND=%RAIZ%\backend"
set "NSSM=%~dp0nssm.exe"

rem --- Comprobaciones -----------------------------------------------------------
net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: ejecute este archivo como Administrador.
  goto :fin
)
if not exist "%NSSM%" (
  where nssm.exe >nul 2>&1 && (for /f "delims=" %%N in ('where nssm.exe') do set "NSSM=%%N") || (
    echo ERROR: falta nssm.exe en %~dp0  ^(descarguelo de https://nssm.cc, carpeta win64^)
    goto :fin
  )
)
set "NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%N"
if not defined NODE (
  echo ERROR: no se encontro Node.js. Instale la version LTS de https://nodejs.org
  goto :fin
)
if not exist "%BACKEND%\dist\server.js" (
  echo ERROR: no existe %BACKEND%\dist\server.js. Descomprima el aplicativo completo en %RAIZ%
  goto :fin
)
if not exist "%BACKEND%\.env" (
  echo ERROR: falta %BACKEND%\.env. Copie .env.example como .env y completelo.
  goto :fin
)
echo Carpeta : %RAIZ%
echo Node    : %NODE%
echo NSSM    : %NSSM%
echo.

rem --- 1. Dependencias del backend (solo produccion) -----------------------------
echo [1/3] Instalando dependencias...
pushd "%BACKEND%"
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 (
  popd
  echo ERROR: npm ci fallo.
  goto :fin
)
popd
if not exist "%BACKEND%\logs" mkdir "%BACKEND%\logs"

rem --- 2. Crear y configurar el servicio -------------------------------------------
echo [2/3] Creando el servicio %SERVICIO%...
"%NSSM%" status %SERVICIO% >nul 2>&1 && "%NSSM%" stop %SERVICIO% >nul 2>&1
"%NSSM%" status %SERVICIO% >nul 2>&1 || "%NSSM%" install %SERVICIO% "%NODE%" dist\server.js
"%NSSM%" set %SERVICIO% Application "%NODE%"
"%NSSM%" set %SERVICIO% AppParameters dist\server.js
"%NSSM%" set %SERVICIO% AppDirectory "%BACKEND%"
rem NODE_ENV=production: sirve el frontend y habilita el boton Actualizar.
rem SERVICE_NAME: el actualizador detiene/arranca este servicio por su nombre.
"%NSSM%" set %SERVICIO% AppEnvironmentExtra NODE_ENV=production SERVICE_NAME=%SERVICIO%
"%NSSM%" set %SERVICIO% DisplayName "Reportes Fiscales"
"%NSSM%" set %SERVICIO% Description "Reportes Fiscales ICG (backend + frontend). Se actualiza desde el aplicativo."
"%NSSM%" set %SERVICIO% Start SERVICE_AUTO_START
rem Si node se cae, NSSM lo vuelve a levantar a los 5 segundos.
"%NSSM%" set %SERVICIO% AppExit Default Restart
"%NSSM%" set %SERVICIO% AppRestartDelay 5000
"%NSSM%" set %SERVICIO% AppStdout "%BACKEND%\logs\servicio.log"
"%NSSM%" set %SERVICIO% AppStderr "%BACKEND%\logs\servicio.log"
"%NSSM%" set %SERVICIO% AppRotateFiles 1
"%NSSM%" set %SERVICIO% AppRotateBytes 10485760

rem --- 3. Arrancar ----------------------------------------------------------------
echo [3/3] Arrancando...
"%NSSM%" start %SERVICIO%
echo.
echo Listo. Abra http://localhost:3000  (desde otra PC: http://^<ip-de-este-equipo^>:3000)
echo Para que otras PC entren, abra el puerto 3000 en el firewall:
echo   netsh advfirewall firewall add rule name="Reportes Fiscales (3000)" dir=in action=allow protocol=TCP localport=3000
echo Log del servicio: %BACKEND%\logs\servicio.log
echo.
echo Otros comandos utiles:
echo   Ver estado     : sc query %SERVICIO%
echo   Reiniciar      : "%NSSM%" restart %SERVICIO%
echo   Quitar servicio: "%NSSM%" stop %SERVICIO% ^&^& "%NSSM%" remove %SERVICIO% confirm

:fin
echo.
pause
endlocal
