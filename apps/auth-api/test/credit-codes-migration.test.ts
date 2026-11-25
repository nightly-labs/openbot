import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];
const HASH = "a".repeat(64);

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function seeded(): DatabaseSync {
  const database = migratedDatabase("0071_membership_hidden_at.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1),
           ('member', 'email:member@example.test', 'member@example.test', 'Kofi Mensah', NULL, 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('host-1', 'owner', 'Studio', 2, 2);
    INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
    VALUES ('purchase:cs_1', 'owner', NULL, 3000, 'purchase', 'owner', 'cs_1', 3),
           ('grant:referral-1', NULL, 'host-1', 100, 'grant', 'owner', 'referral-1', 4);
    INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at)
    VALUES ('referral-1', NULL, 'host-1', 100, 60, 'referral', 4, 400, 4);
  `);
  return database;
}

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  grants: database.prepare("SELECT * FROM credit_grants ORDER BY grant_id").all(),
});

describe("credit codes migration", () => {
  it("keeps every balance row and adds empty code tables", () => {
    const database = seeded();
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0072_credit_codes.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    for (const table of ["credit_codes", "credit_code_redemptions", "credit_code_limits"]) {
      expect(database.prepare(`SELECT count(*) AS rows FROM ${table}`).get()).toEqual({ rows: 0 });
    }
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("stores only a full hash and lets each account redeem a code once", () => {
    const database = seeded();
    database.exec(migration("0072_credit_codes.sql"));
    expect(() =>
      database.exec(`INSERT INTO credit_codes(code_id, code_hash, credits_tenths, created_at)
        VALUES ('short', 'ABCD-EFGH-JKLM-NPQR', 500, 5)`),
    ).toThrow();
    database.exec(`
      INSERT INTO credit_codes(code_id, code_hash, credits_tenths, max_redemptions, created_at)
      VALUES ('code-1', '${HASH}', 500, 1, 5);
      INSERT INTO credit_code_redemptions(code_id, user_id, server_id, grant_id, redeemed_at)
      VALUES ('code-1', 'owner', NULL, 'code:code-1:a', 6);
      UPDATE credit_codes SET redemptions = redemptions + 1 WHERE code_id = 'code-1';
    `);
    expect(() =>
      database.exec(`INSERT INTO credit_code_redemptions(code_id, user_id, server_id, grant_id, redeemed_at)
        VALUES ('code-1', 'owner', 'host-1', 'code:code-1:b', 7)`),
    ).toThrow();
    expect(() =>
      database.exec("UPDATE credit_codes SET redemptions = redemptions + 1 WHERE code_id = 'code-1'"),
    ).toThrow();
    expect(() =>
      database.exec(`INSERT INTO credit_codes(code_id, code_hash, credits_tenths, created_at)
        VALUES ('code-2', '${HASH}', 500, 8)`),
    ).toThrow();

    database.exec("DELETE FROM users WHERE id = 'owner'");
    expect(database.prepare("SELECT count(*) AS rows FROM credit_code_redemptions").get()).toEqual({ rows: 0 });
    expect(database.prepare("SELECT redemptions FROM credit_codes WHERE code_id = 'code-1'").get()).toEqual({
      redemptions: 1,
    });
  });

  it("limits campaign names and keeps only full-hash limit keys", () => {
    const database = seeded();
    database.exec(migration("0072_credit_codes.sql"));
    expect(() =>
      database.exec(`INSERT INTO credit_codes(code_id, code_hash, credits_tenths, campaign, created_at)
        VALUES ('code-1', '${HASH}', 500, '${"c".repeat(41)}', 5)`),
    ).toThrow();
    database.exec(`INSERT INTO credit_codes(code_id, code_hash, credits_tenths, created_at)
      VALUES ('code-1', '${HASH}', 500, 5)`);
    expect(database.prepare("SELECT campaign FROM credit_codes").get()).toEqual({ campaign: "" });
    expect(() =>
      database.exec("INSERT INTO credit_code_limits(key_hash, window_start, count) VALUES ('owner', 0, 1)"),
    ).toThrow();
    expect(() =>
      database.exec(`INSERT INTO credit_code_limits(key_hash, window_start, count) VALUES ('${HASH}', 0, 0)`),
    ).toThrow();
    database.exec(`INSERT INTO credit_code_limits(key_hash, window_start, count) VALUES ('${HASH}', 0, 1)`);
    expect(() =>
      database.exec(`INSERT INTO credit_code_limits(key_hash, window_start, count) VALUES ('${HASH}', 0, 2)`),
    ).toThrow();
  });

  it("rolls back when a code table already exists", () => {
    const database = seeded();
    database.exec("CREATE TABLE credit_code_limits (key_hash TEXT PRIMARY KEY)");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0072_credit_codes.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'credit_codes'").all()).toEqual([]);
  });
});
