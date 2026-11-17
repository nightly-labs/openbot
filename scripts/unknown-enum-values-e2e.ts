// Checks that list reads and scans of the real stores skip a row with an enum value that this version does
// not know, on a real SQLite database in a temporary profile. Future values go in past the CHECK
// constraints with `PRAGMA ignore_check_constraints`. Each list must keep the known rows, single reads
// stay strict, and no future value or skipped routine trigger may change. No app or network is started.
//
// Run: bun scripts/unknown-enum-values-e2e.ts
// Writes .openbot-build/unknown-enum-values/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RoutineSchedule, WorkflowGraph } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { BrowserProxyStore } from "../src/backend/browser-profiles/browser-proxy-store";
import { CrmAgentView } from "../src/backend/crm/crm-agent-view";
import { CrmStore } from "../src/backend/crm/crm-store";
import { databaseRows } from "../src/backend/database/database-rows";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/unknown-enum-values");
const AGENT = "agent-unknown-values";
const NOW = new Date("2026-11-17T09:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const EVERY_15: RoutineSchedule = { kind: "interval", amount: 15, unit: "minutes", anchorAt: NOW.toISOString() };

interface Report {
  checks: string[];
  futureValues: { table: string; column: string; value: string }[];
  passed: boolean;
  failure?: string;
}
const report: Report = { checks: [], futureValues: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};
const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id).join();
const throws = (read: () => unknown) => {
  try {
    read();
    return false;
  } catch {
    return true;
  }
};

const directory = await mkdtemp(join(tmpdir(), "openbot-unknown-enum-values-"));
const database = new OpenBotDatabase(directory);
const sql = (text: string, ...values: (string | number | null)[]) => database.connection.prepare(text).run(...values);
const rows = (text: string, ...values: string[]) => databaseRows(database.connection.prepare(text).all(...values));
const id32 = (n: number) => n.toString(16).padStart(32, "0");

/** Writes a value that this version does not know, past the CHECK constraint, as a newer writer would. */
function future(table: string, column: string, value: string, where: string, ...keys: (string | number)[]) {
  sql("PRAGMA ignore_check_constraints = ON");
  try {
    assert.equal(Number(sql(`UPDATE ${table} SET ${column} = ? WHERE ${where}`, value, ...keys).changes), 1);
  } finally {
    sql("PRAGMA ignore_check_constraints = OFF");
  }
  report.futureValues.push({ table, column, value });
}

const graph: WorkflowGraph = {
  nodes: [
    { id: "trigger", kind: "trigger", at: { x: 0, y: 0 }, fields: { trigger: "schedule" }, schedule: EVERY_15 },
    { id: "manual", kind: "trigger", at: { x: 0, y: 200 }, fields: { trigger: "manual" } },
    { id: "step", kind: "output", at: { x: 300, y: 0 }, fields: { target: "notify" } },
  ],
  edges: [{ id: "edge", from: "trigger", to: "step", type: "text" }],
  strokes: [],
};

