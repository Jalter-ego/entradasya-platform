# events

Servicio de eventos, sectores y cupos de EntradasYa. Dueño: **P2**.

- Puerto por defecto: `3002` (escucha solo en `127.0.0.1`; el navegador entra por Nginx).
- Contrato: [`contracts/events.openapi.yaml`](../../contracts/events.openapi.yaml).
- Stack: Node.js ≥ 20 + TypeScript, Express 5, PostgreSQL (`pg`), migraciones con `node-pg-migrate`.

## Qué hace

| Quién | Qué puede hacer |
|---|---|
| Cualquiera | Ver la cartelera (`GET /api/events`) y el detalle de eventos publicados. |
| Organizador | Crear, editar, publicar y cancelar **sus** eventos; agregar, editar y borrar sectores; ver sus borradores (`/api/events/mine`). |
| orders (interno) | Reservar, consultar y liberar cupos por `orderId` (`/internal/reservations`). |

Las ventas e ingresos del organizador **no** están aquí: la web los pide al reporte de orders.

## Garantías

- **Sin sobreventa:** el cupo se descuenta con un `UPDATE` condicional (`capacity - reserved >= quantity`), y la base rechaza con un `CHECK` cualquier `reserved > capacity`.
- **Reserva idempotente:** `order_id` es único. Repetir la misma reserva devuelve `200` con la misma respuesta y no descuenta otra vez. Si llegan pedidos simultáneos de la misma orden, solo uno descuenta.
- **Liberación idempotente:** la fila se bloquea (`FOR UPDATE`). Repetir la liberación no suma cupos otra vez.
- **Capacidad:** no puede bajar del cupo ya comprometido (`CAPACITY_BELOW_COMMITTED`).
- **Precio:** lo decide events y queda fijado en la reserva. Si el organizador lo cambia después, las reservas existentes conservan su precio.

## Arranque local

```bash
cd services/events
npm install
cp .env.example .env        # completar DATABASE_URL, clave pública JWT e INTERNAL_TOKEN_ORDERS
npm run migrate             # crea/actualiza las tablas
npm run seed                # opcional: 3 eventos de demo (idempotente)
npm run dev                 # desarrollo con recarga
# o: npm run build && npm start
```

Comprobar: `curl http://127.0.0.1:3002/health` → `{"status":"ok","service":"events"}`.

### JWT de auth (P1)

Configura `JWT_PUBLIC_KEY_FILE` con el PEM público del [servicio auth](../auth/README.md) y usa su mismo emisor y audiencia. La cuenta sembrada `organizador@demo.bo` usa el UUID de `SEED_ORGANIZER_ID` por defecto y puede ver sus eventos desde la web.

### Base de datos local

Con el script de bases de P4, o a mano con `psql` como superusuario:

```sql
CREATE USER events_user WITH PASSWORD 'cambiar-esta-clave';
CREATE DATABASE events_db OWNER events_user;
```

### Usar Supabase en lugar de Postgres local

El código y las migraciones son los mismos; solo cambia el `.env`:

```env
DATABASE_URL=postgres://postgres.<ref>:<clave>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DB_SCHEMA=events
```

- Usa la cadena **Session pooler** (puerto 5432) o la conexión directa. **No uses el Transaction pooler (6543)**: este servicio depende de transacciones con bloqueos.
- `DB_SCHEMA=events` deja las tablas en un schema propio. Así los seis servicios pueden compartir un mismo proyecto de Supabase sin mezclarse, y las tablas no quedan expuestas por la Data API de Supabase, que publica el schema `public`.
- Si el pooler rechaza el parámetro de conexión `search_path`, crea un usuario propio para el servicio y fíjalo en la base: `ALTER ROLE events_user SET search_path = events;`.
- `npm run migrate` crea el schema si no existe.

## Variables de entorno

Ver [`.env.example`](.env.example). Las principales:

| Variable | Uso |
|---|---|
| `DATABASE_URL`, `DATABASE_SSL`, `DB_SCHEMA` | Conexión a Postgres o Supabase. |
| `JWT_PUBLIC_KEY_FILE` o `JWT_PUBLIC_KEY`, `JWT_ALG`, `JWT_ISSUER`, `JWT_AUDIENCE` | Verificación local del JWT de auth (P1). |
| `INTERNAL_TOKEN_ORDERS` | Token compartido solo con orders para `/internal/*` (header `X-Internal-Token`). |
| `CURRENCY` | Moneda acordada (ISO 4217). |
| `EVENTS_STORAGE_DIR` | Carpeta persistente de portadas. Relativa al directorio de ejecución o absoluta. Por defecto: `~/.local/share/entradasya/event-covers`. |
| `SEED_ORGANIZER_ID` | Organizador dueño de los eventos de demo; debe coincidir con la semilla de auth. |

