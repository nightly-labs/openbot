import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineFlowStore } from "../src/backend/routine-flows/routine-flow-store";
import { createRoutineFlows } from "../src/backend/routine-flows/routine-flows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-flow-sweep-e2e");
const QUARTER_HOUR_MS = 15 * 60 * 1000;
const SOLO_RUNS = 672;
const DONE_FLOW_RUNS = 160;
const OLD_FLOW_RUNS = 20_000;
const TIMED_SWEEPS = 20;
const INDEXES = ["routine_runs_status_updated", "routine_flow_steps_running", "routine_flow_steps_updated"];

interface Report {
  soloRuns: number;
  doneFlowRuns: number;
  oldFlowRuns: number;
  plans?: Record<string, string[]>;
  answerPlan?: string[];
  checks: string[];
  timing?: { sweeps: number; totalMs: number; perSweepMs: number };
  passed: boolean;
}

const report: Report = {
  soloRuns: SOLO_RUNS,
  doneFlowRuns: DONE_FLOW_RUNS,
  oldFlowRuns: OLD_FLOW_RUNS,
  checks: [],
  passed: false,
};

function seed(database: OpenBotDatabase): void {
  const db = database.connection;
  const now = Date.now();
  const at = (ms: number) => new Date(ms).toISOString();
  const weekAgo = at(now - 8 * 24 * 60 * 60 * 1000 - OLD_FLOW_RUNS * 4 * QUARTER_HOUR_MS);
  const routine = db.prepare(
    `INSERT INTO projection_agent_routines (routine_id, agent_id, name, instruction, active, timezone, created_at,
       updated_at, last_event_sequence) VALUES (?, ?, ?, 'Collect the news.', 1, 'UTC', ?, ?, 1)`,
  );
  routine.run("routine-solo", "solo", "Quarter-hour check", weekAgo, weekAgo);
  routine.run("routine-flow", "chief", "Hourly brief", weekAgo, weekAgo);
  db.prepare(
    `INSERT INTO routine_flow_links (link_id, routine_id, from_agent_id, to_agent_id, instruction, created_at)
     VALUES ('link-1', 'routine-flow', 'chief', 'editor', 'Shorten it.', ?)`,
  ).run(weekAgo);
  const run = db.prepare(
    `INSERT INTO projection_routine_runs (run_id, routine_id, agent_id, trigger_id, run_kind, scheduled_for,
       routine_name, instruction, delivery_id, status, error, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, ?, NULL, 'scheduled', ?, ?, 'Collect the news.', ?, 'succeeded', NULL, ?, ?, 2)`,
  );
  const step = db.prepare(
    `INSERT INTO routine_flow_steps (step_id, run_id, agent_id, delivery_id, input, output, status, error,
       created_at, updated_at) VALUES (?, ?, ?, ?, 'input', 'answer', 'succeeded', NULL, ?, ?)`,
  );
  db.exec("BEGIN");
  for (let index = 0; index < SOLO_RUNS; index += 1) {
    const time = at(now - index * QUARTER_HOUR_MS - 30_000);
    run.run(`solo-${index}`, "routine-solo", "solo", time, "Quarter-hour check", `solo-delivery-${index}`, time, time);
  }
  for (let index = 0; index < DONE_FLOW_RUNS; index += 1) {
    const time = at(now - (index + 1) * 4 * QUARTER_HOUR_MS);
    run.run(`done-${index}`, "routine-flow", "chief", time, "Hourly brief", `done-delivery-${index}`, time, time);
    step.run(`done-${index}-chief`, `done-${index}`, "chief", null, time, time);
    step.run(`done-${index}-editor`, `done-${index}`, "editor", `done-editor-${index}`, time, time);
  }
  for (let index = 0; index < OLD_FLOW_RUNS; index += 1) {
    const time = at(now - 8 * 24 * 60 * 60 * 1000 - index * 4 * QUARTER_HOUR_MS);
    run.run(`old-${index}`, "routine-flow", "chief", time, "Hourly brief", `old-delivery-${index}`, time, time);
    step.run(`old-${index}-chief`, `old-${index}`, "chief", null, time, time);
    step.run(`old-${index}-editor`, `old-${index}`, "editor", `old-editor-${index}`, time, time);
  }
  const recent = at(now - 60_000);
  run.run("pending", "routine-flow", "chief", recent, "Hourly brief", "pending-delivery", recent, recent);
  step.run("pending-chief", "pending", "chief", null, recent, recent);
  run.run("fresh", "routine-flow", "chief", recent, "Hourly brief", "fresh-delivery", recent, recent);
  db.exec("COMMIT");
}

