-- Up Migration

-- Un único ingreso por ticket_id, sin importar qué evento se seleccione al reescanear.
CREATE TABLE checkins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      uuid        NOT NULL UNIQUE,
  event_id       uuid        NOT NULL,
  doorman_id     uuid        NOT NULL,
  checked_in_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX checkins_event_checked_in_idx ON checkins (event_id, checked_in_at);

-- Down Migration

DROP TABLE checkins;
