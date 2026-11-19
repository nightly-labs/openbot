// The start of the agent database host does not count against the first statement. Drives the real
// `AgentDatabaseSupervisor` against the real host, `agent-database-host.ts` run by `node` over stdio:
// - a host that reports ready after longer than the statement deadline answers the first statement,
//   and the reported statement time does not include the start;
// - a host that never reports ready fails the waiting request with the start message and is ended;
// - a host that exits before ready fails the waiting request and is not started again in a loop;
// - a prewarmed host answers the first statement with no second start;
// - a second failed start in a row tells the agent not to retry, starts no host until the retry delay
//   ends, and reports each failure with its reason; a host that starts after the delay answers;
// - through the real `AgentTables`, an agent adds a trigger to its own table in one statement, but
//   not to a table of another agent, the owner record, or a TEMP trigger, and a trigger that a
//   foreign-key cascade fires inside OpenBot's own `DROP TABLE` cannot reassign a table's owner.
// `bun run test:agent-database-host-start`. Writes .openbot-build/agent-database-host-start-e2e/report.json.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import {
  AGENT_DATABASE_LIMITS,
  type AgentDatabaseHostMessage,
  type AgentDatabaseHostProcess,
} from "../src/backend/agent-data/agent-database-protocol";
import {
  type AgentDatabaseOutcome,
  AgentDatabaseSupervisor,
} from "../src/backend/agent-data/agent-database-supervisor";
import { AgentTables } from "../src/backend/agent-data/agent-tables";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-database-host-start-e2e");
const HOST = resolve(import.meta.dirname, "../src/backend/agent-data/agent-database-host.ts");
/** Wide for a loaded CI runner: the first statement creates the file and the metadata tables. */
const STATEMENT_DEADLINE_MS = 1_000;
/** Longer than the statement deadline: before the fix, this start ended the first statement. */
const READY_DELAY_MS = 2_000;
const START_DEADLINE_MS = 3_000;
const NOT_STARTED = "The database process did not start. Nothing was run. Try the call again.";
const UNAVAILABLE =
  "The database process could not start, so shared tables are not available now. Nothing was run. Do not retry now: keep these records in a file in your workspace, and try shared tables again later.";

interface Case {
  ok: boolean;
  failure: string | null;
  starts: number;
  settledMs: number[];
  aliveAfter: number;
}

interface TriggerStep {
  agent: string;
  sql: string;
  result: string;
}

interface Report {
  passed: boolean;
  slowStart?: Case;
  neverReady?: Case & { elapsedMs: number };
  exitBeforeReady?: Case;
  prewarm?: Case;
  repeatedFailure?: { failures: string[]; starts: number; reasons: string[]; recovered: string[] };
  triggers?: TriggerStep[];
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-agent-database-host-start-e2e-"));
const report: Report = { passed: false };
const children: ChildProcess[] = [];

/** The test transport: the host's stdio, with an optional hold on its ready message. */
function stdioHost(args: string[], readyDelayMs = 0): AgentDatabaseHostProcess {
  const child = spawn(process.platform === "win32" ? "node.exe" : "node", args, {
    stdio: ["pipe", "pipe", "inherit"],
  });
  children.push(child);
  const listeners: ((message: AgentDatabaseHostMessage) => void)[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message: AgentDatabaseHostMessage = JSON.parse(line);
    const deliver = () => {
      for (const listener of listeners) listener(message);
    };
    if ("kind" in message && readyDelayMs > 0) setTimeout(deliver, readyDelayMs);
    else deliver();
  });
  return {
    send: (request) => child.stdin.write(`${JSON.stringify(request)}\n`),
    onMessage: (listener) => listeners.push(listener),
    onExit: (listener) => child.once("exit", (code) => listener(code)),
    kill: () => child.kill("SIGKILL"),
  };
}

function select(supervisor: AgentDatabaseSupervisor): Promise<AgentDatabaseOutcome> {
  return Effect.runPromise(
    supervisor.send({
      kind: "statement",
      databasePath: join(root, "agent-data.db"),
      mode: "write",
      provision: true,
      protectedTables: [],
      sql: "CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY)",
      parameters: [],
      limits: AGENT_DATABASE_LIMITS,
    }),
  );
}

function alive(): number {
  return children.filter((child) => child.exitCode === null && child.signalCode === null).length;
}

async function waitForExits(): Promise<void> {
  await Promise.all(
    children
      .filter((child) => child.exitCode === null && child.signalCode === null)
      .map((child) => new Promise((done) => child.once("exit", done))),
  );
}

