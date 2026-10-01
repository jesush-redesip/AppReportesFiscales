<#
  Reportes Fiscales - genera el paquete de una version para publicarlo en GitHub Releases.

    powershell -ExecutionPolicy Bypass -File scripts\empaquetar.ps1 -Version 1.0.1

  Hace: actualiza version.json -> compila backend (tsc) y frontend (vite) -> arma
  release\reportes-fiscales-v1.0.1.zip y su .sha256.

  Publicar: en GitHub > Releases > "Draft a new release", tag v1.0.1, adjuntar el .zip
  y el .sha256, escribir las notas (se ven en el aplicativo) y "Publish release".
  Con GitHub CLI instalado (gh) basta agregar -Publicar.

  Solo ASCII a proposito (PowerShell 5.1).
#>
param(
  [Parameter(Mandatory = $true)] [ValidatePattern('^\d+\.\d+\.\d+$')] [string]$Version,
  [switch]$Publicar,
  [string]$Notas = ''
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$nombre = "reportes-fiscales-v$Version"
$salida = Join-Path $raiz 'release'
$staging = Join-Path $salida $nombre
$zip = Join-Path $salida "$nombre.zip"

function Ejecutar([string]$dir, [string]$cmd) {
  Write-Host "> ($dir) $cmd" -ForegroundColor Cyan
  Push-Location $dir
  try {
    cmd.exe /c $cmd
    if ($LASTEXITCODE -ne 0) { throw "Fallo: $cmd (codigo $LASTEXITCODE)" }
  } finally { Pop-Location }
}

# 1. Version
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $raiz 'version.json'), "{`n  `"version`": `"$Version`"`n}`n", $utf8)

# 2. Compilar (dist limpio: que no viajen archivos de modulos borrados)
Remove-Item -Recurse -Force (Join-Path $raiz 'backend\dist') -ErrorAction SilentlyContinue
Ejecutar (Join-Path $raiz 'backend') 'npm run build'
Ejecutar (Join-Path $raiz 'frontend') 'npm run build'

# 3. Armar la carpeta del paquete
Remove-Item -Recurse -Force $staging, $zip, "$zip.sha256" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $staging 'backend'), (Join-Path $staging 'frontend'), (Join-Path $staging 'scripts') | Out-Null
Copy-Item (Join-Path $raiz 'version.json') $staging
Copy-Item (Join-Path $raiz 'backend\dist') (Join-Path $staging 'backend\dist') -Recurse
Copy-Item (Join-Path $raiz 'backend\templates') (Join-Path $staging 'backend\templates') -Recurse
foreach ($f in @('package.json', 'package-lock.json', '.env.example')) { Copy-Item (Join-Path $raiz "backend\$f") (Join-Path $staging 'backend') }
Copy-Item (Join-Path $raiz 'frontend\dist') (Join-Path $staging 'frontend\dist') -Recurse
foreach ($f in @('actualizar.ps1', 'instalar-servicio.ps1', 'LEEME-INSTALACION.md')) { Copy-Item (Join-Path $PSScriptRoot $f) (Join-Path $staging 'scripts') }
Get-ChildItem -Path (Join-Path $staging 'backend\dist') -Recurse -Filter '*.map' | Remove-Item -Force

# Nada sensible dentro del paquete (es publico).
$prohibidos = Get-ChildItem -Path $staging -Recurse -Force | Where-Object { $_.Name -eq '.env' -or $_.Name -like '.env.respaldo*' -or $_.Name -like '*.log' }
if ($prohibidos) { throw "El paquete contiene archivos que no deben publicarse: $($prohibidos.FullName -join ', ')" }

# 4. Zip con tar.exe de Windows (rutas con "/", lo que espera el actualizador)
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
Push-Location $staging
try {
  & $tar -a -c -f $zip version.json backend frontend scripts
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el zip.' }
} finally { Pop-Location }
$hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
[System.IO.File]::WriteAllText("$zip.sha256", "$hash  $nombre.zip`n", $utf8)
Remove-Item -Recurse -Force $staging

$mb = [Math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ''
Write-Host "Paquete listo: $zip ($mb MB)" -ForegroundColor Green
Write-Host "SHA-256: $hash"

if ($Publicar) {
  $gh = Get-Command gh.exe -ErrorAction SilentlyContinue
  if (-not $gh) { throw 'No se encontro GitHub CLI (gh). Publique el Release a mano desde github.com.' }
  $argsGh = @('release', 'create', "v$Version", $zip, "$zip.sha256", '--title', "v$Version")
  if ($Notas) { $argsGh += @('--notes', $Notas) } else { $argsGh += '--generate-notes' }
  & $gh.Source @argsGh
  if ($LASTEXITCODE -ne 0) { throw 'gh release create fallo.' }
  Write-Host "Publicado v$Version." -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host "Siguiente paso: GitHub > Releases > Draft a new release > tag v$Version > adjuntar $nombre.zip y $nombre.zip.sha256 > Publish release."
}
