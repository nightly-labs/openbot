// The start of the agent database host does not count against the first statement. Drives the real
// `AgentDatabaseSupervisor` against the real host, `agent-database-host.ts` run by `node` over stdio:
// - a host that reports ready after longer than the statement deadline answers the first statement,
//   and the reported statement time does not include the start;
// - a host that never reports ready fails the waiting request with the start message and is ended;
// - a host that exits before ready fails the waiting request and is not started again in a loop;
// - a prewarmed host answers the first statement with no second start.
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-database-host-start-e2e");
const HOST = resolve(import.meta.dirname, "../src/backend/agent-data/agent-database-host.ts");
/** Wide for a loaded CI runner: the first statement creates the file and the metadata tables. */
const STATEMENT_DEADLINE_MS = 1_000;
/** Longer than the statement deadline: before the fix, this start ended the first statement. */
const READY_DELAY_MS = 2_000;
const START_DEADLINE_MS = 3_000;
const NOT_STARTED = "The database process did not start. Nothing was run. Try the call again.";

interface Case {
  ok: boolean;
  failure: string | null;
  starts: number;
  settledMs: number[];
  aliveAfter: number;
}

interface Report {
  passed: boolean;
  slowStart?: Case;
  neverReady?: Case & { elapsedMs: number };
  exitBeforeReady?: Case;
  prewarm?: Case;
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
    onExit: (listener) => child.once("exit", () => listener()),
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
