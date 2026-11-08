import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { COUNT_FEEDBACK, UNCOUNT_FEEDBACK } from "../src/server/feedback-daily-counts";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0051_feedback_daily_counts.sql";

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0050_hosted_server_start_requested_at.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at) VALUES
      ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1),
      ('other', 'email:other@example.test', 'other@example.test', 'Other', NULL, 2, 2);
  `);
  return database;
}

const users = (database: DatabaseSync) => database.prepare("SELECT * FROM users ORDER BY id").all();

describe("feedback daily counts migration", () => {
  it("keeps every account, and starts with no counts", () => {
    const database = beforeMigration();
    const before = users(database);

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(users(database)).toEqual(before);
    expect(database.prepare("SELECT * FROM feedback_daily_counts").all()).toEqual([]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the Worker that runs before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    // The deployed Worker does not know the table; it still adds and deletes accounts.
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('new', 'email:new@example.test', 'new@example.test', 'New', NULL, 3, 3);
      DELETE FROM users WHERE id = 'other';
    `);
    expect(users(database).map((row) => row.id)).toEqual(["new", "owner"]);
  });

  it("counts each account's day up to the limit, gives back a failed send, and deletes the counts with the account", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    const statement = database.prepare(COUNT_FEEDBACK);
    const count = (userId: string, day: string) => statement.all(userId, day, 2);

    expect(count("owner", "2026-11-08")).toEqual([{ count: 1 }]);
    expect(count("owner", "2026-11-08")).toEqual([{ count: 2 }]);
    expect(count("owner", "2026-11-08")).toEqual([]);
    // A send that GitHub refused gives its count back.
    database.prepare(UNCOUNT_FEEDBACK).run("owner", "2026-11-08");
    expect(count("owner", "2026-11-08")).toEqual([{ count: 2 }]);
    expect(count("owner", "2026-11-09")).toEqual([{ count: 1 }]);
    expect(count("other", "2026-11-08")).toEqual([{ count: 1 }]);

    database.exec("DELETE FROM users WHERE id = 'owner'");
    expect(database.prepare("SELECT user_id, day, count FROM feedback_daily_counts").all()).toEqual([
      { user_id: "other", day: "2026-11-08", count: 1 },
    ]);
  });
});
