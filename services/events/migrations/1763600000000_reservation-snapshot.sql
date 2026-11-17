-- Up Migration

-- Copia inmutable del evento y del sector tomada al reservar (docs/database/README.md, sección 4).
-- Las consultas y repeticiones de la reserva devuelven esta copia aunque después se edite
-- el evento o el sector, así un reintento de orders/tickets no cambia de datos.
ALTER TABLE reservations ADD COLUMN snapshot jsonb;

-- Filas previas: se rellenan con los datos actuales. No reconstruye valores históricos
-- que ya se hubieran sobrescrito antes de esta migración.
UPDATE reservations r
SET snapshot = jsonb_build_object(
  'event', jsonb_build_object(
    'id', e.id,
    'title', e.title,
    'venue', e.venue,
    'city', e.city,
    'startsAt', to_char(e.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'organizerId', e.organizer_id
  ),
  'sector', jsonb_build_object('id', s.id, 'name', s.name)
)
FROM events e, sectors s
WHERE e.id = r.event_id AND s.id = r.sector_id;

ALTER TABLE reservations
  ALTER COLUMN snapshot SET NOT NULL,
  ADD CONSTRAINT reservations_snapshot_shape CHECK (
    jsonb_typeof(snapshot -> 'event') = 'object' AND jsonb_typeof(snapshot -> 'sector') = 'object'
  );

-- Down Migration

ALTER TABLE reservations DROP CONSTRAINT reservations_snapshot_shape, DROP COLUMN snapshot;
