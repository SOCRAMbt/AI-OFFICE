# Publica `oficina-opencode` en npm con un token granular.
#
# Uso:  .\scripts\publish-npm.ps1 -Token "npm_XXXX..."
#
# El token NUNCA se imprime: se escribe directo al .npmrc y se retira al
# terminar. ASCII puro a proposito: PowerShell 5.1 no lee UTF-8 sin BOM.
#
# Requisitos del token (dashboard de npm):
#   - Tipo:       Granular Access Token
#   - Packages:   All Packages
#   - Permisos:   Read and write (publish and stage)
#   - Bypass 2FA: ON

param(
  [Parameter(Mandatory = $true)]
  [string]$Token
)

# "Continue" a proposito: los comandos nativos de npm escriben a stderr en
# situations normales (warnings de los tests), y con "Stop" PowerShell
# aborta el script como si fuera un error real.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$npmrc = Join-Path $env:USERPROFILE ".npmrc"

try {
  Write-Host ""
  Write-Host "[1/5] Escribiendo el token en .npmrc..." -ForegroundColor Cyan
  if (Test-Path $npmrc) {
    $existing = @(Get-Content $npmrc | Where-Object { $_ -notmatch "_authToken=" })
  } else {
    $existing = @()
  }
  $line = "//registry.npmjs.org/:_authToken=$Token"
  [System.IO.File]::WriteAllLines($npmrc, @($existing + $line), (New-Object System.Text.UTF8Encoding($false)))

  Write-Host ""
  Write-Host "[2/5] Verificando la sesion..." -ForegroundColor Cyan
  $who = (npm whoami 2>&1 | Select-Object -Last 1)
  Write-Host "    usuario: $who"

  Write-Host ""
  Write-Host "[3/5] Verificacion (typecheck + tests + build)..." -ForegroundColor Cyan
  $check = (npm run prepublishOnly 2>&1 | Out-String)
  $tests = ($check -split "`n" | Where-Object { $_ -match "Tests +[0-9]+ passed" } | Select-Object -First 1)
  if ($check -match "error TS") {
    Write-Host "    FALLO en typecheck" -ForegroundColor Red
    Write-Host $check
    exit 1
  }
  Write-Host "    $tests"

  Write-Host ""
  Write-Host "[4/5] Publicando..." -ForegroundColor Cyan
  $out = (npm publish 2>&1 | Out-String)
  $ok = $out -match "\+ office@|published to|published with"

  Write-Host ""
  Write-Host "[5/5] Verificando en el registry..." -ForegroundColor Cyan
  Start-Sleep -Seconds 10
  $view = (npm view oficina-opencode version dist-tags.latest 2>&1 | Out-String).Trim()
  Write-Host "    $view"

  if ($ok -or $view -match "2\.0\.0") {
    Write-Host ""
    Write-Host "PUBLICADO: oficina-opencode@2.0.0" -ForegroundColor Green
  } else {
    Write-Host ""
    Write-Host "FALLO - detalle:" -ForegroundColor Red
    Write-Host $out
  }
}
finally {
  if (Test-Path $npmrc) {
    $clean = @(Get-Content $npmrc | Where-Object { $_ -notmatch "_authToken=" })
    if ($clean.Count -eq 0) {
      Remove-Item $npmrc -Force
    } else {
      [System.IO.File]::WriteAllLines($npmrc, $clean, (New-Object System.Text.UTF8Encoding($false)))
    }
  }
  $Token = $null
  Write-Host ""
  Write-Host "Token retirado del .npmrc." -ForegroundColor DarkGray
}
