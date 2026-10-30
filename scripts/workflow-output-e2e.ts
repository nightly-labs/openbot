// Checks the output of workflows to a messaging place on the real SQLite and the real workflow service,
// on a temporary profile. The messaging connection is a row in the real table; only the post itself is
// a stand-in, so no platform, app, provider, account or network is started. An output with no place
// fails; an off connection fails; a post sends the workflow's name over the text; empty text posts
// nothing; each post failure ends the step with its sentence; a retry posts again; a stop during a post
// leaves it uncertain; after a restart a post that did not start is sent, and one that was on its way
// fails as uncertain.
//
// Run: bun scripts/workflow-output-e2e.ts
// Writes .openbot-build/workflow-output-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkflowGraph, WorkflowNode, WorkflowStep } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { MessagingPostFailure } from "../src/backend/messaging/messaging-threads";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-output-e2e");
const CONNECTION = "messaging-e2e";
const PLACE = "C0123";
const WAIT_MS = 5_000;

interface Report {
  checks: string[];
  posts: { connectionId: string; placeId: string; markdown: string }[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], posts: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

/** What the next post answers. `hang` never answers, so a stop or a restart cuts it off. */
let answer: "posted" | MessagingPostFailure | "hang" = "posted";
let postStarted = false;

const graphOf = (text: string, output: WorkflowNode["fields"]): WorkflowGraph => ({
  nodes: [
    { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text } },
    { id: "output", kind: "output", at: { x: 300, y: 0 }, fields: { target: "channel", ...output } },
  ],
  edges: [{ id: "edge", from: "prompt", to: "output", type: "text" }],
  strokes: [],
});
const toPlace = { connectionId: CONNECTION, placeId: PLACE };

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-output-"));
let database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

async function open() {
  await Effect.runPromise(database.initialize());
  const workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: (connectionId) =>
        database.connection
          .prepare("SELECT 1 FROM projection_messaging_connections WHERE connection_id = ? AND enabled = 1")
          .get(connectionId) !== undefined,
      post: (connectionId, placeId, markdown) =>
        Effect.suspend(() => {
          postStarted = true;
          report.posts.push({ connectionId, placeId, markdown });
          if (answer === "hang") return Effect.never;
          return Effect.succeed(answer === "posted" ? { posted: true as const } : { failure: answer });
        }),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  service = workflows;
  return workflows;
}

async function close() {
  if (service) await Effect.runPromise(service.close());
  service = null;
  database.close();
}

/** Waits for the output step of a run to reach a state; the post runs in a fiber of its own. */
async function outputStep(
  workflows: WorkflowsHandle,
  runId: string,
  until: (step: WorkflowStep) => boolean,
): Promise<WorkflowStep> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const steps = (await runCauseEffect(workflows.run(runId))).steps.filter((step) => step.nodeId === "output");
    const newest = steps.sort((a, b) => b.attempt - a.attempt)[0];
    if (newest && until(newest)) return newest;
    if (Date.now() > deadline) throw new Error(`The output step did not reach the state: ${JSON.stringify(newest)}`);
    await new Promise((done) => setImmediate(done));
  }
}
const ended = (step: WorkflowStep) => step.status !== "running";

/** Waits for a run to end; it ends in the pass after its last step. */
async function runEnd(workflows: WorkflowsHandle, runId: string): Promise<string> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const { status } = (await runCauseEffect(workflows.run(runId))).run;
    if (status !== "running" && status !== "stopping") return status;
    if (Date.now() > deadline) throw new Error(`The run did not end: ${status}`);
    await new Promise((done) => setImmediate(done));
  }
}
/** The kept post of a step, read as the service reads it. */
const deliveryOf = (stepId: string) => new WorkflowRunStore({ database }).output(stepId);

let requests = 0;
async function runOnce(workflows: WorkflowsHandle, workflowId: string) {
  return (await runCauseEffect(workflows.startRun({ workflowId, requestId: `request-${++requests}` }))).run;
}
async function workflowWith(workflows: WorkflowsHandle, title: string, graph: WorkflowGraph) {
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(saved.ok);
  return created.summary.id;
}

