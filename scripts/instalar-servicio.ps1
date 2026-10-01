<#
  Reportes Fiscales - instalacion inicial como servicio de Windows (una sola vez por equipo).

  1. Descomprimir reportes-fiscales-vX.Y.Z.zip en la carpeta final, p. ej. C:\ReportesFiscales
  2. Copiar nssm.exe (https://nssm.cc, version 2.24 win64) en C:\ReportesFiscales\scripts\
  3. PowerShell COMO ADMINISTRADOR:
       powershell -ExecutionPolicy Bypass -File C:\ReportesFiscales\scripts\instalar-servicio.ps1
     La primera vez crea backend\.env desde .env.example y se detiene para que lo complete
     (DB_HOST, DB_USER, DB_PASSWORD, JWT_SECRET, UPDATE_REPO). Luego se ejecuta de nuevo.

  Despues de esto las versiones nuevas se instalan desde el aplicativo (SUPERVISOR >
  Actualizaciones). Solo ASCII a proposito (PowerShell 5.1).
#>
param(
  [string]$Servicio = 'ReportesFiscales',
  [string]$Nssm = '',
  [switch]$AbrirFirewall
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $raiz 'backend'

$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) { throw 'Ejecute este script en una consola de PowerShell como Administrador.' }

foreach ($rel in @('version.json', 'backend\dist\server.js', 'frontend\dist\index.html')) {
  if (-not (Test-Path (Join-Path $raiz $rel))) { throw "Falta $rel en $raiz. Descomprima el paquete completo." }
}

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'No se encontro Node.js. Instale Node.js 20 o superior (LTS) para todos los usuarios.' }
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
Write-Host "Node: $node ($(& $node -v))"

if (-not $Nssm) {
  $Nssm = Join-Path $PSScriptRoot 'nssm.exe'
  if (-not (Test-Path $Nssm)) { $c = Get-Command nssm.exe -ErrorAction SilentlyContinue; if ($c) { $Nssm = $c.Source } }
}
if (-not (Test-Path $Nssm)) { throw "No se encontro nssm.exe. Descarguelo de https://nssm.cc y copielo en $PSScriptRoot" }

$envFile = Join-Path $backend '.env'
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $backend '.env.example') $envFile
  Write-Host ''
  Write-Host "Se creo $envFile" -ForegroundColor Yellow
  Write-Host 'Completelo (DB_HOST, DB_USER, DB_PASSWORD, JWT_SECRET, UPDATE_REPO) y vuelva a ejecutar este script.' -ForegroundColor Yellow
  notepad.exe $envFile
  exit 1
}
$contenido = Get-Content -Raw $envFile
if ($contenido -match '(?m)^JWT_SECRET=\s*$') { throw 'JWT_SECRET esta vacio en backend\.env.' }
if ($contenido -match '(?m)^DB_PASSWORD=\s*$') { throw 'DB_PASSWORD esta vacio en backend\.env.' }
$puerto = 3000
if ($contenido -match '(?m)^PORT=(\d+)') { $puerto = [int]$Matches[1] }

Write-Host 'Instalando dependencias (npm ci --omit=dev)...'
Push-Location $backend
try {
  cmd.exe /c "`"$npm`" ci --omit=dev --no-audit --no-fund 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "npm ci fallo (codigo $LASTEXITCODE)." }
} finally { Pop-Location }

$existe = Get-Service -Name $Servicio -ErrorAction SilentlyContinue
if ($existe) {
  Write-Host "El servicio $Servicio ya existe: se actualiza su configuracion."
  & $Nssm stop $Servicio | Out-Null
} else {
  & $Nssm install $Servicio $node | Out-Null
}
New-Item -ItemType Directory -Force -Path (Join-Path $backend 'logs') | Out-Null
& $Nssm set $Servicio Application $node | Out-Null
& $Nssm set $Servicio AppParameters 'dist\server.js' | Out-Null
& $Nssm set $Servicio AppDirectory $backend | Out-Null
& $Nssm set $Servicio AppEnvironmentExtra "NODE_ENV=production" "SERVICE_NAME=$Servicio" | Out-Null
& $Nssm set $Servicio DisplayName 'Reportes Fiscales' | Out-Null
& $Nssm set $Servicio Description 'Reportes Fiscales ICG (backend + frontend). Se actualiza desde el aplicativo.' | Out-Null
& $Nssm set $Servicio Start SERVICE_AUTO_START | Out-Null
& $Nssm set $Servicio AppExit Default Restart | Out-Null
& $Nssm set $Servicio AppRestartDelay 5000 | Out-Null
& $Nssm set $Servicio AppStdout (Join-Path $backend 'logs\servicio.log') | Out-Null
& $Nssm set $Servicio AppStderr (Join-Path $backend 'logs\servicio.log') | Out-Null
& $Nssm set $Servicio AppRotateFiles 1 | Out-Null
& $Nssm set $Servicio AppRotateBytes 10485760 | Out-Null

if ($AbrirFirewall) {
  $regla = "Reportes Fiscales ($puerto)"
  if (-not (Get-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $regla -Direction Inbound -Protocol TCP -LocalPort $puerto -Action Allow | Out-Null
  }
}

& $Nssm start $Servicio | Out-Null
Start-Sleep -Seconds 4
try {
  $r = Invoke-RestMethod -Uri "http://localhost:$puerto/health" -TimeoutSec 10
  Write-Host ''
  Write-Host "Listo: servicio $Servicio en marcha, version $($r.version)." -ForegroundColor Green
  Write-Host "Abrir en el navegador: http://localhost:$puerto  (desde otra PC: http://<ip-de-este-equipo>:$puerto)"
} catch {
  Write-Host "El servicio se instalo pero no responde todavia en el puerto $puerto. Revise backend\logs\servicio.log" -ForegroundColor Yellow
}
