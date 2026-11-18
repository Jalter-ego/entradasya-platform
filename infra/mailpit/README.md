# Mailpit local (P4)

[Mailpit](https://mailpit.axllent.org/) recibe por SMTP los correos de confirmación que envía `notifications` y los muestra en una interfaz web. **No envía correos reales a nadie.** Tarea D5 del [plan](../../docs/Plan_de_implementacion_EntradasYa_v1.md#p4---pago-correo-y-soporte-de-datos).

| Puerto | Uso |
|---|---|
| `127.0.0.1:1025` | SMTP. Lo usa `notifications` (`SMTP_HOST`/`SMTP_PORT`). |
| `127.0.0.1:8025` | Interfaz web: <http://localhost:8025>. |

Ambos solo en loopback. Nginx no publica Mailpit.

## Instalar el binario (sin Docker)

**Ubuntu / Linux** — script oficial, instala en `/usr/local/bin/mailpit`:

```bash
sudo bash < <(curl -sL https://raw.githubusercontent.com/axllent/mailpit/develop/install.sh)
mailpit version
```

**Windows**:

1. Descargar `mailpit-windows-amd64.zip` de <https://github.com/axllent/mailpit/releases/latest>.
2. Descomprimir `mailpit.exe` en una carpeta fuera del repositorio, por ejemplo `C:\tools\mailpit\`.
3. Agregar esa carpeta al `PATH` o pasar la ruta con `-Bin`.

```powershell
mailpit.exe version
```

No subir el binario a Git.

## Iniciar

```bash
./infra/mailpit/start-mailpit.sh                                  # Ubuntu
```

```powershell
.\infra\mailpit\start-mailpit.ps1                                 # Windows, mailpit en el PATH
.\infra\mailpit\start-mailpit.ps1 -Bin C:\tools\mailpit\mailpit.exe
```

Los scripts equivalen a:

```bash
mailpit --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025 --database <datos>/mailpit.db --max 500
```

- `--database` guarda los correos en un archivo (`~/.local/share/entradasya/mailpit.db` en Linux, `%LOCALAPPDATA%\entradasya\mailpit.db` en Windows): siguen ahí tras reiniciar, fuera del repositorio.
- `--max 500` conserva los últimos 500 correos.

Detener con `Ctrl+C`.

## Comprobar el envío

Con Mailpit y `notifications` en marcha (puerto 3006, ver su [README](../../services/notifications/README.md)):

```bash
curl -s http://127.0.0.1:3006/health
# {"status":"ok","service":"notifications"}   (503 si Mailpit no responde)

curl -s -X POST http://127.0.0.1:3006/internal/notifications/purchase \
  -H "content-type: application/json" \
  -H "x-internal-token: <INTERNAL_TOKEN_ORDERS de notifications>" \
  -d '{"orderId":"40000000-0000-4000-8000-000000000001","to":"cliente@demo.bo",
       "event":{"title":"Noche de Rock","venue":"Estadio Central","startsAt":"2026-12-20T23:00:00.000Z"},
       "sector":{"name":"General"},"quantity":2,"totalMinor":10000,"currency":"BOB"}'
```

Abrir <http://localhost:8025>: aparece «Compra confirmada: Noche de Rock» con el resumen y el botón «Ver mis entradas».

La API de Mailpit sirve para comprobarlo desde una prueba o script: `curl -s http://127.0.0.1:8025/api/v1/messages`.

## Escenario V9: Mailpit o notifications apagados

Si Mailpit se detiene, `notifications` responde `503 SMTP_UNAVAILABLE` (o `504 SMTP_TIMEOUT` si no contesta a tiempo). Si se detiene `notifications`, orders no recibe respuesta. En ambos casos orders conserva la compra **pagada** y las entradas descargables, y registra `notification_status=failed` o `unknown`. El reintento de la orden reenvía el correo cuando Mailpit vuelve.
