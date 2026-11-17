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

### Tokens de prueba (mientras auth no exista)

Genera un par de claves de desarrollo en `keys/` (la carpeta no se sube a Git):

```bash
node -e "const c=require('crypto'),fs=require('fs');const k=c.generateKeyPairSync('rsa',{modulusLength:2048});fs.mkdirSync('keys',{recursive:true});fs.writeFileSync('keys/auth-public.pem',k.publicKey.export({type:'spki',format:'pem'}));fs.writeFileSync('keys/dev-private.pem',k.privateKey.export({type:'pkcs8',format:'pem'}))"
npm run dev-token -- organizer      # imprime un JWT válido por 8 h (roles: customer, organizer, doorman)
```

Por defecto el token es del organizador de la semilla (`SEED_ORGANIZER_ID`), así ves sus eventos. En la web, pégalo en `http://localhost:5173/dev/sesion`. Cuando P1 entregue su clave pública, reemplaza `keys/auth-public.pem`.

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
| `SEED_ORGANIZER_ID` | Organizador dueño de los eventos de demo; debe coincidir con la semilla de auth. |

## Pruebas

Necesitan un Postgres real (las pruebas de concurrencia no se pueden simular). Usan su propio schema, `events_test`, que se borra y se recrea en cada ejecución:

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
