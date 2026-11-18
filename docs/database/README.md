# Esquema de bases de datos — EntradasYa v1

Referencia de datos para los seis integrantes. Antes de implementar o modificar una tabla, revisar este documento junto con el [plan de implementación](../Plan_de_implementacion_EntradasYa_v1.md) y el contrato HTTP del servicio en [`contracts/`](../../contracts/).

Este README define el diseño objetivo de v1; **no crea ni modifica bases de datos**. Cada responsable lo implementa mediante migraciones en su servicio. Las secciones indican qué coincide con las migraciones actuales y qué falta desarrollar. La referencia se preparó sobre `master`, commit `298f12e`.

## 1. Bases, usuarios y responsabilidades

| Persona | Servicio | Base PostgreSQL | Usuario exclusivo | Tablas de negocio |
|---|---|---|---|---|
| P1 | auth | `auth_db` | `auth_user` | `users` |
| P2 | events | `events_db` | `events_user` | `events`, `sectors`, `reservations` |
| P3 | orders | `orders_db` | `orders_user` | `orders`, `order_items` |
| P4 | payments | `payments_db` | `payments_user` | `payments` |
| P5 | tickets | `tickets_db` | `tickets_user` | `ticket_orders`, `tickets` |
| P6 | checkin | `checkin_db` | `checkin_user` | `checkins` |

`notifications` y la web no tienen base de datos. Las tablas técnicas del ejecutor de migraciones, como `pgmigrations`, no se incluyen en este modelo.

P4 prepara la creación de las seis bases y sus usuarios en `infra/postgres/`. Cada usuario tiene acceso únicamente a su base. Cada dueño implementa sus tablas, índices y semillas desde `services/<servicio>/migrations/` y sus scripts; P4 no mantiene las tablas de los demás.

El objetivo de entrega sigue siendo seis bases independientes en PostgreSQL local. Si alguien desarrolla con schemas de Supabase, debe conservar el aislamiento de permisos y documentar la configuración; eso no autoriza consultas entre servicios ni reemplaza la preparación local acordada.

## 2. Convenciones obligatorias

| Tema | Acuerdo de v1 |
|---|---|
| Nombres SQL | Tablas y columnas en inglés y `snake_case`. |
| Nombres HTTP | Propiedades en `camelCase`; el servicio realiza la conversión. |
| Identificadores | `uuid`. El servicio dueño genera el ID; otro servicio conserva el mismo valor como referencia externa. |
| Fechas SQL | `timestamptz`, con `DEFAULT now()` para fechas de creación. |
| Fechas HTTP | ISO 8601 en UTC, por ejemplo `2026-12-20T23:00:00.000Z`. Presentación local en la interfaz/PDF. |
| Dinero | Unidades menores enteras: `5000` representa `50,00 BOB`. Sin `float`, `real` ni cálculos con decimales binarios. |
| Moneda | `BOB` para la demo. Guardar el código recibido de events y comprobar su coincidencia en los demás pasos. |
| Campos requeridos | En las tablas siguientes, todo campo es `NOT NULL` salvo que se indique **Sí** en la columna «NULL». |
| Restricciones | PK, FK locales, `UNIQUE` y `CHECK` deben estar en PostgreSQL, además de validarse en la API. |
| Actualizaciones | La aplicación actualiza `updated_at` en cada modificación; `DEFAULT now()` no lo actualiza automáticamente. |
| Hashes | SHA-256 en hexadecimal de 64 caracteres. Normalizar los datos antes de calcularlos y conservar la misma representación en reintentos. |
| Datos JSON | Estructura explícita en este README y en el contrato HTTP; `jsonb` no significa aceptar propiedades arbitrarias. |

### Relaciones entre bases

Una FK solo puede apuntar a una tabla de la misma base. Estas referencias son **externas**, sin FK ni consultas SQL al servicio dueño:

| Columna o dato | Dueño del identificador |
|---|---|
| `organizer_id`, `customer_id`, `doorman_id` | `auth_db.users.id` |
| `reservations.order_id`, `payments.order_id`, `ticket_orders.order_id` | `orders_db.orders.id` |
| `event_id`, `sector_id` fuera de events | `events_db.events.id`, `events_db.sectors.id` |
| `payment_transaction_id` en orders | `payments_db.payments.id` |
| `ticket_id` en checkin | `tickets_db.tickets.id` |

