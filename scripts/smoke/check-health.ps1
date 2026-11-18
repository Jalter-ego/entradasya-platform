# Verifica /health de todos los servicios configurados y opcionalmente del gateway Nginx (8080)
param(
  [switch]$CheckGateway
)

$targets = @(
  @{ Name = 'auth';          Url = 'http://127.0.0.1:3001/health'; Required = $true },
  @{ Name = 'events';        Url = 'http://127.0.0.1:3002/health'; Required = $true },
  @{ Name = 'orders';        Url = 'http://127.0.0.1:3003/health'; Required = $false },
  @{ Name = 'payments';      Url = 'http://127.0.0.1:3004/health'; Required = $false },
  @{ Name = 'tickets';       Url = 'http://127.0.0.1:3005/health'; Required = $true },
  @{ Name = 'notifications'; Url = 'http://127.0.0.1:3006/health'; Required = $false },
  @{ Name = 'checkin';       Url = 'http://127.0.0.1:3007/health'; Required = $true },
  @{ Name = 'web (Vite)';    Url = 'http://localhost:5173/';       Required = $false }
)

$hasFailure = $false

foreach ($t in $targets) {
  try {
    $res = Invoke-WebRequest -Uri $t.Url -TimeoutSec 3 -UseBasicParsing
    Write-Host "[OK]   $($t.Name.PadRight(15)) $($res.StatusCode) $($t.Url)" -ForegroundColor Green
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status) {
      Write-Host "[FAIL] $($t.Name.PadRight(15)) HTTP $status $($t.Url)" -ForegroundColor Red
      if ($t.Required) { $hasFailure = $true }
    } elseif ($t.Required) {
      Write-Host "[DOWN] $($t.Name.PadRight(15)) sin respuesta ($($t.Url))" -ForegroundColor Red
      $hasFailure = $true
    } else {
      Write-Host "[INFO] $($t.Name.PadRight(15)) no activo ($($t.Url))" -ForegroundColor DarkGray
    }
  }
}

if ($CheckGateway) {
  Write-Host ""
  Write-Host "--- Verificación de Nginx (http://localhost:8080) ---"
  try {
    $web = Invoke-WebRequest -Uri 'http://localhost:8080/' -TimeoutSec 3 -UseBasicParsing
    Write-Host "[OK]   Nginx web       $($web.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "[FAIL] Nginx web no responde en http://localhost:8080/" -ForegroundColor Red
    $hasFailure = $true
  }

  try {
    $internal = Invoke-WebRequest -Uri 'http://localhost:8080/internal/tickets/validate' -TimeoutSec 3 -UseBasicParsing
    Write-Host "[FAIL] /internal NO está bloqueado en Nginx (devolvió $($internal.StatusCode))" -ForegroundColor Red
    $hasFailure = $true
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 404 -or $code -eq 403) {
      Write-Host "[OK]   /internal bloqueado en Nginx (HTTP $code)" -ForegroundColor Green
    } else {
      Write-Host "[WARN] /internal devolvió estado inesperado ($code)" -ForegroundColor Yellow
    }
  }
}

if ($hasFailure) { exit 1 }
