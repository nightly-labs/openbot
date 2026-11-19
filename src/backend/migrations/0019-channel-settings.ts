import type { DatabaseSync } from "node:sqlite";
import { migrateProviderSessionsForOpencode } from "./0017-provider-sessions-opencode";
import type { OpenBotMigration } from "./migration";

export const CHANNEL_SETTINGS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_channel_memories (
    memory_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES projection_channels(channel_id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('automatic', 'manual')),
    source_turn_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    UNIQUE(channel_id, normalized_text)
  );
  CREATE INDEX IF NOT EXISTS channel_memories_channel
    ON projection_channel_memories(channel_id, updated_at DESC, memory_id);
  CREATE TABLE IF NOT EXISTS projection_channel_routines (
    routine_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES projection_channels(channel_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    instruction TEXT NOT NULL,
    active INTEGER NOT NULL CHECK(active IN (0, 1)),
    timezone TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS channel_routines_channel
    ON projection_channel_routines(channel_id, updated_at DESC, routine_id);
  CREATE TABLE IF NOT EXISTS projection_channel_routine_triggers (
    trigger_id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES projection_channel_routines(routine_id) ON DELETE CASCADE,
    schedule_json TEXT NOT NULL CHECK(json_valid(schedule_json)),
    next_run_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    UNIQUE(routine_id)
  );
  CREATE INDEX IF NOT EXISTS channel_routine_triggers_due
    ON projection_channel_routine_triggers(next_run_at, routine_id);
  CREATE TABLE IF NOT EXISTS projection_channel_routine_runs (
    run_id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES projection_channel_routines(routine_id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    trigger_id TEXT,
    run_kind TEXT NOT NULL CHECK(run_kind IN ('scheduled', 'manual')),
    scheduled_for TEXT NOT NULL,
    routine_name TEXT NOT NULL,
    instruction TEXT NOT NULL,
    request_message_id TEXT,
    status TEXT NOT NULL CHECK(status IN (
      'queued', 'running', 'needs-attention', 'succeeded', 'failed', 'cancelled'
    )),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    UNIQUE(trigger_id, scheduled_for)
  );
  CREATE INDEX IF NOT EXISTS channel_routine_runs_routine
    ON projection_channel_routine_runs(routine_id, created_at DESC, run_id);
  CREATE UNIQUE INDEX IF NOT EXISTS channel_routine_runs_request
    ON projection_channel_routine_runs(request_message_id) WHERE request_message_id IS NOT NULL;
`;

function migrateChannelSettings(db: DatabaseSync): void {
  migrateProviderSessionsForOpencode(db);
  db.exec(CHANNEL_SETTINGS_SCHEMA_SQL);
}

export const migration: OpenBotMigration = {
  version: 19,
  name: "channel-settings",
  disableForeignKeys: true,
  up: migrateChannelSettings,
};
