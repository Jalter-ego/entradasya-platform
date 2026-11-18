# P1 · Autenticación y acceso

El servicio auth registra clientes, inicia sesión para los tres roles y firma los JWT que usan las APIs públicas. La web usa el mismo formulario y las mismas rutas API en desarrollo y en la demo.

## Implementación

| Tarea | Entrega |
|---|---|
| A1 | Servicio Express/TypeScript independiente, migración de `users` en `auth_db`, plantilla de entorno y comandos de arranque. |
| A2 | `GET /health` comprueba acceso a la tabla. Errores JSON y logs con `requestId`, sin registrar credenciales ni tokens. |
| A3 | Contrato OpenAPI y JWT RS256 verificable localmente en events, orders, tickets y checkin. |
| A4 | Registro y login con normalización de correo, hash scrypt con sal aleatoria y JWT firmado. PostgreSQL resuelve la unicidad de correo ante registros concurrentes. |
| A5 | El registro público asigna `customer`. La semilla de demo conserva los UUID acordados de cliente, organizador y portero. |
| A6 | Pantalla de acceso, sesión persistente al recargar, cierre de sesión, expiración en el navegador y navegación por rol. |
| A7 | Guía de arranque, integración de claves públicas y verificación reproducible. |

[Arranque de auth y semilla](../services/auth/README.md) · [Esquema de datos](database/README.md#3-p1--auth_db) · [Contrato OpenAPI](../contracts/auth.openapi.yaml)

## Integración con P2 a P6

- **P2 · events.** El JWT del organizador identifica los eventos propios mediante `sub`. El UUID de `organizador@demo.bo` coincide con el de la semilla de events.
- **P3 · orders.** El JWT de cliente aporta el UUID y el correo firmado de la compra. El rol organizador habilita el acceso al reporte conforme a las reglas de orders.
- **P4 · payments y notifications.** Mantienen sus credenciales internas por par de servicios.
- **P5 · tickets.** Usa `sub` para listar y descargar los PDF del cliente dueño. El correo de confirmación puede enlazar a `/mis-entradas`.
- **P6 · checkin.** El rol portero abre `/porteria` y su `sub` identifica quién registra el ingreso. Nginx y Vite ya enrutan `/api/auth` conservando el prefijo.

Configurar el PEM público en los cuatro consumidores. La clave privada se guarda en auth. Los valores comunes son `JWT_ALG=RS256`, `JWT_ISSUER=entradasya-auth` y `JWT_AUDIENCE=entradasya`. Un login local con una cuenta sembrada entrega un token de ejemplo con vigencia configurable de 8 horas por defecto.

```http
POST /api/auth/login
Content-Type: application/json

{"email":"organizador@demo.bo","password":"<contraseña-configurada-en-la-semilla>"}
```

Con el `token` de esa respuesta, enviar `Authorization: Bearer <token>` a `GET /api/events/mine`. Un token de cliente devuelve `403` en esa ruta.

## Verificación

1. Ejecutar `npm run build` y `npm test` en `services/auth`. Configurar `TEST_DATABASE_URL` para incluir migración, alta concurrente, login, verificación de JWT y repetición de la semilla en PostgreSQL. Ejecutar `npm run build` en `apps/web`.
2. Con auth migrado, `GET http://127.0.0.1:3001/health` debe devolver `200`. En una base desechable sin migrar, debe devolver `503`.
3. **V2.** Desde `/login`, registrar un cliente y recargar `/mis-entradas`. Cerrar sesión y volver a entrar con sus credenciales. Intentar abrir `/organizador/eventos` con esa cuenta y descargar un PDF perteneciente a otro cliente. Deben rechazarse ambos accesos.
4. Sembrar e iniciar sesión como organizador y luego como portero. Verificar el destino inicial (`/organizador/eventos` y `/porteria`), los enlaces de cada rol y el acceso a sus APIs.
5. En un entorno de pruebas, arrancar auth con `JWT_TTL_SECONDS=15`, iniciar sesión y esperar al vencimiento en una vista protegida. La vista debe pedir iniciar sesión de nuevo. Un token vencido debe devolver `401` en una API protegida.
6. **V11.** Un organizador con token de auth debe poder consultar el reporte de sus eventos y recibir un rechazo al editar un evento de otro organizador. Un cliente debe recibir `403` ante una operación de organizador.

### Resultados locales

- Compilaron auth y la web. Pasaron las tres pruebas de auth con PostgreSQL 18 en bases desechables y se validó el OpenAPI.
- En Chrome, con Vite y con Nginx como puerta de entrada, se verificaron el registro, el login, la recarga, la navegación por rol, el vencimiento y el cierre de sesión.
- Se verificaron en Chrome 48 combinaciones de acceso directo a rutas públicas y protegidas con sesión de cliente, organizador, portero y visitante. La revisión aisló la navegación con datos de prueba y comprobó también los cuatro menús.
- **V2.** Tickets entregó el PDF al dueño y devolvió `404` a otro cliente. La web y events rechazaron el acceso de un cliente a operaciones de organizador.
- **V11.** Una compra simulada de una entrada produjo un reporte de 5.000 unidades menores para el organizador dueño. Se rechazaron el reporte y la edición del evento para un segundo organizador.
- Events, orders, tickets y checkin aceptaron JWT emitidos por auth. Events y tickets también aceptaron peticiones autenticadas después de detener auth.

## Bitácora de P1

1. Se compararon el plan adjunto, el plan del repositorio, el esquema de datos y la documentación de P2 a P6. Se comprobó que los consumidores ya esperaban los mismos roles, emisor y audiencia.
2. Se implementaron la base de cuentas, el contrato y la firma. Se preservaron las identidades de demo y se sustituyó el firmador provisional de Vite por auth.
3. Se integraron la pantalla y las rutas con la API de sesión ya usada por las demás vistas.
4. Se retiró el comando `dev-token` de events. El servicio auth centraliza la firma de JWT y los demás servicios usan el PEM público para verificarlo.

## Contribuciones de P1

- Servicio `services/auth`, migración y semilla de demo, autenticación, firma JWT, OpenAPI y pruebas.
- Feature `apps/web/src/features/auth`, integración en el router y el encabezado compartido.
- Instrucciones de arranque, entrega de clave pública a los consumidores y paso de auth a servicio requerido en la verificación local.