async function run(
  args: string[],
  options: { readyDelayMs?: number; prewarm?: boolean; dispose?: boolean },
): Promise<Case> {
  children.length = 0;
  let starts = 0;
  const settledMs: number[] = [];
  const supervisor = new AgentDatabaseSupervisor({
    spawnHost: () => {
      starts += 1;
      return stdioHost(args, options.readyDelayMs);
    },
    statementDeadlineMs: STATEMENT_DEADLINE_MS,
    hostStartDeadlineMs: START_DEADLINE_MS,
    onStatementSettled: (durationMs) => settledMs.push(durationMs),
  });
  if (options.prewarm) {
    supervisor.prewarm();
    assert.equal(starts, 1, "the prewarm did not start a host");
  }
  const outcome = await select(supervisor);
  // The start failures end the host themselves; the others are ended here.
  if (options.dispose !== false) supervisor.dispose();
  await waitForExits();
  return {
    ok: outcome.ok,
    failure: outcome.ok ? null : outcome.failure.message,
    starts,
    settledMs,
    aliveAfter: alive(),
  };
}

try {
  await mkdir(OUT, { recursive: true });

  const slowStart = await run(["--disable-warning=ExperimentalWarning", HOST], { readyDelayMs: READY_DELAY_MS });
  report.slowStart = slowStart;
  assert.equal(slowStart.failure, null, "the slow start ended the first statement");
  assert.equal(slowStart.starts, 1);
  assert.equal(slowStart.settledMs.length, 1);
  assert.ok(
    (slowStart.settledMs[0] ?? Number.POSITIVE_INFINITY) < READY_DELAY_MS,
    "the reported statement time includes the start",
  );

  const startedAt = performance.now();
  const neverReady = await run(["-e", "setInterval(() => {}, 1000)"], { dispose: false });
  report.neverReady = { ...neverReady, elapsedMs: Math.round(performance.now() - startedAt) };
  assert.equal(neverReady.failure, NOT_STARTED);
  assert.equal(neverReady.starts, 1);
  assert.deepEqual(neverReady.settledMs, [], "a start failure was reported as statement time");
  assert.equal(neverReady.aliveAfter, 0, "the host that never became ready was not ended");
  assert.ok(report.neverReady.elapsedMs >= START_DEADLINE_MS, "the start deadline fired early");

  const exitBeforeReady = await run(["-e", "process.exit(1)"], { dispose: false });
  report.exitBeforeReady = exitBeforeReady;
  assert.equal(exitBeforeReady.failure, NOT_STARTED);
  assert.equal(exitBeforeReady.starts, 1, "a host that cannot start was started again");

  const prewarm = await run(["--disable-warning=ExperimentalWarning", HOST], { prewarm: true });
  report.prewarm = prewarm;
  assert.equal(prewarm.failure, null);
  assert.equal(prewarm.starts, 1, "the statement after a prewarm started a second host");

  children.length = 0;
  let failingStarts = 0;
  const reasons: string[] = [];
  const failing = new AgentDatabaseSupervisor({
    spawnHost: () => {
      failingStarts += 1;
      return stdioHost(["-e", "process.exit(3)"]);
    },
    hostStartDeadlineMs: START_DEADLINE_MS,
    // Longer than this case runs, so the third call is inside the delay.
    hostStartRetryDelayMs: 60_000,
    onHostStartFailed: (failure) => reasons.push(`${failure.reason}; retry after ${failure.retryAfterMs} ms`),
  });
  const failures: string[] = [];
  for (let call = 0; call < 3; call += 1) {
    const outcome = await select(failing);
    failures.push(outcome.ok ? "ok" : outcome.failure.message);
  }
  failing.prewarm();
  const startsInDelay = failingStarts;
  failing.dispose();
  await waitForExits();

  // With no delay, the next call after two failed starts starts the real host and is answered.
  children.length = 0;
  const hosts = [
    ["-e", "process.exit(3)"],
    ["-e", "process.exit(3)"],
  ];
  const recovering = new AgentDatabaseSupervisor({
    spawnHost: () => stdioHost(hosts.shift() ?? ["--disable-warning=ExperimentalWarning", HOST]),
    hostStartRetryDelayMs: 0,
  });
  const recovered: string[] = [];
  for (let call = 0; call < 3; call += 1) {
    const outcome = await select(recovering);
    recovered.push(outcome.ok ? "ok" : outcome.failure.message);
  }
  recovering.dispose();
  await waitForExits();

  report.repeatedFailure = { failures, starts: startsInDelay, reasons, recovered };
  assert.deepEqual(failures, [NOT_STARTED, UNAVAILABLE, UNAVAILABLE]);
  assert.equal(startsInDelay, 2, "a call or a prewarm inside the retry delay started a host");
  assert.deepEqual(reasons, [
    "exited with code 3 before it reported ready; retry after 0 ms",
    "exited with code 3 before it reported ready; retry after 60000 ms",
  ]);
  assert.equal(recovered.at(-1), "ok", "the host did not answer after the failed starts");

  const steps: TriggerStep[] = [];
  report.triggers = steps;
  children.length = 0;
  const tables = new AgentTables({
    sharedRoot: join(root, "triggers"),
    supervisor: new AgentDatabaseSupervisor({
      spawnHost: () => stdioHost(["--disable-warning=ExperimentalWarning", HOST]),
    }),
  });
  const execute = async (agent: string, sql: string): Promise<string> => {
    const result = await Effect.runPromise(tables.execute(agent, sql, []));
    const text = result.ok ? "ok" : result.message;
    steps.push({ agent, sql, result: text });
    return text;
  };
  const OTHER_AGENT = "given a trigger";
  try {
    assert.equal(await execute("A", "CREATE TABLE item_revisions (id INTEGER PRIMARY KEY, body TEXT NOT NULL)"), "ok");
    assert.equal(
      await execute(
        "A",
        "CREATE TRIGGER item_revision_no_update BEFORE UPDATE ON item_revisions BEGIN SELECT RAISE(ABORT, 'Revisions are immutable'); END",
      ),
      "ok",
      "a trigger was refused",
    );
    assert.equal(await execute("A", "INSERT INTO item_revisions (body) VALUES ('a')"), "ok");
    assert.match(await execute("B", "UPDATE item_revisions SET body = 'b'"), /Revisions are immutable/);
    assert.match(
      await execute(
        "A",
        "CREATE TRIGGER second AFTER INSERT ON item_revisions BEGIN SELECT 1; END; DELETE FROM item_revisions",
      ),
      /^Send one SQL statement per call/,
      "a statement after a trigger was let through",
    );
    assert.match(
      await execute("B", "CREATE TRIGGER b_lock AFTER INSERT ON item_revisions BEGIN SELECT 1; END"),
      new RegExp(OTHER_AGENT),
    );
    assert.match(await execute("B", "DROP TRIGGER item_revision_no_update"), new RegExp(OTHER_AGENT));
    assert.notEqual(
      await execute("A", "CREATE TRIGGER owners AFTER INSERT ON openbot_metadata BEGIN SELECT 1; END"),
      "ok",
      "a trigger was added to the owner record",
    );
    assert.match(
      await execute("A", "CREATE TEMP TRIGGER temp_lock AFTER INSERT ON main.item_revisions BEGIN SELECT 1; END"),
      /TEMP triggers/,
    );

    assert.equal(await execute("B", "CREATE TABLE b_table (id INTEGER PRIMARY KEY)"), "ok");
    assert.equal(await execute("A", "CREATE TABLE parent (id INTEGER PRIMARY KEY)"), "ok");
    assert.equal(
      await execute(
        "A",
        "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE)",
      ),
      "ok",
    );
    assert.equal(
      await execute(
        "A",
        "CREATE TRIGGER take AFTER DELETE ON child BEGIN UPDATE openbot_metadata SET owner_agent_id = 'A' WHERE table_name = 'b_table'; END",
      ),
      "ok",
    );
    assert.equal(await execute("A", "INSERT INTO parent (id) VALUES (1)"), "ok");
    assert.equal(await execute("A", "INSERT INTO child (id, parent_id) VALUES (1, 1)"), "ok");
    const removed = await Effect.runPromise(tables.remove("A", "parent"));
    steps.push({ agent: "A", sql: "remove parent", result: removed.ok ? "ok" : removed.message });
    const listed = await Effect.runPromise(tables.list());
    assert.ok(listed.ok, "the tables could not be listed");
    const owner = listed.value.find((table) => table.name === "b_table")?.ownerAgentId;
    assert.equal(owner, "B", "a trigger in OpenBot's own DROP TABLE reassigned the owner of another agent's table");
  } finally {
    tables.dispose();
  }

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGKILL");
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
