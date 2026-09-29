import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("billing migration", () => {
  it("keeps accounts and sessions, accepts old Worker writes, and can run again", () => {
    const database = migratedDatabase("0021_agent_templates.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('user-1', 'email:one@example.test', 'one@example.test', 'One', NULL, 1, 1);
      INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
      VALUES ('session-1', 'user-1', 'hash-1', 100, 1, 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0022_billing.sql"));
    database.exec("COMMIT");
    database.exec(migration("0022_billing.sql"));

    expect(snapshot(database)).toEqual(before);
    // The old Worker still creates and deletes accounts.
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('user-2', 'email:two@example.test', 'two@example.test', NULL, NULL, 2, 2);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-2', 'user-2', 'Server', 2, 2);
      INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
      VALUES ('user-2', 'cus_2', 2, 2);
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
        current_period_end, cancel_at_period_end, updated_at
      ) VALUES ('sub_2', 'user-2', 'cus_2', 'host-2', 'standard', 'year', 'eur', 'active', 10, 0, 2);
    `);
    // The plan of a removed host stays: Stripe still bills it until the account cancels it.
    database.exec("DELETE FROM remote_hosts WHERE host_id = 'host-2'");
    expect(database.prepare("SELECT server_id FROM billing_subscriptions").all()).toEqual([{ server_id: "host-2" }]);
    database.exec("DELETE FROM users WHERE id = 'user-2'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM billing_customers").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM billing_subscriptions").get()).toEqual({ count: 0 });
    database.exec(
      "INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at) VALUES ('user-1', 'cus_1', 1, 1)",
    );
    // One Stripe customer belongs to one account.
    expect(() =>
      database.exec(`
        INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
        VALUES ('user-3', 'email:three@example.test', 'three@example.test', NULL, NULL, 3, 3);
        INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
        VALUES ('user-3', 'cus_1', 3, 3);
      `),
    ).toThrow();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  sessions: database.prepare("SELECT * FROM auth_sessions ORDER BY id").all(),
});
