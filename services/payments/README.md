# payments - EntradasYa (P4)

Pago **simulado** de una orden. Servicio interno: solo lo llama orders, con un token exclusivo del par orders ↔ payments. Guarda un único resultado por orden en su base `payments_db`, así repetir un cobro nunca crea otra transacción.

- Contrato HTTP: [`contracts/payments.openapi.yaml`](../../contracts/payments.openapi.yaml).
- Modelo de datos: [README de bases, sección P4](../../docs/database/README.md#6-p4--payments_db-y-notifications).
- Plan: tareas D2, D3 y D7 del [plan de implementación](../../docs/Plan_de_implementacion_EntradasYa_v1.md#p4---pago-correo-y-soporte-de-datos).

## Regla de la demo

| `last4` | Resultado |
|---|---|
| `1111` | `approved` |
| `0000` | `rejected`, `rejectionCode=PAYMENT_REJECTED` |
| otro | `400 VALIDATION_ERROR`, sin crear pago |

Solo se recibe `method=demo_card` y `last4`. No hay número de tarjeta, CVV ni dinero real; cualquier campo extra se rechaza con 400. Un rechazo es un **resultado de negocio** (2xx con `status=rejected`), no un error 500.

## Requisitos

- Node.js 20.11 o superior y npm.
- PostgreSQL con la base `payments_db` y el usuario `payments_user`, creados con [`infra/postgres`](../../infra/postgres/README.md).

## Preparar y ejecutar

```bash
cd services/payments
npm install
cp .env.example .env      # completar DATABASE_URL e INTERNAL_TOKEN_ORDERS
npm run migrate
npm run dev
curl http://127.0.0.1:3004/health    # {"status":"ok","service":"payments"}
```

| Comando | Uso |
|---|---|
| `npm run dev` | Desarrollo con recarga. |
| `npm run build` y `npm start` | Compilar y ejecutar `dist/`. |
| `npm run typecheck` | Comprobar tipos. |
| `npm run migrate` / `npm run migrate:down` | Aplicar las pendientes / revertir la última. |
| `npm test` | Pruebas sobre PostgreSQL real (ver [Pruebas](#pruebas)). |

El servidor no crea tablas al arrancar; si falta la migración, `/health` responde 503. Para detenerlo, `Ctrl+C`: los pagos quedan guardados.

## Variables

| Variable | Uso |
|---|---|
| `PORT`, `HOST` | `3004` y `127.0.0.1`. Solo loopback: ni el navegador ni Nginx deben llegar a payments. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` o `silent`. |
| `DATABASE_URL`, `DATABASE_SSL` | Conexión exclusiva a `payments_db`. |
| `DB_SCHEMA` | `public` en local. En el Supabase compartido, `payments`. |
| `INTERNAL_TOKEN_ORDERS` | Token del par orders ↔ payments, ≥ 24 caracteres. **Igual** a `PAYMENTS_INTERNAL_TOKEN` del `.env` de orders y distinto de los demás tokens. |

Generar un token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. No subir `.env` a Git.

## API interna

| Ruta | Resultado |
|---|---|
| `POST /internal/payments` | `201` resultado nuevo; `200` repetición del mismo cuerpo (mismo `transactionId`); `400` cuerpo inválido; `401` sin token; `409 IDEMPOTENCY_CONFLICT` si la orden ya se cobró con otro importe, moneda o tarjeta. |
| `GET /internal/payments/orders/:orderId` | `200` el pago registrado; `404` si la orden nunca se cobró. |
| `GET /health` | `200` con base y migración; `503` si no. |

Cuerpo: `{ orderId, amountMinor, currency, method: "demo_card", last4: "1111" | "0000" }`.

Respuesta: `{ transactionId, orderId, status, amountMinor, currency, method, last4, rejectionCode, createdAt }`. Coincide con el cliente de orders (`services/orders/src/clients/paymentsClient.ts`).

### Idempotencia y concurrencia

- `UNIQUE(order_id)` en PostgreSQL: el `INSERT ... ON CONFLICT DO NOTHING` deja que la base resuelva dos peticiones simultáneas; la segunda lee la fila de la primera.
- `request_hash` = SHA-256 de `amountMinor`, `currency`, `method` y `last4` normalizados. Si una repetición trae otro hash → 409.
- El resultado es definitivo: la fila nunca se actualiza ni se borra.
- Tras un timeout, orders consulta `GET /internal/payments/orders/:orderId` o repite el mismo POST; en ningún caso se cobra dos veces.

### Seguridad

- `/internal/*` exige `X-Internal-Token` (comparación en tiempo constante). Un JWT de cliente no sirve.
- Escucha en `127.0.0.1` y Nginx no tiene ruta hacia el puerto 3004 (P6 bloquea `/internal/*`).
- Los logs registran `orderId`, `transactionId` y resultado; nunca el cuerpo de la petición.

## Pruebas

Necesitan PostgreSQL real, porque prueban la concurrencia. Crean y borran su propio schema `payments_test` en la base indicada:

```bash
cp .env.test.example .env.test   # TEST_DATABASE_URL, p. ej. la base payments_test
npm test
```

`infra/postgres` con `WITH_TEST_DBS=1` crea la base desechable `payments_test`.

Cubren: salud; token interno obligatorio (sin token, token incorrecto, JWT de cliente); aprobación con `1111`; rechazo 2xx con `0000`; 400 para otras terminaciones, campos extra (número de tarjeta, CVV) y datos inválidos; repetición con el mismo `transactionId` (también de un rechazo); 409 si cambia importe, moneda o tarjeta; diez cobros simultáneos de la misma orden con una sola transacción; consulta por orden y 404.

**Estado:** 16 pruebas en verde sobre PostgreSQL 17 local.

## Estructura

```text
src/
├── server.ts, app.ts   # arranque, /health y montaje de /internal
├── config.ts           # único lugar que lee process.env
├── db.ts               # pool de PostgreSQL
├── logger.ts           # logs JSON de una línea
├── http/               # requestId, errores, token interno
├── routes/internal.ts  # validación zod y endpoints
└── repo/payments.ts    # cobro idempotente, hash y consulta
migrations/             # 1763800000000_init-payments.sql
```
