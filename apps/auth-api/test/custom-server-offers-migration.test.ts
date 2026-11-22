import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CUSTOM_SERVER_OFFER_COLUMNS,
  type CustomServerOfferRow,
  customServerPayment,
} from "../src/server/custom-server-offers";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("custom server offers migration", () => {
  it("keeps host rows, accepts old Worker writes, and can run again", () => {
    const database = migratedDatabase("0062_referral_credit_parts.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1),
             ('member', 'email:member@example.test', 'member@example.test', 'Member', NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, machine_token_hash, auth_epoch, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 'key-a', 'token-hash', 4, 1, 1),
             ('host-2', 'owner', 'Plain', 'key-b', 'token-hash-2', 1, 1, 1);
      INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('m-owner', 'host-1', 'owner', 'owner', 'active', 1, 1),
             ('m-member', 'host-1', 'member', 'member', 'active', 1, 1),
             ('m-owner-2', 'host-2', 'owner', 'owner', 'active', 1, 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0063_custom_server_offers.sql"));
    database.exec("COMMIT");
    database.exec(migration("0063_custom_server_offers.sql"));

    expect(snapshot(database)).toEqual(before);
    database.exec(`
      UPDATE remote_hosts SET device_public_key = 'key-c', auth_epoch = auth_epoch + 1, updated_at = 2
       WHERE host_id = 'host-1' AND owner_user_id = 'owner';
      UPDATE remote_memberships SET status = 'revoked', updated_at = 2 WHERE membership_id = 'm-member';
      UPDATE remote_memberships SET status = 'active', updated_at = 3 WHERE membership_id = 'm-member';
    `);
    expect(
      database.prepare("SELECT device_public_key, auth_epoch FROM remote_hosts WHERE host_id = 'host-1'").get(),
    ).toEqual({ device_public_key: "key-c", auth_epoch: 5 });

    const insert = database.prepare(
      `INSERT INTO custom_server_offers(host_id, plan_name, amount, currency, billing_interval, vcpu, memory_gb, storage_gb, personalized_support, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 4)`,
    );
    insert.run("host-1", "Studio Pro", 49_900, "eur", "month", 16, 64, 500, 1);
    expect(() => insert.run("host-1", "Again", 49_900, "eur", "month", 16, 64, 500, 1)).toThrow();
    for (const invalid of [
      ["host-3", " ", 49_900, "eur", "month", 16, 64, 500, 1],
      ["host-3", "Pro", 99, "eur", "month", 16, 64, 500, 1],
      ["host-3", "Pro", 499.5, "eur", "month", 16, 64, 500, 1],
      ["host-3", "Pro", 49_900, "gbp", "month", 16, 64, 500, 1],
      ["host-3", "Pro", 49_900, "eur", "week", 16, 64, 500, 1],
      ["host-3", "Pro", 49_900, "eur", "month", 0, 64, 500, 1],
      ["host-3", "Pro", 49_900, "eur", "month", 16, 64, 500, 2],
    ] as const) {
      expect(() => insert.run(...invalid)).toThrow();
    }

    const hosts = (userId: string) =>
      database
        .prepare(
          `SELECT h.host_id, m.role, ${CUSTOM_SERVER_OFFER_COLUMNS}
             FROM remote_memberships m
             JOIN remote_hosts h ON h.host_id = m.host_id
             LEFT JOIN custom_server_offers o ON o.host_id = h.host_id
            WHERE m.user_id = ? AND m.status = 'active'
            ORDER BY h.host_id`,
        )
        .all(userId)
        .map((row) => ({ hostId: row.host_id, ...customServerPayment(offerRow(row), String(row.role)) }));
    const plan = {
      name: "Studio Pro",
      amount: 49_900,
      currency: "eur",
      interval: "month",
      vcpu: 16,
      memoryGb: 64,
      storageGb: 500,
      personalizedSupport: true,
    };
    expect(hosts("owner")).toEqual([
      { hostId: "host-1", paymentRequired: true, customPlan: plan },
      { hostId: "host-2" },
    ]);
    expect(hosts("member")).toEqual([{ hostId: "host-1", paymentRequired: true }]);

    const sync = database.prepare(
      `UPDATE custom_server_offers
          SET stripe_subscription_id = ?, subscription_status = ?, checkout_session_id = NULL, updated_at = 5
        WHERE host_id = ?`,
    );
    sync.run("sub_1", "active", "host-1");
    expect(hosts("owner")).toEqual([{ hostId: "host-1" }, { hostId: "host-2" }]);
    expect(hosts("member")).toEqual([{ hostId: "host-1" }]);
    insert.run("host-2", "Plain", 10_000, "usd", "year", 2, 4, 40, 0);
    expect(() => sync.run("sub_1", "active", "host-2")).toThrow();
    sync.run("sub_1", "canceled", "host-1");
    expect(hosts("member")).toEqual([{ hostId: "host-1", paymentRequired: true }]);

    database.exec(
      "DELETE FROM remote_memberships WHERE host_id = 'host-1'; DELETE FROM remote_hosts WHERE host_id = 'host-1'",
    );
    expect(database.prepare("SELECT host_id FROM custom_server_offers ORDER BY host_id").all()).toEqual([
      { host_id: "host-1" },
      { host_id: "host-2" },
    ]);

    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

function offerRow(row: { [column: string]: SQLOutputValue }): CustomServerOfferRow {
  const text = (value: SQLOutputValue | undefined) => (typeof value === "string" ? value : null);
  const number = (value: SQLOutputValue | undefined) => (typeof value === "number" ? value : null);
  return {
    plan_name: text(row.plan_name),
    amount: number(row.amount),
    currency: text(row.currency),
    billing_interval: text(row.billing_interval),
    vcpu: number(row.vcpu),
    memory_gb: number(row.memory_gb),
    storage_gb: number(row.storage_gb),
    personalized_support: number(row.personalized_support),
    subscription_status: text(row.subscription_status),
  };
}

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  memberships: database.prepare("SELECT * FROM remote_memberships ORDER BY membership_id").all(),
});