## Portadas desde el dispositivo

El formulario permite seleccionar una imagen con vista previa, reemplazarla o quitarla. Los enlaces HTTP(S) anteriores siguen funcionando.

- `POST /api/events/:id/cover`: JWT de organizador dueño; `multipart/form-data` con un solo archivo `image`. Devuelve el evento actualizado. Rechaza eventos cancelados.
- JPEG, PNG o WebP de hasta **3 MiB**; se comprueban firma y dimensiones (máximo 10 000 por lado y 25 millones de píxeles). SVG no está permitido. La validación de cabeceras no recodifica la imagen.
- `GET /api/events/covers/:name`: lectura pública, con MIME fijo y `nosniff`. Los archivos tienen nombres UUID nuevos por subida; nunca se usa el nombre proporcionado por el cliente.
- `events.image_url` conserva solo `/api/events/covers/<uuid>.<ext>`; **no hay migración** ni bytes de imagen en PostgreSQL. El JSON de creación/edición acepta únicamente enlaces HTTP(S) o `null`: las rutas locales las asigna el endpoint de subida.
- `EVENTS_STORAGE_DIR` se crea al iniciar. El `.env.example` apunta a `../../../.local/entradasya/event-covers` (fuera del repositorio al arrancar desde `services/events`). Debe tener permisos de escritura y mantenerse entre reinicios/despliegues. Respaldar esta carpeta junto con la base; si se usan varias instancias, compartir el almacenamiento o migrar a un servicio de objetos.
- Una sustitución borra el archivo anterior después de confirmar la transacción. Si la base falla, se elimina el archivo nuevo. Una interrupción abrupta del proceso puede dejar un archivo sin referencia.
- Al crear, la web guarda primero el borrador y luego sube la portada. Si falla la subida, abre ese mismo borrador y permite seleccionar de nuevo la imagen, sin duplicar eventos.
- Vite ya reenvía `/api/events`. Si se usa Nginx, aplicar la configuración actualizada y recargarla: ese bloque admite 4 MiB para el archivo y los campos multipart.

Prueba manual: entrar como organizador → Crear evento → seleccionar portada → Guardar borrador → comprobar imagen al editar y publicar → comprobar cartelera → reemplazar o quitar y guardar. Probar además un archivo mayor de 3 MB y un formato no admitido.

## Pruebas

Las pruebas de portadas no requieren PostgreSQL ni puertos abiertos: usan Express y sus parsers reales, archivos temporales y transacciones simuladas (no prueban los bloqueos de PostgreSQL):

```bash
npm test -- tests/covers.test.ts
```

Las demás pruebas necesitan un Postgres real (las pruebas de concurrencia no se pueden simular). Usan su propio schema, `events_test`, que se borra y se recrea en cada ejecución:

```bash
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/events_db npm test
```

Cubren: acceso por rol, ciclo borrador → publicado → cancelado, validaciones, capacidad mínima, reserva idempotente, **último cupo con 10 compras simultáneas**, 30 compras simultáneas sin superar la capacidad, la misma orden enviada en paralelo, y liberación repetida o simultánea.

## Migraciones

- Están en `migrations/`, como archivos `.sql` con secciones `-- Up Migration` / `-- Down Migration`.
- Crear una nueva: `npm run migrate:create -- nombre-descriptivo`.
- Revertir la última: `npm run migrate -- down`.
- No modifiques una migración ya compartida: crea una nueva.

## Pendiente de acordar con el equipo

- **P1:** nombres de roles (`customer`, `organizer`, `doorman`), claims (`sub` UUID, `role`, `email`), `iss`/`aud` y algoritmo de firma.
- **P3:** el contrato de `/internal/reservations` y cómo trata `SOLD_OUT`, `EVENT_NOT_AVAILABLE` y los timeouts.
- **Todos:** la moneda (`CURRENCY`; en desarrollo usamos `BOB`). Las listas de categorías y ciudades están en `src/catalog.ts` y en `apps/web/src/features/events/catalog.ts`: si se agrega una, va en los dos.
- **P6:** que Nginx conserve el prefijo `/api` y bloquee `/internal/*`.
- **Fuera de alcance por ahora:** reservas que vencen solas si orders nunca confirma ni libera, y qué pasa con las entradas ya vendidas al cancelar un evento.
