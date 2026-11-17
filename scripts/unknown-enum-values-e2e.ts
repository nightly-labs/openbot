// Checks that list reads of the real stores keep working when a stored row has an enum value that this
// version does not know, on a real SQLite database in a temporary profile. The script writes valid rows
// through the stores (and plain SQL where a store has no simple write), then writes future values with
// `PRAGMA ignore_check_constraints`: a CHECK constraint holds each column, so only a hand edit or a bug
// can store such a value today. Each list read must return the known rows and leave out the others;
// the future values must stay in the database unchanged; a single-row read keeps its strict decode;
// the database must open again. No app, provider, account or network is started.
//
// Run: bun scripts/unknown-enum-values-e2e.ts
// Writes .openbot-build/unknown-enum-values/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RoutineSchedule, WorkflowGraph } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { BrowserProxyStore } from "../src/backend/browser-profiles/browser-proxy-store";
import { CrmAgentView } from "../src/backend/crm/crm-agent-view";
import { CrmStore } from "../src/backend/crm/crm-store";
import { databaseRow, requiredNumberColumn } from "../src/backend/database/database-rows";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/unknown-enum-values");
const AGENT = "agent-unknown-values";
const NOW = new Date("2026-11-17T09:00:00.000Z");
const EVERY_15: RoutineSchedule = { kind: "interval", amount: 15, unit: "minutes", anchorAt: NOW.toISOString() };

interface Report {
  checks: string[];
  futureValues: { table: string; column: string; value: string }[];
  uncleanStart?: string;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], futureValues: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const directory = await mkdtemp(join(tmpdir(), "openbot-unknown-enum-values-"));
let database = new OpenBotDatabase(directory);
const sql = (text: string, ...values: (string | number | null)[]) => database.connection.prepare(text).run(...values);
const count = (text: string, ...values: (string | number)[]) => {
  const row = databaseRow(database.connection.prepare(text).get(...values));
  return row ? requiredNumberColumn(row, "n") : 0;
};
const id32 = (n: number) => n.toString(16).padStart(32, "0");

/** Writes a value that this version does not know, past the CHECK constraint, as a newer writer would. */
function future(table: string, column: string, futureValue: string, where: string, ...keys: (string | number)[]) {
  sql("PRAGMA ignore_check_constraints = ON");
  try {
    const changed = sql(`UPDATE ${table} SET ${column} = ? WHERE ${where}`, futureValue, ...keys).changes;
    assert.equal(Number(changed), 1, `${table}.${column}: one row changed`);
  } finally {
    sql("PRAGMA ignore_check_constraints = OFF");
  }
  report.futureValues.push({ table, column, value: futureValue });
}

