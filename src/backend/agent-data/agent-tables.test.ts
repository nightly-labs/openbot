import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentDatabaseSupervisor } from "./agent-database-supervisor";
import { AgentTables } from "./agent-tables";
import { spawnNodeDatabaseHost } from "./node-database-host";

let sharedRoot: string;
let tables: AgentTables;

beforeEach(async () => {
  sharedRoot = await mkdtemp(join(tmpdir(), "openbot-shared-"));
  tables = new AgentTables({
    sharedRoot,
    supervisor: new AgentDatabaseSupervisor({ spawnHost: spawnNodeDatabaseHost }),
  });
});

afterEach(() => {
  tables.dispose();
});

async function createPeople(agentId = "chief"): Promise<void> {
  const created = await tables.execute(agentId, "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT UNIQUE)", []);
  expect(created.ok || created.message).toBe(true);
}

describe("AgentTables", () => {
  it("keeps one file, and records the agent that created each table", async () => {
    await createPeople();
    await tables.execute("chief", "INSERT INTO people (name) VALUES (?)", ["Ada"]);

    expect(existsSync(join(sharedRoot, "Data", "agent-data.db"))).toBe(true);
    expect(await tables.list()).toMatchObject([{ name: "people", ownerAgentId: "chief", rowCount: 1 }]);
  });

  it("lets another agent read and write the same table", async () => {
    await createPeople();
    const written = await tables.execute("research", "INSERT INTO people (name) VALUES (?)", ["Grace"]);
    expect(written.ok && written.value.changes).toBe(1);

    const read = await tables.query("SELECT name FROM people", []);
    expect(read.ok && read.value.rows).toEqual([["Grace"]]);
  });

  it("refuses to drop or alter a table another agent created, from SQL and from the tool", async () => {
    await createPeople();

    const dropped = await tables.execute("research", "DROP TABLE people", []);
    expect(dropped.ok).toBe(false);
    const altered = await tables.execute("research", "ALTER TABLE people ADD COLUMN email TEXT", []);
    expect(altered.ok).toBe(false);

    const removed = await tables.remove("research", "people");
    expect(removed.ok).toBe(false);
    expect(removed.ok || removed.message).toContain("created by another agent");
    expect(await tables.list()).toHaveLength(1);
  });

  it("lets the owner remove its own table, and the user remove any table", async () => {
    await createPeople();
    await tables.execute("research", "CREATE TABLE sources (url TEXT PRIMARY KEY)", []);

    expect(await tables.remove("chief", "people")).toEqual({ ok: true, value: "people" });
    await tables.removeAsUser("sources");
    expect(await tables.list()).toEqual([]);
  });

  it("refuses the statements that would reach a file or the engine, and leaves the table in place", async () => {
    await createPeople();
    const outsidePath = join(sharedRoot, "escaped.db");

    for (const sql of [
      `ATTACH DATABASE '${outsidePath}' AS other`,
      `VACUUM INTO '${outsidePath}'`,
      "PRAGMA journal_mode = wal",
      "BEGIN",
      "SELECT load_extension('/tmp/x.so')",
      "CREATE VIRTUAL TABLE stats USING dbstat",
      "INSERT INTO people (name) VALUES ('a'); DROP TABLE people",
      "UPDATE openbot_metadata SET owner_agent_id = 'research'",
      "DROP TABLE openbot_metadata",
    ]) {
      const result = await tables.execute("chief", sql, []);
      expect(result.ok && sql).toBe(false);
    }

    expect(existsSync(outsidePath)).toBe(false);
    expect(await tables.list()).toMatchObject([{ name: "people", ownerAgentId: "chief" }]);
  });

  it("names the columns even when nothing matched", async () => {
    await createPeople();

    const read = await tables.query("SELECT name FROM people WHERE name = ?", ["nobody"]);
    // Columns without rows are how a model tells "no matches" from "wrong column name".
    expect(read.ok && read.value.rows).toEqual([]);
    expect(read.ok && read.value.columns).toEqual(["name"]);
  });
});
