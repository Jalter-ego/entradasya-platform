#!/usr/bin/env bash
set -euo pipefail

CHECK_GATEWAY="${1:-}"
HAS_FAILURE=0

check_url() {
  local name="$1"
  local url="$2"
  local required="$3"
  local code

  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" || echo "000")
  if [ "$code" = "200" ]; then
    printf "[OK]   %-15s HTTP %s %s\n" "$name" "$code" "$url"
  elif [ "$code" = "000" ]; then
    if [ "$required" = "1" ]; then
      printf "[DOWN] %-15s sin respuesta (%s)\n" "$name" "$url"
      HAS_FAILURE=1
    else
      printf "[INFO] %-15s no activo (%s)\n" "$name" "$url"
    fi
  else
    printf "[FAIL] %-15s HTTP %s %s\n" "$name" "$code" "$url"
    if [ "$required" = "1" ]; then HAS_FAILURE=1; fi
  fi
}

check_url "auth"          "http://127.0.0.1:3001/health" 1
check_url "events"        "http://127.0.0.1:3002/health" 1
check_url "orders"        "http://127.0.0.1:3003/health" 0
check_url "payments"      "http://127.0.0.1:3004/health" 0
check_url "tickets"       "http://127.0.0.1:3005/health" 1
check_url "notifications" "http://127.0.0.1:3006/health" 0
check_url "checkin"       "http://127.0.0.1:3007/health" 1
check_url "web (Vite)"    "http://localhost:5173/"       0

if [ "$CHECK_GATEWAY" = "--gateway" ]; then
  echo ""
  echo "--- Verificación de Nginx (http://localhost:8080) ---"
  check_url "Nginx web" "http://localhost:8080/" 1
  internal_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:8080/internal/tickets/validate" || echo "000")
  if [ "$internal_code" = "404" ] || [ "$internal_code" = "403" ]; then
    echo "[OK]   /internal bloqueado en Nginx (HTTP $internal_code)"
  else
    echo "[FAIL] /internal NO está bloqueado correctamente en Nginx (HTTP $internal_code)"
    HAS_FAILURE=1
  fi
fi

exit "$HAS_FAILURE"
