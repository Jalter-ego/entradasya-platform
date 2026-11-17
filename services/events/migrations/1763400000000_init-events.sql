-- Up Migration

CREATE TABLE events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  uuid        NOT NULL,
  title         text        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description   text        NOT NULL DEFAULT '',
  venue         text        NOT NULL CHECK (length(venue) BETWEEN 1 AND 200),
  starts_at     timestamptz NOT NULL,
  image_url     text,
  currency      char(3)     NOT NULL,
  status        text        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_status_starts_at_idx ON events (status, starts_at);
CREATE INDEX events_organizer_idx ON events (organizer_id);

-- "reserved" = cupos comprometidos (reservas activas). Nunca supera la capacidad:
-- la base lo garantiza aunque el código tenga un error.
CREATE TABLE sectors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid    NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name         text    NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  price_minor  integer NOT NULL CHECK (price_minor >= 0),
  capacity     integer NOT NULL CHECK (capacity > 0),
  reserved     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sectors_reserved_range CHECK (reserved >= 0 AND reserved <= capacity),
  CONSTRAINT sectors_event_name_unique UNIQUE (event_id, name)
);

-- Una reserva por orden (la compra es de un solo sector). La unicidad de order_id
-- hace idempotente la reserva y serializa dos pedidos simultáneos de la misma orden.
CREATE TABLE reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid    NOT NULL UNIQUE,
  event_id          uuid    NOT NULL REFERENCES events (id),
  sector_id         uuid    NOT NULL REFERENCES sectors (id),
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 6),
  unit_price_minor  integer NOT NULL CHECK (unit_price_minor >= 0),
  currency          char(3) NOT NULL,
  status            text    NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'released')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  released_at       timestamptz
);

CREATE INDEX reservations_sector_idx ON reservations (sector_id);

-- Down Migration

DROP TABLE reservations;
DROP TABLE sectors;
DROP TABLE events;
