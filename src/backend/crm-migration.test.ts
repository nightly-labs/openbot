// @vitest-environment node
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CRM_TABLES_AFTER_MIGRATION } from "./crm/crm-schema";
import { CRM_SCHEMA_SQL } from "./migrations/0063-crm";
import { THREAD_EVENT_COMPACTION_TABLES_AFTER_MIGRATION } from "./migrations/0065-thread-event-compaction";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const CUSTOMER = "a".repeat(32);
const PLAN = "b".repeat(32);
const PAYMENT = "c".repeat(32);
const TAG = "d".repeat(32);
const STATUS = "e".repeat(32);
const NOW = "2026-11-14T10:00:00.000Z";

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
}

function seed(db: DatabaseSync, version: number): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'Bill Acme 界"\\', 'bill acme 界"\\', 'manual', NULL, '2026-01-01', '2026-01-01', 2)`).run();
  if (version >= 45)
    db.prepare(`INSERT INTO browser_profiles (profile_id, name, hue, created_at, updated_at)
      VALUES (?, 'Client A 界', 215, '2026-01-02', '2026-01-02')`).run("f".repeat(32));
}

type Contents = Record<string, Record<string, SQLOutputValue>[]>;

function contents(db: DatabaseSync): Contents {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function crmObjects(db: DatabaseSync) {
  return db.prepare("SELECT type, name FROM sqlite_master WHERE tbl_name LIKE 'crm_%' ORDER BY name").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 65 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

interface CustomerFixture {
  customer_id: string;
  number: number;
  name: string;
  status_id: string;
  method: string | null;
  currency: string;
  search_text: string;
  revision: number;
}

function insertCustomer(db: DatabaseSync, values: Partial<CustomerFixture> = {}): void {
  const row: CustomerFixture = {
    customer_id: CUSTOMER,
    number: 1,
    name: "Acme 界",
    status_id: "lead",
    method: null,
    currency: "EUR",
    search_text: '{"name":"acme 界"}',
    revision: 1,
    ...values,
  };
  db.prepare(`INSERT INTO crm_customers
    (customer_id, number, name, status_id, method, currency, search_text, created_at, updated_at, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.customer_id,
    row.number,
    row.name,
    row.status_id,
    row.method,
    row.currency,
    row.search_text,
    NOW,
    NOW,
    row.revision,
  );
}

function insertPlan(db: DatabaseSync, values: { plan_id?: string; amount_minor?: number; ends_on?: string } = {}) {
  db.prepare(`INSERT INTO crm_plans (plan_id, customer_id, name, amount_minor, every, starts_on, ends_on, created_at, updated_at)
    VALUES (?, ?, 'Pro', ?, 'month', '2026-01-31', ?, ?, ?)`).run(
    values.plan_id ?? PLAN,
    CUSTOMER,
    values.amount_minor ?? 12_900,
    values.ends_on ?? null,
    NOW,
    NOW,
  );
}

function insertPayment(
  db: DatabaseSync,
  values: { payment_id?: string; number?: number; customer_id?: string; plan_id?: string | null } = {},
) {
  db.prepare(`INSERT INTO crm_payments
    (payment_id, number, customer_id, plan_id, label, amount_minor, due_on, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Pro', 12900, '2026-01-31', ?, ?)`).run(
    values.payment_id ?? PAYMENT,
    values.number ?? 1,
    values.customer_id ?? CUSTOMER,
    values.plan_id === undefined ? PLAN : values.plan_id,
    NOW,
    NOW,
  );
}

function migrated(): DatabaseSync {
  const db = databaseAt(62);
  seed(db, 62);
  migrateOpenBotDatabase(db);
  return db;
}