try {
  await Effect.runPromise(database.initialize());

  // --- Workflows -------------------------------------------------------------------------------
  const workflows = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") });
  const runs = new WorkflowRunStore({ database });
  const github = new WorkflowGitHubStore({ database });
  const created = workflows.create({ title: "Future values" }, NOW);
  const workflowId = created.summary.id;
  const plainWorkflow = workflows.create({ title: "Known" }, NOW).summary.id;
  assert.ok(workflows.saveGraph(workflowId, created.revision, graph, NOW).ok);
  const startRun = (n: number) =>
    runs.startRun(
      {
        workflowId,
        triggerNodeId: "manual",
        fromNodeId: null,
        source: "manual",
        scheduledFor: null,
        idempotencyKey: `run-${n}`,
        revision: 1,
        graph,
        payload: null,
      },
      new Date(at(n * 60)),
    ).run;
  const [oldest, middle, newest] = [startRun(1), startRun(2), startRun(3)];
  const addStep = (n: number) =>
    runs.addStep(
      {
        workflowId,
        runId: newest.id,
        nodeId: "step",
        kind: "output",
        requestId: `request-${n}`,
        agentId: null,
        status: "running",
        input: "",
      },
      NOW,
    );
  const [knownStep, futureStep] = [addStep(1), addStep(2)];
  workflows.addRunVersion(workflowId, 2, graph, NOW);
  workflows.addRunVersion(workflowId, 3, graph, new Date(at(1)));
  for (const n of [1, 2])
    github.addDelivery({
      workflowId,
      nodeId: "trigger",
      deliveryId: `delivery-${n}`,
      event: "issue.opened",
      item: null,
      receivedAt: at(n),
      outcome: "started",
      reason: null,
      runId: null,
      payload: null,
      causedByBot: false,
    });
  const versionsBefore = workflows.versions(workflowId).length;

  future("workflow_runs", "status", "paused-by-host", "run_id = ?", middle.id);
  future("workflow_steps", "kind", "video", "step_id = ?", futureStep.id);
  future("workflow_versions", "kind", "import", "rowid = (SELECT max(rowid) FROM workflow_versions)");
  future("workflow_triggers", "kind", "email", "workflow_id = ? AND node_id = ?", workflowId, "manual");
  future("workflow_github_deliveries", "outcome", "queued", "delivery_id = ?", "delivery-2");

  const first = runs.page(workflowId, undefined, 2);
  check("a run page leaves out the future status", ids(first.runs.map((entry) => entry.run)) === newest.id);
  check("a run keeps its known steps", ids(first.runs[0]?.steps ?? []) === knownStep.id);
  const second = runs.page(workflowId, first.nextBefore ?? undefined, 2);
  check("the page cursor goes past the left-out run", ids(second.runs.map((entry) => entry.run)) === oldest.id);
  check(
    "open runs and steps load",
    !runs.openRuns().some((run) => run.id === middle.id) && runs.openSteps().length > 0,
  );
  check("versions leave out the future kind", workflows.versions(workflowId).length === versionsBefore - 1);
  check("the detail leaves out the future trigger", workflows.detail(workflowId)?.triggers.length === 1);
  check("GitHub history leaves out the future outcome", ids(github.history(workflowId).deliveries) === "delivery-1");
  check(
    "a single run read stays strict",
    throws(() => runs.run(middle.id)),
  );
  future("workflow_nodes", "kind", "video", "workflow_id = ? AND node_id = ?", workflowId, "step");
  check(
    "the graph scan leaves out a workflow with a future node kind",
    workflows
      .listWithGraphs()
      .map((entry) => entry.summary.id)
      .join() === plainWorkflow,
  );

  // --- Browser proxies -------------------------------------------------------------------------
  const proxies = new BrowserProxyStore(database);
  const proxy = (scheme: "http" | "socks5", host: string) =>
    proxies.create({ scheme, host, port: 8080, username: null, password: null });
  const [knownProxy, futureProxy] = [proxy("http", "proxy.test"), proxy("socks5", "future.test")];
  future("browser_proxies", "scheme", "socks6", "proxy_id = ?", futureProxy);
  check("the proxy list leaves out the future scheme", ids(proxies.list()) === knownProxy);
  check(
    "a single proxy read stays strict",
    throws(() => proxies.get(futureProxy)),
  );

  // --- Agent threads ---------------------------------------------------------------------------
  const threads = new AgentThreadStore(database);
  for (const thread of ["thread-known", "thread-future"]) {
    sql(
      `INSERT INTO projection_threads (thread_id, agent_id, title, created_at, updated_at, last_event_sequence)
       VALUES (?, ?, ?, ?, ?, 1)`,
      thread,
      AGENT,
      thread,
      at(0),
      at(0),
    );
    sql(
      `INSERT INTO projection_agent_threads (thread_id, agent_id, origin, title, title_source, created_at, updated_at,
        last_event_sequence) VALUES (?, ?, 'user', ?, 'auto', ?, ?, 1)`,
      thread,
      AGENT,
      thread,
      at(0),
      at(0),
    );
  }
  future("projection_agent_threads", "origin", "routine", "thread_id = ?", "thread-future");
  const threadIds = (list: readonly { threadId: string }[]) => list.map((thread) => thread.threadId).join();
  check("the thread list leaves out the future origin", threadIds(threads.list(AGENT)) === "thread-known");
  check("recent threads leave out the future origin", threadIds(threads.recent(AGENT, null, 10)) === "thread-known");

  // --- Routines --------------------------------------------------------------------------------
  const routines = new AgentRoutineStore(database);
  const routine = (name: string) =>
    routines.create(
      { agentId: AGENT, name, instruction: "Check the inbox.", active: true, timezone: "UTC", schedule: EVERY_15 },
      NOW,
    );
  const [knownRoutine, futureRoutine] = [routine("Known"), routine("Future")];
  future("projection_agent_routines", "limit_policy", "queue-forever", "routine_id = ?", futureRoutine.id);
  // The unreadable routine is due first, so a scan that does not skip it would pick it.
  sql("UPDATE projection_routine_triggers SET next_run_at = ? WHERE routine_id = ?", at(-120), futureRoutine.id);
  sql("UPDATE projection_routine_triggers SET next_run_at = ? WHERE routine_id = ?", at(-60), knownRoutine.id);
  const futureTrigger = () =>
    JSON.stringify(rows("SELECT * FROM projection_routine_triggers WHERE routine_id = ?", futureRoutine.id));
  const triggerBefore = futureTrigger();
  check("the routine list leaves out the future limit policy", ids(routines.list(AGENT)) === knownRoutine.id);
  check(
    "the routine record list leaves out the future limit policy",
    ids(routines.listRecords(AGENT)) === knownRoutine.id,
  );
  check(
    "the due scan leaves out the unreadable routine",
    routines
      .due(NOW)
      .map((entry) => entry.routine.id)
      .join() === knownRoutine.id,
  );
  check("the next due time skips the unreadable routine", routines.nextDueAt() === at(-60), routines.nextDueAt());
  routines.skipMissed(new Date(at(3600)));
  check("the start-up catch-up leaves the unreadable trigger unchanged", futureTrigger() === triggerBefore);
  const knownRun = routines.createRun(knownRoutine, null, "test", at(0));
  const futureRun = routines.createRun(knownRoutine, null, "test", at(1));
  future("projection_routine_runs", "status", "paused-by-host", "run_id = ?", futureRun.id);
  check("the run list leaves out the future status", ids(routines.listRuns(AGENT, knownRoutine.id)) === knownRun.id);
  check("pending runs load", !routines.pendingRuns().some((run) => run.id === futureRun.id));
  check(
    "a single routine read stays strict",
    throws(() => routines.get(AGENT, futureRoutine.id)),
  );

  // --- CRM -------------------------------------------------------------------------------------
  const crm = new CrmStore({ database, now: () => NOW });
  for (const n of [1, 2]) {
    sql(
      `INSERT INTO crm_customers (customer_id, number, name, status_id, currency, created_at, updated_at)
       VALUES (?, ?, ?, 'lead', 'USD', ?, ?)`,
      id32(n),
      n,
      `Customer ${n}`,
      at(0),
      at(0),
    );
    sql(
      `INSERT INTO crm_plans (plan_id, customer_id, name, amount_minor, every, starts_on, created_at, updated_at)
       VALUES (?, ?, ?, 1000, 'month', '2026-11-01', ?, ?)`,
      id32(100 + n),
      id32(1),
      `Plan ${n}`,
      at(0),
      at(0),
    );
    sql(
      `INSERT INTO crm_payments (payment_id, number, customer_id, label, amount_minor, due_on, method, created_at,
        updated_at) VALUES (?, ?, ?, ?, 1000, ?, 'cash', ?, ?)`,
      id32(200 + n),
      n,
      id32(1),
      `Invoice ${n}`,
      `2026-12-0${n}`,
      at(0),
      at(0),
    );
    sql(
      `INSERT INTO crm_activity (activity_id, customer_id, actor_kind, kind, details_json, created_at)
       VALUES (?, ?, 'person', 'note', '{}', ?)`,
      id32(300 + n),
      id32(1),
      at(n),
    );
  }
  sql(
    "INSERT INTO crm_statuses (status_id, label, tone, position, created_at) VALUES (?, 'Trial', 'info-light', 3, ?)",
    id32(400),
    at(0),
  );
  sql(
    `INSERT INTO crm_sources (source_id, kind, test_mode, key_hint, state, connected_at)
     VALUES (?, 'stripe', 1, 'abcd', 'ok', ?)`,
    id32(500),
    at(0),
  );
  sql("INSERT INTO crm_private_fields (field) VALUES ('notes'), ('phone')");
  sql("INSERT INTO crm_agent_access (agent_id, granted_at) VALUES (?, ?)", AGENT, at(0));
  const statusesBefore = crm.statuses().length;

  future("crm_customers", "method", "giftcard", "customer_id = ?", id32(2));
  future("crm_plans", "every", "fortnight", "plan_id = ?", id32(102));
  future("crm_payments", "method", "giftcard", "payment_id = ?", id32(202));
  future("crm_activity", "actor_kind", "bot", "activity_id = ?", id32(302));
  future("crm_statuses", "tone", "teal", "status_id = ?", id32(400));
  future("crm_sources", "state", "paused", "source_id = ?", id32(500));
  future("crm_private_fields", "field", "birthday", "field = ?", "phone");

  const customers = crm.customers({}).customers;
  check("the customer list leaves out the future method", ids(customers) === id32(1));
  check("a customer leaves out the future plan", ids(customers[0]?.plans ?? []) === id32(101));
  check("the payment list leaves out the future method", ids(crm.payments({ state: "open" }).payments) === id32(201));
  check(
    "the activity list leaves out the future actor",
    ids(crm.activity({ customerId: id32(1) }).activity) === id32(301),
  );
  check("the status list leaves out the future tone", crm.statuses().length === statusesBefore - 1);
  check("the source list leaves out the future state", crm.sources().length === 0);
  check("the private field list leaves out the future field", crm.privateFields().join() === "notes");
  const view = new CrmAgentView(crm);
  view.find(AGENT, {});
  view.customer(AGENT, id32(1));
  view.payments(AGENT, { state: "open" });
  check("the agent CRM reads load", true);

  // --- Writes ----------------------------------------------------------------------------------
  check(
    "every future value stays in the database unchanged",
    report.futureValues.every(
      (entry) => rows(`SELECT 1 FROM ${entry.table} WHERE ${entry.column} = ?`, entry.value).length === 1,
    ),
  );
  check(
    "the one-time hidden-agent pause also pauses the unreadable routine",
    routines.pauseForAgentsHiddenBeforeWork([AGENT]).includes(futureRoutine.id),
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  database.close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const artifact = join(OUT, "report.json");
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${report.checks.length} checks: ${artifact}\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
