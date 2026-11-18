# Inicia Mailpit en loopback: SMTP 127.0.0.1:1025 e interfaz http://127.0.0.1:8025 (P4 - D5).
# Uso: .\infra\mailpit\start-mailpit.ps1 [-Bin C:\ruta\mailpit.exe]
param(
  [string]$Bin = $(if ($env:MAILPIT_BIN) { $env:MAILPIT_BIN } else { 'mailpit' }),
  [string]$Smtp = '127.0.0.1:1025',
  [string]$Ui = '127.0.0.1:8025',
  [int]$Max = 500
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command $Bin -ErrorAction SilentlyContinue)) {
  Write-Error "No se encontró '$Bin'. Instálalo según infra\mailpit\README.md o usa -Bin C:\ruta\mailpit.exe"
}

$DataDir = Join-Path $env:LOCALAPPDATA 'entradasya'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$Db = Join-Path $DataDir 'mailpit.db'

Write-Host "Mailpit: SMTP $Smtp  |  interfaz http://$Ui  |  datos $Db"
& $Bin --smtp $Smtp --listen $Ui --database $Db --max $Max
