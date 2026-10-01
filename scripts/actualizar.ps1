<#
  Reportes Fiscales - aplica una actualizacion ya descargada y verificada.

  Lo lanza el backend (boton "Actualizar" del SUPERVISOR) como tarea programada SYSTEM,
  fuera del servicio. Tambien se puede ejecutar a mano (como administrador):

    powershell -ExecutionPolicy Bypass -File actualizar.ps1 -Origen <carpeta del zip descomprimido> -Destino C:\ReportesFiscales

  Pasos: detener servicio -> respaldar -> reemplazar backend\dist, backend\templates,
  frontend\dist, scripts, version.json -> npm ci (solo si cambio package-lock.json) ->
  arrancar -> esperar que /health responda la version nueva. Si algo falla, restaura
  el respaldo y arranca la version anterior.

  NUNCA toca: backend\.env, backend\logs, _respaldos, _actualizaciones.
  Nota: este archivo es solo ASCII a proposito (PowerShell 5.1 lee mal UTF-8 sin BOM).
#>
param(
  [Parameter(Mandatory = $true)] [string]$Origen,
  [Parameter(Mandatory = $true)] [string]$Destino,
  [string]$Servicio = 'ReportesFiscales',
  [int]$Puerto = 3000,
  # Solo para probar el script sin servicio: arranca/detiene node directamente.
  [switch]$Prueba
)

$ErrorActionPreference = 'Stop'
$dirActualizaciones = Join-Path $Destino '_actualizaciones'
$dirRespaldos = Join-Path $Destino '_respaldos'
$archivoEstado = Join-Path $dirActualizaciones 'estado.json'
New-Item -ItemType Directory -Force -Path $dirActualizaciones, $dirRespaldos | Out-Null
$sello = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $dirActualizaciones "actualizar-$sello.log"
Start-Transcript -Path $log -Force | Out-Null

# Lo que se reemplaza (relativo a la raiz). .env, logs y node_modules quedan como estan.
$ELEMENTOS = @('version.json', 'backend\dist', 'backend\templates', 'backend\package.json', 'backend\package-lock.json', 'backend\.env.example', 'frontend\dist', 'scripts')

function Leer-Version([string]$raiz) {
  try { return (Get-Content -Raw -Path (Join-Path $raiz 'version.json') | ConvertFrom-Json).version } catch { return '0.0.0' }
}

$desde = Leer-Version $Destino
$hasta = Leer-Version $Origen