async function sweepPlans(database: OpenBotDatabase, sweep: () => Promise<void>): Promise<Record<string, string[]>> {
  const connection = database.connection;
  const prepare = connection.prepare.bind(connection);
  const statements = new Set<string>();
  connection.prepare = (...args: Parameters<typeof prepare>) => {
    statements.add(args[0]);
    return prepare(...args);
  };
  try {
    await sweep();
  } finally {
    connection.prepare = prepare;
  }
  return Object.fromEntries(
    [...statements]
      .filter((sql) => /^\s*SELECT/i.test(sql))
      .map((sql) => [
        sql.replace(/\s+/g, " ").trim(),
        connection
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .all()
          .map((row) => String(row.detail)),
      ]),
  );
}

function checkTurnAnswerRead(database: OpenBotDatabase): string[] {
  const db = database.connection;
  const at = (second: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, second)).toISOString();
  db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at,
       last_event_sequence) VALUES ('chief-chat', 'chief', 'Chat', NULL, ?, ?, 1)`,
  ).run(at(0), at(0));
  const turn = db.prepare(
    `INSERT INTO projection_turns (turn_id, thread_id, provider_session_id, status, started_at, completed_at,
       last_event_sequence) VALUES (?, 'chief-chat', NULL, 'completed', ?, ?, 1)`,
  );
  const message = db.prepare(
    `INSERT INTO projection_thread_messages (thread_id, message_id, turn_id, author, status, item_type, created_at,
       ordinal, message_json, last_event_sequence) VALUES ('chief-chat', ?, ?, ?, 'completed', NULL, ?, ?, ?, 1)`,
  );
  const add = (id: string, turnId: string, author: string, second: number, ordinal: number) =>
    message.run(id, turnId, author, at(second), ordinal, JSON.stringify({ id, turnId, author, text: id }));
  db.exec("BEGIN");
  turn.run("chat-turn", at(1), at(1));
  turn.run("routine-turn", at(10), at(12));
  add("chat-question", "chat-turn", "user", 1, 0);
  add("chat-answer", "chat-turn", "assistant", 2, 1);
  add("routine-answer", "routine-turn", "assistant", 12, 4);
  add("routine-instruction", "routine-turn", "user", 10, 2);
  add("routine-progress", "routine-turn", "assistant", 11, 3);
  db.exec("COMMIT");

  const prepare = db.prepare.bind(db);
  const statements: string[] = [];
  db.prepare = (...args: Parameters<typeof prepare>) => {
    statements.push(args[0]);
    return prepare(...args);
  };
  let ids: string[];
  try {
    ids = database.readTurnAssistantMessages("chief", "routine-turn").map((read) => read.id);
  } finally {
    db.prepare = prepare;
  }
  assert.deepEqual(ids, ["routine-progress", "routine-answer"], "The read gives the turn's answers in chat order.");
  assert.deepEqual(database.readTurnAssistantMessages("editor", "routine-turn"), [], "Another agent reads nothing.");
  const [sql] = statements;
  assert.ok(sql, "The answer read prepares a statement.");
  const plan = prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all("routine-turn", "chief")
    .map((row) => String(row.detail));
  const messages = plan.find((line) => line.includes(" message "));
  assert.ok(
    messages?.startsWith("SEARCH message USING INDEX thread_messages_turn (thread_id=? AND turn_id=?)"),
    `The answer read finds the turn's messages by the turn index, not by reading the chat: ${plan.join("; ")}`,
  );
  return plan;
}

