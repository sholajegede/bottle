-- Bottle schema. Every statement is safe to run again.

CREATE TABLE IF NOT EXISTS accounts (
  id               text PRIMARY KEY,            -- Kinde user id
  email            text,
  plan             text NOT NULL DEFAULT 'free', -- free | pro
  plan_changed_at  timestamptz NOT NULL DEFAULT 'epoch',
  billing_state    text NOT NULL DEFAULT 'ok',   -- ok | past_due
  customer_id      text,                         -- Kinde billing customer id
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The intake. Every event from outside is written here first, then acknowledged.
-- (source, dedupe_key) is the one rule that makes a second copy harmless.
CREATE TABLE IF NOT EXISTS inbox_events (
  id               bigserial PRIMARY KEY,
  source           text NOT NULL,               -- kinde | sandbox
  dedupe_key       text NOT NULL,               -- the webhook-id header
  type             text NOT NULL,
  payload          jsonb NOT NULL,
  occurred_at      timestamptz NOT NULL,         -- time in the event, not arrival time
  received_at      timestamptz NOT NULL DEFAULT now(),
  seen_count       integer NOT NULL DEFAULT 1,   -- how many copies arrived
  status           text NOT NULL DEFAULT 'received', -- received | processing | applied | ignored | failed | dead
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  applied_at       timestamptz,
  replays          integer NOT NULL DEFAULT 0,
  result           text,
  account_id       text,
  UNIQUE (source, dedupe_key)
);
CREATE INDEX IF NOT EXISTS inbox_due ON inbox_events (next_attempt_at) WHERE status IN ('received', 'failed', 'processing');

-- One row for each copy that reached the endpoint, kept so the log can show it.
CREATE TABLE IF NOT EXISTS inbox_receipts (
  id           bigserial PRIMARY KEY,
  event_id     bigint REFERENCES inbox_events(id) ON DELETE CASCADE,
  received_at  timestamptz NOT NULL DEFAULT now(),
  outcome      text NOT NULL                    -- accepted | duplicate
);
CREATE INDEX IF NOT EXISTS receipts_event ON inbox_receipts (event_id);

-- Quota ledger. A grant or a spend is one row, and entry_key makes it happen once.
CREATE TABLE IF NOT EXISTS ledger (
  id          bigserial PRIMARY KEY,
  account_id  text NOT NULL,
  period      text NOT NULL,                    -- YYYY-MM
  delta       integer NOT NULL,
  reason      text NOT NULL,
  entry_key   text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger (account_id, period);

CREATE TABLE IF NOT EXISTS bottles (
  id               text PRIMARY KEY,
  account_id       text NOT NULL,
  kind             text NOT NULL,               -- email | webhook
  target           text NOT NULL,
  subject          text,
  body             text NOT NULL,
  deliver_at       timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'scheduled', -- scheduled | sending | delivered | failed | cancelled
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL,
  locked_until     timestamptz,
  delivered_at     timestamptz,
  last_error       text,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS bottles_due ON bottles (next_attempt_at) WHERE status IN ('scheduled', 'sending');
CREATE INDEX IF NOT EXISTS bottles_account ON bottles (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bottle_attempts (
  id         bigserial PRIMARY KEY,
  bottle_id  text NOT NULL REFERENCES bottles(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  ok         boolean NOT NULL,
  detail     text
);

-- The relay. Each account can point its own Kinde app's webhooks at /api/relay/{relay_id}.
-- Bottle checks the signature against the account's Kinde domain, keeps one row for each
-- delivery id, and `bottle listen` collects the rows with a lease.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS relay_id text UNIQUE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS relay_issuer text;

CREATE TABLE IF NOT EXISTS relay_events (
  id               text PRIMARY KEY,
  account_id       text NOT NULL,
  dedupe_key       text NOT NULL,               -- the webhook-id header
  type             text NOT NULL,
  token            text NOT NULL,               -- the signed JWT exactly as Kinde sent it
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  seen_count       integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'waiting', -- waiting | sending | delivered | failed
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  delivered_at     timestamptz,
  last_error       text,
  UNIQUE (account_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS relay_due ON relay_events (account_id, next_attempt_at) WHERE status IN ('waiting', 'sending');
