import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { PRUNE_BILLING_WEBHOOK_EVENTS_SQL } from "../src/server/billing-service";
import { DELETE_ACCOUNT_ACTIVE_DAYS_SQL } from "../src/server/d1-auth-repository";
import { bucketHasRoomSql } from "../src/server/hosted-site-server";
import { SUPERSEDE_ACTIVE_DEPLOYMENTS_SQL } from "../src/server/hosted-site-service";

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

const migration = readFileSync(new URL("../migrations/0081_d1_scan_indexes.sql", import.meta.url), "utf8");

const TABLES = ["site_deployments", "hosted_sites", "account_active_days", "billing_webhook_events"];

function seed(database: DatabaseSync) {
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
      VALUES ('owner', 'email:owner', 'owner@example.com', 1, 1),
             ('other', 'email:other', 'other@example.com', 1, 1);
    INSERT INTO hosted_sites(id, user_id, hostname, title, description, framework, status, created_at, updated_at,
        current_deployment_id)
      VALUES ('site-a', 'owner', 'a.example', 'A', '', 'vanilla', 'active', 1, 1, 'deploy-next'),
             ('site-b', 'owner', 'b.example', 'B', '', 'astro', 'uploading', 1, 1, NULL),
             ('site-c', 'other', 'c.example', 'C', '', 'vanilla', 'active', 1, 1, 'deploy-c');
    INSERT INTO site_deployments(id, site_id, user_id, status, file_count, total_bytes, manifest_json, site_title,
        site_description, site_framework, site_spa_fallback, idempotency_key, request_hash, created_at,
        upload_expires_at)
      VALUES ('deploy-old', 'site-a', 'owner', 'superseded', 1, 10, '[]', 'A', '', 'vanilla', 0, 'k1', 'h1', 1, 5),
             ('deploy-live', 'site-a', 'owner', 'active', 1, 10, '[]', 'A', '', 'vanilla', 0, 'k2', 'h2', 2, 5),
             ('deploy-next', 'site-a', 'owner', 'activating', 1, 10, '[]', 'A', '', 'vanilla', 0, 'k3', 'h3', 3, 500),
             ('deploy-b', 'site-b', 'owner', 'uploading', 1, 10, '[]', 'B', '', 'astro', 0, 'k4', 'h4', 4, 500),
             ('deploy-c', 'site-c', 'other', 'active', 1, 10, '[]', 'C', '', 'vanilla', 1, 'k5', 'h5', 5, 5);
    INSERT INTO account_active_days(day, account_id)
      VALUES ('2026-11-26', 'owner'), ('2026-11-27', 'owner'), ('2026-11-27', 'other');
    INSERT INTO billing_webhook_events(event_id, type, received_at)
      VALUES ('evt-old', 'invoice.paid', 10), ('evt-new', 'invoice.paid', 900);
  `);
}

function rows(database: DatabaseSync, table: string) {
  return database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

function plan(database: DatabaseSync, sql: string): string {
  const parameters = Array.from(sql.matchAll(/\?/g), () => null);
  return database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...parameters)
    .map((row) => String(row.detail))
    .join("\n");
}

const slots = bucketHasRoomSql({ kind: "unlinked", limit: 3 }, "owner", null, 100);
const SLOTS_SQL = `SELECT ${slots.sql} AS room`;

describe("D1 scan indexes migration", () => {
  it("keeps every row, keeps the results, and lets the four scans use an index", () => {
    const database = migratedTo("0081");
    seed(database);
    const before = TABLES.map((table) => rows(database, table));
    const roomBefore = database.prepare(SLOTS_SQL).get(...slots.binds);
    expect(plan(database, SUPERSEDE_ACTIVE_DEPLOYMENTS_SQL)).not.toContain("site_deployments_site_status");

    database.exec(migration);

    expect(TABLES.map((table) => rows(database, table))).toEqual(before);
    expect(database.prepare(SLOTS_SQL).get(...slots.binds)).toEqual(roomBefore);

    const supersede = plan(database, SUPERSEDE_ACTIVE_DEPLOYMENTS_SQL);
    expect(supersede).toContain("site_deployments_site_status (site_id=? AND status=?)");
    const room = plan(database, SLOTS_SQL);
    expect(room).toContain("site_deployments_site_status (site_id=? AND status=? AND upload_expires_at>?)");
    expect(room).not.toContain("site_deployments_upload_expiry");
    const activeDays = plan(database, DELETE_ACCOUNT_ACTIVE_DAYS_SQL);
    expect(activeDays).toContain("account_active_days_account (account_id=?)");
    const webhooks = plan(database, PRUNE_BILLING_WEBHOOK_EVENTS_SQL);
    expect(webhooks).toContain("billing_webhook_events_received_at (received_at<?)");
    for (const scan of [supersede, room, activeDays, webhooks]) expect(scan).not.toMatch(/^SCAN \w+$/m);

    expect(
      database
        .prepare(SUPERSEDE_ACTIVE_DEPLOYMENTS_SQL)
        .run("site-a", "deploy-next", "deploy-next", "site-a", "owner", "deploy-next").changes,
    ).toBe(1);
    expect(database.prepare("SELECT status FROM site_deployments WHERE id = 'deploy-live'").get()).toEqual({
      status: "superseded",
    });
    expect(database.prepare("SELECT status FROM site_deployments WHERE id = 'deploy-c'").get()).toEqual({
      status: "active",
    });
    expect(database.prepare(DELETE_ACCOUNT_ACTIVE_DAYS_SQL).run("owner").changes).toBe(2);
    expect(rows(database, "account_active_days")).toEqual([{ day: "2026-11-27", account_id: "other" }]);
    expect(database.prepare(PRUNE_BILLING_WEBHOOK_EVENTS_SQL).run(500).changes).toBe(1);
    expect(rows(database, "billing_webhook_events")).toEqual([
      { event_id: "evt-new", type: "invoice.paid", received_at: 900 },
    ]);
  });

  it("can run again on a database that has the indexes", () => {
    const database = migratedTo("0082");
    expect(() => database.exec(migration)).not.toThrow();
  });
});