describe("CRM migration", () => {
  it.each(Array.from({ length: 55 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      if (version < 62) migrateUpTo(db, 62);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({
        ...before,
        ...CRM_TABLES_AFTER_MIGRATION,
        ...THREAD_EVENT_COMPACTION_TABLES_AFTER_MIGRATION,
      });
      expectHealthy(db);
    },
  );

  it("rolls back the tables, the statuses and the marker after a late failure, then retries", () => {
    const db = databaseAt(62);
    seed(db, 62);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=63
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 63 failed");
    expect(contents(db)).toEqual(before);
    expect(crmObjects(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=63").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({
      ...before,
      ...CRM_TABLES_AFTER_MIGRATION,
      ...THREAD_EVENT_COMPACTION_TABLES_AFTER_MIGRATION,
    });
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the tables", () => {
    const db = databaseAt(62);
    seed(db, 62);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(66,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=66; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(crmObjects(db)).toEqual([]);
  });

  it("refuses to open a version 63 database in an older application", () => {
    const db = migrated();
    insertCustomer(db);
    const after = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(66,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    expect(contents(db)).toEqual(after);
  });

  it("has the built-in statuses once, in an upgraded and in a new database", () => {
    const upgraded = migrated();
    upgraded.exec(CRM_SCHEMA_SQL);
    const created = new DatabaseSync(":memory:");
    databases.push(created);
    migrateOpenBotDatabase(created);
    created.exec(CRM_SCHEMA_SQL);
    for (const db of [upgraded, created]) {
      expect(db.prepare("SELECT * FROM crm_statuses").all()).toEqual(CRM_TABLES_AFTER_MIGRATION.crm_statuses);
      expectHealthy(db);
    }
  });

  it("refuses a bad customer, status, tag, plan, payment, activity or proposal", () => {
    const db = migrated();
    expect(() => insertCustomer(db, { customer_id: "short" })).toThrow("CHECK constraint failed");
    expect(() => insertCustomer(db, { number: 0 })).toThrow("CHECK constraint failed");
    expect(() => insertCustomer(db, { name: "" })).toThrow("CHECK constraint failed");
    expect(() => insertCustomer(db, { currency: "eur" })).toThrow("CHECK constraint failed");
    expect(() => insertCustomer(db, { currency: "EURO" })).toThrow("CHECK constraint failed");
    expect(() => insertCustomer(db, { method: "card" })).toThrow("CHECK constraint failed");
    expect(() => insertCustomer(db, { search_text: "{" })).toThrow("CHECK constraint failed");
    expect(() => insertCustomer(db, { revision: 0 })).toThrow("CHECK constraint failed");
    expect(() => insertCustomer(db, { status_id: STATUS })).toThrow("FOREIGN KEY constraint failed");
    insertCustomer(db, { method: "stripe" });
    expect(() => insertCustomer(db, { customer_id: "9".repeat(32) })).toThrow("UNIQUE constraint failed");

    const status = db.prepare(
      "INSERT INTO crm_statuses (status_id, label, tone, position, created_at) VALUES (?, ?, ?, 3, ?)",
    );
    expect(() => status.run("lead", null, "outline", NOW)).toThrow("UNIQUE constraint failed");
    expect(() => status.run(STATUS, null, "outline", NOW)).toThrow("CHECK constraint failed");
    expect(() => status.run("trial", "Trial", "outline", NOW)).toThrow("CHECK constraint failed");
    expect(() => status.run(STATUS, "Trial", "red", NOW)).toThrow("CHECK constraint failed");
    status.run(STATUS, "Trial", "warning-light", NOW);
    expect(() => status.run("9".repeat(32), "TRIAL", "outline", NOW)).toThrow("UNIQUE constraint failed");
    expect(() => db.prepare("UPDATE crm_statuses SET label = 'Lead' WHERE status_id = 'lead'").run()).toThrow(
      "CHECK constraint failed",
    );

    const tag = db.prepare("INSERT INTO crm_tags (tag_id, label, created_at) VALUES (?, ?, ?)");
    expect(() => tag.run("short", "VIP", NOW)).toThrow("CHECK constraint failed");
    expect(() => tag.run(TAG, "", NOW)).toThrow("CHECK constraint failed");
    tag.run(TAG, "VIP", NOW);
    expect(() => tag.run("9".repeat(32), "vip", NOW)).toThrow("UNIQUE constraint failed");
    const link = db.prepare("INSERT INTO crm_customer_tags (customer_id, tag_id) VALUES (?, ?)");
    expect(() => link.run(CUSTOMER, "9".repeat(32))).toThrow("FOREIGN KEY constraint failed");
    expect(() => link.run("9".repeat(32), TAG)).toThrow("FOREIGN KEY constraint failed");
    link.run(CUSTOMER, TAG);
    expect(() => link.run(CUSTOMER, TAG)).toThrow("UNIQUE constraint failed");

    expect(() => insertPlan(db, { amount_minor: -1 })).toThrow("CHECK constraint failed");
    expect(() => insertPlan(db, { amount_minor: 1_000_000_000_001 })).toThrow("CHECK constraint failed");
    expect(() => insertPlan(db, { ends_on: "2026-01-30" })).toThrow("CHECK constraint failed");
    insertPlan(db, { amount_minor: 1_000_000_000_000 });

    expect(() => insertPayment(db, { customer_id: "9".repeat(32) })).toThrow("FOREIGN KEY constraint failed");
    expect(() => insertPayment(db, { plan_id: "9".repeat(32) })).toThrow("FOREIGN KEY constraint failed");
    insertPayment(db);
    expect(() => insertPayment(db, { payment_id: "9".repeat(32) })).toThrow("UNIQUE constraint failed");
    expect(() => db.prepare("UPDATE crm_payments SET due_on = '31.01.2026' WHERE payment_id = ?").run(PAYMENT)).toThrow(
      "CHECK constraint failed",
    );

    const activity = db.prepare(`INSERT INTO crm_activity
      (activity_id, customer_id, actor_kind, kind, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    expect(() => activity.run("1".repeat(32), CUSTOMER, "robot", "payment-paid", "{}", NOW)).toThrow(
      "CHECK constraint failed",
    );
    expect(() => activity.run("1".repeat(32), CUSTOMER, "person", "payment-paid", "{", NOW)).toThrow(
      "CHECK constraint failed",
    );
    activity.run("1".repeat(32), CUSTOMER, "person", "payment-paid", '{"number":1}', NOW);

    const proposal = db.prepare(`INSERT INTO crm_proposals
      (proposal_id, agent_id, customer_id, reason, change_json, state, created_at, decided_at)
      VALUES (?, 'chief', ?, 'Paid by transfer', ?, ?, ?, ?)`);
    expect(() => proposal.run("2".repeat(32), CUSTOMER, "{}", "done", NOW, NOW)).toThrow("CHECK constraint failed");
    expect(() => proposal.run("2".repeat(32), CUSTOMER, "{}", "approved", NOW, null)).toThrow(
      "CHECK constraint failed",
    );
    expect(() => proposal.run("2".repeat(32), "9".repeat(32), "{}", "pending", NOW, null)).toThrow(
      "FOREIGN KEY constraint failed",
    );
    proposal.run("2".repeat(32), CUSTOMER, '{"kind":"payment-paid"}', "pending", NOW, null);

    expect(() => db.prepare("INSERT INTO crm_private_fields (field) VALUES ('card')").run()).toThrow(
      "CHECK constraint failed",
    );
    expect(() => db.prepare("INSERT INTO crm_counters (name, value) VALUES ('invoice', 1)").run()).toThrow(
      "CHECK constraint failed",
    );
    expectHealthy(db);
  });

  it("keeps a status in use, keeps paid history of a deleted plan, and deletes a customer with its rows", () => {
    const db = migrated();
    db.prepare(
      "INSERT INTO crm_statuses (status_id, label, tone, position, created_at) VALUES (?, 'Trial', ?, 3, ?)",
    ).run(STATUS, "warning-light", NOW);
    insertCustomer(db, { status_id: STATUS });
    expect(() => db.prepare("DELETE FROM crm_statuses WHERE status_id = ?").run(STATUS)).toThrow(
      "FOREIGN KEY constraint failed",
    );
    db.prepare("INSERT INTO crm_tags (tag_id, label, created_at) VALUES (?, 'VIP', ?)").run(TAG, NOW);
    db.prepare("INSERT INTO crm_customer_tags (customer_id, tag_id) VALUES (?, ?)").run(CUSTOMER, TAG);
    insertPlan(db);
    insertPayment(db);
    db.prepare(`INSERT INTO crm_activity (activity_id, customer_id, actor_kind, kind, details_json, created_at)
      VALUES (?, ?, 'person', 'plan-created', '{}', ?)`).run("1".repeat(32), CUSTOMER, NOW);
    db.prepare(`INSERT INTO crm_proposals (proposal_id, agent_id, customer_id, reason, change_json, created_at)
      VALUES (?, 'chief', ?, '', '{}', ?)`).run("2".repeat(32), CUSTOMER, NOW);

    db.prepare("DELETE FROM crm_tags WHERE tag_id = ?").run(TAG);
    expect(db.prepare("SELECT * FROM crm_customer_tags").all()).toEqual([]);
    db.prepare("DELETE FROM crm_plans WHERE plan_id = ?").run(PLAN);
    expect(db.prepare("SELECT payment_id, plan_id FROM crm_payments").all()).toEqual([
      { payment_id: PAYMENT, plan_id: null },
    ]);

    insertPlan(db);
    db.prepare("DELETE FROM crm_customers WHERE customer_id = ?").run(CUSTOMER);
    for (const table of ["crm_customers", "crm_plans", "crm_payments", "crm_activity", "crm_proposals"])
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    db.prepare("DELETE FROM crm_statuses WHERE status_id = ?").run(STATUS);
    expectHealthy(db);
  });
});