function Escribir-Estado([string]$estado, [string]$mensaje) {
  $obj = [ordered]@{
    estado  = $estado
    desde   = $desde
    hasta   = $hasta
    mensaje = $mensaje
    fecha   = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    log     = $log
  }
  # UTF-8 sin BOM (el backend igual tolera BOM).
  [System.IO.File]::WriteAllText($archivoEstado, ($obj | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "[$estado] $mensaje"
}

$archivoPid = Join-Path $Destino '_prueba.pid'

function Detener-Servicio {
  if ($Prueba) {
    if (Test-Path $archivoPid) { Stop-Process -Id ([int](Get-Content $archivoPid)) -Force -ErrorAction SilentlyContinue; Remove-Item $archivoPid -Force }
    Start-Sleep -Seconds 2
    return
  }
  $svc = Get-Service -Name $Servicio -ErrorAction SilentlyContinue
  if (-not $svc) { throw "No existe el servicio '$Servicio'." }
  if ($svc.Status -ne 'Stopped') {
    Stop-Service -Name $Servicio -Force
    $svc.WaitForStatus('Stopped', (New-TimeSpan -Seconds 90))
  }
  Start-Sleep -Seconds 2
}

function Iniciar-Servicio {
  if ($Prueba) {
    $env:NODE_ENV = 'production'; $env:PORT = "$Puerto"; $env:SERVICE_NAME = $Servicio
    $p = Start-Process -FilePath node.exe -ArgumentList 'dist\server.js' -WorkingDirectory (Join-Path $Destino 'backend') -WindowStyle Hidden -PassThru
    Set-Content -Path $archivoPid -Value $p.Id
    return
  }
  Start-Service -Name $Servicio
  (Get-Service -Name $Servicio).WaitForStatus('Running', (New-TimeSpan -Seconds 60))
}

function Esperar-Version([string]$esperada, [int]$segundos) {
  $limite = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $limite) {
    try {
      $r = Invoke-RestMethod -Uri "http://localhost:$Puerto/health" -TimeoutSec 5
      if ($r.status -eq 'ok' -and $r.version -eq $esperada) { return $true }
    } catch { }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Copiar-Elementos([string]$desdeRaiz, [string]$haciaRaiz) {
  # Carpetas con robocopy /MIR (deja el destino identico y soporta rutas de mas de 260
  # caracteres, donde Copy-Item/Remove-Item fallan); archivos sueltos con Copy-Item.
  foreach ($rel in $ELEMENTOS) {
    $src = Join-Path $desdeRaiz $rel
    $dst = Join-Path $haciaRaiz $rel
    $esCarpeta = (Test-Path -LiteralPath $src -PathType Container) -or (Test-Path -LiteralPath $dst -PathType Container)
    if ($esCarpeta) {
      if (Test-Path -LiteralPath $src -PathType Container) {
        Robocopiar $src $dst
      } elseif (Test-Path -LiteralPath $dst) {
        # No viene en el paquete: vaciar con un espejo de una carpeta vacia y borrar.
        $vacia = Join-Path $env:TEMP "rf-vacia-$sello"
        New-Item -ItemType Directory -Force -Path $vacia | Out-Null
        Robocopiar $vacia $dst
        Remove-Item -LiteralPath $dst -Recurse -Force
        Remove-Item -LiteralPath $vacia -Force
      }
    } else {
      if (Test-Path -LiteralPath $src) {
        $padre = Split-Path -Parent $dst
        if (-not (Test-Path -LiteralPath $padre)) { New-Item -ItemType Directory -Force -Path $padre | Out-Null }
        Copy-Item -LiteralPath $src -Destination $dst -Force
      } elseif (Test-Path -LiteralPath $dst) {
        Remove-Item -LiteralPath $dst -Force
      }
    }
  }
}

function Robocopiar([string]$src, [string]$dst) {
  & robocopy.exe $src $dst /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
  # robocopy: 0-7 = bien (copio, nada que copiar, extras borrados); 8 o mas = error.
  if ($LASTEXITCODE -ge 8) { throw "robocopy fallo copiando '$src' a '$dst' (codigo $LASTEXITCODE)." }
  $global:LASTEXITCODE = 0
}

function Ruta-Npm {
  $c = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\npm.cmd", "${env:ProgramFiles(x86)}\nodejs\npm.cmd")) { if (Test-Path $p) { return $p } }
  throw 'No se encontro npm (Node.js). Instale Node.js para todos los usuarios.'
}

function Hash-Archivo([string]$ruta) {
  if (Test-Path -LiteralPath $ruta) { return (Get-FileHash -LiteralPath $ruta -Algorithm SHA256).Hash } else { return '' }
}

$respaldo = Join-Path $dirRespaldos "$($desde)_$sello"
$backend = Join-Path $Destino 'backend'
$modulos = Join-Path $backend 'node_modules'
$modulosAnterior = Join-Path $backend 'node_modules.anterior'
$cambiaronDependencias = (Hash-Archivo (Join-Path $Origen 'backend\package-lock.json')) -ne (Hash-Archivo (Join-Path $backend 'package-lock.json'))
$fase = 'inicio'

try {
  Escribir-Estado 'en-curso' "Actualizando de $desde a $hasta..."
  if (-not (Test-Path (Join-Path $Origen 'backend\dist\server.js'))) { throw "El paquete en '$Origen' esta incompleto." }

  # Dejar que el backend termine de responder al navegador antes de detenerlo.
  Start-Sleep -Seconds 3
  $fase = 'detener'
  Detener-Servicio

  $fase = 'respaldo'
  New-Item -ItemType Directory -Force -Path $respaldo | Out-Null
  Copiar-Elementos $Destino $respaldo
  Write-Host "Respaldo en $respaldo"

  $fase = 'reemplazo'
  Copiar-Elementos $Origen $Destino

  if ($cambiaronDependencias) {
    $fase = 'dependencias'
    Write-Host 'Cambiaron las dependencias: npm ci --omit=dev'
    if (Test-Path -LiteralPath $modulosAnterior) { Remove-Item -LiteralPath $modulosAnterior -Recurse -Force }
    if (Test-Path -LiteralPath $modulos) { Rename-Item -LiteralPath $modulos -NewName 'node_modules.anterior' }
    $npm = Ruta-Npm
    Push-Location $backend
    try {
      cmd.exe /c "`"$npm`" ci --omit=dev --no-audit --no-fund 2>&1"
      if ($LASTEXITCODE -ne 0) { throw "npm ci fallo (codigo $LASTEXITCODE)." }
    } finally { Pop-Location }
  }

  $fase = 'arranque'
  Iniciar-Servicio
  if (-not (Esperar-Version $hasta 90)) { throw "La version $hasta no respondio en http://localhost:$Puerto/health." }

  # Limpieza: dependencias anteriores, paquetes descargados viejos y respaldos (quedan 3).
  if (Test-Path -LiteralPath $modulosAnterior) { Remove-Item -LiteralPath $modulosAnterior -Recurse -Force -ErrorAction SilentlyContinue }
  Get-ChildItem -Path $dirActualizaciones -Directory | Where-Object { $_.FullName -ne (Split-Path -Parent $Origen) } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Origen -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -Path $dirRespaldos -Directory | Sort-Object CreationTime -Descending | Select-Object -Skip 3 |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  Escribir-Estado 'ok' "Actualizado de $desde a $hasta."
}
catch {
  $error1 = $_.Exception.Message
  Write-Host "ERROR en fase '$fase': $error1"
  $restaurado = $false
  if ($fase -ne 'inicio' -and $fase -ne 'detener' -and $fase -ne 'respaldo') {
    try {
      Write-Host 'Restaurando la version anterior...'
      try { Detener-Servicio } catch { }
      Copiar-Elementos $respaldo $Destino
      if (Test-Path -LiteralPath $modulosAnterior) {
        if (Test-Path -LiteralPath $modulos) { Remove-Item -LiteralPath $modulos -Recurse -Force }
        Rename-Item -LiteralPath $modulosAnterior -NewName 'node_modules'
      }
      $restaurado = $true
    } catch {
      Write-Host "No se pudo restaurar: $($_.Exception.Message)"
    }
  }
  try {
    if ($Prueba) { if (-not (Test-Path $archivoPid)) { Iniciar-Servicio } }
    elseif ((Get-Service -Name $Servicio).Status -ne 'Running') { Iniciar-Servicio }
  } catch { Write-Host "No se pudo arrancar el servicio: $($_.Exception.Message)" }

  $detalle = if ($restaurado) { "Se restauro la version $desde." } elseif ($fase -in @('inicio', 'detener', 'respaldo')) { "No se cambio nada; sigue la version $desde." } else { "ATENCION: no se pudo restaurar; revise $respaldo." }
  Escribir-Estado 'error' "Fallo la actualizacion a $hasta ($fase): $error1 $detalle"
}
finally {
  # Por cmd: en PowerShell 5.1 el stderr de un .exe con ErrorAction Stop corta el script.
  cmd.exe /c "schtasks.exe /Delete /TN ReportesFiscales-Actualizar /F >nul 2>&1"
  Stop-Transcript | Out-Null
}
