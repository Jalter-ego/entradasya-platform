-- Up Migration

-- Esquema P3 según docs/database/README.md §5. Una orden = 1 a 6 entradas de un solo sector.
CREATE TABLE orders (
  id                     uuid        PRIMARY KEY,
  customer_id            uuid        NOT NULL,
  customer_email         text        NOT NULL CHECK (length(customer_email) BETWEEN 1 AND 254),
  idempotency_key        varchar(128) NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_hash           char(64)    NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status                 text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'paid', 'rejected', 'cancelled')),
  reservation_status     text        NOT NULL DEFAULT 'not_started'
                         CHECK (reservation_status IN ('not_started', 'pending', 'active', 'release_pending', 'released', 'failed')),
  payment_status         text        NOT NULL DEFAULT 'not_started'
                         CHECK (payment_status IN ('not_started', 'pending', 'unknown', 'approved', 'rejected')),
  ticket_status          text        NOT NULL DEFAULT 'not_started'
                         CHECK (ticket_status IN ('not_started', 'pending', 'issued')),
  notification_status    text        NOT NULL DEFAULT 'not_started'
                         CHECK (notification_status IN ('not_started', 'pending', 'sent', 'failed', 'unknown')),
  -- Solo datos ficticios de demo: { "method": "demo_card", "last4": "1111" | "0000" }.
  payment_request        jsonb       NOT NULL CHECK (
                           jsonb_typeof(payment_request) = 'object'
                           AND payment_request ->> 'method' = 'demo_card'
                           AND payment_request ->> 'last4' IN ('0000', '1111')
                           AND payment_request - 'method' - 'last4' = '{}'::jsonb
                         ),
  payment_transaction_id uuid,
  ticket_issue_payload   jsonb       CHECK (ticket_issue_payload IS NULL OR jsonb_typeof(ticket_issue_payload) = 'object'),
  last_error_step        text        CHECK (last_error_step IN ('reservation', 'payment', 'tickets', 'notification')),
  last_error_code        text,
  paid_at                timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT orders_customer_idempotency_key UNIQUE (customer_id, idempotency_key),
  CONSTRAINT orders_paid_requires_payment CHECK (
    status <> 'paid'
    OR (payment_status = 'approved' AND payment_transaction_id IS NOT NULL AND paid_at IS NOT NULL)
  )
);

CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at DESC);

-- Una línea por orden en v1. Los cuatro datos de la reserva llegan juntos o no llegan.
CREATE TABLE order_items (
  order_id             uuid     PRIMARY KEY REFERENCES orders (id),
  event_id             uuid     NOT NULL,
  sector_id            uuid     NOT NULL,
  quantity             smallint NOT NULL CHECK (quantity BETWEEN 1 AND 6),
  organizer_id         uuid,
  unit_price_minor     integer  CHECK (unit_price_minor >= 0),
  currency             char(3),
  reservation_snapshot jsonb    CHECK (reservation_snapshot IS NULL OR jsonb_typeof(reservation_snapshot) = 'object'),

  CONSTRAINT order_items_reservation_all_or_none CHECK (
    num_nulls(organizer_id, unit_price_minor, currency, reservation_snapshot) IN (0, 4)
  )
);

CREATE INDEX order_items_event_organizer_idx ON order_items (event_id, organizer_id);

-- Down Migration
DROP TABLE order_items;
DROP TABLE orders;
