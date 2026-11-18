#!/usr/bin/env bash
# Crea las seis bases y usuarios de EntradasYa y comprueba su aislamiento (P4 - D1).
# Uso: ./infra/postgres/setup-databases.sh            -> crear/actualizar y verificar
#      ./infra/postgres/setup-databases.sh --verify   -> solo verificar
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Falta $ENV_FILE. Copia .env.example a .env y completa las claves." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

for var in AUTH_DB_PASSWORD EVENTS_DB_PASSWORD ORDERS_DB_PASSWORD PAYMENTS_DB_PASSWORD TICKETS_DB_PASSWORD CHECKIN_DB_PASSWORD; do
  if [ -z "${!var:-}" ]; then echo "Falta $var en $ENV_FILE" >&2; exit 1; fi
done

export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"

if [ "${1:-}" != "--verify" ]; then
  psql -X -q -d postgres -f "$DIR/create-databases.sql" \
    -v auth_password="$AUTH_DB_PASSWORD" \
    -v events_password="$EVENTS_DB_PASSWORD" \
    -v orders_password="$ORDERS_DB_PASSWORD" \
    -v payments_password="$PAYMENTS_DB_PASSWORD" \
    -v tickets_password="$TICKETS_DB_PASSWORD" \
    -v checkin_password="$CHECKIN_DB_PASSWORD" \
    -v with_test_dbs="${WITH_TEST_DBS:-0}"
fi

# --- Verificación: cada usuario entra a su base y NO a la de otro servicio -------
services=(auth events orders payments tickets checkin)
failures=0
as_user() { # usuario clave base
  PGUSER="$1" PGPASSWORD="$2" psql -X -q -t -A -d "$3" -c 'SELECT current_user' 2>/dev/null
}
for i in "${!services[@]}"; do
  svc="${services[$i]}"
  other="${services[$(( (i + 1) % ${#services[@]} ))]}"
  pw_var="$(echo "$svc" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
  pw="${!pw_var}"
  if [ "$(as_user "${svc}_user" "$pw" "${svc}_db" || true)" = "${svc}_user" ]; then
    printf "[OK]   %-14s se conecta a %s\n" "${svc}_user" "${svc}_db"
  else
    printf "[FAIL] %-14s no puede conectarse a %s\n" "${svc}_user" "${svc}_db"; failures=1
  fi
  if as_user "${svc}_user" "$pw" "${other}_db" >/dev/null; then
    printf "[FAIL] %-14s PUEDE conectarse a %s (debería estar bloqueado)\n" "${svc}_user" "${other}_db"; failures=1
  else
    printf "[OK]   %-14s bloqueado en %s\n" "${svc}_user" "${other}_db"
  fi
done
exit "$failures"
