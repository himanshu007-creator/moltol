-- MolTol core schema (scaffold). Applied idempotently on API startup.
-- Money is stored as integer minor units (cents). See plan section 9.2.1.

CREATE TABLE IF NOT EXISTS negotiations (
  id                 text PRIMARY KEY,
  state              text NOT NULL,
  query              text NOT NULL,
  persona            text NOT NULL,
  rounds_max         integer NOT NULL,
  max_total_cents    integer NOT NULL,
  currency           char(3) NOT NULL,
  agreed_price_cents integer,
  paypal_order_id    text,
  market             jsonb,
  turns              jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS negotiations_created_at_idx ON negotiations (created_at DESC);
