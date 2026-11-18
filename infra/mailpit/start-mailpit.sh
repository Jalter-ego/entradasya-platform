#!/usr/bin/env bash
# Inicia Mailpit en loopback: SMTP 127.0.0.1:1025 e interfaz http://127.0.0.1:8025 (P4 - D5).
# Uso: ./infra/mailpit/start-mailpit.sh
# Variables opcionales: MAILPIT_BIN, MAILPIT_SMTP, MAILPIT_UI, MAILPIT_DB, MAILPIT_MAX
set -euo pipefail

BIN="${MAILPIT_BIN:-mailpit}"
if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "No se encontró '$BIN'. Instálalo según infra/mailpit/README.md o define MAILPIT_BIN." >&2
  exit 1
fi

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entradasya"
mkdir -p "$DATA_DIR"

exec "$BIN" \
  --smtp "${MAILPIT_SMTP:-127.0.0.1:1025}" \
  --listen "${MAILPIT_UI:-127.0.0.1:8025}" \
  --database "${MAILPIT_DB:-$DATA_DIR/mailpit.db}" \
  --max "${MAILPIT_MAX:-500}"
