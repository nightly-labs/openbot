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

const migration = readFileSync(new URL("../migrations/0071_cron_sweep_indexes.sql", import.meta.url), "utf8");

const TABLES = ["site_operation_receipts", "site_creation_events", "hosted_sites", "billing_analytics_events"];

// The released query and its replacement in SalesAnalyticsDelivery.#readyEvents.
const RELEASED_READY = `SELECT source_key FROM billing_analytics_events
  WHERE status = 'pending' OR (status = 'rejected' AND next_attempt_at > 0 AND next_attempt_at <= 100 AND attempts < 3)
  ORDER BY created_at ASC LIMIT 50`;
const READY = `SELECT source_key FROM billing_analytics_events
  WHERE status IN ('pending', 'rejected')
    AND (status = 'pending' OR (next_attempt_at > 0 AND next_attempt_at <= 100 AND attempts < 3))
  ORDER BY created_at ASC LIMIT 50`;

function seed(database: DatabaseSync) {
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
      VALUES ('owner', 'email:owner', 'owner@example.com', 1, 1);
    INSERT INTO site_operation_receipts(user_id, idempotency_key, operation, resource_id, status, claim_token,
        response_json, created_at, updated_at)
      VALUES ('owner', 'old', 'create', 'site-a', 'completed', NULL, '{}', 10, 10),
             ('owner', 'new', 'deploy', NULL, 'pending', 'claim', NULL, 90, 90);
    INSERT INTO site_creation_events(id, user_id, created_at)
      VALUES ('event-old', 'owner', 10), ('event-new', 'owner', 90);
    INSERT INTO hosted_sites(id, user_id, hostname, title, description, framework, status, created_at, updated_at,
        route_synced_at)
      VALUES ('site-a', 'owner', 'a.example', 'A', '', 'vanilla', 'active', 1, 30, NULL),
             ('site-b', 'owner', 'b.example', 'B', '', 'astro', 'active', 1, 20, 25),
             ('site-c', 'owner', 'c.example', 'C', '', 'vanilla', 'uploading', 1, 10, NULL);
    INSERT INTO billing_analytics_events(source_key, profile_id, event_name, properties_json, event_timestamp, status,
        attempts, next_attempt_at, claimed_at, claim_token, created_at, updated_at)
      VALUES ('pending', 'owner', 'revenue', '{}', 1, 'pending', 0, 0, NULL, NULL, 5, 5),
             ('rejected-due', 'owner', 'revenue', '{}', 1, 'rejected', 1, 50, NULL, NULL, 4, 4),
             ('rejected-later', 'owner', 'revenue', '{}', 1, 'rejected', 1, 500, NULL, NULL, 3, 3),
             ('rejected-final', 'owner', 'revenue', '{}', 1, 'rejected', 0, 0, NULL, NULL, 2, 2),
             ('sending', 'owner', 'revenue', '{}', 1, 'sending', 1, 0, 40, 'token', 1, 1),
             ('sent', NULL, 'billing_action', '{}', 1, 'sent', 1, 0, NULL, NULL, 0, 0);
  `);
}

function rows(database: DatabaseSync, table: string) {
  return database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

function plan(database: DatabaseSync, sql: string): string {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((row) => String(row.detail))
    .join("\n");
}

describe("cron sweep indexes migration", () => {
  it("keeps every row and lets the five-minute cron sweeps use an index", () => {
    const database = migratedTo("0071");
    seed(database);
    const before = TABLES.map((table) => rows(database, table));
    const releasedReady = database.prepare(RELEASED_READY).all();

    database.exec(migration);

    expect(TABLES.map((table) => rows(database, table))).toEqual(before);
    expect(database.prepare(READY).all()).toEqual(releasedReady);
    expect(releasedReady.map((row) => row.source_key)).toEqual(["rejected-due", "pending"]);

    const receipts = plan(database, "DELETE FROM site_operation_receipts WHERE created_at < 50");
    expect(receipts).toContain("site_operation_receipts_created_at");
    const events = plan(database, "DELETE FROM site_creation_events WHERE created_at < 50");
    expect(events).toContain("site_creation_events_created_at");
    const unsynced = plan(
      database,
      `SELECT id, hostname FROM hosted_sites
        WHERE +status IN ('active', 'blocked', 'deleted', 'expired') AND route_synced_at IS NULL
        ORDER BY updated_at, id LIMIT 50`,
    );
    expect(unsynced).toContain("hosted_sites_route_unsynced");
    const claims = plan(
      database,
      `UPDATE billing_analytics_events SET status = 'uncertain', claimed_at = NULL, claim_token = NULL,
          last_error = 'claim_expired', updated_at = 100
        WHERE status = 'sending' AND claimed_at IS NOT NULL AND claimed_at <= 50`,
    );
    expect(claims).toContain("billing_analytics_events_sending");
    expect(plan(database, READY)).toContain("billing_analytics_events_ready");
    expect(unsynced).not.toContain("TEMP B-TREE");
    // A partial index scan reads only the rows that its WHERE clause keeps; a table scan reads every row.
    for (const sweep of [receipts, events, unsynced, claims, plan(database, READY)])
      expect(sweep).not.toMatch(/^SCAN \w+$/m);

    expect(database.prepare("DELETE FROM site_operation_receipts WHERE created_at < 50").run().changes).toBe(1);
    expect(database.prepare("DELETE FROM site_creation_events WHERE created_at < 50").run().changes).toBe(1);
  });

  it("can run again on a database that has the indexes", () => {
    const database = migratedTo("0072");
    expect(() => database.exec(migration)).not.toThrow();
  });
});
