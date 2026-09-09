// Shared by migration v17 and the separate new-database schema. IF NOT EXISTS throughout, because
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

// Shared by migration v18 and the separate new-database schema. A separate constant, and a new
// version rather than an edit to CHANNEL_SCHEMA_SQL: a database that already ran 17 - every
// development profile on this branch - would otherwise never meet these tables.
//
// Every table mirrors its agent twin in the v8 baseline column for column, because one store
// implementation serves both owners. The two UNIQUE constraints on the run table are what make one
// fire produce one run; without them a missed re-arm degrades silently into duplicate work.
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
