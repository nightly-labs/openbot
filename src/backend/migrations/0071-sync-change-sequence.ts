import type { OpenBotMigration } from "./migration";

function changeTriggers(
  scope: "thread" | "channel",
  table: string,
  owner: string,
  shownColumns: readonly string[],
): string {
  const shown = (row: "new" | "old") =>
    `(${[owner, "message_id", ...shownColumns].map((column) => `${row}.${column}`).join(", ")})`;
  const forget = (row: "new" | "old") =>
    `DELETE FROM sync_message_changes WHERE scope = '${scope}' AND owner_id = ${row}.${owner} AND message_id = ${row}.message_id;`;
  const record = (row: "new" | "old", deleted: 0 | 1) =>
    `INSERT INTO sync_message_changes (scope, owner_id, message_id, deleted) VALUES ('${scope}', ${row}.${owner}, ${row}.message_id, ${deleted});`;
  return `
  CREATE TRIGGER IF NOT EXISTS sync_${scope}_message_insert AFTER INSERT ON ${table} BEGIN
    ${forget("new")}
    ${record("new", 0)}
  END;
  CREATE TRIGGER IF NOT EXISTS sync_${scope}_message_update AFTER UPDATE ON ${table}
    WHEN ${shown("old")} IS NOT ${shown("new")} BEGIN
    ${forget("old")}
    ${forget("new")}
    INSERT INTO sync_message_changes (scope, owner_id, message_id, deleted)
      SELECT '${scope}', old.${owner}, old.message_id, 1
      WHERE old.${owner} IS NOT new.${owner} OR old.message_id IS NOT new.message_id;
    ${record("new", 0)}
  END;
  CREATE TRIGGER IF NOT EXISTS sync_${scope}_message_delete AFTER DELETE ON ${table} BEGIN
    ${forget("old")}
    ${record("old", 1)}
  END;`;
}

export const V71_SYNC_CHANGE_SEQUENCE_SQL = `
  CREATE TABLE IF NOT EXISTS sync_message_changes (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK(scope IN ('thread', 'channel')),
    owner_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    deleted INTEGER NOT NULL CHECK(deleted IN (0, 1)),
    UNIQUE(scope, owner_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS sync_message_changes_owner ON sync_message_changes(scope, owner_id, sequence);
  ${changeTriggers("thread", "projection_thread_messages", "thread_id", [
    "turn_id",
    "author",
    "status",
    "item_type",
    "created_at",
    "ordinal",
    "message_json",
    "group_start",
    "group_first",
    "group_id",
    "turn_rank",
  ])}
  ${changeTriggers("channel", "projection_channel_messages", "channel_id", ["sequence", "message_json"])}
  CREATE TRIGGER IF NOT EXISTS sync_thread_changes_forget AFTER DELETE ON projection_threads BEGIN
    DELETE FROM sync_message_changes WHERE scope = 'thread' AND owner_id = old.thread_id;
  END;
  CREATE TRIGGER IF NOT EXISTS sync_channel_changes_forget AFTER DELETE ON projection_channels BEGIN
    DELETE FROM sync_message_changes WHERE scope = 'channel' AND owner_id = old.channel_id;
  END;
`;

export const migration: OpenBotMigration = {
  version: 71,
  name: "sync-change-sequence",
  up: (db) => db.exec(V71_SYNC_CHANGE_SEQUENCE_SQL),
};