/** Whether every future value is still in the database, unchanged by the reads. */
function futureValuesKept(): boolean {
  return report.futureValues.every(
    (entry) => count(`SELECT count(*) AS n FROM ${entry.table} WHERE ${entry.column} = ?`, entry.value) === 1,
  );
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

  // --- Workflows: runs (with a page cursor), steps, versions, triggers, GitHub deliveries ----------
  const workflows = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") });
  const runs = new WorkflowRunStore({ database });
  const github = new WorkflowGitHubStore({ database });
  const created = workflows.create({ title: "Future values" }, NOW);
  const workflowId = created.summary.id;
  const saved = workflows.saveGraph(workflowId, created.revision, graph, NOW);
  assert.ok(saved.ok, "the graph saves");
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
      new Date(NOW.getTime() + n * 60_000),
    ).run;
  const oldest = startRun(1);
  const middle = startRun(2);
  const newest = startRun(3);
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
  const knownStep = addStep(1);
  const futureStep = addStep(2);
  workflows.addRunVersion(workflowId, 2, graph, NOW);
  workflows.addRunVersion(workflowId, 3, graph, new Date(NOW.getTime() + 1000));
  const delivery = (n: number) =>
    github.addDelivery({
      workflowId,
      nodeId: "trigger",
      deliveryId: `delivery-${n}`,
      event: "issue.opened",
      item: null,
      receivedAt: new Date(NOW.getTime() + n * 1000).toISOString(),
      outcome: "started",
      reason: null,
      runId: null,
      payload: null,
      causedByBot: false,
    });
  delivery(1);
  delivery(2);
  const versionsBefore = workflows.versions(workflowId).length;
  const triggersBefore = workflows.detail(workflowId)?.triggers.length ?? 0;
  check("the seeded workflow has two triggers", triggersBefore === 2, triggersBefore);

  future("workflow_runs", "status", "paused-by-host", "run_id = ?", middle.id);
  future("workflow_steps", "kind", "video", "step_id = ?", futureStep.id);
  future("workflow_versions", "kind", "import", "rowid = (SELECT max(rowid) FROM workflow_versions)");
  future("workflow_triggers", "kind", "email", "workflow_id = ? AND node_id = ?", workflowId, "manual");
  future("workflow_github_deliveries", "outcome", "queued", "delivery_id = ?", "delivery-2");

  const first = runs.page(workflowId, undefined, 2);
  check(
    "a run page leaves out the run with a future status",
    first.runs.length === 1 && first.runs[0]?.run.id === newest.id,
    first.runs.map((entry) => entry.run.id),
  );
  check("the run page cursor goes on past the left-out run", first.nextBefore !== null);
  check(
    "a run keeps its known steps and leaves out the step with a future kind",
    first.runs[0]?.steps.map((step) => step.id).join() === knownStep.id,
  );
  const second = runs.page(workflowId, first.nextBefore ?? undefined, 2);
  check(
    "the next run page still reaches the oldest run",
    second.runs.length === 1 && second.runs[0]?.run.id === oldest.id,
    second.runs.map((entry) => entry.run.id),
  );
  check(
    "open runs leave out the future status",
    runs.openRuns().every((run) => run.id !== middle.id),
  );
  check(
    "steps leave out the future kind",
    runs
      .steps(newest.id)
      .map((step) => step.id)
      .join() === knownStep.id,
  );
  check(
    "open steps leave out the future kind",
    runs.openSteps().every((step) => step.id !== futureStep.id),
  );
  check("versions leave out the future kind", workflows.versions(workflowId).length === versionsBefore - 1);
  const triggersAfter = workflows.detail(workflowId)?.triggers ?? [];
  check(
    "the workflow detail loads and leaves out the future trigger kind",
    triggersAfter.length === 1 && triggersAfter[0]?.nodeId === "trigger",
    triggersAfter,
  );
  const history = github.history(workflowId);
  check(
    "GitHub history leaves out the future outcome",
    history.deliveries.map((entry) => entry.id).join() === "delivery-1",
  );
  check(
    "a single run read stays strict",
    (() => {
      try {
        runs.run(middle.id);
        return false;
      } catch {
        return true;
      }
    })(),
  );

  // --- Browser proxies -------------------------------------------------------------------------
  const proxies = new BrowserProxyStore(database);
  const knownProxy = proxies.create({ scheme: "http", host: "proxy.test", port: 8080, username: null, password: null });
  const futureProxy = proxies.create({
    scheme: "socks5",
    host: "future.test",
    port: 1080,
    username: null,
    password: null,
  });
  future("browser_proxies", "scheme", "socks6", "proxy_id = ?", futureProxy);
  check(
    "the proxy list leaves out the future scheme",
    proxies
      .list()
      .map((proxy) => proxy.id)
      .join() === knownProxy,
  );
  check(
    "a single proxy read stays strict, so the browser does not connect directly",
    (() => {
      try {
        proxies.get(futureProxy);
        return false;
      } catch {
        return true;
      }
    })(),
  );

  // --- Agent threads ---------------------------------------------------------------------------
  const threads = new AgentThreadStore(database);
  for (const thread of ["thread-known", "thread-future"]) {
    const at = NOW.toISOString();
    sql(
      `INSERT INTO projection_threads (thread_id, agent_id, title, created_at, updated_at, last_event_sequence)
       VALUES (?, ?, ?, ?, ?, 1)`,
      thread,
      AGENT,
      thread,
      at,
      at,
    );
    sql(
      `INSERT INTO projection_agent_threads (thread_id, agent_id, origin, title, title_source, created_at, updated_at,
        last_event_sequence) VALUES (?, ?, 'user', ?, 'auto', ?, ?, 1)`,
      thread,
      AGENT,
      thread,
      at,
      at,
    );
  }
  future("projection_agent_threads", "origin", "routine", "thread_id = ?", "thread-future");
  check(
    "the thread list leaves out the future origin",
    threads
      .list(AGENT)
      .map((thread) => thread.threadId)
      .join() === "thread-known",
  );
  check(
    "recent threads leave out the future origin",
    threads
      .recent(AGENT, null, 10)
      .map((thread) => thread.threadId)
      .join() === "thread-known",
  );

  // --- Routines --------------------------------------------------------------------------------
  const routines = new AgentRoutineStore(database);
  const routine = (name: string) =>
    routines.create(
      { agentId: AGENT, name, instruction: "Check the inbox.", active: true, timezone: "UTC", schedule: EVERY_15 },
      NOW,
    );
  const knownRoutine = routine("Known");
  const futureRoutine = routine("Future");
  future("projection_agent_routines", "limit_policy", "queue-forever", "routine_id = ?", futureRoutine.id);
  check(
    "the routine list leaves out the future limit policy",
    routines
      .list(AGENT)
      .map((entry) => entry.id)
      .join() === knownRoutine.id,
  );
  const knownRun = routines.createRun(knownRoutine, null, "test", NOW.toISOString());
  const futureRun = routines.createRun(knownRoutine, null, "test", new Date(NOW.getTime() + 1000).toISOString());
  future("projection_routine_runs", "status", "paused-by-host", "run_id = ?", futureRun.id);
  check(
    "the routine run list leaves out the future status",
    routines
      .listRuns(AGENT, knownRoutine.id)
      .map((run) => run.id)
      .join() === knownRun.id,
  );
  check(
    "pending routine runs load",
    routines.pendingRuns().every((run) => run.id !== futureRun.id),
  );

  // --- CRM -------------------------------------------------------------------------------------
  const crm = new CrmStore({ database, now: () => NOW });
  const at = NOW.toISOString();
  const customer = (n: number) =>
    sql(
      `INSERT INTO crm_customers (customer_id, number, name, status_id, currency, created_at, updated_at)
       VALUES (?, ?, ?, 'lead', 'USD', ?, ?)`,
      id32(n),
      n,
      `Customer ${n}`,
      at,
      at,
    );
  customer(1);
  customer(2);
  const plan = (n: number) =>
    sql(
      `INSERT INTO crm_plans (plan_id, customer_id, name, amount_minor, every, starts_on, created_at, updated_at)
       VALUES (?, ?, ?, 1000, 'month', '2026-11-01', ?, ?)`,
      id32(100 + n),
      id32(1),
      `Plan ${n}`,
      at,
      at,
    );
  plan(1);
  plan(2);
  const payment = (n: number) =>
    sql(
      `INSERT INTO crm_payments (payment_id, number, customer_id, label, amount_minor, due_on, method, created_at,
        updated_at) VALUES (?, ?, ?, ?, 1000, ?, 'cash', ?, ?)`,
      id32(200 + n),
      n,
      id32(1),
      `Invoice ${n}`,
      `2026-12-0${n}`,
      at,
      at,
    );
  payment(1);
  payment(2);
  const activity = (n: number) =>
    sql(
      `INSERT INTO crm_activity (activity_id, customer_id, actor_kind, kind, details_json, created_at)
       VALUES (?, ?, 'person', 'note', '{}', ?)`,
      id32(300 + n),
      id32(1),
      new Date(NOW.getTime() + n * 1000).toISOString(),
    );
  activity(1);
  activity(2);
  sql(
    `INSERT INTO crm_statuses (status_id, label, tone, position, created_at) VALUES (?, 'Trial', 'info-light', 3, ?)`,
    id32(400),
    at,
  );
  sql(
    `INSERT INTO crm_sources (source_id, kind, test_mode, key_hint, state, connected_at)
     VALUES (?, 'stripe', 1, 'abcd', 'ok', ?)`,
    id32(500),
    at,
  );
  sql("INSERT INTO crm_private_fields (field) VALUES ('notes'), ('phone')");
  sql("INSERT INTO crm_agent_access (agent_id, granted_at) VALUES (?, ?)", AGENT, at);
  const statusesBefore = crm.statuses().length;

  future("crm_customers", "method", "giftcard", "customer_id = ?", id32(2));
  future("crm_plans", "every", "fortnight", "plan_id = ?", id32(102));
  future("crm_payments", "method", "giftcard", "payment_id = ?", id32(202));
  future("crm_activity", "actor_kind", "bot", "activity_id = ?", id32(302));
  future("crm_statuses", "tone", "teal", "status_id = ?", id32(400));
  future("crm_sources", "state", "paused", "source_id = ?", id32(500));
  future("crm_private_fields", "field", "birthday", "field = ?", "phone");

  const customers = crm.customers({});
  check(
    "the customer list leaves out the future payment method",
    customers.customers.map((entry) => entry.id).join() === id32(1),
  );
  check(
    "a customer keeps its known plans and leaves out the future plan",
    customers.customers[0]?.plans.map((entry) => entry.id).join() === id32(101),
  );
  const open = crm.payments({ state: "open" });
  check("the payment list leaves out the future method", open.payments.map((entry) => entry.id).join() === id32(201));
  const activities = crm.activity({ customerId: id32(1) });
  check(
    "the activity list leaves out the future actor kind",
    activities.activity.map((entry) => entry.id).join() === id32(301),
  );
  check("the status list leaves out the future tone", crm.statuses().length === statusesBefore - 1);
  check("the source list leaves out the future state", crm.sources().length === 0);
  check("the private field list leaves out the future field", crm.privateFields().join() === "notes");
  const view = new CrmAgentView(crm);
  check("the agent customer search loads", view.find(AGENT, {}) !== null);
  check("the agent customer detail loads", view.customer(AGENT, id32(1)) !== null);
  check("the agent payment list loads", view.payments(AGENT, { state: "open" }) !== null);

  check("every future value stays in the database unchanged", futureValuesKept());

  // --- Start again -----------------------------------------------------------------------------
  // A clean stop of the app removes the write-ahead log. Bun keeps it after a close, so the script
  // leaves WAL mode first, which writes the log back to the file and removes it, as that stop does.
  database.connection.exec("PRAGMA journal_mode = DELETE");
  database.close();
  check("the clean stop left no write-ahead log", !existsSync(join(directory, "openbot.db-wal")));
  database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  check("the database opens again after a clean stop, with the future values", futureValuesKept());
  check(
    "lists load after the restart",
    new WorkflowRunStore({ database }).page(workflowId, undefined, 10).runs.length === 2 &&
      new AgentRoutineStore(database).list(AGENT).length === 1,
  );

  // Known limit, not changed here: after a migration or a stop that did not close the file, the start
  // runs `PRAGMA quick_check`, which also reports the rows that break a CHECK constraint.
  database.close();
  database = new OpenBotDatabase(directory);
  const unclean = await Effect.runPromise(Effect.result(database.initialize()));
  report.uncleanStart = Result.isFailure(unclean) ? "refused by quick_check" : "opened";
  check("an unclean start still runs quick_check, which refuses the CHECK violations", Result.isFailure(unclean));

  report.passed = true;
} catch (error) {
  // A database error keeps the original failure in `cause`.
  const causes: string[] = [];
  let current: unknown = error;
  while (current !== undefined && causes.length < 4) {
    causes.push(current instanceof Error ? current.message || current.name : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  report.failure = causes.join(" <- ");
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
