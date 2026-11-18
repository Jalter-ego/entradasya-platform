# EntradasYa Platform

Proyecto del módulo 3: plataforma de eventos, compra de entradas y control de ingreso, desarrollada por seis integrantes.

## Documentación para el equipo

- [Esquema de bases de datos](docs/database/README.md): referencia de tablas, campos, restricciones, estados y datos compartidos. Consultar antes de crear o modificar migraciones.
- [Plan de implementación y reparto P1–P6](docs/Plan_de_implementacion_EntradasYa_v1.md): alcance, tareas, integración y aceptación; se basa en el esquema anterior.
- [Contratos HTTP](contracts/): peticiones y respuestas entre servicios.

## Componentes actuales

- [Web](apps/web/README.md).
- [Events — P2](services/events/README.md).
- [Orders — P3](services/orders/README.md).
- [Payments — P4](services/payments/README.md): pago simulado e idempotente, solo interno.
- [Tickets — P5](services/tickets/README.md).
- [Notifications — P4](services/notifications/README.md): correo de confirmación a Mailpit, solo interno.

## Infraestructura local

- [PostgreSQL — P4](infra/postgres/README.md): script para crear las seis bases y sus usuarios exclusivos.
- [Mailpit — P4](infra/mailpit/README.md): instalación del binario y arranque en `127.0.0.1:1025` (SMTP) / `:8025` (interfaz).

El esquema documenta también los servicios pendientes. No implica que sus bases, migraciones o endpoints ya estén implementados. Cada responsable mantiene el arranque y las migraciones de su servicio.
