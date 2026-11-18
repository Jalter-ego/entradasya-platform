# EntradasYa Platform

Plataforma de eventos, compra de entradas, generación de PDF/QR y control de ingreso en portería, desarrollada por seis integrantes.

## Documentación para el equipo

- [Esquema de bases de datos](docs/database/README.md): referencia de tablas, campos, restricciones, estados y datos compartidos. Consultar antes de crear o modificar migraciones.
- [Plan de implementación y reparto P1–P6](docs/Plan_de_implementacion_EntradasYa_v1.md): alcance, tareas, integración y aceptación.
- [Documentación P6 — Checkin, Nginx y ejecución local](docs/P6_Checkin_y_Ejecucion.md): detalle de lo implementado en portería, gateway y configuración compartida en Supabase.
- [Contratos HTTP](contracts/): especificaciones OpenAPI de events, orders, payments, tickets, notifications y checkin.

## Componentes actuales

- [Web](apps/web/README.md) — Interfaz React + Vite (`http://localhost:5173`).
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

El esquema documenta también el servicio pendiente (`auth`, P1). Cada responsable mantiene el arranque y las migraciones de su servicio.

## Arranque y verificación local (P6)

### 1. Preparar bases de datos, claves y `.env`

1. En PostgreSQL local, crear la base y usuario exclusivo de cada servicio con datos implementado (`events_db`, `orders_db`, `payments_db`, `tickets_db`, `checkin_db`), siguiendo `infra/postgres/README.md`. Preparar `auth_db` para P1. Notifications no necesita base. Copiar `.env.example` a `.env` solo si todavía no existe, y completar las variables sin sobrescribir la configuración local.
   - **Si usan Supabase**, consultar los README de cada servicio y la documentación de P6: usar conexión directa o Session pooler, configurar SSL y el schema correspondiente. Verificar/aplicar las migraciones en el entorno usado; no asumir que sus tablas ya existen ni usar una base compartida como base desechable de pruebas.
2. Usar el par de claves RS256 de desarrollo compartido en `services/events/keys/`; si no existe, generarlo una sola vez como indica el README de events. Copiar únicamente `auth-public.pem` en `orders`, `tickets` y `checkin`, o apuntar `JWT_PUBLIC_KEY_FILE` al mismo archivo público. No regenerar un par diferente por servicio.
3. Configurar un token distinto (≥ 24 caracteres) por cada par: orders/events, orders/payments, orders/tickets, orders/notifications y checkin/tickets. En cada par, emisor y receptor deben tener exactamente el mismo valor. `INTERNAL_TOKEN_CHECKIN` se comparte únicamente entre `tickets` y `checkin`.
4. Instalar dependencias y aplicar migraciones según el README de cada servicio (`npm install` / `pnpm install`), e instalar dependencias en `apps/web` (`npm install`).

### 2. Iniciar y detener todos los servicios disponibles

Levantar Mailpit por separado con el script de `infra/mailpit/` para que notifications pueda enviar correos. Los scripts siguientes inician los servicios disponibles y la web; auth se omite mientras P1 no esté integrado. Antes de ejecutar el arranque conjunto, detener las instancias manuales que ya ocupen esos puertos.

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
