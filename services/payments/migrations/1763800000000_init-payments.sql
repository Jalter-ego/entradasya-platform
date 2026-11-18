-- Up Migration

-- Pago simulado de una orden (docs/database/README.md, sección 6).
-- Un registro por orden: la unicidad de order_id hace idempotente el cobro,
-- también ante dos peticiones simultáneas. El resultado es definitivo y no se actualiza.
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL,
  amount_minor    bigint NOT NULL,
  currency        char(3) NOT NULL,
  method          text NOT NULL,
  demo_last4      char(4) NOT NULL,
  request_hash    char(64) NOT NULL,
  status          text NOT NULL,
  rejection_code  text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payments_order_id_key UNIQUE (order_id),
  CONSTRAINT payments_amount_minor_check CHECK (amount_minor >= 0),
  CONSTRAINT payments_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payments_method_check CHECK (method = 'demo_card'),
  CONSTRAINT payments_demo_last4_check CHECK (demo_last4 IN ('0000', '1111')),
  CONSTRAINT payments_request_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT payments_status_check CHECK (status IN ('approved', 'rejected')),
  CONSTRAINT payments_result_check CHECK (
    (status = 'approved' AND rejection_code IS NULL)
    OR (status = 'rejected' AND rejection_code = 'PAYMENT_REJECTED')
  )
);

-- Down Migration

DROP TABLE payments;
