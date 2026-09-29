import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const insertServer = (database: DatabaseSync, values: { id: string; plan: string; size: string; state: string }) =>
  database
    .prepare(
      `INSERT INTO hosted_servers(
         server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
         idempotency_key, created_at, updated_at
       ) VALUES (?, 'user-1', 'Cloud server', ?, ?, 'year', 'pln', 'stopped', ?, ?, 1, 1)`,
    )
    .run(values.id, values.size, values.plan, values.state, `key-${values.id}`);

describe("hosted servers migration", () => {
  it("adds its tables to a database with billing, and keeps accounts, sessions and plans", () => {
    const database = migratedDatabase("0022_billing.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('user-1', 'email:one@example.test', 'one@example.test', 'One', NULL, 1, 1);
      INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
      VALUES ('session-1', 'user-1', 'hash-1', 100, 1, 1);
      INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
      VALUES ('user-1', 'cus_1', 1, 1);
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
        current_period_end, cancel_at_period_end, updated_at
      ) VALUES ('sub_1', 'user-1', 'cus_1', 'server-1', 'pro', 'year', 'pln', 'active', 10, 0, 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0023_hosted_servers.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    insertServer(database, { id: "server-1", plan: "pro", size: "large", state: "awaiting_payment" });
    expect(() => insertServer(database, { id: "server-2", plan: "free", size: "small", state: "stopped" })).toThrow();
    expect(() => database.exec("UPDATE hosted_servers SET pending_size = 'huge'")).toThrow();
    database.exec(
      "UPDATE hosted_servers SET desired_state = 'idle', last_active_at = 2, lease_until = 3, next_run_at = 4, last_wake_reason = 'schedule'",
    );
    expect(() => database.exec("UPDATE hosted_servers SET last_wake_reason = 'timer'")).toThrow();
    expect(() => database.exec("UPDATE hosted_servers SET desired_state = 'asleep'")).toThrow();
    // A paid sandbox never loses its row: the owner cannot be removed while the row exists.
    expect(() => database.exec("DELETE FROM users WHERE id = 'user-1'")).toThrow();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  sessions: database.prepare("SELECT * FROM auth_sessions ORDER BY id").all(),
  customers: database.prepare("SELECT * FROM billing_customers ORDER BY user_id").all(),
  subscriptions: database.prepare("SELECT * FROM billing_subscriptions ORDER BY stripe_subscription_id").all(),
});