Los servicios se comunican por HTTP y conservan las copias de datos necesarias. No se eliminan físicamente órdenes, pagos, reservas, entradas ni ingresos para simular una cancelación. Los eventos cambian de estado; solo se permite borrar sectores sin reservas, respetando las restricciones actuales de events.

## 3. P1 — `auth_db`

**Estado:** diseño por implementar; todavía no hay migraciones de auth en `master`.

### Tabla `users`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `id` | `uuid` | No | PK; generado por auth. |
| `name` | `text` | No | Longitud de 1 a 120; nombre visible. |
| `email` | `text` | No | `UNIQUE`; longitud de 1 a 254; guardar `lower(trim(email))`. |
| `password_hash` | `text` | No | Hash de contraseña con su sal y parámetros; nunca contraseña en texto plano. |
| `role` | `text` | No | `CHECK IN ('customer', 'organizer', 'doorman')`; default `customer`. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Además del `UNIQUE(email)`, agregar `CHECK (email = lower(btrim(email)))`. La API valida el formato del correo y normaliza antes de registrar o iniciar sesión. El registro público siempre asigna `customer`; ignora o rechaza un rol enviado por el navegador. Organizador y portero se crean por semilla.

JWT de integración: algoritmo `RS256`, `iss=entradasya-auth`, `aud=entradasya`, `sub=users.id`, `role`, `email`, `iat` y `exp`. Solo auth conserva la clave privada; los consumidores verifican la firma con la pública. No se necesita una tabla de sesiones para esta v1.

IDs de la semilla compartida, compatibles con el login de desarrollo actual:

| Cuenta | Rol | UUID |
|---|---|---|
| `organizador@demo.bo` | `organizer` | `00000000-0000-4000-8000-000000000001` |
| `cliente@demo.bo` | `customer` | `00000000-0000-4000-8000-000000000002` |
| `portero@demo.bo` | `doorman` | `00000000-0000-4000-8000-000000000003` |

La semilla debe ser idempotente. Estos IDs se conservan para que los eventos de ejemplo sigan perteneciendo al organizador correcto.

## 4. P2 — `events_db`

**Estado:** las tres tablas e índices siguientes ya existen en las [migraciones de events](../../services/events/migrations/). La columna `reservations.snapshot` se agrega en la migración `1763600000000_reservation-snapshot.sql`, descrita por separado.

### Tabla `events`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `id` | `uuid` | No | PK; default `gen_random_uuid()`. |
| `organizer_id` | `uuid` | No | Referencia externa a auth; del JWT validado. |
| `title` | `text` | No | Longitud de 1 a 200. |
| `description` | `text` | No | Default `''`; máximo 5000 en API. |
| `venue` | `text` | No | Longitud de 1 a 200. |
| `starts_at` | `timestamptz` | No | Fecha/hora del evento. |
| `image_url` | `text` | Sí | URL HTTP(S); máximo 2000 en API. |
| `currency` | `char(3)` | No | Código de moneda; configurar `CURRENCY=BOB` para v1. |
| `status` | `text` | No | `draft`, `published` o `cancelled`; default `draft`. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |
| `category` | `text` | No | Longitud de 1 a 40; default `otros`. |
| `city` | `text` | No | Longitud de 1 a 100; default `La Paz`. |

Índices existentes: `(status, starts_at)`, `(organizer_id)` y `(status, category, city, starts_at)`.

Categorías de v1: `concierto`, `electronica`, `teatro`, `festival`, `deportes`, `fiesta`, `capacitacion`, `otros`. Ciudades: La Paz, El Alto, Santa Cruz de la Sierra, Cochabamba, Sucre, Oruro, Potosí, Tarija, Trinidad y Cobija. La API valida estas listas; se mantienen sincronizadas en `src/catalog.ts`, la web y el OpenAPI de events.

