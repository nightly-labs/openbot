import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RoutineSchedule, WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { WorkflowTriggers, workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-schedule-e2e");
const ZONE = "UTC";
const START = "2026-10-24T09:00:00.000Z";
const EVERY_15: RoutineSchedule = { kind: "interval", amount: 15, unit: "minutes", anchorAt: START };

interface Report {
  checks: string[];
  triggerOutputs?: string[];
  modelPrompt?: string;
  runs?: { workflow: string; number: number; source: string; scheduledFor: string | null; status: string }[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const trigger = (schedule: RoutineSchedule | undefined): WorkflowNode => ({
  id: "trigger",
  kind: "trigger",
  at: { x: 0, y: 0 },
  fields: { trigger: "schedule" },
  ...(schedule ? { schedule } : {}),
});
const modelPrompts: string[] = [];
const changeListeners = new Set<() => void>();
const nextChange = () =>
  new Promise<void>((resolve) => {
    const listener = () => {
      changeListeners.delete(listener);
      resolve();
    };
    changeListeners.add(listener);
  });
async function until(test: () => Promise<boolean>, what: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const change = nextChange();
    if (await test()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([change, new Promise((resolve) => (timer = setTimeout(resolve, deadline - Date.now())))]);
    clearTimeout(timer);
  }
  assert.fail(`timed out: ${what}`);
}
const modelGraph = (schedule: RoutineSchedule, timezone: string): WorkflowGraph => ({
  nodes: [
    { ...trigger(schedule), fields: { trigger: "schedule", timezone } },
    { id: "model", kind: "llm", at: { x: 300, y: 0 }, fields: { prompt: "Summarize the last 24 hours." } },
  ],
  edges: [{ id: "edge", from: "trigger", to: "model", type: "text" }],
  strokes: [],
});
const graphOf = (schedule: RoutineSchedule | undefined, step: "notify" | "approval"): WorkflowGraph => ({
  nodes: [
    trigger(schedule),
    step === "notify"
      ? { id: "step", kind: "output", at: { x: 300, y: 0 }, fields: { target: "notify" } }
      : { id: "step", kind: "approval", at: { x: 300, y: 0 }, fields: { question: "Go on?" } },
  ],
  edges: [{ id: "edge", from: "trigger", to: "step", type: "text" }],
  strokes: [],
});

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-schedule-"));
let clock = new Date(START);
let database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

async function open() {
  await Effect.runPromise(database.initialize());
  const store = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => ZONE) });
  const workflows = await Effect.runPromise(
    createWorkflows({
      store,
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: (request) =>
        Effect.sync(() => {
          modelPrompts.push(request.prompt);
          return "Summary.";
        }),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No output posts in this test.")),
      changed: () => {
        for (const listener of [...changeListeners]) listener();
      },
      rearm: () => {},
      timezone: () => ZONE,
      now: () => clock,
    }),
  );
  service = workflows;
  const triggers = new WorkflowTriggers({
    store,
    timezone: () => ZONE,
    start: (start) => workflows.startScheduled(start),
    changed: () => {},
  });
  const timer = new RoutineTimer(
    () => [triggers],
    () => true,
    () => {},
  );
  const fire = () => runCauseEffect(triggers.processDue(clock, () => true));
  const nextDueAt = async (workflowId: string) =>
    (await runCauseEffect(workflows.get(workflowId))).triggers.find((entry) => entry.nodeId === "trigger")?.nextDueAt ??
    null;
  const runsOf = async (workflowId: string) => {
    const occurrence = database.connection.prepare("SELECT scheduled_for FROM workflow_runs WHERE run_id = ?");
    return (await runCauseEffect(workflows.runs({ workflowId, limit: 50 }))).runs.map(({ run }) => {
      const row = occurrence.get(run.id);
      const scheduledFor = row && typeof row.scheduled_for === "string" ? row.scheduled_for : null;
      return { ...run, scheduledFor };
    });
  };
  const triggerOutput = async (runId: string) =>
    (await runCauseEffect(workflows.run(runId))).steps.find((step) => step.nodeId === "trigger")?.output ?? null;
  return { workflows, timer, fire, nextDueAt, runsOf, triggerOutput };
}

async function close() {
  if (service) await Effect.runPromise(service.close());
  service = null;
  database.close();
}