try {
  let workflows = await open();
  const now = new Date().toISOString();
  database.connection
    .prepare(
      `INSERT INTO projection_messaging_connections
         (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
       VALUES (?, 'slack', 'T0123', 'Acme', 1, ?, ?)`,
    )
    .run(CONNECTION, now, now);

  const noPlace = await workflowWith(workflows, "No place", graphOf("Hello", { connectionId: CONNECTION }));
  const noPlaceRun = await runOnce(workflows, noPlace);
  let step = await outputStep(workflows, noPlaceRun.id, ended);
  check(
    "an output with no place fails and posts nothing",
    step.status === "failed" &&
      step.error === sourceText("error.workflow.outputPlaceMissing") &&
      report.posts.length === 0,
    step,
  );
  const noPlaceDetail = await runCauseEffect(workflows.get(noPlace));
  await runCauseEffect(
    workflows.saveGraph({
      workflowId: noPlace,
      baseRevision: noPlaceDetail.revision,
      graph: graphOf("Hello", toPlace),
    }),
  );
  await runCauseEffect(workflows.retryStep({ stepId: step.id, requestId: `request-${++requests}` }));
  step = await outputStep(workflows, noPlaceRun.id, (candidate) => candidate.attempt === 2 && ended(candidate));
  check(
    "a retry uses the place chosen after the failure",
    step.status === "done" && report.posts.at(-1)?.placeId === PLACE && report.posts.length === 1,
    step,
  );

  const digest = await workflowWith(workflows, "Daily digest", graphOf("Three new competitors.", toPlace));
  let run = await runOnce(workflows, digest);
  step = await outputStep(workflows, run.id, ended);
  check(
    "a post ends the step as done with its input",
    step.status === "done" && step.output === "Three new competitors.",
    step,
  );
  check(
    "the place gets the workflow's name over the text",
    report.posts.at(-1)?.markdown === "**Daily digest**\n\nThree new competitors." &&
      report.posts.at(-1)?.connectionId === CONNECTION &&
      report.posts.at(-1)?.placeId === PLACE,
    report.posts.at(-1),
  );
  check("the post is kept as sent", deliveryOf(step.id)?.status === "sent");
  check("the run ends as done", (await runEnd(workflows, run.id)) === "done");

  const quiet = await workflowWith(workflows, "Quiet", graphOf("   ", toPlace));
  const postsBefore = report.posts.length;
  step = await outputStep(workflows, (await runOnce(workflows, quiet)).id, ended);
  check("empty text posts nothing", step.status === "done" && report.posts.length === postsBefore, step);

  for (const [failure, key, kept] of [
    ["not-running", "error.workflow.outputNotRunning", "failed"],
    ["refused", "error.workflow.outputRefused", "failed"],
    ["gone", "error.workflow.outputConnectionOff", "failed"],
    ["unknown", "error.workflow.outputUncertain", "uncertain"],
  ] as const) {
    answer = failure;
    step = await outputStep(workflows, (await runOnce(workflows, digest)).id, ended);
    const row = deliveryOf(step.id);
    check(
      `a ${failure} post fails the step with its sentence`,
      step.status === "failed" && step.error === sourceText(key) && row?.status === kept && row?.reason === failure,
      { step, row },
    );
  }

  answer = "not-running";
  run = await runOnce(workflows, digest);
  const failed = await outputStep(workflows, run.id, ended);
  answer = "posted";
  await runCauseEffect(workflows.retryStep({ stepId: failed.id, requestId: `request-${++requests}` }));
  step = await outputStep(workflows, run.id, (candidate) => candidate.attempt === 2 && ended(candidate));
  check(
    "a retry posts the same text again",
    step.status === "done" && report.posts.at(-1)?.markdown === "**Daily digest**\n\nThree new competitors.",
    step,
  );
  check("the run of a retried post ends as done", (await runEnd(workflows, run.id)) === "done");

  database.connection.prepare("UPDATE projection_messaging_connections SET enabled = 0").run();
  const postsOff = report.posts.length;
  step = await outputStep(workflows, (await runOnce(workflows, digest)).id, ended);
  check(
    "an off connection fails the step and posts nothing",
    step.status === "failed" &&
      step.error === sourceText("error.workflow.outputConnectionOff") &&
      report.posts.length === postsOff,
    step,
  );
  database.connection.prepare("UPDATE projection_messaging_connections SET enabled = 1").run();

  answer = "hang";
  postStarted = false;
  run = await runOnce(workflows, digest);
  step = await outputStep(workflows, run.id, () => postStarted);
  check("a post on its way keeps the step running", step.status === "running" && workflows.working());
  await runCauseEffect(workflows.stopStep(step.id));
  step = await outputStep(workflows, run.id, ended);
  check(
    "a stop during a post stops the step and keeps the post as uncertain",
    step.status === "stopped" && deliveryOf(step.id)?.status === "uncertain",
    { step, row: deliveryOf(step.id) },
  );
  check("nothing works after the stop", !workflows.working());

  // A restart during a post: the step stays running, and the first pass after it decides.
  postStarted = false;
  const cutRun = await runOnce(workflows, digest);
  const cut = await outputStep(workflows, cutRun.id, () => postStarted);
  const waitingRun = await runOnce(workflows, quiet);
  const waiting = await outputStep(workflows, waitingRun.id, ended);
  await close();
  database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  // The second run's output as if the restart came between its keep and its post, and the first as
  // if the process died during its post.
  database.connection
    .prepare("UPDATE workflow_steps SET status = 'running', ended_at = NULL, output = NULL WHERE step_id = ?")
    .run(waiting.id);
  database.connection
    .prepare("UPDATE workflow_runs SET status = 'running', ended_at = NULL WHERE run_id = ?")
    .run(waitingRun.id);
  database.connection
    .prepare(
      `INSERT INTO workflow_output_deliveries (step_id, connection_id, place_id, text, status, created_at, updated_at)
       VALUES (?, ?, ?, 'Kept before the restart.', 'pending', ?, ?)`,
    )
    .run(waiting.id, CONNECTION, PLACE, now, now);
  database.connection.prepare("UPDATE workflow_output_deliveries SET status = 'sending' WHERE step_id = ?").run(cut.id);
  database.close();
  database = new OpenBotDatabase(directory);
  answer = "posted";
  const postsRestart = report.posts.length;
  workflows = await open();
  await runCauseEffect(workflows.sweep());
  step = await outputStep(workflows, cutRun.id, ended);
  check(
    "after a restart a post that was on its way fails as uncertain and is not sent again",
    step.status === "failed" &&
      step.error === sourceText("error.workflow.outputUncertain") &&
      deliveryOf(step.id)?.status === "uncertain" &&
      !report.posts.slice(postsRestart).some((post) => post.markdown.includes("Three new competitors.")),
    { step, row: deliveryOf(step.id) },
  );
  step = await outputStep(workflows, waitingRun.id, ended);
  check(
    "after a restart a post that did not start is sent",
    step.status === "done" &&
      report.posts.slice(postsRestart).some((post) => post.markdown === "Kept before the restart."),
    { step, posts: report.posts.slice(postsRestart) },
  );
  check("both runs end", (await runEnd(workflows, cutRun.id)) === "failed");

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks; ${OUT}/report.json
`);
  if (report.failure)
    process.stderr.write(`${report.failure}
`);
  process.exitCode = report.passed ? 0 : 1;
}