### Tabla `sectors`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `id` | `uuid` | No | PK; default `gen_random_uuid()`. |
| `event_id` | `uuid` | No | FK local a `events.id`, `ON DELETE CASCADE`. |
| `name` | `text` | No | Longitud de 1 a 100. |
| `price_minor` | `integer` | No | `CHECK >= 0`; máximo 100000000 en API. |
| `capacity` | `integer` | No | `CHECK > 0`; máximo 100000 en API. |
| `reserved` | `integer` | No | Default `0`; `CHECK (reserved >= 0 AND reserved <= capacity)`. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Restricción existente: `UNIQUE(event_id, name)`. La disponibilidad es `capacity - reserved`; no agregar otra columna para ella. `reserved` incluye todos los cupos comprometidos, también los de compras pagadas; el ingreso al evento no los libera.

### Tabla `reservations`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `id` | `uuid` | No | PK; default `gen_random_uuid()`. |
| `order_id` | `uuid` | No | `UNIQUE`; referencia externa a orders. |
| `event_id` | `uuid` | No | FK local a `events.id`. |
| `sector_id` | `uuid` | No | FK local a `sectors.id`. |
| `quantity` | `integer` | No | `CHECK BETWEEN 1 AND 6`. |
| `unit_price_minor` | `integer` | No | `CHECK >= 0`; precio fijado al reservar. |
| `currency` | `char(3)` | No | Moneda fijada al reservar. |
| `status` | `text` | No | `active` o `released`; default `active`. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `released_at` | `timestamptz` | Sí | Fecha de liberación. |

Índice existente: `(sector_id)`. La API comprueba que el sector pertenece al evento. Reservar descuenta cupos en la misma transacción que crea la reserva; liberar bloquea la reserva y devuelve sus cupos una sola vez. `totalMinor = unit_price_minor * quantity` se calcula; no tiene columna propia.

### Copia inmutable de evento y sector (`reservations.snapshot`)

**Estado:** implementado en una nueva migración (`1763600000000_reservation-snapshot.sql`), sin editar las ya compartidas.

| Columna | Tipo PostgreSQL | NULL | Contenido |
|---|---|---|---|
| `snapshot` | `jsonb` | No | `{ "event": { "id", "title", "venue", "city", "startsAt", "organizerId" }, "sector": { "id", "name" } }`. |

Capturar el snapshot al reservar y confirmarlo en la misma transacción. Las consultas y repeticiones devuelven estos datos guardados, aunque luego se edite el evento o sector. El objeto `reservation` conserva sus campos actuales, incluido el estado mutable de liberación. Debe coordinarse la lectura del sector con sus ediciones para obtener un precio y un nombre coherentes.

Al reservar, events bloquea el evento (`FOR SHARE`) y luego el sector (`FOR NO KEY UPDATE`), y guarda la copia en la misma transacción que crea la reserva; así precio y nombre son coherentes aunque el organizador edite el sector al mismo tiempo. `GET /internal/reservations/{orderId}` y las repeticiones leen solo esta columna, sin JOIN. Restricción: `CHECK` de que `snapshot.event` y `snapshot.sector` son objetos. Las filas anteriores a la migración se rellenaron con los datos que había en ese momento; no se reconstruyen valores históricos ya sobrescritos.

## 5. P3 — `orders_db`

**Estado:** implementado en la [migración de orders](../../services/orders/migrations/1763700000000_init-orders.sql), con las tablas, restricciones, estados e índices de esta sección. El flujo y su recuperación se describen en el [README de orders](../../services/orders/README.md). Las integraciones con payments y notifications siguen un contrato provisional hasta que P4 publique el suyo. Una orden compra de 1 a 6 entradas de **un solo sector de un evento**; por eso hay como máximo un registro `order_items` por orden en v1.

