# orders - EntradasYa (P3)

Servicio de órdenes: recibe la compra del cliente y coordina `events -> payments -> tickets -> notifications`. Guarda el avance de cada paso para poder repetirlo sin duplicar órdenes, cobros ni entradas. También ofrece las consultas del comprador y el reporte de ventas del organizador. Solo usa su propia base `orders_db`; con los demás servicios se comunica por HTTP.

- Contrato HTTP: [`contracts/orders.openapi.yaml`](../../contracts/orders.openapi.yaml).
- Modelo de datos: [README de bases, sección P3](../../docs/database/README.md#5-p3--orders_db).
- Plan: tareas C1-C7 del [plan de implementación](../../docs/Plan_de_implementacion_EntradasYa_v1.md#p3---órdenes-y-compra).

## Requisitos

- Node.js 22.11 o superior y pnpm.
- PostgreSQL con una base exclusiva `orders_db` y su usuario `orders_user`.
- Clave **pública** RS256 de auth (P1).
- URLs y tokens internos de events, payments, tickets y notifications.

## Preparar y ejecutar

P4 prepara las bases y los usuarios. Si necesitas crear solo esta base, abre `psql` como administrador:

```sql
CREATE ROLE orders_user LOGIN;
\password orders_user
CREATE DATABASE orders_db OWNER orders_user;
```

Luego, desde la raíz del monorepo:

```bash
cd services/orders
pnpm install --frozen-lockfile
cp .env.example .env      # completar según la tabla de variables
pnpm migrate
pnpm dev
curl http://127.0.0.1:3003/health
```

El servidor no crea tablas al arrancar: si faltan las migraciones, no levanta. Tampoco arranca si falta o es inválida alguna variable; el log indica cuál.

| Comando | Uso |
|---|---|
| `pnpm dev` | Desarrollo con recarga. |
| `pnpm build` y `pnpm start` | Compilar y ejecutar `dist/`. |
| `pnpm typecheck` | Comprobar tipos. |
| `pnpm migrate` / `pnpm migrate:down` | Aplicar las pendientes / revertir la última. |
| `pnpm test` | Pruebas sobre `orders_test` (ver [Pruebas](#pruebas)). |

Para detener el servicio, usar `Ctrl+C`; las órdenes quedan guardadas en la base.

### Clave JWT mientras auth no exista

Usar el par de desarrollo **compartido** del equipo, en `services/events/keys/`. Lo usan también el login de prueba de la web y `dev-token`; su generación se explica en el [README de events](../events/README.md). Copiar `services/events/keys/auth-public.pem` a `services/orders/keys/auth-public.pem`. No generar un par propio, porque los tokens de la web no lo aceptarían. Cuando P1 entregue su clave pública, reemplazar ese archivo.

## Variables

Todas se leen únicamente en `src/config/config.ts`.

| Variable | Uso |
|---|---|
| `PORT`, `HOST` | `3003` y `127.0.0.1` por defecto. Solo loopback: el navegador entra por Nginx. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` o `silent`. |
| `DATABASE_URL`, `DATABASE_SSL` | Conexión exclusiva a `orders_db`. Si la clave tiene caracteres reservados, codificarla para URL. |
| `JWT_PUBLIC_KEY_FILE` / `JWT_PUBLIC_KEY` | Clave pública de auth; si se definen las dos, se usa el archivo. |
| `JWT_ALG`, `JWT_ISSUER`, `JWT_AUDIENCE` | `RS256`, `entradasya-auth`, `entradasya`. |
| `HTTP_TIMEOUT_MS` | Timeout por llamada interna; `5000` por defecto. |
| `TICKETS_TIMEOUT_MS` | Timeout de la emisión, más largo porque se generan PDF; `20000` por defecto. |
| `EVENTS_URL`, `EVENTS_INTERNAL_TOKEN` | events directo (`http://127.0.0.1:3002`). |
| `PAYMENTS_URL`, `PAYMENTS_INTERNAL_TOKEN` | payments (`:3004`). |
| `TICKETS_URL`, `TICKETS_INTERNAL_TOKEN` | tickets (`:3005`). |
| `NOTIFICATIONS_URL`, `NOTIFICATIONS_INTERNAL_TOKEN` | notifications (`:3006`). |

Cada token interno debe tener al menos 24 caracteres y **los cuatro deben ser distintos**. Cada uno es igual al `INTERNAL_TOKEN_ORDERS` del `.env` del servicio correspondiente. Para generarlos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

No subir a Git `.env`, `.env.test` ni `keys/`.

## API pública

Todas las rutas van bajo `/api/orders`, que Nginx conserva. orders no expone `/internal`.

| Ruta | Rol | Resultado |
|---|---|---|
| `POST /api/orders` + header `Idempotency-Key` | customer | 201 si la orden es nueva; 200 si se repitió la clave con el mismo cuerpo; 409 `IDEMPOTENCY_CONFLICT` si la clave se usó con otros datos. |
| `GET /api/orders/me?page=&perPage=` | customer | Mis compras, de la más reciente a la más antigua, con `meta` de paginación. |
| `GET /api/orders/:id` | customer | Detalle; una compra ajena responde 404. |
| `POST /api/orders/:id/retry` | customer | Reanuda solo los pasos pendientes. |
| `GET /api/orders/reports/events/:eventId` | organizer | Ventas e ingresos de órdenes pagadas, por sector. |

Cuerpo de la compra: `{ eventId, sectorId, quantity (1-6), payment: { method: "demo_card", last4: "1111" | "0000" } }`. El navegador no puede enviar precio, comprador ni correo: el precio sale de la reserva de events, y el comprador y el correo del JWT.

### Formato de respuesta

```json
{ "success": true, "message": "Compra realizada", "data": { }, "meta": null, "requestId": "..." }
```

```json
{ "success": false, "message": "...", "data": null,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "field": "quantity", "message": "..." }] },
  "meta": null, "requestId": "..." }
```

Los errores cumplen la convención común del plan, `{ error: { code, message }, requestId }`. `details` solo aparece en errores de validación. `meta` solo se llena en listados paginados (`currentPage`, `perPage`, `total`, `lastPage`).

### Resultado de una compra

Una compra agotada o con pago rechazado **no es un error HTTP**: la orden se crea y el motivo va en `data.lastError.code`.

| `data.status` | Significado |
|---|---|
| `paid` | Pago aprobado. Si tickets o el correo fallaron, la compra sigue pagada: `progress.tickets = pending` o `progress.notification = failed`, y se completa con el reintento. |
| `rejected` | `SOLD_OUT`, `EVENT_NOT_AVAILABLE`, `EVENT_NOT_FOUND` o `PAYMENT_REJECTED`. Con pago rechazado, los cupos se liberan. |
| `pending` | Un paso quedó incierto (timeout o servicio caído). Consultar el detalle o llamar al reintento. |

La web debe generar una `Idempotency-Key` por compra, por ejemplo con `crypto.randomUUID()`, y **reutilizarla** si reenvía esa misma compra (doble clic, timeout). Una compra nueva usa una clave nueva.

## Coordinación de la compra

Para cada orden, `src/services/orderProcessor.ts` guarda el intento **antes** de cada llamada remota y el resultado **después**. Así se puede ejecutar cualquier número de veces: solo hace lo que falta.

| Paso | Respuesta definitiva | Sin respuesta (timeout, red, 5xx) |
|---|---|---|
| 1. Reserva en events | `active` y copia de la reserva. Agotado, no disponible o inexistente: orden `rejected` **sin llamar a payments**. | `pending`; se repite con el mismo `orderId` (events es idempotente). |
| 2. Pago | Aprobado: orden `paid`. Rechazado: `rejected` y `release_pending`. | `unknown`, **nunca `rejected`**; los cupos siguen retenidos. |
| 3. Liberación | `released` una sola vez. | Sigue `release_pending`. |
| 4. Emisión | `issued`. El cuerpo se guarda en `ticket_issue_payload` antes de llamar y se reenvía sin cambios. | `pending`; la orden sigue `paid`, sin otro cobro. |
| 5. Correo | `sent`. Solo se envía con las entradas ya emitidas. | `failed`, o `unknown` si fue timeout. **No revierte la compra.** |

- **Serialización:** dos ejecuciones de la misma orden se serializan con un advisory lock de PostgreSQL en una conexión dedicada, que se libera siempre antes de devolverla al pool. Si otra petición tiene la orden más de 10 s, se responde con el estado actual.
- **Idempotencia de la compra:** la protegen `UNIQUE(customer_id, idempotency_key)` y el `request_hash` (SHA-256 de `eventId`, `sectorId`, `quantity` y `payment` normalizados).
- **Reenvío del correo:** el reintento vuelve a enviar un correo en `failed` o `unknown`, y puede duplicarlo, algo que acepta el README de bases. Nunca duplica órdenes, cobros ni entradas.

## Integración con otros servicios

| Servicio | Llamadas | Estado |
|---|---|---|
| events (P2) | `POST /internal/reservations`, `POST /internal/reservations/:orderId/release` | Según `contracts/events.openapi.yaml`. |
| tickets (P5) | `POST /internal/tickets/issue` | Según `contracts/tickets.openapi.yaml`: cuerpo del README de bases §9, **sin `city`**. |
| payments (P4) | `POST /internal/payments` `{ orderId, amountMinor, currency, method, last4 }` | **Provisional**, según plan §4 y README de bases §6. Ajustar `src/clients/paymentsClient.ts` cuando P4 publique su contrato. |
| notifications (P4) | `POST /internal/notifications/purchase` `{ orderId, to, event, sector, quantity, totalMinor, currency }` | **Provisional**. Ajustar `src/clients/notificationsClient.ts`. |

Todas las llamadas envían `X-Internal-Token` y `X-Request-Id`, tienen timeout y no siguen redirecciones. Los logs registran el servicio, la ruta, el estado y la duración, nunca los cuerpos.

**Para P2 (web de ventas):** el reporte responde dentro del envoltorio y los datos están en `body.data`: `{ eventId, currency, ordersPaid, ticketsSold, revenueMinor, sectors: [...] }`. Solo cuenta órdenes `paid`; un evento sin ventas devuelve ceros y `currency: null`.

**Para P6 (Nginx):**

```nginx
location /api/orders/ {
    proxy_pass http://127.0.0.1:3003;
    proxy_set_header Host $host;
    proxy_set_header X-Request-Id $request_id;
}
```

## Estructura

```text
src/
├── server.ts, app.ts
├── config/        # único lugar que lee process.env
├── constants/     # estados, roles, códigos de error, límites
├── database/      # pool, transacciones y lock por orden
├── middleware/    # requestId, JWT por rol, 404, errores
├── routes/        # routes.ts (montaje) y ordersRoutes.ts
├── controllers/   # validan la entrada y responden con ApiResponse
├── services/      # purchaseService y orderProcessor (coordinación)
├── repositories/  # SQL de órdenes y reportes
├── clients/       # HTTP interno: events, payments, tickets, notifications
├── builders/      # hash de la solicitud, cuerpo de emisión, correo, paginación
├── mappers/       # fila SQL -> JSON camelCase, mensajes
├── validators/    # esquemas zod de entrada
├── types/
└── utils/         # apiResponse, appError, logger, jwt, hash
```

## Pruebas

Las pruebas necesitan una base **desechable** cuyo nombre empiece por `orders_test`. Se niegan a usar cualquier otra, porque borran sus tablas. Como administrador:

```sql
CREATE DATABASE orders_test OWNER orders_user;
```

```bash
cp .env.test.example .env.test   # ajustar TEST_DATABASE_URL
pnpm test
```

Aplican las migraciones, generan su propia clave RSA y usan dobles HTTP de events, payments, tickets y notifications, así que no hace falta levantar ningún otro servicio. Cubren los escenarios V3 y V6-V11 del plan:
- **Validación (V3):** de 1 a 6 entradas; se rechazan la cantidad 7 y un precio enviado por el navegador.
- **Agotado (V6):** sin cobro, también con dos compradores por el último cupo.
- **Pago rechazado (V7):** libera los cupos una sola vez.
- **Idempotencia (V8):** repetición, conflicto y peticiones simultáneas.
- **Fallos (V9, V10):** timeouts y caídas de cada servicio, con su reintento.
- **Consultas y reporte (V11):** aislamiento entre compradores y reporte por organizador.

**Estado:** la suite está escrita, pero todavía no se ejecutó, porque falta crear `orders_test`. El flujo y los endpoints se verificaron manualmente contra `orders_db` con servicios dobles.

## Límites de v1

- Una orden compra de 1 a 6 entradas de **un solo sector**: una línea en `order_items`.
- No hay cancelación de compras pagadas, reembolsos ni endpoint de cancelación; el estado `cancelled` existe en la base pero no se usa.
- No hay colas ni reintentos automáticos en segundo plano: la recuperación es el reintento autenticado o reenviar la misma `Idempotency-Key`.
- Las entradas se consultan en tickets (`GET /api/tickets/me?orderId=`); orders no las devuelve.
