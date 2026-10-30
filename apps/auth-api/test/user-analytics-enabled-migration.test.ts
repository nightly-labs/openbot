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

const migration = readFileSync(new URL("../migrations/0043_user_analytics_enabled.sql", import.meta.url), "utf8");

describe("user analytics answer migration", () => {
  it("keeps every account and starts each one with no answer", () => {
    const database = migratedTo("0043");
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
        VALUES ('named', 'named', 'named@example.com', 'Ada', 'https://example.com/a.png', 1, 2),
               ('plain', 'plain', 'plain@example.com', NULL, NULL, 3, 4);
    `);
    database.exec(migration);
    expect(
      database
        .prepare(
          "SELECT id, email, name, avatar_url, created_at, updated_at, analytics_enabled, analytics_answered_at FROM users ORDER BY id",
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
        analytics_enabled: null,
        analytics_answered_at: null,
      },
      {
        id: "plain",
        email: "plain@example.com",
        name: null,
        avatar_url: null,
        created_at: 3,
        updated_at: 4,
        analytics_enabled: null,
        analytics_answered_at: null,
      },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the insert of the Worker that runs before the deploy, and only a yes or a no", () => {
    const database = migratedTo("0043");
    database.exec(migration);
    // The email sign-up insert of the deployed Worker names no analytics column.
    database.exec(`INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('old-worker', 'old-worker', 'old@example.com', NULL, NULL, 1, 1)`);
    expect(
      database.prepare("SELECT analytics_enabled, analytics_answered_at FROM users WHERE id = 'old-worker'").get(),
    ).toEqual({ analytics_enabled: null, analytics_answered_at: null });
    database.exec("UPDATE users SET analytics_enabled = 1 WHERE id = 'old-worker'");
    database.exec("UPDATE users SET analytics_enabled = 0 WHERE id = 'old-worker'");
    expect(() => database.exec("UPDATE users SET analytics_enabled = 2 WHERE id = 'old-worker'")).toThrow(
      /CHECK constraint failed/,
    );
  });
});