### Tabla `orders`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `id` | `uuid` | No | PK; generado antes de reservar o pagar. |
| `customer_id` | `uuid` | No | Referencia externa a auth; del JWT validado. |
| `customer_email` | `text` | No | Copia del correo del JWT para confirmación; no del cuerpo del navegador. |
| `idempotency_key` | `varchar(128)` | No | Longitud de 1 a 128; clave estable enviada por la web. |
| `request_hash` | `char(64)` | No | Hash de la solicitud normalizada; detecta reutilización de clave con otros datos. |
| `status` | `text` | No | `pending`, `paid`, `rejected`, `cancelled`; default `pending`. |
| `reservation_status` | `text` | No | Estados de la tabla siguiente; default `not_started`. |
| `payment_status` | `text` | No | Estados de la tabla siguiente; default `not_started`. |
| `ticket_status` | `text` | No | Estados de la tabla siguiente; default `not_started`. |
| `notification_status` | `text` | No | Estados de la tabla siguiente; default `not_started`. |
| `payment_request` | `jsonb` | No | Solo `{ "method": "demo_card", "last4": "1111" }` o terminación `0000`; datos ficticios para reintentos. |
| `payment_transaction_id` | `uuid` | Sí | ID confirmado de payments; referencia externa. |
| `ticket_issue_payload` | `jsonb` | Sí | Cuerpo exacto para tickets, persistido antes de llamar y reutilizado sin cambios. |
| `last_error_step` | `text` | Sí | `reservation`, `payment`, `tickets` o `notification`. |
| `last_error_code` | `text` | Sí | Código de error para recuperación; sin credenciales ni datos de tarjeta. |
| `paid_at` | `timestamptz` | Sí | Momento en que se confirmó el pago aprobado. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Restricciones: `UNIQUE(customer_id, idempotency_key)`; `CHECK` de cada conjunto de estados; `CHECK (status <> 'paid' OR (payment_status = 'approved' AND payment_transaction_id IS NOT NULL AND paid_at IS NOT NULL))`. Índice para compras propias: `(customer_id, created_at DESC)`.

| Columna técnica | Valores permitidos y significado |
|---|---|
| `reservation_status` | `not_started`, `pending`, `active`, `release_pending`, `released`, `failed`. `pending` también cubre un resultado todavía desconocido; consultar/repetir por el mismo `orderId`. |
| `payment_status` | `not_started`, `pending`, `unknown`, `approved`, `rejected`. Un timeout pasa a `unknown`, nunca a `rejected` por suposición. |
| `ticket_status` | `not_started`, `pending`, `issued`. Si falla la emisión/PDF, queda `pending` y se registra el error. |
| `notification_status` | `not_started`, `pending`, `sent`, `failed`, `unknown`. `unknown` representa un timeout sin confirmación de envío. |

### Tabla `order_items`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `order_id` | `uuid` | No | PK y FK local a `orders.id`; una línea por orden en v1. |
| `event_id` | `uuid` | No | Referencia externa a events; selección original. |
| `sector_id` | `uuid` | No | Referencia externa a events; selección original. |
| `quantity` | `smallint` | No | `CHECK BETWEEN 1 AND 6`; selección original. |
| `organizer_id` | `uuid` | Sí | Copia confiable de la reserva; para autorizar el reporte de ventas. |
| `unit_price_minor` | `integer` | Sí | `CHECK >= 0`; se completa con la reserva, nunca con un precio del navegador. |
| `currency` | `char(3)` | Sí | Se completa con la reserva. |
| `reservation_snapshot` | `jsonb` | Sí | Respuesta completa `{ "reservation": {...}, "event": {...}, "sector": {...} }`, guardada al confirmar la reserva. |

Crear `CHECK` para que `organizer_id`, `unit_price_minor`, `currency` y `reservation_snapshot` estén todos nulos o todos completos. Crear índice `(event_id, organizer_id)` para reportes. Guardar la orden y su línea inicial en una sola transacción; al confirmar la reserva, guardar sus cuatro campos y el avance de orders en otra transacción local. Comprobar que IDs, cantidad, precio y moneda coincidan con la respuesta confiable y no sobrescribir el snapshot en reintentos.

El total se deriva de `quantity * unit_price_minor`; para sumas SQL usar `bigint` y para JSON comprobar rango entero seguro. No duplicar el total en otra columna. Los reportes agregan únicamente órdenes `paid`, y comprueban que el organizador del JWT sea el de las líneas consultadas. Las referencias y copias permiten consultar órdenes antiguas sin acceder a otra base.

### Reintentos y avance persistido

