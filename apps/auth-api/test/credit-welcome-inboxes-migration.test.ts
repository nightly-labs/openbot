import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  grants: database.prepare("SELECT * FROM credit_grants ORDER BY grant_id").all(),
});

const inboxes = (database: DatabaseSync) =>
  database.prepare("SELECT inbox, user_id, created_at FROM credit_welcome_inboxes ORDER BY inbox").all();

function user(id: string, email: string): string {
  return `INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
          VALUES ('${id}', 'email:${email}', '${email}', NULL, NULL, 1, 1);`;
}

function welcome(id: string, at: number): string {
  return `INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, scope, starts_at, expires_at, status, created_at)
          VALUES ('welcome:${id}', '${id}', NULL, 100, 100, 'welcome', 'welcome', ${at}, 253402300799999, 'active', ${at});
          INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
          VALUES ('grant:welcome:${id}', '${id}', NULL, 100, 'grant', NULL, 'welcome:${id}', ${at});`;
}

function seeded(): DatabaseSync {
  const database = migratedDatabase("0078_credit_hold_failure_reason.sql");
  databases.push(database);
  database.exec(`
    ${user("plain", "ana.lopez@gmail.com")}
    ${user("dotted", "AnaLopez+promo@GoogleMail.com")}
    ${user("tagged", "a.n.a.lopez+x@gmail.com")}
    ${user("work", "ana.lopez@example.test")}
    ${user("other", "ben@gmail.com")}
    ${user("unused", "carla@gmail.com")}
    ${welcome("dotted", 2)}
    ${welcome("plain", 3)}
    ${welcome("tagged", 4)}
    ${welcome("work", 5)}
    ${welcome("other", 6)}
    INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at)
    VALUES ('license:sub-1:1', 'unused', NULL, 500, 500, 'license:sub-1', 1, 9, 1);
  `);
  return database;
}

describe("credit welcome inboxes migration", () => {
  it("keeps every grant and gives each used Gmail inbox one row from its earliest grant", () => {
    const database = seeded();
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0079_credit_welcome_inboxes.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(inboxes(database)).toEqual([
      { inbox: "analopez@gmail.com", user_id: "dotted", created_at: 2 },
      { inbox: "ben@gmail.com", user_id: "other", created_at: 6 },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("records the inbox of a welcome grant that the old Worker writes after the migration", () => {
    const database = seeded();
    database.exec("BEGIN");
    database.exec(migration("0079_credit_welcome_inboxes.sql"));
    database.exec("COMMIT");

    database.exec(`
      ${welcome("unused", 7)}
      ${user("late", "dan@example.test")}
      ${welcome("late", 8)}
      INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at)
      VALUES ('license:sub-2:1', 'other', NULL, 500, 500, 'license:sub-2', 1, 9, 9);
    `);
    expect(inboxes(database)).toEqual([
      { inbox: "analopez@gmail.com", user_id: "dotted", created_at: 2 },
      { inbox: "ben@gmail.com", user_id: "other", created_at: 6 },
      { inbox: "carla@gmail.com", user_id: "unused", created_at: 7 },
    ]);

    database.exec("DELETE FROM users WHERE id = 'unused'");
    expect(inboxes(database)).toHaveLength(2);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rolls back as one unit when a statement fails", () => {
    const database = seeded();
    database.exec("CREATE TRIGGER credit_welcome_inboxes_on_grant AFTER DELETE ON users BEGIN SELECT 1; END");
    const before = snapshot(database);
    database.exec("BEGIN");
    expect(() => database.exec(migration("0079_credit_welcome_inboxes.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'credit_welcome_inboxes'").all()).toEqual([]);
  });
});
