# Nginx — Gateway local de EntradasYa (P6)

Nginx actúa como puerta de entrada única en `http://localhost:8080`:

- Sirve la aplicación web (`apps/web/dist` en demo, o proxy a Vite `127.0.0.1:5173` en desarrollo).
- Enruta únicamente las 5 APIs públicas conservando el prefijo `/api`:
  - `/api/auth` → `127.0.0.1:3001`
  - `/api/events` → `127.0.0.1:3002`
  - `/api/orders` → `127.0.0.1:3003`
  - `/api/tickets` → `127.0.0.1:3005`
  - `/api/checkin` → `127.0.0.1:3007`
- **Bloquea `/internal/*`** con `404`.
- **No publica** `payments` (`3004`), `notifications` (`3006`) ni la carpeta local de PDF (`TICKETS_STORAGE_DIR`).

## Uso en Ubuntu / Linux

1. Instalar Nginx:

```bash
sudo apt update && sudo apt install -y nginx
```

2. Compilar la web si vas a servir archivos estáticos:

```bash
cd apps/web && npm run build
```

3. Copiar la configuración y ajustar la ruta `root` hacia `<ruta-del-repo>/apps/web/dist` (o usar `entradasya.dev.conf` si corres `npm run dev` en Vite):

```bash
sudo cp infra/nginx/entradasya.conf /etc/nginx/sites-available/entradasya.conf
sudo ln -sf /etc/nginx/sites-available/entradasya.conf /etc/nginx/sites-enabled/entradasya.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Uso en Windows

1. Descarga Nginx para Windows y extráelo (por ejemplo en `C:\nginx`).
2. Copia `infra/nginx/nginx.windows.conf` sobre `C:\nginx\conf\nginx.conf` (o pásalo con `-c`).
3. Ejecuta `nginx.exe` desde `C:\nginx`:

```powershell
cd C:\nginx
.\nginx.exe -t
.\nginx.exe
```

Para recargar o detener:

```powershell
.\nginx.exe -s reload
.\nginx.exe -s stop
```

## Verificación de seguridad del gateway

```bash
# Debe devolver 404 desde Nginx (aunque tickets/events respondan en loopback):
curl -i http://localhost:8080/internal/tickets/validate
curl -i http://localhost:8080/internal/payments
```