- La web reutiliza la misma `Idempotency-Key` para la misma compra. Una nueva compra usa otra clave. El hash cubre `eventId`, `sectorId`, `quantity` y `payment` normalizados; no incluye el JWT ni datos variables como la hora del reintento.
- La misma clave y comprador devuelven la orden existente; un hash diferente devuelve `409 IDEMPOTENCY_CONFLICT`. La restricción única también protege dos peticiones simultáneas.
- Serializar el procesamiento por `orders.id` en PostgreSQL, incluso entre dos procesos. Puede usarse un advisory lock de sesión en una conexión dedicada, conservado entre los commits de avance y liberado siempre antes de devolver la conexión al pool. Las llamadas HTTP tienen timeout. Una bandera en memoria no basta.
- Persistir el intento antes de la llamada remota y su resultado después. Si el proceso cae entre ambos, recuperar consultando o repitiendo idempotentemente la misma operación; el lock no reemplaza esos estados persistidos.
- Reserva agotada: orden `rejected`, sin llamar a payments. Pago rechazado: orden `rejected`, con `release_pending` hasta confirmar la liberación. Un pago incierto mantiene la orden `pending` y los cupos comprometidos.
- Pago aprobado: orden `paid` aunque falten PDF o correo. Persistir `ticket_issue_payload` antes de emitir; un fallo deja `ticket_status=pending`. No cobrar de nuevo ni liberar cupos.
- La cancelación solo aplica antes de un pago aprobado o incierto, sin una operación remota todavía sin resolver. No implementar cancelación de compras pagadas ni reembolsos en esta v1.

## 6. P4 — `payments_db` y notifications

**Estado:** diseño por implementar. Payments es interno y solo acepta llamadas autenticadas de orders.

### Tabla `payments`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `id` | `uuid` | No | PK; se expone como `transactionId` en HTTP. |
| `order_id` | `uuid` | No | `UNIQUE`; referencia externa a orders. |
| `amount_minor` | `bigint` | No | `CHECK >= 0`; total calculado por orders desde la reserva. |
| `currency` | `char(3)` | No | Copia de la moneda de la compra. |
| `method` | `text` | No | `CHECK (method = 'demo_card')`. |
| `demo_last4` | `char(4)` | No | `CHECK IN ('0000', '1111')`; únicamente terminación ficticia. |
| `request_hash` | `char(64)` | No | Hash normalizado de importe, moneda y pago ficticio. |
| `status` | `text` | No | `approved` o `rejected`; resultado definitivo simulado. |
| `rejection_code` | `text` | Sí | `PAYMENT_REJECTED` cuando se rechaza. |
| `created_at` | `timestamptz` | No | Default `now()`; instante del resultado. |

Agregar `CHECK` de coherencia: aprobado implica `rejection_code IS NULL`; rechazado implica `rejection_code = 'PAYMENT_REJECTED'`. No hace falta otro índice por `order_id`: ya lo crea la unicidad.

Regla fija de demo: `1111` aprueba y `0000` rechaza; otro valor devuelve `400` sin crear un pago. Guardar el resultado en una transacción con unicidad por orden. Repetir la misma orden/cuerpo devuelve el mismo `transactionId` y resultado, incluso si fue rechazado. Cualquier cambio de importe, moneda o medio ficticio produce `409 IDEMPOTENCY_CONFLICT`. Tras un timeout, orders consulta `GET /internal/payments/orders/:orderId` o repite la misma petición.

No guardar PAN completo, CVV ni datos de tarjetas reales. `PaymentFields` pide únicamente la terminación de demo; el navegador manda el formulario a orders, no a payments.

### Notifications no tiene base propia

Recibe el correo validado, resumen de compra y enlace a Mis entradas; envía a Mailpit. Orders conserva `notification_status` y el error. SMTP no garantiza envío exactamente una vez: un timeout puede dejar resultado `unknown`, y un reintento podría duplicar el correo. Eso no duplica órdenes, pagos ni entradas y no revierte la compra.

## 7. P5 — `tickets_db`

**Estado:** coincide con la [migración actual de tickets](../../services/tickets/migrations/1763460000000_init-tickets.sql). No se requiere renombrar tablas ni agregar una columna de ruta PDF.

