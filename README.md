# EntradasYa Platform

Plataforma de eventos, compra de entradas, generación de PDF/QR y control de ingreso en portería, desarrollada por seis integrantes.

## Documentación para el equipo

- [Esquema de bases de datos](docs/database/README.md): referencia de tablas, campos, restricciones, estados y datos compartidos. Consultar antes de crear o modificar migraciones.
- [Plan de implementación y reparto P1–P6](docs/Plan_de_implementacion_EntradasYa_v1.md): alcance, tareas, integración y aceptación.
- [Documentación P1 — Autenticación y acceso](docs/P1_Autenticacion_y_Acceso.md): servicio, web, integración JWT y verificación.
- [Documentación P6 — Checkin, Nginx y ejecución local](docs/P6_Checkin_y_Ejecucion.md): detalle de lo implementado en portería, gateway y configuración compartida en Supabase.
- [Contratos HTTP](contracts/): especificaciones OpenAPI de los siete servicios.

## Componentes actuales

- [Web](apps/web/README.md) — Interfaz React + Vite (`http://localhost:5173`).
- [Auth — P1](services/auth/README.md) — Registro, login y emisión de JWT (`127.0.0.1:3001`).
- [Events — P2](services/events/README.md) — Eventos, sectores y reservas (`127.0.0.1:3002`).
- [Orders — P3](services/orders/README.md) — Órdenes, coordinación de compra y reportes (`127.0.0.1:3003`).
- [Payments — P4](services/payments/README.md) — Pago simulado e idempotente, solo interno (`127.0.0.1:3004`).
- [Tickets — P5](services/tickets/README.md) — Emisión idempotente, PDF con QR y descarga (`127.0.0.1:3005`).
- [Notifications — P4](services/notifications/README.md) — Correo de confirmación a Mailpit, solo interno (`127.0.0.1:3006`).
- [Checkin — P6](services/checkin/README.md) — Portería, validación de QR, ingreso único y conteo (`127.0.0.1:3007`).

## Infraestructura local

- [PostgreSQL — P4](infra/postgres/README.md): script para crear las seis bases y sus usuarios exclusivos.
- [Mailpit — P4](infra/mailpit/README.md): instalación del binario y arranque en `127.0.0.1:1025` (SMTP) / `:8025` (interfaz).
- [Nginx — P6](infra/nginx/README.md) — Gateway único en `http://localhost:8080` (bloquea `/internal/*` y no expone `payments`/`notifications`).

## Arranque y verificación local (P6)

### 1. Preparar bases de datos, claves y `.env`

1. En PostgreSQL local, crear las bases y usuarios exclusivos para `auth_db`, `events_db`, `orders_db`, `payments_db`, `tickets_db` y `checkin_db` según [el procedimiento de P4](infra/postgres/README.md). Copiar `.env.example` a `.env` según corresponda y completar las variables.
   - **Si usan Supabase**, consultar los README de cada servicio y la documentación de P6: usar conexión directa o Session pooler, configurar SSL y el schema correspondiente. Verificar/aplicar las migraciones en el entorno usado; no asumir que sus tablas ya existen ni usar una base compartida como base desechable de pruebas.
2. Preparar un único par RSA en [auth](services/auth/README.md#arranque-local). Configurar el PEM público en `events`, `orders`, `tickets` y `checkin` mediante `JWT_PUBLIC_KEY_FILE` y el mismo emisor y audiencia.
3. Configurar un token distinto (≥ 24 caracteres) por cada par: orders/events, orders/payments, orders/tickets, orders/notifications y checkin/tickets. En cada par, emisor y receptor deben tener exactamente el mismo valor. `INTERNAL_TOKEN_CHECKIN` se comparte únicamente entre `tickets` y `checkin`.
4. Instalar dependencias y aplicar migraciones según el README de cada servicio (`npm ci` / `pnpm install`). Para preparar las cuentas de demo, definir `DEMO_PASSWORD` y ejecutar `npm run seed` desde `services/auth`. Instalar las dependencias de la web desde `apps/web` con `npm ci`.

### 2. Iniciar y detener todos los servicios disponibles

Levantar Mailpit por separado con el script de `infra/mailpit/` para que notifications pueda enviar correos. Los scripts siguientes incluyen auth y la web. Antes de ejecutar el arranque conjunto, detener las instancias manuales que ya ocupen esos puertos.

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