function count(database: OpenBotDatabase, sql: string): number {
  return Number(database.connection.prepare(sql).get()?.count);
}

const root = await mkdtemp(join(tmpdir(), "openbot-routine-flow-sweep-"));
const database = new OpenBotDatabase(join(root, "profile"));
try {
  await runCauseEffect(database.initialize());
  const indexes = database.connection
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${INDEXES.map(() => "?").join(", ")})`)
    .all(...INDEXES)
    .map((row) => String(row.name))
    .sort();
  assert.deepEqual(indexes, [...INDEXES].sort());
  report.checks.push(`indexes: ${indexes.join(", ")}`);
  seed(database);

  const handoffs: { runId: string; agentId: string }[] = [];
  const flows = await Effect.runPromise(
    createRoutineFlows({
      store: new RoutineFlowStore({ database }),
      routines: { list: () => [], get: () => null, listRuns: () => [] },
      delivery: (deliveryId) =>
        deliveryId.startsWith("handoff-")
          ? { status: "queued", turnId: null, error: null }
          : { status: "completed", turnId: `turn-${deliveryId}`, error: null },
      turnAnswer: () => "answer",
      agentName: (agentId) => agentId,
      sendHandoff: (input) => {
        handoffs.push({ runId: input.run.id, agentId: input.agentId });
        return Effect.succeed(`handoff-${input.run.id}`);
      },
      stopRoutineRun: () => Effect.void,
      stopDelivery: () => Effect.void,
      changed: () => {},
    }),
  );
  try {
    await Effect.runPromise(flows.sweep());
    assert.equal(
      count(
        database,
        "SELECT COUNT(*) AS count FROM routine_flow_steps WHERE run_id LIKE 'solo-%' AND agent_id = 'solo'",
      ),
      SOLO_RUNS,
      "Each ended run of a routine without a flow gets its own agent's step: the canvas shows that answer.",
    );
    report.checks.push(`owner steps: ${SOLO_RUNS} runs of a routine without a flow`);
    assert.deepEqual(
      handoffs.sort((left, right) => left.runId.localeCompare(right.runId)),
      [
        { runId: "fresh", agentId: "editor" },
        { runId: "pending", agentId: "editor" },
      ],
      "The sweep sends the handoff of a new answer and the one a restart left, and no other.",
    );
    report.checks.push("handoffs: the new answer's and the one a restart left, once each");

    const plans = await sweepPlans(database, () => Effect.runPromise(flows.sweep()));
    report.plans = plans;
    const scans = Object.entries(plans).filter(([, plan]) =>
      plan.some((line) => line.startsWith("SCAN") && !line.includes("USING INDEX routine_flow_steps_running")),
    );
    assert.deepEqual(scans, [], "No query of a sweep reads every row of a table.");
    report.checks.push(`query plans: ${Object.keys(plans).length} sweep queries, each reads by an index`);

    const steps = count(database, "SELECT COUNT(*) AS count FROM routine_flow_steps");
    const started = performance.now();
    for (let index = 0; index < TIMED_SWEEPS; index += 1) await Effect.runPromise(flows.sweep());
    const totalMs = performance.now() - started;
    assert.equal(handoffs.length, 2, "A sweep with nothing to do sends nothing.");
    assert.equal(count(database, "SELECT COUNT(*) AS count FROM routine_flow_steps"), steps);
    report.checks.push(`later sweeps: no handoff and no step in ${TIMED_SWEEPS} sweeps`);
    report.timing = {
      sweeps: TIMED_SWEEPS,
      totalMs: Math.round(totalMs),
      perSweepMs: Number((totalMs / TIMED_SWEEPS).toFixed(2)),
    };
    report.answerPlan = checkTurnAnswerRead(database);
    report.checks.push("answer read: the turn's answers in chat order, by the turn index");
    report.passed = true;
  } finally {
    await Effect.runPromise(flows.close());
  }
} finally {
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}: ${report.checks.length} checks, ${report.timing?.perSweepMs} ms per sweep. ` +
    `Report: ${join(OUT, "report.json")}\n`,
);
if (!report.passed) process.exitCode = 1;
