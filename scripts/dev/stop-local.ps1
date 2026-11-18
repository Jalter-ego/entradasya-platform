# Detiene los procesos locales iniciados con start-local.ps1
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$PidsFile = Join-Path $Root '.local\pids.json'

if (-not (Test-Path $PidsFile)) {
  Write-Host "No hay archivo de PIDs ($PidsFile)."
  exit 0
}

$entries = Get-Content $PidsFile -Raw | ConvertFrom-Json
if ($entries -isnot [System.Array]) { $entries = @($entries) }

foreach ($entry in $entries) {
  if (-not $entry.pid) { continue }
  try {
    # taskkill /T /F cierra también los subprocesos hijos (cmd -> npm/tsx/node)
    & taskkill /PID $entry.pid /T /F 2>$null | Out-Null
    Write-Host "[stop] $($entry.name) (PID $($entry.pid))" -ForegroundColor Yellow
  } catch {
    Write-Host "[skip] $($entry.name) (PID $($entry.pid)) ya no estaba activo" -ForegroundColor DarkGray
  }
}

Remove-Item $PidsFile -Force -ErrorAction SilentlyContinue
Write-Host "Servicios locales detenidos. Los datos de PostgreSQL y PDFs se conservan."
