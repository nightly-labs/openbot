import type { OpenBotMigration } from "./migration";

export const WEBHOOK_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_routine_webhooks (
    routine_id TEXT PRIMARY KEY REFERENCES projection_agent_routines(routine_id) ON DELETE CASCADE,
    route_id TEXT NOT NULL UNIQUE,
    event_type TEXT,
    filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),
    secret_ciphertext TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projection_channel_routine_webhooks (
    routine_id TEXT PRIMARY KEY REFERENCES projection_channel_routines(routine_id) ON DELETE CASCADE,
    route_id TEXT NOT NULL UNIQUE,
    event_type TEXT,
    filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),
    secret_ciphertext TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projection_webhook_route_revocations (
    route_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projection_webhook_receipts (
    receipt_id TEXT PRIMARY KEY,
    owner_kind TEXT NOT NULL CHECK(owner_kind IN ('agent', 'channel')),
    routine_id TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('started', 'ignored')),
    reason TEXT CHECK(reason IS NULL OR reason IN ('event-type', 'filter', 'inactive')),
    run_id TEXT,
    received_at TEXT NOT NULL,
    UNIQUE(owner_kind, routine_id, delivery_id)
  );
  CREATE INDEX IF NOT EXISTS webhook_receipts_recent
    ON projection_webhook_receipts(owner_kind, routine_id, received_at DESC, receipt_id);
  CREATE INDEX IF NOT EXISTS webhook_receipts_received ON projection_webhook_receipts(received_at);
`;

export const migration: OpenBotMigration = {
  version: 30,
  name: "routine-webhooks",
  up: (db) => db.exec(WEBHOOK_SCHEMA_SQL),
};
