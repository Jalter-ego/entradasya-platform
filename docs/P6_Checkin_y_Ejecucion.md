# Documentación P6 — Control de ingreso (`checkin`), Gateway Nginx y Arranque Local

**Responsable:** P6 (Sebastian)

**Componentes cubiertos:** `services/checkin`, `apps/web/src/features/checkin`, `contracts/checkin.openapi.yaml`, `infra/nginx`, `scripts/dev`, `scripts/smoke` y compatibilidad de `services/tickets` con `DB_SCHEMA` para Supabase.

---

## 1. Arquitectura de base de datos en Supabase (proyecto único con schemas aislados)

Para que todo el equipo pueda trabajar y probar contra **una sola base de datos compartida** sin mezclar tablas ni romper el aislamiento de microservicios definido en [`docs/database/README.md`](database/README.md):

- Se utiliza un proyecto de Supabase dedicado (organización **EntradasYa**, proyecto `lqpvocebhdhetpmhfcom`, región `us-east-2`), separado de cualquier otro proyecto de la cuenta.
- Dentro de la base `postgres`, cada servicio usa su propio **schema** independiente:
  - `events` (P2): `events`, `sectors`, `reservations`, `pgmigrations` + 7 eventos y 12 sectores de demo.
  - `orders` (P3): `orders`, `order_items`, `pgmigrations`.
  - `tickets` (P5): `ticket_orders`, `tickets`, `pgmigrations`.
  - `checkin` (P6): `checkins`, `pgmigrations`.
  - `payments` (P4) y `auth_app` (P1): schemas creados y reservados para cuando se integren sus servicios (`auth_app` evita conflicto con el schema interno `auth` de Supabase).
- Seguridad aplicada en Supabase:
  - Se revocó acceso a `PUBLIC`, `anon` y `authenticated` en todos los schemas de los microservicios.
  - Se activó **Row Level Security (RLS)** en todas las tablas para impedir exposición vía Data API pública de Supabase; los backends se conectan con credenciales administrativas (`postgres.<ref>`) vía **Session Pooler (puerto `5432`)** en IPv4.
- **Nota de compatibilidad en código:** `services/tickets` (`src/config.ts`, `src/db.ts`, `src/server.ts`, `scripts/migrate.mjs`) fue actualizado para soportar `DB_SCHEMA` y `DATABASE_SSL_REJECT_UNAUTHORIZED` al igual que `events` y `checkin`, manteniendo `public` y `true` por defecto para ejecución local en PostgreSQL.

---

## 2. Backend `services/checkin` (Puerto `3007`)

Ubicación: [`services/checkin/`](../services/checkin/) · Contrato HTTP: [`contracts/checkin.openapi.yaml`](../contracts/checkin.openapi.yaml)

### Modelo de datos (`checkin.checkins`)
Migración: [`1763700000000_init-checkins.sql`](../services/checkin/migrations/1763700000000_init-checkins.sql)

- `id` (`uuid`, PK)
- `ticket_id` (`uuid`, `NOT NULL`, `UNIQUE`) — **unicidad exclusivamente por `ticket_id`** (impide reutilizar una entrada incluso seleccionando otro evento).
- `event_id` (`uuid`, `NOT NULL`)
- `doorman_id` (`uuid`, `NOT NULL`) — obtenido del claim `sub` del JWT validado.
- `checked_in_at` (`timestamptz`, `NOT NULL`, `DEFAULT now()`)
- Índice `(event_id, checked_in_at)` para el conteo y listado de ingresos recientes por evento.

### Endpoints y reglas implementadas
| Método y ruta | Acceso | Comportamiento |
|---|---|---|
| `GET /health` | Público | Verifica conexión a PostgreSQL y tabla `checkins` (`200` o `503`). |
| `POST /api/checkin` | JWT `role=doorman` | 1. Llama a `tickets` (`POST /internal/tickets/validate`) con `X-Internal-Token` y timeout (`INTERNAL_TIMEOUT_MS=5000`).<br>2. Rechaza `404 INVALID_TICKET` o `409 WRONG_EVENT` sin insertar filas.<br>3. Inserta con `INSERT ... ON CONFLICT (ticket_id) DO NOTHING`; si ya existía, consulta el registro confirmado y devuelve `409 ALREADY_USED` incluyendo `error.details.checkedInAt` con la hora exacta del primer ingreso.<br>4. Si `tickets` está caído o excede el timeout, responde `503 TICKETS_UNAVAILABLE` sin registrar ingreso. |
| `GET /api/checkin/events/:eventId/count` | JWT `doorman` u `organizer` | Devuelve `{ eventId, count }` calculado con `COUNT(*)`. |
| `GET /api/checkin/events/:eventId/recent` | JWT `doorman` u `organizer` | Devuelve los últimos ingresos registrados del evento. |