### Tabla `ticket_orders`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `order_id` | `uuid` | No | PK; referencia externa a orders; una emisión por orden. |
| `customer_id` | `uuid` | No | Referencia externa a auth; entregada por orders. |
| `payment_status` | `text` | No | `CHECK (payment_status = 'approved')`. |
| `payload_hash` | `char(64)` | No | Hash del cuerpo de emisión validado y normalizado. |
| `snapshot` | `jsonb` | No | Copia completa e inmutable del cuerpo de emisión; estructura en la sección 9. |
| `created_at` | `timestamptz` | No | Default `now()`. |

Índice existente: `(customer_id, created_at DESC)`.

### Tabla `tickets`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `id` | `uuid` | No | PK; generado por tickets. |
| `order_id` | `uuid` | No | FK local a `ticket_orders.order_id`. |
| `ticket_number` | `smallint` | No | `CHECK BETWEEN 1 AND 6`; ordinal dentro de la compra. |
| `code` | `varchar(43)` | No | `UNIQUE`; generado con 32 bytes aleatorios y codificación base64url. |
| `created_at` | `timestamptz` | No | Default `now()`. |

Restricción existente: `UNIQUE(order_id, ticket_number)`. La cantidad total, comprador, evento, sector y precio se leen del registro local `ticket_orders`; no se duplican en cada entrada. La transacción de emisión crea exactamente `quantity` filas y reutiliza IDs/códigos ante reintentos.

El PDF se ubica en `TICKETS_STORAGE_DIR/<tickets.id>.v<PDF_LAYOUT_VERSION>.pdf` (actualmente `.v2.pdf`); esta ruta se deriva, no se guarda en la tabla ni se recibe del navegador. La carpeta es persistente y externa al repositorio. Si falta el archivo de la versión actual, se regenera desde el snapshot sin crear una nueva entrada ni cambiar su código. Esto permite aplicar un diseño nuevo también a entradas emitidas previamente, conservando los archivos anteriores. La descarga pública es autenticada mediante `/api/tickets/:id/pdf`, se llama `entrada-<tickets.id>.pdf` y exige que el comprador coincida con el JWT.

No agregar `used`, `used_at` ni un estado de ingreso a tickets: checkin administra el uso. El QR contiene el código opaco, sin JWT ni URL de acceso directo al archivo.

## 8. P6 — `checkin_db`

**Estado:** diseño por implementar.

### Tabla `checkins`

| Columna | Tipo PostgreSQL | NULL | Restricción / uso |
|---|---|---|---|
| `id` | `uuid` | No | PK; generado por checkin. |
| `ticket_id` | `uuid` | No | `UNIQUE`; referencia externa a tickets. |
| `event_id` | `uuid` | No | Referencia externa a events; confirmado por tickets. |
| `doorman_id` | `uuid` | No | Referencia externa a auth; del JWT `doorman` validado. |
| `checked_in_at` | `timestamptz` | No | Default `now()`; hora del primer ingreso autorizado. |

Índice: `(event_id, checked_in_at)`, para conteo y consulta por evento. La unicidad es **solo por `ticket_id`**, no por `(ticket_id, event_id)`: una entrada no puede registrarse dos veces con otro evento seleccionado.

Primero consultar `/internal/tickets/validate` con código y evento. Si responde inválido o evento incorrecto, no insertar. Si es válido, insertar con protección `UNIQUE(ticket_id)`; ante conflicto devolver `ALREADY_USED` y el `checked_in_at` existente. Dos escaneos concurrentes deben permitir un único ingreso. No basta consultar antes de insertar.

El conteo es `COUNT(*)` de `checkins` para el evento; no guardar un contador independiente. Los intentos fallidos se registran en logs, no como ingresos válidos.

## 9. Datos que atraviesan el flujo de compra

### Mapeo SQL / HTTP

| Dato | Origen confiable | Campo HTTP | Destino |
|---|---|---|---|
| Comprador | JWT `sub` | `customerId` | orders y tickets. |
| Correo | JWT `email` | `customerEmail` en la orden | Confirmación a notifications. |
| Orden | `orders.id` | `orderId` | events, payments, tickets y notifications. |
| Evento / sector / cantidad | Selección validada y reserva confirmada | `eventId`, `sectorId`, `quantity` | orders; emisión usa objetos `event` y `sector`. |
| Precio unitario | `reservations.unit_price_minor` | `unitPriceMinor` | orders y tickets. |
| Total | Precio unitario por cantidad | `amountMinor` para payments; `totalMinor` en la reserva | Pago y resumen; no lo decide el navegador. |
| Resultado del pago | `payments.status` | `paymentStatus` al emitir | tickets solo admite emisión con `approved`. |
| Transacción | `payments.id` | `transactionId` | `orders.payment_transaction_id`. |
| Entrada | `tickets.id` | `ticket.id` en validación | `checkins.ticket_id`. |

