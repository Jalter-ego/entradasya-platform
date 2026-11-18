# checkin — EntradasYa (P6)

Servicio de control de ingreso en portería. Valida códigos contra `tickets` (P5), garantiza un único ingreso por `ticket_id` en `checkin_db` y expone el conteo por evento.

- Puerto por defecto: `3007` (escucha en `127.0.0.1`; el navegador entra por Nginx).
- Contrato: [`contracts/checkin.openapi.yaml`](../../contracts/checkin.openapi.yaml).
- Esquema de referencia: [`docs/database/README.md`](../../docs/database/README.md#8-p6--checkin_db).
- Stack: Node.js ≥ 22.11 + TypeScript, Express 5, PostgreSQL (`pg`), migraciones con `node-pg-migrate`.

## Qué hace

| Quién | Qué puede hacer |
|---|---|
| Portero (`doorman`) | Registrar ingresos (`POST /api/checkin`), consultar conteo (`GET /api/checkin/events/:eventId/count`) y últimos ingresos (`/recent`). |
| Organizador (`organizer`) | Consultar conteo y últimos ingresos de un evento. |
| Interno (`tickets`) | `checkin` llama a `POST /internal/tickets/validate` en `tickets` con `X-Internal-Token` (`INTERNAL_TOKEN_CHECKIN`). |

## Garantías

- **Un único ingreso por entrada:** `checkins.ticket_id` tiene restricción `UNIQUE` en PostgreSQL (no por par `(ticket_id, event_id)`). Ante dos escaneos simultáneos o repetidos, solo uno inserta (`201`) y los demás reciben `409 ALREADY_USED` con la fecha/hora exacta del primer ingreso (`error.details.checkedInAt`).
- **Sin registros inválidos:** códigos inexistentes (`404 INVALID_TICKET`), de otro evento (`409 WRONG_EVENT`) o fallos/timeouts de `tickets` (`503 TICKETS_UNAVAILABLE`) no insertan filas en `checkins`.
- **Conteo derivado:** usa `COUNT(*)` sobre `checkins` filtrado por `event_id`.

## Arranque local

```bash
cd services/checkin
npm install
cp .env.example .env
```

Si creas la base manualmente como superusuario en `psql`:

```sql
CREATE USER checkin_user WITH PASSWORD 'cambiar-esta-clave';
CREATE DATABASE checkin_db OWNER checkin_user;
```

En `.env` configura:
1. `DATABASE_URL` apuntando a `checkin_db`.
2. `JWT_PUBLIC_KEY_FILE` apuntando a la clave pública compartida (en desarrollo, la misma usada con `events` y `tickets`, por ejemplo `../events/keys/auth-public.pem` o copia en `./keys/auth-public.pem`).
3. `TICKETS_URL=http://127.0.0.1:3005`.
4. `INTERNAL_TOKEN_CHECKIN`: exactamente el mismo token aleatorio (≥ 24 caracteres) configurado en `services/tickets/.env`.

Luego aplica migraciones y arranca:

```bash
npm run migrate
npm run dev
# o para producción local:
npm run build
npm start
```

Comprobar salud:

```bash
curl http://127.0.0.1:3007/health
```

## Pruebas

Requiere una base desechable en PostgreSQL:

```sql
CREATE DATABASE checkin_test OWNER checkin_user;
```

```bash
cp .env.test.example .env.test
# Editar TEST_DATABASE_URL en .env.test
npm test
```

Las pruebas levantan el servidor Express real y un servidor HTTP simulado para `/internal/tickets/validate`, verificando roles JWT, concurrencia de 10 escaneos simultáneos sobre el mismo código, `INVALID_TICKET`, `WRONG_EVENT`, `ALREADY_USED` y timeouts (`503`).
