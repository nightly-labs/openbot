import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("credit wallets migration", () => {
  it("keeps accounts and servers, stores purchases and ledger entries, and keeps a server balance after the server goes", () => {
    const database = migratedDatabase("0062_referral_credit_parts.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1),
             ('member', 'email:member@example.test', 'member@example.test', NULL, NULL, 2, 2);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 3, 3);
      INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('m-1', 'host-1', 'owner', 'owner', 'active', 3, 3),
             ('m-2', 'host-1', 'member', 'member', 'active', 4, 4);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0064_credit_wallets.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);

    database.exec(`
      INSERT INTO credit_purchases(checkout_session_id, user_id, server_id, credits, currency, created_at, updated_at)
      VALUES ('cs_1', 'owner', NULL, 3000, 'eur', 5, 5),
             ('cs_2', 'member', 'host-1', 1000, 'eur', 6, 6);
      UPDATE credit_purchases SET status = 'paid', amount = 2500, payment_intent_id = 'pi_1' WHERE checkout_session_id = 'cs_1';
      INSERT OR IGNORE INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('purchase:cs_1', 'owner', NULL, 3000, 'purchase', 'owner', 'cs_1', 7);
      INSERT OR IGNORE INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('purchase:cs_1', 'owner', NULL, 3000, 'purchase', 'owner', 'cs_1', 8);
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('purchase:cs_2', NULL, 'host-1', 1000, 'purchase', 'member', 'cs_2', 9);
    `);
    expect(balance(database, "user_id", "owner")).toBe(3000);

    database.exec(`
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      SELECT 'transfer:t1:out', 'owner', NULL, -1200, 'transfer', 'owner', 't1', 10
      WHERE (SELECT COALESCE(SUM(amount_tenths), 0) FROM credit_ledger WHERE user_id = 'owner') >= 1200
        AND EXISTS (SELECT 1 FROM remote_hosts WHERE host_id = 'host-1' AND owner_user_id = 'owner');
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      SELECT 'transfer:t1:in', NULL, 'host-1', 1200, 'transfer', 'owner', 't1', 10
      WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE entry_id = 'transfer:t1:out');
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      SELECT 'transfer:t2:out', 'owner', NULL, -9000, 'transfer', 'owner', 't2', 11
      WHERE (SELECT COALESCE(SUM(amount_tenths), 0) FROM credit_ledger WHERE user_id = 'owner') >= 9000;
    `);
    expect(balance(database, "user_id", "owner")).toBe(1800);
    expect(balance(database, "server_id", "host-1")).toBe(2200);

    expect(() =>
      database.exec(`
        INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, reference, created_at)
        VALUES ('bad:both', 'owner', 'host-1', 1, 'transfer', 'bad', 12);
      `),
    ).toThrow();
    expect(() =>
      database.exec(`
        INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, reference, created_at)
        VALUES ('bad:zero', 'owner', NULL, 0, 'transfer', 'bad', 12);
      `),
    ).toThrow();
    expect(() =>
      database.exec(`
        UPDATE credit_purchases SET payment_intent_id = 'pi_1' WHERE checkout_session_id = 'cs_2';
      `),
    ).toThrow();

    database.exec(`
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-1', NULL, 'host-1', 'member', 'seedance-2.5', 300, 13, 14, 15),
             ('job-2', 'owner', NULL, 'owner', 'seedance-2.5', 100, 13, 14, 15);
      UPDATE credit_holds SET status = 'charged', outcome = 'completed', charged_tenths = 300, settled_at = 16 WHERE job_id = 'job-1';
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('spend:job-1', NULL, 'host-1', -300, 'spend', 'member', 'job-1', 16);
    `);
    expect(balance(database, "server_id", "host-1")).toBe(1900);
    for (const statement of [
      "INSERT INTO credit_holds(job_id, user_id, server_id, model_id, credits_tenths, created_at, check_at, expires_at) VALUES ('bad', 'owner', 'host-1', 'm', 1, 1, 1, 1)",
      "INSERT INTO credit_holds(job_id, user_id, model_id, credits_tenths, created_at, check_at, expires_at) VALUES ('bad', 'owner', 'm', 0, 1, 1, 1)",
      "UPDATE credit_holds SET status = 'charged', outcome = 'completed', charged_tenths = 101 WHERE job_id = 'job-2'",
      "UPDATE credit_holds SET status = 'released' WHERE job_id = 'job-2'",
      "UPDATE credit_holds SET status = 'charged', outcome = 'completed' WHERE job_id = 'job-2'",
      "UPDATE credit_holds SET outcome = 'lost' WHERE job_id = 'job-1'",
    ])
      expect(() => database.exec(statement)).toThrow();
    database.exec("UPDATE credit_holds SET provider_job_id = 'p-1' WHERE job_id = 'job-1'");
    expect(() => database.exec("UPDATE credit_holds SET provider_job_id = 'p-1' WHERE job_id = 'job-2'")).toThrow();

    database.exec(`
      INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at)
      VALUES ('license:sub_1:100', 'owner', NULL, 50, 50, 'license:sub_1', 100, 200, 100),
             ('license:sub_1:100:t1', NULL, 'host-1', 20, 20, 'license:sub_1:100', 100, 200, 101);
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('grant:license:sub_1:100', 'owner', NULL, 50, 'grant', NULL, 'license:sub_1:100', 100),
             ('expiry:license:sub_1:100', 'owner', NULL, -30, 'expiry', NULL, 'license:sub_1:100', 200);
      UPDATE credit_grants SET remaining_tenths = 0, status = 'expired' WHERE grant_id = 'license:sub_1:100';
    `);
    expect(balance(database, "user_id", "owner")).toBe(1820);
    for (const statement of [
      "INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at) VALUES ('bad', 'owner', 'host-1', 1, 1, 's', 1, 2, 1)",
      "INSERT INTO credit_grants(grant_id, user_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at) VALUES ('bad', 'owner', 0, 0, 's', 1, 2, 1)",
      "INSERT INTO credit_grants(grant_id, user_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at) VALUES ('bad', 'owner', 5, 6, 's', 1, 2, 1)",
      "INSERT INTO credit_grants(grant_id, user_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at) VALUES ('bad', 'owner', 5, 5, 's', 2, 2, 1)",
      "UPDATE credit_grants SET remaining_tenths = -1 WHERE grant_id = 'license:sub_1:100:t1'",
      "UPDATE credit_grants SET status = 'used' WHERE grant_id = 'license:sub_1:100:t1'",
      "INSERT INTO credit_ledger(entry_id, user_id, amount_tenths, kind, reference, created_at) VALUES ('bad:kind', 'owner', 1, 'gift', 'bad', 1)",
    ])
      expect(() => database.exec(statement)).toThrow();

    database.exec("DELETE FROM remote_hosts WHERE host_id = 'host-1'");
    expect(balance(database, "server_id", "host-1")).toBe(1900);

    database.exec("DELETE FROM users WHERE id = 'member'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM credit_purchases WHERE user_id = 'member'").get()).toEqual({
      count: 0,
    });
    expect(database.prepare("SELECT actor_user_id FROM credit_ledger WHERE entry_id = 'purchase:cs_2'").get()).toEqual({
      actor_user_id: null,
    });

    expect(database.prepare("SELECT actor_user_id FROM credit_holds WHERE job_id = 'job-1'").get()).toEqual({
      actor_user_id: null,
    });

    database.exec("DELETE FROM users WHERE id = 'owner'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE user_id IS NOT NULL").get()).toEqual({
      count: 0,
    });
    expect(database.prepare("SELECT job_id FROM credit_holds").all()).toEqual([{ job_id: "job-1" }]);
    expect(database.prepare("SELECT grant_id FROM credit_grants").all()).toEqual([
      { grant_id: "license:sub_1:100:t1" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const balance = (database: DatabaseSync, column: "user_id" | "server_id", id: string) =>
  database.prepare(`SELECT COALESCE(SUM(amount_tenths), 0) AS balance FROM credit_ledger WHERE ${column} = ?`).get(id)
    ?.balance;

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  memberships: database.prepare("SELECT * FROM remote_memberships ORDER BY membership_id").all(),
});
