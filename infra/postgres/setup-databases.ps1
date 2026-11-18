# Crea las seis bases y usuarios de EntradasYa y comprueba su aislamiento (P4 - D1).
# Uso: .\infra\postgres\setup-databases.ps1            -> crear/actualizar y verificar
#      .\infra\postgres\setup-databases.ps1 -VerifyOnly -> solo verificar
param([switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
$EnvFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $EnvFile)) {
  Write-Error "Falta $EnvFile. Copia .env.example a .env y completa las claves."
}

$vars = @{}
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') { $vars[$Matches[1]] = $Matches[2] }
}
$services = @('auth', 'events', 'orders', 'payments', 'tickets', 'checkin')
foreach ($svc in $services) {
  if (-not $vars["$($svc.ToUpper())_DB_PASSWORD"]) { Write-Error "Falta $($svc.ToUpper())_DB_PASSWORD en $EnvFile" }
}
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Error 'No se encontró psql. Agrega la carpeta bin de PostgreSQL al PATH.'
}

$env:PGHOST = if ($vars.PGHOST) { $vars.PGHOST } else { 'localhost' }
$env:PGPORT = if ($vars.PGPORT) { $vars.PGPORT } else { '5432' }
$adminUser = if ($vars.PGUSER) { $vars.PGUSER } else { 'postgres' }
$adminPassword = $vars.PGPASSWORD

if (-not $VerifyOnly) {
  $env:PGUSER = $adminUser
  if ($adminPassword) { $env:PGPASSWORD = $adminPassword }
  $withTests = if ($vars.WITH_TEST_DBS) { $vars.WITH_TEST_DBS } else { '0' }
  & psql -X -q -d postgres -f (Join-Path $PSScriptRoot 'create-databases.sql') `
    -v "auth_password=$($vars.AUTH_DB_PASSWORD)" `
    -v "events_password=$($vars.EVENTS_DB_PASSWORD)" `
    -v "orders_password=$($vars.ORDERS_DB_PASSWORD)" `
    -v "payments_password=$($vars.PAYMENTS_DB_PASSWORD)" `
    -v "tickets_password=$($vars.TICKETS_DB_PASSWORD)" `
    -v "checkin_password=$($vars.CHECKIN_DB_PASSWORD)" `
    -v "with_test_dbs=$withTests"
  if ($LASTEXITCODE -ne 0) { Write-Error 'psql terminó con errores.' }
}

# --- Verificación: cada usuario entra a su base y NO a la de otro servicio -------
function Test-Connect($user, $password, $db) {
  # Un rechazo esperado escribe en stderr; en PowerShell 5.1 no debe detener el script.
  $ErrorActionPreference = 'Continue'
  $env:PGUSER = $user
  $env:PGPASSWORD = $password
  $out = & psql -X -q -t -A -d $db -c 'SELECT current_user' 2>$null
  return ($LASTEXITCODE -eq 0 -and "$out".Trim() -eq $user)
}

$failed = $false
for ($i = 0; $i -lt $services.Count; $i++) {
  $svc = $services[$i]
  $other = $services[($i + 1) % $services.Count]
  $pw = $vars["$($svc.ToUpper())_DB_PASSWORD"]
  if (Test-Connect "$($svc)_user" $pw "$($svc)_db") {
    Write-Host ("[OK]   {0,-14} se conecta a {1}" -f "$($svc)_user", "$($svc)_db") -ForegroundColor Green
  } else {
    Write-Host ("[FAIL] {0,-14} no puede conectarse a {1}" -f "$($svc)_user", "$($svc)_db") -ForegroundColor Red; $failed = $true
  }
  if (Test-Connect "$($svc)_user" $pw "$($other)_db") {
    Write-Host ("[FAIL] {0,-14} PUEDE conectarse a {1}" -f "$($svc)_user", "$($other)_db") -ForegroundColor Red; $failed = $true
  } else {
    Write-Host ("[OK]   {0,-14} bloqueado en {1}" -f "$($svc)_user", "$($other)_db") -ForegroundColor Green
  }
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if ($failed) { exit 1 }
exit 0
