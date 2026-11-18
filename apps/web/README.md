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
    ├── checkin/         # P6: portería, lectura QR, resultado y conteo
    ├── events/          # P2: cartelera, detalle, organizador
    ├── orders/          # P3: checkout, resultado y Mis compras
    ├── payments/        # P4: PaymentFields (pago de demo dentro del checkout)
    └── tickets/         # P5: Mis entradas y descarga autenticada
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
- **P3 (orders):** ✅ `/checkout` ya está implementado (ver la feature orders). El reporte `GET /api/orders/reports/events/:eventId` se adapta en `eventsApi.salesReport` a la forma de `SalesReport` que usa el panel: desenvuelve `data`, renombra `ordersPaid` → `paidOrders` y `sectors` → `bySector`, y usa la moneda del evento cuando no hay ventas. Si orders no responde, el panel muestra los lugares reservados.

## Feature orders (P3)

| Ruta | Pantalla |
|---|---|
| `/checkout?eventId&sectorId&quantity` | Resumen de la selección hecha en el detalle del evento, pago de demo y confirmación. Solo `role=customer`. |
| `/compras/:id` | Resultado: pagada (enlace a `/mis-entradas?orderId=`), rechazada (motivo y vuelta al evento) o en proceso (reintento). |
| `/mis-compras` | Compras del cliente con estado, total y paginación de 10. |

- **Idempotencia:** el checkout envía `Idempotency-Key`, que se genera en `features/orders/idempotency.ts`. Mientras la compra sea la misma (doble clic, timeout, recarga) se reutiliza la misma clave y el backend no crea otra orden ni cobra dos veces. Al cambiar la selección o el pago se genera otra clave, y se olvida al recibir la orden.
- **Precio:** el navegador nunca envía precio ni total; el total del checkout es solo de referencia.
- **Respuestas:** orders responde con un envoltorio `{ success, message, data, meta, requestId }`, y `features/orders/api.ts` lo desenvuelve. Los errores mantienen `{ error: { code, message } }`, así que `shared/api.ts` los traduce sin cambios.
- **Reintento:** en `/compras/:id`, "Reintentar" llama a `POST /api/orders/:id/retry`. Completa solo los pasos pendientes (emisión, correo, pago incierto) sin cobrar otra vez.
- **Pago (P4):** `CheckoutPage` usa `PaymentFields` de `features/payments`, con la interfaz `{ value, onChange, disabled }` y `value = { method: 'demo_card', last4 }`. Reemplazó al provisional `DemoPaymentFields`.
- **Cambios compartidos:** `shared/api.ts` acepta `headers` opcionales, y `shared/Layout.tsx` muestra «Mis compras» a los clientes.

## Feature payments (P4)

`features/payments/PaymentFields.tsx` es el componente de pago simulado que se monta dentro del formulario del checkout. No tiene rutas ni llama a ninguna API: devuelve `{ method: 'demo_card', last4 }` y el checkout lo envía a **orders** dentro de `POST /api/orders`. La web nunca llama a payments, que es interno.

| Terminación | Resultado |
|---|---|
| `1111` | Pago aprobado. |
| `0000` | Pago rechazado (para probar la liberación de cupos). |

No pide número de tarjeta, CVV ni importe: el total lo calcula orders con el precio de la reserva. Muestra una tarjeta de demo con el resultado esperado y se deshabilita mientras se procesa la compra. Estilos en `payments.css`, con los tokens de `global.css`.

## Feature tickets (P5)

| Ruta | Pantalla |
|---|---|
| `/mis-entradas` | Entradas del cliente autenticado; evento, fecha, lugar, sector, precio unitario, código y descarga individual de PDF. |
| `/mis-entradas?orderId=<UUID>` | La misma lista filtrada por una compra propia; enlace para volver a todas las entradas. |

El enlace aparece en el encabezado para `role=customer`. La página usa `GET /api/tickets/me` y descarga con `GET /api/tickets/:id/pdf`, enviando Bearer en ambos casos. El token no se incluye en URLs ni se usa la API interna desde el navegador. Hay paginación de 12 entradas, actualización manual y estados de carga, vacío y error. Cambiar de sesión cancela las peticiones y desmonta las entradas anteriores.

