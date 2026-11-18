# PostgreSQL local — bases y usuarios (P4)

Prepara las **seis bases y sus seis usuarios exclusivos** definidos en el [README de bases, §1](../../docs/database/README.md#1-bases-usuarios-y-responsabilidades). Tarea D1 del [plan](../../docs/Plan_de_implementacion_EntradasYa_v1.md#p4---pago-correo-y-soporte-de-datos).

| Servicio | Base | Usuario |
|---|---|---|
| auth | `auth_db` | `auth_user` |
| events | `events_db` | `events_user` |
| orders | `orders_db` | `orders_user` |
| payments | `payments_db` | `payments_user` |
| tickets | `tickets_db` | `tickets_user` |
| checkin | `checkin_db` | `checkin_user` |

`notifications` y la web no tienen base.

**Qué hace y qué no:** crea usuarios y bases, les asigna dueño y bloquea el acceso cruzado. **No crea tablas**: cada dueño aplica sus migraciones desde `services/<servicio>` con su propio usuario.

## Archivos

| Archivo | Uso |
|---|---|
| `create-databases.sql` | Script de psql idempotente. Recibe las claves como variables; no contiene ninguna. |
| `setup-databases.sh` | Ubuntu/Linux: lee `.env`, ejecuta el script y verifica el aislamiento. |
| `setup-databases.ps1` | Windows PowerShell: lo mismo. |
| `.env.example` | Plantilla de conexión de administrador y una clave por usuario. |

## Uso

Requisitos: PostgreSQL 14 o superior en marcha y `psql` en el `PATH` (en Windows, `C:\Program Files\PostgreSQL\<versión>\bin`).

```bash
cp infra/postgres/.env.example infra/postgres/.env   # completar claves (≥ 12 caracteres)
./infra/postgres/setup-databases.sh                  # Ubuntu
```

```powershell
Copy-Item infra\postgres\.env.example infra\postgres\.env
.\infra\postgres\setup-databases.ps1                 # Windows
```

Salida esperada (resumida):

```text
Listo: seis bases y seis usuarios exclusivos preparados.
[OK]   auth_user      se conecta a auth_db
[OK]   auth_user      bloqueado en events_db
...
[OK]   checkin_user   bloqueado en auth_db
```

Para solo comprobar permisos: `setup-databases.sh --verify` o `setup-databases.ps1 -VerifyOnly`.

Con `WITH_TEST_DBS=1` crea además `<servicio>_test` (por ejemplo `orders_test`, `payments_test`), bases desechables para las pruebas de cada servicio, con el mismo dueño.

Sin los envoltorios también se puede ejecutar directamente:

```bash
psql -U postgres -d postgres -f infra/postgres/create-databases.sql \
  -v auth_password='...' -v events_password='...' -v orders_password='...' \
  -v payments_password='...' -v tickets_password='...' -v checkin_password='...'
```

## Permisos que deja

- Cada usuario: `LOGIN`, sin `SUPERUSER`, `CREATEDB` ni `CREATEROLE`.
- Cada base: dueño su usuario; `REVOKE ALL ... FROM PUBLIC` y `CONNECT` solo para su dueño. Otro usuario recibe `permission denied for database`.
- Schema `public` de cada base: dueño su usuario, sin `CREATE` para `PUBLIC`. Así las migraciones funcionan igual en PostgreSQL 14 y 15+.

Repetir el script no borra datos: actualiza las claves de los usuarios y reafirma dueños y permisos. Sirve también para cambiar una clave.

## Conexión de cada servicio

Cada dueño copia su clave en `services/<servicio>/.env`:

```text
DATABASE_URL=postgres://payments_user:<clave>@localhost:5432/payments_db
```

Si la clave tiene caracteres reservados de URL (`@`, `:`, `/`, `#`…), codificarla o generar una con `base64url`, como sugiere `.env.example`.

`infra/postgres/.env` queda fuera de Git (regla `.env` del `.gitignore` raíz). No subir claves reales.

## Supabase

Si el equipo usa el proyecto compartido con un schema por servicio, este script no aplica: allí cada servicio usa `DB_SCHEMA=<servicio>`. El objetivo de la entrega sigue siendo PostgreSQL local con bases separadas.
