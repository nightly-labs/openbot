import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0050_hosted_server_start_requested_at.sql";

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0049_user_chat_color.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
    INSERT INTO hosted_servers(
      server_id, owner_user_id, name, provider_sandbox_id, size, plan, billing_interval, currency, desired_state,
      observed_state, observed_error, provider_event_at, last_wake_reason, last_active_at, idempotency_key,
      created_at, updated_at
    ) VALUES
      ('waking', 'owner', 'Studio', 'sbx_1', 'small', 'starter', 'month', 'eur', 'running', 'waking', NULL, 5,
       'message', 5, 'key-1', 1, 5),
      ('idle', 'owner', 'Lab', 'sbx_2', 'default', 'standard', 'year', 'pln', 'idle', 'stopped', NULL, 3,
       'schedule', 3, 'key-2', 2, 3),
      ('paying', 'owner', 'New', NULL, 'large', 'pro', 'month', 'usd', 'running', 'awaiting_payment', NULL, NULL,
       NULL, NULL, 'key-3', 4, 4);
  `);
  return database;
}

const rows = (database: DatabaseSync) => database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all();

describe("hosted server start time migration", () => {
  it("keeps every hosted server, and starts each one with no start that waits", () => {
    const database = beforeMigration();
    const before = rows(database);

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(rows(database)).toEqual(before.map((row) => ({ ...row, start_requested_at: null })));
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the Worker that runs before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    // The deployed Worker names no start time in its insert, its wake or its observed state.
    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('old-worker', 'owner', 'Old', 'small', 'starter', 'month', 'eur', 'running', 'awaiting_payment',
        'key-4', 6, 6);
      UPDATE hosted_servers SET observed_state = 'waking', last_wake_reason = 'message', updated_at = 7
        WHERE server_id = 'idle';
      UPDATE hosted_servers SET observed_state = 'running', provider_event_at = 8, updated_at = 8
        WHERE server_id = 'waking';
    `);
    expect(
      database.prepare("SELECT server_id, start_requested_at FROM hosted_servers ORDER BY server_id").all(),
    ).toEqual([
      { server_id: "idle", start_requested_at: null },
      { server_id: "old-worker", start_requested_at: null },
      { server_id: "paying", start_requested_at: null },
      { server_id: "waking", start_requested_at: null },
    ]);
    database.exec("UPDATE hosted_servers SET start_requested_at = 9 WHERE server_id = 'idle'");
    database.exec("UPDATE hosted_servers SET start_requested_at = NULL WHERE server_id = 'idle'");
  });
});
