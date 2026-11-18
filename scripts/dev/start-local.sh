#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_DIR="$ROOT/.local"
LOGS_DIR="$LOCAL_DIR/logs"
PIDS_FILE="$LOCAL_DIR/pids.txt"

mkdir -p "$LOGS_DIR"
: > "$PIDS_FILE"

start_service() {
  local name="$1"
  local rel="$2"
  local port="$3"
  local mgr="$4"
  local dir="$ROOT/$rel"

  if [ ! -f "$dir/package.json" ]; then
    echo "[skip] $name aún no está implementado en $rel"
    return
  fi
  if [ "$name" != "web" ] && [ ! -f "$dir/.env" ]; then
    echo "[warn] $name: falta $dir/.env (copia .env.example a .env)"
    return
  fi
  if [ ! -d "$dir/node_modules" ]; then
    echo "[warn] $name: falta node_modules (ejecuta $mgr install en $rel)"
    return
  fi

  (
    cd "$dir"
    if [ "$mgr" = "pnpm" ]; then
      nohup pnpm "$MODE" > "$LOGS_DIR/$name.out.log" 2> "$LOGS_DIR/$name.err.log" &
    else
      if [ "$name" = "web" ] && [ "$MODE" = "start" ]; then
        nohup npm run preview -- --port 5173 --host 127.0.0.1 > "$LOGS_DIR/$name.out.log" 2> "$LOGS_DIR/$name.err.log" &
      elif [ "$name" = "web" ]; then
        nohup npm run dev -- --host 127.0.0.1 > "$LOGS_DIR/$name.out.log" 2> "$LOGS_DIR/$name.err.log" &
      else
        nohup npm run "$MODE" > "$LOGS_DIR/$name.out.log" 2> "$LOGS_DIR/$name.err.log" &
      fi
    fi
    echo "$name:$!:$port" >> "$PIDS_FILE"
  )
  echo "[ok] $name iniciado (puerto $port)"
}

start_service "auth"          "services/auth"          3001 npm
start_service "events"        "services/events"        3002 npm
start_service "orders"        "services/orders"        3003 pnpm
start_service "payments"      "services/payments"      3004 npm
start_service "tickets"       "services/tickets"       3005 pnpm
start_service "notifications" "services/notifications" 3006 npm
start_service "checkin"       "services/checkin"       3007 npm
start_service "web"           "apps/web"               5173 npm

echo "Logs en: $LOGS_DIR"
echo "Verifica salud con: ./scripts/smoke/check-health.sh"
