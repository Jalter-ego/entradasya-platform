-- Up Migration

-- Categoría y ciudad del evento, para filtrar la cartelera.
-- Los valores permitidos se validan en la API (src/catalog.ts); aquí solo se exige que existan.
ALTER TABLE events
  ADD COLUMN category text NOT NULL DEFAULT 'otros' CHECK (length(category) BETWEEN 1 AND 40),
  ADD COLUMN city     text NOT NULL DEFAULT 'La Paz' CHECK (length(city) BETWEEN 1 AND 100);

CREATE INDEX events_published_filters_idx ON events (status, category, city, starts_at);

-- Down Migration

DROP INDEX events_published_filters_idx;
ALTER TABLE events DROP COLUMN city, DROP COLUMN category;
