#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIDS_FILE="$ROOT/.local/pids.txt"

if [ ! -f "$PIDS_FILE" ]; then
  echo "No hay archivo de PIDs ($PIDS_FILE)."
  exit 0
fi

while IFS=: read -r name pid port; do
  [ -z "${pid:-}" ] && continue
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "[stop] $name (PID $pid, puerto $port)"
  else
    echo "[skip] $name (PID $pid) ya no estaba activo"
  fi
done < "$PIDS_FILE"

rm -f "$PIDS_FILE"
echo "Servicios locales detenidos. Los datos de PostgreSQL y PDFs se conservan."
