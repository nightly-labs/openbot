import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function migratedTo(lastExclusive: string): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql") && name < lastExclusive)
    .sort()) {
    database.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  return database;
}

const migration = readFileSync(new URL("../migrations/0049_user_chat_color.sql", import.meta.url), "utf8");

describe("user chat color migration", () => {
  it("keeps every account and starts each one with no chat color", () => {
    const database = migratedTo("0049");
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at, analytics_enabled)
        VALUES ('named', 'named', 'named@example.com', 'Ada', 'https://example.com/a.png', 1, 2, 1),
               ('plain', 'plain', 'plain@example.com', NULL, NULL, 3, 4, NULL);
    `);
    database.exec(migration);
    expect(
      database
        .prepare(
          "SELECT id, email, name, avatar_url, created_at, updated_at, analytics_enabled, chat_color FROM users ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "named",
        email: "named@example.com",
        name: "Ada",
        avatar_url: "https://example.com/a.png",
        created_at: 1,
        updated_at: 2,
        analytics_enabled: 1,
        chat_color: null,
      },
      {
        id: "plain",
        email: "plain@example.com",
        name: null,
        avatar_url: null,
        created_at: 3,
        updated_at: 4,
        analytics_enabled: null,
        chat_color: null,
      },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the insert of the Worker that runs before the deploy, and only a lower-case #rrggbb color", () => {
    const database = migratedTo("0049");
    database.exec(migration);
    // The email sign-up insert of the deployed Worker names no chat color column.
    database.exec(`INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('old-worker', 'old-worker', 'old@example.com', NULL, NULL, 1, 1)`);
    expect(database.prepare("SELECT chat_color FROM users WHERE id = 'old-worker'").get()).toEqual({
      chat_color: null,
    });
    database.exec("UPDATE users SET chat_color = '#3b82f6' WHERE id = 'old-worker'");
    database.exec("UPDATE users SET chat_color = NULL WHERE id = 'old-worker'");
    for (const invalid of ["#3B82F6", "3b82f6", "#3b82f", "#3b82f60", "#gggggg", "", "red"]) {
      expect(() => database.prepare("UPDATE users SET chat_color = ? WHERE id = 'old-worker'").run(invalid)).toThrow(
        /CHECK constraint failed/,
      );
    }
  });
});
