import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("billing sales migration", () => {
  it("keeps the previous schema usable and adds only sales tables", () => {
    const database = migratedDatabase("0030_sales_analytics.sql");
    databases.push(database);
    database.exec(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES ('sales-user', 'email:sales@example.test', 'sales@example.test', 1, 1)`,
    );
    const before = database.prepare("SELECT id, email, created_at FROM users").all();
    database.exec(migration("0031_billing_sales.sql"));
    database.exec(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES ('sales-user-2', 'email:two@example.test', 'two@example.test', 2, 2)`,
    );

    expect(database.prepare("SELECT id, email, created_at FROM users ORDER BY id").all()).toEqual([
      ...before,
      { id: "sales-user-2", email: "two@example.test", created_at: 2 },
    ]);
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'billing_sales_%'").all(),
    ).toEqual(expect.arrayContaining([{ name: "billing_sales_checkouts" }, { name: "billing_sales_facts" }]));
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("keeps every sales fact when it adds the refund and dispute fact types", () => {
    const database = migratedDatabase("0034_server_claims.sql");
    databases.push(database);
    database.exec(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES
         ('sales-user', 'email:sales@example.test', 'sales@example.test', 1, 1),
         ('gone-user', 'email:gone@example.test', 'gone@example.test', 1, 1)`,
    );
    const insert = database.prepare(
      `INSERT INTO billing_sales_facts(
         source_key, fact_type, source_id, invoice_id, session_id, user_id, server_id,
         event_timestamp, attributes_json, delivery_enqueued_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const earlierTypes = [
      "checkout_started",
      "checkout_completed",
      "checkout_expired",
      "checkout_returned",
      "payment_failed",
      "payment_succeeded",
    ];
    earlierTypes.forEach((type, index) => {
      insert.run(
        `fact:${type}`,
        type,
        `evt_${index}`,
        type.startsWith("payment") ? `in_${index}` : null,
        type.startsWith("checkout") ? `cs_${index}` : null,
        index % 2 === 0 ? "sales-user" : "gone-user",
        "server-1",
        1_000 + index,
        `{"plan":"starter","amount":${index}}`,
        index < 3 ? 2_000 + index : null,
        3_000 + index,
      );
    });
    const facts = () => database.prepare("SELECT * FROM billing_sales_facts ORDER BY source_key").all();
    const before = facts();

    database.exec(migration("0035_billing_sales_reversals.sql"));

    expect(facts()).toEqual(before);
    for (const type of ["payment_refunded", "refund_failed", "payment_disputed", "dispute_lost"]) {
      insert.run(`new:${type}`, type, "evt_new", "in_0", null, "sales-user", "server-1", 5_000, "{}", null, 5_000);
    }
    expect(() => insert.run("bad", "payment_reversed", "evt_bad", null, null, null, null, 1, "{}", null, 1)).toThrow(
      /CHECK/u,
    );
    expect(() =>
      insert.run("again", "payment_succeeded", "evt_again", "in_5", null, null, null, 1, "{}", null, 1),
    ).toThrow(/UNIQUE/u);
    database.exec("DELETE FROM users WHERE id = 'gone-user'");
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM billing_sales_facts WHERE source_key LIKE 'fact:%' AND user_id IS NULL")
        .get(),
    ).toEqual({ count: 3 });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'billing_sales_facts' ORDER BY name",
        )
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { name: "billing_sales_facts_invoice" },
        { name: "billing_sales_facts_pending" },
        { name: "billing_sales_facts_user" },
        { name: "billing_sales_paid_invoice" },
      ]),
    );
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'billing_sales_facts_next'").all()).toEqual(
      [],
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});
