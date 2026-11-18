# notifications - EntradasYa (P4)

Envía el **correo de confirmación** de una compra pagada por SMTP a [Mailpit](../../infra/mailpit/README.md). Servicio interno, **sin base de datos**: solo lo llama orders, con un token exclusivo del par orders ↔ notifications. El estado del envío lo guarda orders en `notification_status`.

- Contrato HTTP: [`contracts/notifications.openapi.yaml`](../../contracts/notifications.openapi.yaml).
- Datos: [README de bases, sección P4](../../docs/database/README.md#6-p4--payments_db-y-notifications).
- Plan: tareas D4, D5 y D7 del [plan de implementación](../../docs/Plan_de_implementacion_EntradasYa_v1.md#p4---pago-correo-y-soporte-de-datos).

## Requisitos

- Node.js 20.11 o superior y npm.
- Mailpit en `127.0.0.1:1025` ([instalación](../../infra/mailpit/README.md)).

## Preparar y ejecutar

```bash
cd services/notifications
npm install
cp .env.example .env      # completar INTERNAL_TOKEN_ORDERS
npm run dev
curl http://127.0.0.1:3006/health    # 200 si Mailpit responde; 503 si no
```

| Comando | Uso |
|---|---|
| `npm run dev` | Desarrollo con recarga. |
| `npm run build` y `npm start` | Compilar y ejecutar `dist/`. |
| `npm run typecheck` | Comprobar tipos. |
| `npm test` | Pruebas; no necesitan Mailpit. |

## Variables

| Variable | Uso |
|---|---|
| `PORT`, `HOST` | `3006` y `127.0.0.1`. Solo loopback. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` o `silent`. |
| `INTERNAL_TOKEN_ORDERS` | Token del par orders ↔ notifications, ≥ 24 caracteres. **Igual** a `NOTIFICATIONS_INTERNAL_TOKEN` del `.env` de orders. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Mailpit: `127.0.0.1`, `1025`, `false`. |
| `SMTP_USER`, `SMTP_PASSWORD` | Opcionales; Mailpit local no los pide. |
| `SMTP_TIMEOUT_MS` | Límite de cada envío; `4000`. Menor que `HTTP_TIMEOUT_MS` de orders (`5000`), para responder antes de que orders corte. |
| `MAIL_FROM` | Remitente, `EntradasYa <no-reply@entradasya.local>`. |
| `PUBLIC_WEB_URL` | URL pública de la web por Nginx, `http://localhost:8080`. |
| `MAIL_TIMEZONE` | Zona para la fecha del evento; `America/La_Paz`. |

## API interna

`POST /internal/notifications/purchase` con `X-Internal-Token`:

```json
{
  "orderId": "40000000-0000-4000-8000-000000000001",
  "to": "cliente@demo.bo",
  "event": { "title": "Noche de Rock", "venue": "Estadio Central", "startsAt": "2026-12-20T23:00:00.000Z" },
  "sector": { "name": "General" },
  "quantity": 2,
  "totalMinor": 10000,
  "currency": "BOB"
}
```

Es el cuerpo que ya arma orders en `src/builders/purchaseNotification.ts`. Campos extra → 400.

| Respuesta | Significado para orders |
|---|---|
| `200 { orderId, status: "sent", messageId, sentAt }` | Mailpit aceptó el correo → `notification_status=sent`. |
| `400 VALIDATION_ERROR` | Cuerpo inválido; no se envía nada. |
| `401 UNAUTHORIZED` | Token interno ausente o incorrecto. |
| `503 SMTP_UNAVAILABLE` | No se pudo conectar con Mailpit → `failed`. |
| `504 SMTP_TIMEOUT` | Mailpit no respondió en `SMTP_TIMEOUT_MS`; el correo pudo o no salir. orders lo registra hoy como `failed`. |

### Contenido del correo

- Asunto `Compra confirmada: <evento>`, versión texto y HTML.
- Evento, fecha en hora de La Paz, lugar, sector, cantidad, total (`100,00 BOB`, calculado desde unidades menores sin decimales binarios) y número de orden.
- Botón y enlace a `<PUBLIC_WEB_URL>/mis-entradas?orderId=<orderId>`. **Sin JWT, token ni ruta directa al PDF**: el cliente inicia sesión y tickets comprueba que las entradas son suyas.
- Los datos del evento se escapan en el HTML; el asunto y los campos de una línea rechazan saltos de línea (evita inyectar cabeceras).
- `Message-ID` fijo por orden (`<compra-<orderId>@entradasya.local>`) y cabecera `X-EntradasYa-Order`.

### Reintentos y fallos

SMTP no garantiza envío exactamente una vez. Si orders reintenta tras `failed` o `unknown`, puede llegar un segundo correo con el mismo `Message-ID`. Eso no duplica órdenes, pagos ni entradas y **nunca revierte la compra** (escenario V9).

### Seguridad y logs

- `/internal/*` exige `X-Internal-Token` (comparación en tiempo constante). Un JWT de cliente no sirve.
- Escucha en `127.0.0.1`; Nginx no tiene ruta hacia el puerto 3006.
- Los logs registran `orderId` y el destinatario enmascarado (`c***@demo.bo`); nunca el cuerpo ni el correo completo.

## Pruebas

```bash
npm test
```

Usan un servidor SMTP real en memoria (`smtp-server`) en lugar de Mailpit, un puerto cerrado para «Mailpit apagado» y un socket que nunca saluda para el timeout. Cubren: salud 200/503; token interno obligatorio; envío con destinatario, asunto, resumen, total y enlace; ausencia de JWT/token/ruta de PDF; escape de HTML; 400 por datos inválidos, saltos de línea o campos extra; reenvío con el mismo Message-ID; 503 `SMTP_UNAVAILABLE` y 504 `SMTP_TIMEOUT` dentro del límite.

**Estado:** 14 pruebas en verde. La entrega a Mailpit real se comprueba con los pasos de [infra/mailpit](../../infra/mailpit/README.md#comprobar-el-envío).

## Estructura

```text
src/
├── server.ts, app.ts       # arranque, /health (verifica SMTP) y montaje de /internal
├── config.ts               # único lugar que lee process.env
├── logger.ts
├── http/                   # requestId, errores, token interno
├── routes/internal.ts      # validación zod y envío
└── email/
    ├── mailer.ts           # nodemailer con timeouts y clasificación de errores
    └── purchaseEmail.ts    # asunto, texto, HTML y enlace a Mis entradas
```
