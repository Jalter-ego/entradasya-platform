# Inicia los servicios disponibles en EntradasYa en segundo plano (Windows PowerShell)
# Guarda PIDs en .local/pids.json y logs en .local/logs/*.log
param(
  [ValidateSet('dev', 'start')]
  [string]$Mode = 'dev'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$LocalDir = Join-Path $Root '.local'
$LogsDir = Join-Path $LocalDir 'logs'
$PidsFile = Join-Path $LocalDir 'pids.json'

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

if (Test-Path $PidsFile) {
  Write-Warning "Ya existe $PidsFile. Ejecuta primero .\scripts\dev\stop-local.ps1 si hay procesos activos."
}

$services = @(
  @{ Name = 'auth';          Path = 'services\auth';          Port = 3001; Manager = 'npm' },
  @{ Name = 'events';        Path = 'services\events';        Port = 3002; Manager = 'npm' },
  @{ Name = 'orders';        Path = 'services\orders';        Port = 3003; Manager = 'pnpm' },
  @{ Name = 'payments';      Path = 'services\payments';      Port = 3004; Manager = 'npm' },
  @{ Name = 'tickets';       Path = 'services\tickets';       Port = 3005; Manager = 'pnpm' },
  @{ Name = 'notifications'; Path = 'services\notifications'; Port = 3006; Manager = 'npm' },
  @{ Name = 'checkin';       Path = 'services\checkin';       Port = 3007; Manager = 'npm' }
)

$started = @()

foreach ($svc in $services) {
  $svcDir = Join-Path $Root $svc.Path
  if (-not (Test-Path (Join-Path $svcDir 'package.json'))) {
    Write-Host "[skip] $($svc.Name) aún no está implementado en $($svc.Path)" -ForegroundColor DarkGray
    continue
  }
  if (-not (Test-Path (Join-Path $svcDir '.env'))) {
    Write-Warning "[skip] $($svc.Name): falta $svcDir\.env (copia .env.example a .env)"
    continue
  }
  if (-not (Test-Path (Join-Path $svcDir 'node_modules'))) {
    Write-Warning "[skip] $($svc.Name): falta node_modules (ejecuta $($svc.Manager) install)"
    continue
  }

  $outLog = Join-Path $LogsDir "$($svc.Name).out.log"
  $errLog = Join-Path $LogsDir "$($svc.Name).err.log"
  $cmd = if ($svc.Manager -eq 'pnpm') { "pnpm $Mode" } else { "npm run $Mode" }

  $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WorkingDirectory $svcDir `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru

  $started += [PSCustomObject]@{
    name = $svc.Name
    port = $svc.Port
    pid  = $proc.Id
  }
  Write-Host "[ok] $($svc.Name) iniciado (PID $($proc.Id), puerto $($svc.Port))" -ForegroundColor Green
}

$webDir = Join-Path $Root 'apps\web'
if ((Test-Path (Join-Path $webDir 'package.json')) -and (Test-Path (Join-Path $webDir 'node_modules'))) {
  $outLog = Join-Path $LogsDir 'web.out.log'
  $errLog = Join-Path $LogsDir 'web.err.log'
  $webCmd = if ($Mode -eq 'start') { 'npm run preview -- --port 5173 --host 127.0.0.1' } else { 'npm run dev -- --host 127.0.0.1' }
  $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $webCmd -WorkingDirectory $webDir `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
  $started += [PSCustomObject]@{
    name = 'web'
    port = 5173
    pid  = $proc.Id
  }
  Write-Host "[ok] web iniciado (PID $($proc.Id), puerto 5173)" -ForegroundColor Green
} else {
  Write-Warning "[skip] web: instala dependencias en apps\web con npm install"
}

$started | ConvertTo-Json | Set-Content -Path $PidsFile -Encoding UTF8
Write-Host ""
Write-Host "Logs en: $LogsDir"
Write-Host "Verifica salud con: .\scripts\smoke\check-health.ps1"
