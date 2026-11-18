# EntradasYa Platform

Plataforma de eventos, compra de entradas, generación de PDF/QR y control de ingreso en portería, desarrollada por seis integrantes.

## Documentación para el equipo

- [Esquema de bases de datos](docs/database/README.md): referencia de tablas, campos, restricciones, estados y datos compartidos. Consultar antes de crear o modificar migraciones.
- [Plan de implementación y reparto P1–P6](docs/Plan_de_implementacion_EntradasYa_v1.md): alcance, tareas, integración y aceptación.
- [Documentación P6 — Checkin, Nginx y ejecución local](docs/P6_Checkin_y_Ejecucion.md): detalle de lo implementado en portería, gateway y configuración compartida en Supabase.
- [Contratos HTTP](contracts/): especificaciones OpenAPI entre servicios (`events.openapi.yaml`, `orders.openapi.yaml`, `tickets.openapi.yaml`, `checkin.openapi.yaml`).

## Componentes actuales

- [Web](apps/web/README.md) — Interfaz React + Vite (`http://localhost:5173`).
- [Events — P2](services/events/README.md) — Eventos, sectores y reservas (`127.0.0.1:3002`).
- [Orders — P3](services/orders/README.md) — Órdenes, coordinación de compra y reportes (`127.0.0.1:3003`).
- [Tickets — P5](services/tickets/README.md) — Emisión idempotente, PDF con QR y descarga (`127.0.0.1:3005`).
- [Checkin — P6](services/checkin/README.md) — Portería, validación de QR, ingreso único y conteo (`127.0.0.1:3007`).
- [Nginx — P6](infra/nginx/README.md) — Gateway único en `http://localhost:8080` (bloquea `/internal/*` y no expone `payments`/`notifications`).

El esquema documenta también los servicios pendientes (`auth`, `payments`, `notifications`). Cada responsable mantiene el arranque y las migraciones de su servicio.

## Arranque y verificación local (P6)

### 1. Preparar bases de datos, claves y `.env`

1. En PostgreSQL local, crear la base y usuario exclusivo de cada servicio implementado (`events_db`, `orders_db`, `tickets_db`, `checkin_db`), copiar `.env.example` a `.env` en cada carpeta y completar las variables.
   - **Si usan el proyecto compartido en Supabase** (organización `EntradasYa`, proyecto `lqpvocebhdhetpmhfcom`, región `us-east-2`): las tablas de `events`, `orders`, `tickets`, `checkin` y los 7 eventos de demo ya están migrados en schemas separados (`events`, `orders`, `tickets`, `checkin`, además de `payments` y `auth_app` preparados). Solo configuren en cada `.env` la cadena **Session pooler (puerto `5432`)**, `DATABASE_SSL=true` y `DB_SCHEMA=<servicio>` (en `tickets` además `DATABASE_SSL_REJECT_UNAUTHORIZED=false`). No usen el Transaction pooler (`6543`) ni `TEST_DATABASE_URL` contra esta base compartida.
2. Generar el par de claves RS256 de desarrollo en `services/events/keys/` (como indica `services/events/README.md`) y copiar `auth-public.pem` en los demás servicios (`orders`, `tickets`, `checkin`) o apuntar `JWT_PUBLIC_KEY_FILE` al mismo archivo público.
3. Configurar los mismos `INTERNAL_TOKEN_*` (≥ 24 caracteres) entre servicios pares (`INTERNAL_TOKEN_CHECKIN` compartido únicamente entre `tickets` y `checkin`).
4. Instalar dependencias y aplicar migraciones en cada servicio (`npm install` / `pnpm install`), e instalar dependencias en `apps/web` (`npm install`).

### 2. Iniciar y detener todos los servicios disponibles

**Windows (PowerShell):**

```powershell
.\scripts\dev\start-local.ps1          # modo desarrollo
.\scripts\smoke\check-health.ps1       # verifica /health de cada servicio
.\scripts\dev\stop-local.ps1           # detiene los procesos conservando BD y PDFs
```

**Linux / Ubuntu (Bash):**

```bash
./scripts/dev/start-local.sh
./scripts/smoke/check-health.sh
./scripts/dev/stop-local.sh
```

Para validar también a través del gateway Nginx (`http://localhost:8080`):

```powershell
.\scripts\smoke\check-health.ps1 -CheckGateway
```
