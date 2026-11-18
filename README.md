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
- [Tickets — P5](services/tickets/README.md).

El esquema documenta también los servicios pendientes. No implica que sus bases, migraciones o endpoints ya estén implementados. Cada responsable mantiene el arranque y las migraciones de su servicio.
