// Shared by migration v15 and the separate new-database schema.
export const GROUP_SCHEMA_SQL = `
  CREATE TABLE projection_groups (
    group_id TEXT PRIMARY KEY,
    group_json TEXT NOT NULL CHECK(json_valid(group_json))
  );
  CREATE TABLE projection_group_messages (
    group_id TEXT NOT NULL REFERENCES projection_groups(group_id),
    message_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    message_json TEXT NOT NULL CHECK(json_valid(message_json)),
    PRIMARY KEY(group_id, message_id)
  );
  CREATE INDEX group_messages_sequence ON projection_group_messages(group_id, sequence);
  CREATE TABLE projection_group_tasks (
    task_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES projection_groups(group_id),
    task_json TEXT NOT NULL CHECK(json_valid(task_json))
  );
  CREATE INDEX group_tasks_group ON projection_group_tasks(group_id);
  CREATE TABLE projection_group_assignments (
    assignment_id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES projection_groups(group_id),
    task_id TEXT NOT NULL REFERENCES projection_group_tasks(task_id),
    delivery_id TEXT UNIQUE,
    assignment_json TEXT NOT NULL CHECK(json_valid(assignment_json))
  );
  CREATE INDEX group_assignments_group ON projection_group_assignments(group_id);
  CREATE TABLE projection_group_contexts (
    group_id TEXT NOT NULL REFERENCES projection_groups(group_id),
    agent_id TEXT NOT NULL,
    thread_id TEXT NOT NULL UNIQUE REFERENCES projection_threads(thread_id),
    session_id TEXT,
    through_sequence INTEGER NOT NULL DEFAULT 0,
    summary_version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(group_id, agent_id)
  );
  CREATE TABLE projection_group_summaries (
    group_id TEXT PRIMARY KEY REFERENCES projection_groups(group_id),
    version INTEGER NOT NULL,
    through_sequence INTEGER NOT NULL,
    text TEXT NOT NULL
  );
  CREATE TABLE projection_group_reads (
    group_id TEXT NOT NULL REFERENCES projection_groups(group_id),
    member_id TEXT NOT NULL,
    through_sequence INTEGER NOT NULL,
    PRIMARY KEY(group_id, member_id)
  );
`;