try {
  let app = await open();
  const quarter = await runCauseEffect(app.workflows.create({ title: "Every quarter hour" }));
  const quarterId = quarter.summary.id;
  const saved = await runCauseEffect(
    app.workflows.saveGraph({
      workflowId: quarterId,
      baseRevision: quarter.revision,
      graph: graphOf(EVERY_15, "notify"),
    }),
  );
  assert.ok(saved.ok);
  check("save plans the next occurrence", (await app.nextDueAt(quarterId)) === "2026-10-24T09:15:00.000Z");
  check("the timer wakes at that occurrence", app.timer.nextDueAt() === "2026-10-24T09:15:00.000Z");

  clock = new Date("2026-10-24T09:14:59.000Z");
  await app.fire();
  check("nothing starts before the occurrence", (await app.runsOf(quarterId)).length === 0);

  clock = new Date("2026-10-24T09:15:01.000Z");
  await app.fire();
  await app.fire();
  let runs = await app.runsOf(quarterId);
  check("a due occurrence starts one run, also when the timer fires twice", runs.length === 1, runs.length);
  check(
    "the run is a schedule run of that occurrence",
    runs[0]?.source === "schedule" && runs[0].scheduledFor === "2026-10-24T09:15:00.000Z",
    runs[0],
  );
  await runCauseEffect(app.workflows.sweep());
  runs = await app.runsOf(quarterId);
  check("the run ends", runs[0]?.status === "done", runs[0]?.status);
  const quarterOutput = runs[0] ? await app.triggerOutput(runs[0].id) : null;
  check(
    "the schedule trigger gives the time of its occurrence to the next step",
    quarterOutput?.startsWith(
      "Run time: 2026-10-24T09:15:00.000Z\nLocal time of this run: Saturday, 2026-10-24 09:15 in UTC (GMT",
    ) === true,
    quarterOutput,
  );
  check("the trigger moves to the next occurrence", (await app.nextDueAt(quarterId)) === "2026-10-24T09:30:00.000Z");

  clock = new Date("2026-10-24T10:20:00.000Z");
  await app.fire();
  runs = await app.runsOf(quarterId);
  check("missed occurrences become one run", runs.length === 2, runs.length);
  check("that run is the last missed occurrence", runs[0]?.scheduledFor === "2026-10-24T10:15:00.000Z", runs[0]);
  check("the next occurrence is in the future", (await app.nextDueAt(quarterId)) === "2026-10-24T10:30:00.000Z");

  const unchanged = await runCauseEffect(app.workflows.get(quarterId));
  const moved = { ...graphOf(EVERY_15, "notify") };
  moved.nodes = moved.nodes.map((node) => (node.id === "step" ? { ...node, at: { x: 500, y: 40 } } : node));
  assert.ok(
    (
      await runCauseEffect(
        app.workflows.saveGraph({ workflowId: quarterId, baseRevision: unchanged.revision, graph: moved }),
      )
    ).ok,
  );
  check(
    "a save that keeps the schedule keeps the plan",
    (await app.nextDueAt(quarterId)) === "2026-10-24T10:30:00.000Z",
  );

  const hourly: RoutineSchedule = { kind: "hourly", minute: 5 };
  const before = await runCauseEffect(app.workflows.get(quarterId));
  assert.ok(
    (
      await runCauseEffect(
        app.workflows.saveGraph({
          workflowId: quarterId,
          baseRevision: before.revision,
          graph: graphOf(hourly, "notify"),
        }),
      )
    ).ok,
  );
  check(
    "a save that changes the schedule plans it again",
    (await app.nextDueAt(quarterId)) === "2026-10-24T11:05:00.000Z",
  );

  const tooOften: RoutineSchedule = { kind: "interval", amount: 1, unit: "minutes", anchorAt: START };
  const latest = await runCauseEffect(app.workflows.get(quarterId));
  const refused = await runCauseEffect(
    app.workflows.saveGraph({
      workflowId: quarterId,
      baseRevision: latest.revision,
      graph: graphOf(tooOften, "notify"),
    }),
  ).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  check("a schedule that is too frequent is refused", refused !== null && refused.length > 0, refused);
  check("the refused save keeps the plan", (await app.nextDueAt(quarterId)) === "2026-10-24T11:05:00.000Z");

  const gated = await runCauseEffect(app.workflows.create({ title: "Waits for a person" }));
  assert.ok(
    (
      await runCauseEffect(
        app.workflows.saveGraph({
          workflowId: gated.summary.id,
          baseRevision: gated.revision,
          graph: graphOf(EVERY_15, "approval"),
        }),
      )
    ).ok,
  );
  check("the second workflow is planned", (await app.nextDueAt(gated.summary.id)) === "2026-10-24T10:30:00.000Z");
  clock = new Date("2026-10-24T10:30:00.000Z");
  await app.fire();
  await runCauseEffect(app.workflows.sweep());
  let gatedRuns = await app.runsOf(gated.summary.id);
  check(
    "its first occurrence starts a run that waits",
    gatedRuns.length === 1 && gatedRuns[0]?.status === "approval",
    gatedRuns,
  );
  clock = new Date("2026-10-24T10:45:00.000Z");
  await app.fire();
  gatedRuns = await app.runsOf(gated.summary.id);
  check("an occurrence while the run waits starts nothing", gatedRuns.length === 1, gatedRuns.length);
  check(
    "the waiting occurrence keeps its plan",
    (await app.nextDueAt(gated.summary.id)) === "2026-10-24T10:45:00.000Z",
  );
  check(
    "the timer does not wake for a workflow that runs",
    app.timer.nextDueAt() === "2026-10-24T11:05:00.000Z",
    app.timer.nextDueAt(),
  );
  const approveNewest = async () => {
    const newest = (await app.runsOf(gated.summary.id))[0];
    assert.ok(newest, "the gated workflow has a run");
    const { steps } = await runCauseEffect(app.workflows.run(newest.id));
    const waiting = steps.find((step) => step.status === "approval");
    assert.ok(waiting, "the run waits for a decision");
    await runCauseEffect(app.workflows.decide({ stepId: waiting.id, approved: true }));
  };
  clock = new Date("2026-10-24T10:50:00.000Z");
  await approveNewest();
  gatedRuns = await app.runsOf(gated.summary.id);
  check("the approved run ends", gatedRuns[0]?.status === "done", gatedRuns[0]);
  await app.fire();
  gatedRuns = await app.runsOf(gated.summary.id);
  check(
    "the occurrence that waited starts when the run ends",
    gatedRuns.length === 2 && gatedRuns[0]?.scheduledFor === "2026-10-24T10:45:00.000Z",
    gatedRuns,
  );
  check(
    "then the plan moves to the next occurrence",
    (await app.nextDueAt(gated.summary.id)) === "2026-10-24T11:00:00.000Z",
  );
  await approveNewest();

  const once = await runCauseEffect(app.workflows.create({ title: "Once" }));
  const onceSchedule: RoutineSchedule = { kind: "once", date: "2026-10-24", time: "12:00" };
  assert.ok(
    (
      await runCauseEffect(
        app.workflows.saveGraph({
          workflowId: once.summary.id,
          baseRevision: once.revision,
          graph: graphOf(onceSchedule, "notify"),
        }),
      )
    ).ok,
  );
  check("a one-time schedule is planned", (await app.nextDueAt(once.summary.id)) === "2026-10-24T12:00:00.000Z");

  await close();
  database = new OpenBotDatabase(directory);
  app = await open();
  check("a restart keeps the plans", (await app.nextDueAt(once.summary.id)) === "2026-10-24T12:00:00.000Z");
  check("a restart keeps the earliest wake", app.timer.nextDueAt() === "2026-10-24T11:00:00.000Z");

  clock = new Date("2026-10-24T12:00:30.000Z");
  await app.fire();
  const onceRuns = await app.runsOf(once.summary.id);
  check(
    "the one-time occurrence starts one run",
    onceRuns.length === 1 && onceRuns[0]?.scheduledFor === "2026-10-24T12:00:00.000Z",
    onceRuns,
  );
  check("a one-time schedule ends after its run", (await app.nextDueAt(once.summary.id)) === null);

  const model = await runCauseEffect(app.workflows.create({ title: "Daily summary" }));
  const modelSchedule: RoutineSchedule = { kind: "once", date: "2026-10-24", time: "14:30" };
  assert.ok(
    (
      await runCauseEffect(
        app.workflows.saveGraph({
          workflowId: model.summary.id,
          baseRevision: model.revision,
          graph: modelGraph(modelSchedule, "Europe/Warsaw"),
        }),
      )
    ).ok,
  );
  check(
    "a schedule in the trigger's time zone is planned",
    (await app.nextDueAt(model.summary.id)) === "2026-10-24T12:30:00.000Z",
  );
  clock = new Date("2026-10-24T12:30:00.000Z");
  await app.fire();
  await until(async () => (await app.runsOf(model.summary.id))[0]?.status === "done", "the model step run ends");
  const modelRuns = await app.runsOf(model.summary.id);
  check("the model step run ends", modelRuns.length === 1 && modelRuns[0]?.status === "done", modelRuns);
  const prompt = modelPrompts.at(-1) ?? "";
  report.modelPrompt = prompt;
  check(
    "the model step reads the run time in the trigger's time zone",
    modelPrompts.length === 1 &&
      prompt.includes("Run time: 2026-10-24T12:30:00.000Z") &&
      prompt.includes("Local time of this run: Saturday, 2026-10-24 14:30 in Europe/Warsaw (GMT+02:00)."),
    prompt,
  );

  const manual = await runCauseEffect(app.workflows.startRun({ workflowId: once.summary.id, requestId: "manual-1" }));
  const manualOutput = await app.triggerOutput(manual.run.id);
  check(
    "a manual run of a schedule trigger gives the time it started",
    manualOutput?.startsWith(`Run time: ${manual.run.startedAt}\n`) === true,
    manualOutput,
  );
  report.triggerOutputs = [quarterOutput ?? "", manualOutput ?? ""];

  report.runs = [];
  for (const [workflow, id] of [
    ["quarter", quarterId],
    ["gated", gated.summary.id],
    ["once", once.summary.id],
  ] as const) {
    for (const run of await app.runsOf(id))
      report.runs.push({
        workflow,
        number: run.number,
        source: run.source,
        scheduledFor: run.scheduledFor,
        status: run.status,
      });
  }
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    await close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });
  const artifact = join(OUT, "report.json");
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${artifact}\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
