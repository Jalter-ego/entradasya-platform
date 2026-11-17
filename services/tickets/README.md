# tickets - EntradasYa (P5)

Servicio independiente de emisión de entradas, PDF con QR, consulta y descarga. Solo usa su propia base `tickets_db`; no llama a auth, events, payments ni checkin.

## Requisitos

- Node.js 22.11 o superior y pnpm (instalación verificada con Node 24 y pnpm 11).
- PostgreSQL accesible y una base exclusiva de tickets, con usuario que pueda aplicar sus migraciones.
- Clave pública RS256 de auth y acceso de escritura a la carpeta de PDF.

La web de Mis entradas está en `apps/web/src/features/tickets`, ruta `/mis-entradas`. Su [README](../../apps/web/README.md#feature-tickets-p5) explica cómo probarla con el cliente de demo, incluso antes de que exista orders.

## Preparar y ejecutar

Desde la raíz del monorepo:

```bash
cd services/tickets
pnpm install --frozen-lockfile
cp .env.example .env
```

P4 prepara las bases y usuarios. Si necesitas crear solo esta base y tienes un usuario administrador de PostgreSQL, abre `psql` como ese administrador y ejecuta:

```sql
CREATE ROLE tickets_user LOGIN;
\password tickets_user
CREATE DATABASE tickets_db OWNER tickets_user;
```

`\password` pide la contraseña sin dejarla escrita en el archivo SQL. No uses el usuario administrador como credencial de ejecución del servicio.

En `.env` configura:

1. `DATABASE_URL` con la base y usuario de tickets. Si la contraseña contiene caracteres reservados de una URL, codifícalos.
2. `TICKETS_STORAGE_DIR`: carpeta persistente; para desarrollo puede ser `./data/tickets`.
3. La clave **pública** de P1 en `keys/auth-public.pem`, o `JWT_PUBLIC_KEY` con saltos `\n`. No copies su clave privada.
4. `JWT_ISSUER` y `JWT_AUDIENCE`, iguales a los de auth.
5. Dos credenciales aleatorias distintas: `INTERNAL_TOKEN_ORDERS`, compartida solo con P3, y `INTERNAL_TOKEN_CHECKIN`, solo con P6. Cada una debe tener al menos 24 caracteres.

Puedes generar cada credencial con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Luego:

```bash
pnpm migrate
pnpm dev
```

Comprobar disponibilidad:

```bash
curl http://127.0.0.1:3005/health
```

Para ejecutar compilado:

```bash
pnpm build
pnpm start
```

Detener con `Ctrl+C`; los PDF y los datos se conservan. El servidor no crea tablas al arrancar: aplica antes `pnpm migrate`, que solo ejecuta las migraciones pendientes.

## Variables

| Variable | Uso |
|---|---|
| `PORT`, `HOST` | Puerto y dirección, por defecto `3005` y `127.0.0.1`. |
| `DATABASE_URL` | Conexión exclusiva a `tickets_db`. |
| `DATABASE_SSL` | `false` en local; `true` habilita TLS con verificación de certificado. |
| `TICKETS_STORAGE_DIR` | Carpeta donde escribir PDF; obligatoria. Rutas relativas desde el directorio de ejecución. |
| `DISPLAY_TIME_ZONE` | Zona para mostrar la fecha en el PDF, por ejemplo `America/La_Paz`. La API conserva UTC. |
| `JWT_PUBLIC_KEY_FILE` / `JWT_PUBLIC_KEY` | Archivo PEM o contenido de la clave pública de auth. Si hay archivo, tiene prioridad. |
| `JWT_ALG` | `RS256`, igual al contrato de P2; otros algoritmos se rechazan. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Emisor y audiencia esperados. |
| `INTERNAL_TOKEN_ORDERS` | Autoriza únicamente emisión. |
| `INTERNAL_TOKEN_CHECKIN` | Autoriza únicamente validación para portería. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` o `silent`. |

No guardar `.env`, claves, archivos de base ni PDF en Git. La configuración real de P1 todavía debe acordarse con el equipo; no existe un modo de saltarse la autenticación.

## Integración con P3: orders

Contrato completo: `contracts/tickets.openapi.yaml`, en la raíz del repositorio.

`POST /internal/tickets/issue`, directamente al servicio mediante su URL configurable. Header `X-Internal-Token` con la credencial exclusiva de orders.

```json
{
  "orderId": "40000000-0000-4000-8000-000000000001",
  "customerId": "10000000-0000-4000-8000-000000000001",
  "paymentStatus": "approved",
  "quantity": 2,
  "unitPriceMinor": 5000,
  "currency": "BOB",
  "event": {
    "id": "20000000-0000-4000-8000-000000000001",
    "title": "Noche de Rock",
    "venue": "Estadio Central",
    "startsAt": "2026-12-20T23:00:00Z"
  },
  "sector": {
    "id": "30000000-0000-4000-8000-000000000001",
    "name": "Preferencia"
  }
}
```

P3 obtiene `customerId` del JWT verificado y usa los datos confirmados por events/payments, nunca un precio o estado de pago que decida el navegador. Construye el cuerpo a partir de la reserva de P2: selecciona los campos de `event` y `sector` del ejemplo, y toma `reservation.quantity`, `reservation.unitPriceMinor` y `reservation.currency`. El campo opcional `event.organizerId` también se admite; `event.city` no se envía porque el esquema actual rechaza campos adicionales. El [README de bases](../../docs/database/README.md#9-datos-que-atraviesan-el-flujo-de-compra) detalla este mapeo.

Responde `{ orderId, items: [...] }`. Cada item tiene ID, número de entrada, código, evento, sector y `pdfUrl`. Esa URL requiere el JWT del comprador y pasa por Nginx; no es una URL pública al archivo.

- `201`: emisión creada y PDF listos.
- `200`: la misma orden y los mismos datos ya habían sido emitidos; devuelve los mismos IDs/códigos.
- `409 IDEMPOTENCY_CONFLICT`: se intenta reutilizar el mismo `orderId` con datos diferentes.
- `409 UNPAID_ORDER`: pago `pending` o `rejected`; no guarda entradas.
- `503 PDF_UNAVAILABLE`: los registros pueden estar guardados. **Repetir la misma orden con el mismo cuerpo**, sin cobrar otra vez. Se generan solo los PDF que faltan.

Los importes de v1 se muestran en centavos (`5000` representa `50,00` de la moneda acordada). Máximo seis entradas por orden.

## Integración con P6: checkin

`POST /internal/tickets/validate`, header `X-Internal-Token` con la credencial exclusiva de checkin:

```json
{
  "code": "codigo-del-QR-o-escrito-por-el-portero",
  "eventId": "20000000-0000-4000-8000-000000000001"
}
```

Resultado válido:

```json
{
  "valid": true,
  "ticket": {
    "id": "50000000-0000-4000-8000-000000000001",
    "orderId": "40000000-0000-4000-8000-000000000001",
    "customerId": "10000000-0000-4000-8000-000000000001",
    "eventId": "20000000-0000-4000-8000-000000000001",
    "paymentStatus": "approved"
  }
}
```

Código inexistente: `{ "valid": false, "reason": "INVALID_TICKET" }`.
Otro evento: `{ "valid": false, "reason": "WRONG_EVENT" }`.
Ambos son resultados de negocio con HTTP `200`; JSON inválido y credenciales inválidas devuelven `400/401`.

**tickets no marca el ingreso ni sabe si el código se utilizó.** P6 registra el uso en `checkin_db`, con unicidad por `ticket.id`, y devuelve `ALREADY_USED` con la hora del primer ingreso. Así dos validaciones concurrentes no deben permitir dos ingresos. El QR contiene solo el código aleatorio, sin JWT, precio ni datos personales.

## API de cliente y Nginx

- `GET /api/tickets/me`: JWT con `role=customer`, `sub` UUID, firma RS256, emisor/audiencia correctos y expiración. Filtros opcionales `orderId`, `limit` (1-100) y `offset`.
- `GET /api/tickets/:id/pdf`: mismo JWT; devuelve attachment PDF solo si pertenece al cliente. Una entrada ajena responde `404`. Si falta el archivo, lo regenera conservando el código.
- `GET /health`: consulta las tablas y comprueba acceso a la carpeta. `503` si no está listo.

Para P6, Nginx conserva el prefijo `/api`:

```nginx
location /api/tickets/ {
    proxy_pass http://127.0.0.1:3005;
    proxy_set_header Host $host;
    proxy_set_header X-Request-Id $request_id;
}
```

No publicar `/internal/*` ni servir `TICKETS_STORAGE_DIR` como carpeta estática. El frontend usa `fetch` con Authorization para descargar el blob; un enlace simple no envía automáticamente un JWT guardado por la aplicación.

## Verificación

```bash
pnpm typecheck
pnpm build
# PDF y almacenamiento, sin PostgreSQL ni otros servicios:
pnpm exec vitest run tests/pdf.test.ts
```

Para probar el flujo HTTP y la persistencia real, crea una base **desechable** llamada `tickets_test` o `tickets_test_*`. Ejemplo desde el administrador de PostgreSQL:

```sql
CREATE DATABASE tickets_test OWNER tickets_user;
```

```bash
cp .env.test.example .env.test
# Editar TEST_DATABASE_URL con la base de pruebas y sus credenciales.
pnpm test
```

Las pruebas se niegan a usar una base cuyo nombre no comience por `tickets_test`; aplican migraciones y limpian sus tablas. Generan sus propias claves JWT temporales, por lo que no necesitan levantar auth, orders ni checkin.

Cubren: emisión por cantidad, concurrencia/idempotencia, conflicto de datos, pago sin aprobar, aislamiento entre compradores, descarga, permisos internos, validación de JWT, códigos inválidos/otro evento y recuperación de PDF. El rechazo de QR reutilizado se prueba después con P6, porque pertenece a checkin.

## Modelo de datos y límites de v1

- `ticket_orders`: una fila por orden aprobada, comprador, hash del cuerpo normalizado y copia de los datos necesarios.
- `tickets`: una fila por entrada; código único y unicidad por `(order_id, ticket_number)`.
- IDs y códigos se confirman en una transacción antes de generar archivos. Los PDF se escriben en un temporal y se renombran atómicamente.
- La plantilla A5 usa la paleta del frontend: encabezado morado oscuro, acentos frambuesa, cuerpo claro y talón con QR negro sobre blanco. Ajusta la tipografía según el largo del título, lugar y sector. Usa fuentes estándar de PDF para funcionar sin descargar fuentes ni acceder a Internet al emitir.
- Los archivos se guardan como `<ticketId>.v2.pdf`, según `PDF_LAYOUT_VERSION` en `src/tickets/pdf.ts`. Al cambiar de plantilla, incrementar esa versión: la próxima descarga genera el nuevo diseño desde el mismo snapshot, sin cambiar ID/código ni eliminar el archivo anterior. La descarga sigue llamándose `entrada-<ticketId>.pdf` y el endpoint público no cambia. No hace falta una migración de base de datos.
- El servicio no utiliza datos de otras bases, no verifica un pago mediante HTTP y no registra check-in. Confía en la llamada autenticada de orders para la confirmación de pago.
- Cancelaciones/devoluciones y revocación de entradas no forman parte de esta implementación. La copia del evento representa los datos de la compra; tickets no consulta cambios posteriores en events.
