<#
  Reportes Fiscales - publica una version nueva en GitHub (que hace de puente con los clientes).

    powershell -ExecutionPolicy Bypass -File scripts\publicar.ps1 -Version 1.0.2 -Notas "Arreglo en Libro de Venta; Nueva columna en Cierre de Caja"

  Las notas se separan con ";" (cada una queda como un punto en CAMBIOS.md).

  Hace: version.json -> CAMBIOS.md (las notas se ven en la pantalla Actualizaciones) ->
  compila backend (tsc) y frontend (vite) -> git add -A, commit, tag v1.0.2 -> push a main.

  Los clientes ven la version nueva en Actualizaciones apenas termina el push (hasta 10
  minutos por la cache) y la descargan como zip desde GitHub.

  OJO: sube TODO lo pendiente de la carpeta (git add -A). Con -SinPush deja el commit
  hecho pero no lo sube. Solo ASCII a proposito (PowerShell 5.1).
#>
param(
  [Parameter(Mandatory = $true)] [ValidatePattern('^\d+\.\d+\.\d+$')] [string]$Version,
  [Parameter(Mandatory = $true)] [string[]]$Notas,
  [switch]$SinPush
)

$ErrorActionPreference = 'Stop'
$Notas = @($Notas | ForEach-Object { $_ -split ';' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (-not $Notas) { throw 'Indique al menos una nota con -Notas.' }
$raiz = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Ejecutar([string]$dir, [string]$cmd) {
  Write-Host "> ($dir) $cmd" -ForegroundColor Cyan
  Push-Location $dir
  try {
    cmd.exe /c "$cmd 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "Fallo: $cmd (codigo $LASTEXITCODE)" }
  } finally { Pop-Location }
}

function Git([string]$argumentos) {
  # Por cmd: los avisos de git por stderr no deben cortar el script (PowerShell 5.1).
  $salida = cmd.exe /c "git $argumentos 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "git $argumentos fallo: $($salida -join ' ')" }
  return $salida
}

Push-Location $raiz
try {
  # 0. Comprobaciones
  $rama = (Git 'rev-parse --abbrev-ref HEAD' | Select-Object -Last 1).Trim()
  if ($rama -ne 'main') { throw "Esta en la rama '$rama'; publique desde main." }
  $actual = (Get-Content -Raw (Join-Path $raiz 'version.json') | ConvertFrom-Json).version
  if ([version]$Version -le [version]$actual) { throw "La version $Version no es mayor que la actual ($actual)." }
  cmd.exe /c "git rev-parse -q --verify refs/tags/v$Version >nul 2>&1"
  if ($LASTEXITCODE -eq 0) { throw "Ya existe el tag v$Version." }

  # 1. Version y notas
  [System.IO.File]::WriteAllText((Join-Path $raiz 'version.json'), "{`n  `"version`": `"$Version`"`n}`n", $utf8)
  $archivoCambios = Join-Path $raiz 'CAMBIOS.md'
  $previo = if (Test-Path $archivoCambios) { [System.IO.File]::ReadAllText($archivoCambios, [System.Text.Encoding]::UTF8) } else { "# Cambios`n" }
  $seccion = "## $Version - $(Get-Date -Format 'yyyy-MM-dd')`n" + (($Notas | ForEach-Object { "- $_" }) -join "`n") + "`n"
  $i = $previo.IndexOf("`n## ")
  $nuevo = if ($i -ge 0) { $previo.Substring(0, $i + 1) + $seccion + "`n" + $previo.Substring($i + 1) } else { $previo.TrimEnd() + "`n`n" + $seccion }
  [System.IO.File]::WriteAllText($archivoCambios, $nuevo, $utf8)

  # 2. Compilar (dist limpio: que no queden archivos de modulos borrados)
  Remove-Item -Recurse -Force (Join-Path $raiz 'backend\dist') -ErrorAction SilentlyContinue
  Ejecutar (Join-Path $raiz 'backend') 'npm run build'
  Ejecutar (Join-Path $raiz 'frontend') 'npm run build'
  foreach ($rel in @('backend\dist\server.js', 'frontend\dist\index.html')) {
    if (-not (Test-Path (Join-Path $raiz $rel))) { throw "No se genero $rel." }
  }

  # 3. Commit y tag (nada sensible: el repositorio es publico)
  Git 'add -A' | Out-Null
  $sensibles = Git 'diff --cached --name-only' | Where-Object { $_ -notmatch '^(warning|hint):' } | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '\.env\.example$' -and $_ -notmatch 'frontend/\.env\.production$' }
  if ($sensibles) { Git 'reset -q' | Out-Null; throw "Se iban a subir archivos sensibles: $($sensibles -join ', ')" }
  $titulo = "Version ${Version}: $($Notas[0])"
  $archivoMensaje = Join-Path $env:TEMP "rf-commit-$Version.txt"
  [System.IO.File]::WriteAllText($archivoMensaje, "$titulo`n`n" + (($Notas | ForEach-Object { "- $_" }) -join "`n") + "`n", $utf8)
  Git "commit -q -F `"$archivoMensaje`"" | Out-Null
  Remove-Item $archivoMensaje -Force
  Git "tag v$Version" | Out-Null

  # 4. Subir
  if ($SinPush) {
    Write-Host "Commit y tag v$Version listos (sin subir). Para publicar: git push origin main --tags" -ForegroundColor Yellow
  } else {
    try { Git 'push origin main --tags' | Write-Host } catch { throw "El commit quedo hecho pero el push fallo; reintente con: git push origin main --tags. $_" }
    Write-Host "Publicada la version $Version. Los clientes la veran en Actualizaciones." -ForegroundColor Green
  }
} finally { Pop-Location }
