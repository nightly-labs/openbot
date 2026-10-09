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
});
