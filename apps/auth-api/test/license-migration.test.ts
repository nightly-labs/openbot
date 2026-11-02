import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("license migration", () => {
  it("keeps billing and membership rows, accepts old Worker writes, and can run again", () => {
    const database = migratedDatabase("0037_close_invites_of_former_admins.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1),
             ('member', 'email:member@example.test', 'member@example.test', NULL, NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 1, 1);
      INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('m-owner', 'host-1', 'owner', 'owner', 'active', 1, 1),
             ('m-member', 'host-1', 'member', 'member', 'active', 1, 1);
      INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
      VALUES ('owner', 'cus_1', 1, 1);
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount, status,
        current_period_end, cancel_at_period_end, updated_at
      ) VALUES ('sub_server', 'owner', 'cus_1', 'host-1', 'standard', 'month', 'eur', 5000, 'active', 10, 0, 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0038_licenses.sql"));
    database.exec("COMMIT");
    database.exec(migration("0038_licenses.sql"));

    expect(snapshot(database)).toEqual(before);
    // The old Worker's billing and member queries still run and see the same rows.
    expect(
      database
        .prepare(
          `SELECT s.stripe_subscription_id, h.name AS server_name FROM billing_subscriptions s
           LEFT JOIN remote_hosts h ON h.host_id = s.server_id AND h.owner_user_id = s.user_id
           WHERE s.user_id = ? AND s.status IN ('active', 'trialing', 'past_due', 'unpaid', 'paused')`,
        )
        .all("owner"),
    ).toEqual([{ stripe_subscription_id: "sub_server", server_name: "Studio" }]);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM remote_memberships WHERE host_id = ? AND status = 'active'")
        .get("host-1"),
    ).toEqual({ count: 2 });
    database.exec(`
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
        current_period_end, cancel_at_period_end, updated_at
      ) VALUES ('sub_server_2', 'owner', 'cus_1', 'host-1', 'pro', 'year', 'eur', 'active', 20, 0, 2);
      UPDATE remote_memberships SET status = 'revoked', removed_at = 3, updated_at = 3 WHERE membership_id = 'm-member';
    `);

    database.exec(`
      INSERT INTO licenses(
        stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end,
        cancel_at_period_end, updated_at
      ) VALUES ('sub_license', 'owner', 'cus_1', 7, 'eur', 'active', 30, 0, 4);
    `);
    expect(() =>
      database.exec(`
        INSERT INTO licenses(stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, updated_at)
        VALUES ('sub_bad', 'owner', 'cus_1', 0, 'eur', 'active', 5);
      `),
    ).toThrow();
    expect(() =>
      database.exec(`
        INSERT INTO licenses(
          stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, cancel_at_period_end, updated_at
        ) VALUES ('sub_bad', 'owner', 'cus_1', 5, 'eur', 'active', 2, 5);
      `),
    ).toThrow();
    // An account that the old Worker deletes takes its license rows with it.
    database.exec("DELETE FROM users WHERE id = 'owner'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM licenses").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  memberships: database.prepare("SELECT * FROM remote_memberships ORDER BY membership_id").all(),
  customers: database.prepare("SELECT * FROM billing_customers ORDER BY user_id").all(),
  subscriptions: database.prepare("SELECT * FROM billing_subscriptions ORDER BY stripe_subscription_id").all(),
});