La etiqueta «Emitida» confirma la emisión; no indica si la entrada ya se utilizó. Ese dato lo administra checkin. El QR se muestra en el PDF emitido por tickets.

### Probar antes de que exista orders

Se puede desarrollar/probar esta pantalla sin P1 ni P3: el login provisional permite entrar como cliente y tickets puede emitir entradas de demo por su API interna. Sin entradas emitidas se muestra una lista vacía; events no es necesario para consultar o descargar entradas ya emitidas.

1. Configurar/migrar y levantar `services/tickets` siguiendo su README.
2. Verificar que su clave pública corresponda a la clave de desarrollo usada por el login web (`services/events/keys/dev-private.pem`), con el mismo issuer/audience. No generar un par diferente para cada servicio.
3. Para crear dos entradas de demo **en el servicio local**, ejecutar desde `services/tickets`, en otra terminal con Node 22.11 o superior:

```bash
node --env-file=.env --input-type=module <<'NODE'
const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3005}/internal/tickets/issue`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Token': process.env.INTERNAL_TOKEN_ORDERS,
  },
  body: JSON.stringify({
    orderId: '40000000-0000-4000-8000-000000000005',
    customerId: '00000000-0000-4000-8000-000000000002',
    paymentStatus: 'approved',
    quantity: 2,
    unitPriceMinor: 5000,
    currency: 'BOB',
    event: {
      id: '20000000-0000-4000-8000-000000000001',
      title: 'Noche de Rock — demo de entradas',
      venue: 'Estadio Central',
      startsAt: '2026-12-20T23:00:00.000Z',
      organizerId: '00000000-0000-4000-8000-000000000001',
    },
    sector: { id: '30000000-0000-4000-8000-000000000001', name: 'General' },
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(`${response.status}: ${result.error?.message ?? 'No se pudo emitir'}`);
console.log(`HTTP ${response.status}: ${result.items.length} entradas listas para el cliente de demo.`);
NODE
```

Este comando crea registros/PDF de prueba y simula la llamada de orders; no procesa una compra ni reserva cupos. Usa UUID y fecha fijos para que repetirlo conserve las mismas dos entradas. No cambiar el cuerpo con ese mismo `orderId`; para otro caso de prueba, usar un UUID de orden nuevo. La credencial interna se lee del `.env` del backend y nunca se publica en la configuración del frontend.

4. Levantar la web e iniciar sesión como `cliente@demo.bo` / `demo1234`.
5. Abrir `/mis-entradas`, descargar ambos PDF y comprobar el QR. También puede usarse `/mis-entradas?orderId=40000000-0000-4000-8000-000000000005`.

Para P1: conservar `useSession()` o actualizar sus consumidores al reemplazar el acceso. Para P3: emitir usando el contrato de tickets y enlazar `/mis-entradas?orderId=<UUID>` desde el resultado de compra. P4 puede usar `/mis-entradas` como enlace en el correo; el usuario inicia sesión, sin JWT en la URL. P6 debe conservar `/api/tickets` al configurar Nginx y servir la SPA también en `/mis-entradas`.

### Verificación local del frontend

```bash
npm run typecheck
npm run build
npm test
```

Las pruebas de tickets usan el ejecutor de Node y el compilador TypeScript ya instalado, sin nuevas dependencias. Simulan `fetch` y verifican Bearer, filtro/paginación, respuesta binaria, errores 401/403/404/503, errores del proxy, archivo vacío, HTML inesperado, caída de red y cancelación. No reemplazan la comprobación manual con el backend y PostgreSQL.

## Feature checkin (P6)

| Ruta | Pantalla |
|---|---|
| `/porteria` | Portería (`role=doorman`): selector de evento publicado, entrada manual o lector QR (teclado / cámara opcional), resultado claro (`APROBADO`, `ALREADY_USED` con hora del primer ingreso, `WRONG_EVENT`, `INVALID_TICKET`) y conteo en vivo. |

El enlace aparece en el encabezado para `role=doorman` y el inicio de sesión redirige automáticamente a `/porteria` con esa cuenta (`portero@demo.bo` / `demo1234`).
