# web

Interfaz única de EntradasYa: React 18 + Vite + TypeScript, con vistas por rol.

## Arranque

```bash
cd apps/web
npm install
npm run dev          # http://localhost:5173
npm run build        # genera dist/ para que Nginx la sirva en la demo
```

En desarrollo, Vite reenvía cada API a su servicio con los puertos del plan: auth 3001, events 3002, orders 3003, tickets 3005 y checkin 3007. Para cambiar uno: `EVENTS_URL=http://127.0.0.1:4002 npm run dev`. En la demo, Nginx cumple ese papel.

## Estructura

```text
src/
├── App.tsx              # rutas
├── shared/              # piezas comunes (provisorias; ver abajo)
│   ├── api.ts           # fetch con el formato de error acordado
│   ├── session.tsx      # sesión: la reemplaza P1
│   ├── Layout.tsx       # encabezado y pie: P1 define la navegación por rol
│   └── ...
├── styles/global.css    # colores, tipografía y componentes base
└── features/
    └── events/          # P2: cartelera, detalle, organizador
```

Cada integrante trabaja en `src/features/<su-feature>/` y agrega sus rutas en `App.tsx`.

## Login de prueba (solo desarrollo)

Mientras no exista el servicio auth, `npm run dev` incluye un login de prueba (`dev-auth.ts`) que firma tokens con `services/events/keys/dev-private.pem`. No forma parte del build.

| Cuenta | Rol |
|---|---|
| `organizador@demo.bo` | Organizador (dueño de los eventos de demo) |
| `cliente@demo.bo` | Cliente |
| `portero@demo.bo` | Portero |

Contraseña de todas: `demo1234`. La pantalla `/login` las muestra con un botón para completar el formulario.

## Feature events (P2)

| Ruta | Pantalla |
|---|---|
| `/` | Cartelera: carrusel de próximos eventos, búsqueda y filtros por categoría y ciudad. |
| `/eventos/:id` | Detalle: sectores con disponibilidad, cantidad (1 a 6) y total. «Continuar con la compra» lleva a `/checkout?eventId&sectorId&quantity`. |
| `/organizador/eventos` | Mis eventos: estado, lugares reservados, publicar y cancelar. |
| `/organizador/eventos/nuevo` | Crear evento con sus sectores (queda en borrador). |
| `/organizador/eventos/:id` | Editar datos, sectores y precios; ver ventas. |

### Lo que espera de otros

- **P1 (auth):** reemplazar `shared/session.tsx` conservando `useSession()` → `{ token, user, signIn, signOut }`, y el encabezado. La pantalla `/login` (`shared/LoginPage.tsx`) se puede reutilizar: solo hay que cambiar `LOGIN_URL` en `shared/authApi.ts` a `/api/auth/login` y borrar `dev-auth.ts`.
- **P3 (orders):**
  - La ruta `/checkout`, que hoy es un marcador.
  - El reporte `GET /api/orders/reports/events/:eventId` con la forma de `SalesReport` en `features/events/api.ts`: `{ eventId, currency, paidOrders, ticketsSold, revenueMinor, bySector? }`. Si cambia, se ajusta ahí. Hasta que exista, el panel muestra los lugares reservados.
