-- Up Migration
CREATE TABLE ticket_orders (
  order_id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  payment_status text NOT NULL CHECK (payment_status = 'approved'),
  payload_hash char(64) NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES ticket_orders(order_id),
  ticket_number smallint NOT NULL CHECK (ticket_number BETWEEN 1 AND 6),
  code varchar(43) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, ticket_number)
);

CREATE INDEX ticket_orders_customer_idx ON ticket_orders(customer_id, created_at DESC);

-- Down Migration
DROP TABLE tickets;
DROP TABLE ticket_orders;
