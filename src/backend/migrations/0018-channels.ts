import type { OpenBotMigration } from "./migration";

// Shared by migration v18 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema: a database built from the
// latest schema and then replayed forward - which is how a test fakes an older version - meets its
// own tables.
export const CHANNEL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_channels (
    channel_id TEXT PRIMARY KEY,
    channel_json TEXT NOT NULL CHECK(json_valid(channel_json))
  );
  CREATE TABLE IF NOT EXISTS projection_channel_messages (
    channel_id TEXT NOT NULL REFERENCES projection_channels(channel_id),
    message_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    message_json TEXT NOT NULL CHECK(json_valid(message_json)),
    PRIMARY KEY(channel_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS channel_messages_sequence ON projection_channel_messages(channel_id, sequence);
  CREATE TABLE IF NOT EXISTS projection_channel_tasks (
    task_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES projection_channels(channel_id),
    task_json TEXT NOT NULL CHECK(json_valid(task_json))
  );
  CREATE INDEX IF NOT EXISTS channel_tasks_channel ON projection_channel_tasks(channel_id);
  CREATE TABLE IF NOT EXISTS projection_channel_assignments (
    assignment_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES projection_channels(channel_id),
    task_id TEXT NOT NULL REFERENCES projection_channel_tasks(task_id),
    delivery_id TEXT UNIQUE,
    assignment_json TEXT NOT NULL CHECK(json_valid(assignment_json))
  );
  CREATE INDEX IF NOT EXISTS channel_assignments_channel ON projection_channel_assignments(channel_id);
  CREATE TABLE IF NOT EXISTS projection_channel_contexts (
    channel_id TEXT NOT NULL REFERENCES projection_channels(channel_id),
    agent_id TEXT NOT NULL,
    thread_id TEXT NOT NULL UNIQUE REFERENCES projection_threads(thread_id),
    session_id TEXT,
    through_sequence INTEGER NOT NULL DEFAULT 0,
    summary_version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(channel_id, agent_id)
  );
  CREATE TABLE IF NOT EXISTS projection_channel_summaries (
    channel_id TEXT PRIMARY KEY REFERENCES projection_channels(channel_id),
    version INTEGER NOT NULL,
    through_sequence INTEGER NOT NULL,
    text TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projection_channel_reads (
    channel_id TEXT NOT NULL REFERENCES projection_channels(channel_id),
    member_id TEXT NOT NULL,
    through_sequence INTEGER NOT NULL,
    PRIMARY KEY(channel_id, member_id)
  );
`;

export const migration: OpenBotMigration = {
  version: 18,
  name: "channels",
  up: (db) => db.exec(CHANNEL_SCHEMA_SQL),
};
