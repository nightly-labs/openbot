import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_DATABASE_LIMITS } from "./agent-database-protocol";
import { AgentDatabaseSupervisor } from "./agent-database-supervisor";
import { spawnNodeDatabaseHost } from "./node-database-host";

// The statement that provably cannot be interrupted from inside the process running it: `sqlite3_step`
// never returns to JavaScript, so nothing but ending the process stops it.
const RUNAWAY =
  "WITH RECURSIVE counter(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM counter) SELECT count(*) FROM counter";

let databasePath: string;
let supervisor: AgentDatabaseSupervisor;

function statement(sql: string, mode: "read" | "write", provision = false) {
  return supervisor.send({
    kind: "statement" as const,
    databasePath,
    mode,
    provision,
    protectedTables: [],
    sql,
    parameters: [],
    limits: AGENT_DATABASE_LIMITS,
  });
}

beforeEach(async () => {
  databasePath = join(await mkdtemp(join(tmpdir(), "openbot-supervisor-")), "work.db");
  supervisor = new AgentDatabaseSupervisor({
    spawnHost: spawnNodeDatabaseHost,
    // Input, not a wait: the deadline is the thing under test, so it is set short rather than slept
    // on. It cannot be tighter than a cold host start, because the first statement after a spawn
    // starts this timer before the host process exists and pays that start out of its own budget.
    // At 250ms a loaded CI machine stopped a CREATE TABLE as a runaway; the product default is 5s.
    statementDeadlineMs: 2_000,
  });
  expect((await statement("CREATE TABLE notes (body TEXT)", "write", true)).ok).toBe(true);
  expect((await statement("INSERT INTO notes (body) VALUES ('before')", "write")).ok).toBe(true);
});

afterEach(() => {
  supervisor.dispose();
});

describe("AgentDatabaseSupervisor", () => {
  it("stops a runaway statement and keeps serving the same database afterwards", async () => {
    const runaway = await statement(RUNAWAY, "read");
    expect(runaway.ok).toBe(false);
    expect(runaway.ok || runaway.failure.message).toContain("was stopped");

    // The replacement host proves two things at once: a new process was started, and the killed one
    // released the file rather than leaving a lock behind.
    expect((await statement("INSERT INTO notes (body) VALUES ('after')", "write")).ok).toBe(true);
    const rows = await statement("SELECT body FROM notes ORDER BY body", "read");
    expect(rows.ok && rows.result.rows).toEqual([["after"], ["before"]]);
  });

  it("dispatches a statement queued behind a runaway instead of failing it too", async () => {
    const runaway = statement(RUNAWAY, "read");
    const queued = statement("SELECT body FROM notes", "read");
    expect((await runaway).ok).toBe(false);
    const result = await queued;
    expect(result.ok && result.result.rows).toEqual([["before"]]);
  });
});