### Ejemplo de emisión compatible con P5

Guardar este cuerpo en `orders.ticket_issue_payload` y reenviar el mismo contenido en cada reintento. IDs y datos del evento/sector del ejemplo son ilustrativos; usar los obtenidos en una reserva real, no asumir que existen en la semilla.

```json
{
  "orderId": "40000000-0000-4000-8000-000000000001",
  "customerId": "00000000-0000-4000-8000-000000000002",
  "paymentStatus": "approved",
  "quantity": 2,
  "unitPriceMinor": 5000,
  "currency": "BOB",
  "event": {
    "id": "20000000-0000-4000-8000-000000000001",
    "title": "Noche de Rock",
    "venue": "Estadio Central",
    "startsAt": "2026-12-20T23:00:00.000Z",
    "organizerId": "00000000-0000-4000-8000-000000000001"
  },
  "sector": {
    "id": "30000000-0000-4000-8000-000000000001",
    "name": "General"
  }
}
```

P3 construye explícitamente este cuerpo: copia `orderId`, `quantity`, `unitPriceMinor` y `currency` de la reserva confirmada; toma `customerId` de su orden y `approved` del pago confirmado. Para `event`, selecciona `id`, `title`, `venue`, `startsAt` y `organizerId`; para `sector`, `id` y `name`. No reenviar automáticamente toda la respuesta de events.

**`city` permanece en el snapshot de la reserva y en orders, pero no se envía a tickets en el contrato actual.** Su esquema rechaza campos adicionales. Si se necesita ciudad en el PDF, P3 y P5 actualizan juntos este README, el OpenAPI, la validación y el renderizado antes de comenzar a enviarla.

El formato exacto de cada petición/respuesta y sus errores se mantiene en OpenAPI. Este README fija el modelo de datos y los nombres comunes; los archivos [`events.openapi.yaml`](../../contracts/events.openapi.yaml), [`orders.openapi.yaml`](../../contracts/orders.openapi.yaml) y [`tickets.openapi.yaml`](../../contracts/tickets.openapi.yaml) describen los endpoints actuales. P1, P4 y P6 deben agregar los de sus servicios.

## 10. Implementación y control de cambios

| Responsable | Trabajo derivado de este esquema |
|---|---|
| P1 | Crear `users`, semilla con IDs compartidos y contrato JWT acordado. |
| P2 | Conservar tablas existentes; agregar y consumir el snapshot inmutable de reservas con nueva migración. |
| P3 | Crear `orders` y `order_items`; persistir idempotencia, avance y cuerpo de emisión. |
| P4 | Preparar las seis bases/usuarios; crear payments y acordar su contrato con orders. Notifications sigue sin base. |
| P5 | Mantener `ticket_orders` y `tickets`; consumir únicamente el cuerpo de emisión definido y completar Mis entradas. |
| P6 | Crear `checkins`, unicidad por ticket y conteo derivado; preparar gateway y arranque. |

Cada cambio de esquema compartido debe incluir en el mismo PR: actualización de este README, nueva migración cuando corresponda, ajuste de OpenAPI si cambia HTTP y ejemplos/pruebas del comportamiento afectado. Avisar a los consumidores; no renombrar unilateralmente campos o estados. Las migraciones reflejan lo instalado; una diferencia con este diseño se documenta como pendiente y se resuelve con un cambio explícito, sin afirmar que ya está implementada. El README propio de cada servicio debe enlazar esta referencia y documentar cualquier transición pendiente que le corresponda.

Antes de integrar, comprobar permisos por base; migraciones desde una base vacía; restricciones de unicidad ante concurrencia; conservación de precio/snapshot al editar un evento; reintento de emisión con el mismo cuerpo; descarga solo del comprador; y segundo ingreso rechazado con la hora del primero. Los escenarios completos están en la sección 8 del plan.