### Pruebas
- [`services/checkin/tests/unit.test.ts`](../services/checkin/tests/unit.test.ts): pruebas HTTP sin PostgreSQL (roles JWT, `/health`, `INVALID_TICKET`, `WRONG_EVENT`, `ALREADY_USED` con hora, `503 TICKETS_UNAVAILABLE` por caída/timeout).
- [`services/checkin/tests/checkin.test.ts`](../services/checkin/tests/checkin.test.ts): pruebas contra PostgreSQL real incluyendo **10 escaneos simultáneos** sobre el mismo código QR garantizando 1 solo ingreso `201` y 9 rechazos `409 ALREADY_USED`.

---

## 3. Frontend de Portería (`apps/web/src/features/checkin`)

- **Ruta protegida:** `/porteria` mediante `<RequireRole role="doorman">` en [`App.tsx`](../apps/web/src/App.tsx).
- **Navegación y login:** enlace **Portería** en [`Layout.tsx`](../apps/web/src/shared/Layout.tsx) y redirección tras iniciar sesión como `doorman` desde [`LoginPage.tsx`](../apps/web/src/features/auth/LoginPage.tsx).
- **Funcionalidades de [`CheckinPage.tsx`](../apps/web/src/features/checkin/pages/CheckinPage.tsx):**
  - Selector de eventos publicados (`GET /api/events`) con fecha, lugar y ciudad.
  - Entrada de código con `autoFocus` continuo (pensado para lector QR USB que actúa como teclado + `Enter` o ingreso manual).
  - Escáner opcional por cámara web ([`CameraScanner.tsx`](../apps/web/src/features/checkin/components/CameraScanner.tsx)) usando `BarcodeDetector` cuando el navegador lo soporta.
  - Tarjeta de **resultado visual claro**: `APROBADO`, `ALREADY_USED` (resaltando fecha y hora local del primer ingreso), `WRONG_EVENT` e `INVALID_TICKET`.
  - **Conteo en vivo** de asistentes ingresados e historial de escaneos recientes.

---

## 4. Gateway Nginx (`infra/nginx/`)

Archivos: [`entradasya.conf`](../infra/nginx/entradasya.conf), [`entradasya.dev.conf`](../infra/nginx/entradasya.dev.conf), [`nginx.windows.conf`](../infra/nginx/nginx.windows.conf) e [`infra/nginx/README.md`](../infra/nginx/README.md).

- Escucha en el puerto **`8080`**.
- **Bloquea `/internal/*`** devolviendo `404`.
- **No expone** `payments` (`3004`), `notifications` (`3006`) ni la carpeta local de PDF (`TICKETS_STORAGE_DIR`).
- Enruta las 5 APIs públicas conservando el prefijo `/api`: `/api/auth` (`3001`), `/api/events` (`3002`), `/api/orders` (`3003`), `/api/tickets` (`3005`) y `/api/checkin` (`3007`).
- Sirve la SPA React con respaldo `try_files $uri $uri/ /index.html;` para que rutas como `/porteria` y `/mis-entradas` funcionen al recargar.

---

## 5. Scripts de arranque, parada y verificación (`scripts/`)

- **Windows (PowerShell):**
  - [`scripts/dev/start-local.ps1`](../scripts/dev/start-local.ps1): inicia los servicios implementados que tengan `.env` y `node_modules` listos, guardando logs en `.local/logs/`.
  - [`scripts/dev/stop-local.ps1`](../scripts/dev/stop-local.ps1): detiene ordenadamente los procesos locales sin borrar datos ni PDFs.
  - [`scripts/smoke/check-health.ps1`](../scripts/smoke/check-health.ps1): consulta `/health` de los servicios y la web (con `-CheckGateway` valida también Nginx en `8080` y que `/internal/*` esté bloqueado).
- **Linux / Ubuntu (Bash):** equivalentes en [`start-local.sh`](../scripts/dev/start-local.sh), [`stop-local.sh`](../scripts/dev/stop-local.sh) y [`check-health.sh`](../scripts/smoke/check-health.sh).

---

## 6. Cómo probarlo paso a paso

1. Configura los `.env` de cada servicio (en local o apuntando al **Session pooler puerto `5432`** de Supabase con su respectivo `DB_SCHEMA`).
2. Ejecuta `.\scripts\dev\start-local.ps1` y luego `.\scripts\smoke\check-health.ps1`.
3. Abre `http://localhost:5173/login`:
   - Inicia sesión como **Portero** (`portero@demo.bo`) con la contraseña configurada al [sembrar auth](../services/auth/README.md#cuentas-de-demo).
   - Selecciona un evento publicado, ingresa el código de una entrada emitida por `tickets` y verifica que el primer escaneo devuelva **APROBADO** (conteo `+1`) y el segundo **RECHAZADO — Entrada ya utilizada** con la hora del primer ingreso.
