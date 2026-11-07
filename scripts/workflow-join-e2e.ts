// Checks a workflow join on the real SQLite and the real workflow service, on a temporary profile
// (#5553). Three branches go into an approval and into an output: two prompts, and a model step that
// fails once. The approval and the output start only when all three branches end. The approval keeps
// the place of the failed branch with its error; the output posts only the answers. A retry runs the
// failed branch again and not the others, and the join runs again with all three answers. The run
// keeps its steps over a restart. Approvals need no provider, and the model step is a fake, so no
// model, agent, account or network is started.
//
// Run: bun scripts/workflow-join-e2e.ts
// Writes .openbot-build/workflow-join-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkflowGraph, WorkflowStep } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-join-e2e");
const WAIT_MS = 5_000;
const BOARD_ERROR = "The job board did not answer.";

interface Report {
  checks: string[];
  inputs: Record<string, string | undefined>;
  outputs: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], inputs: {}, outputs: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const GRAPH: WorkflowGraph = {
  nodes: [
    { id: "a", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Board A: 3 jobs" } },
    { id: "b", kind: "llm", at: { x: 0, y: 200 }, fields: { prompt: "Search board B" } },
    { id: "c", kind: "prompt", at: { x: 0, y: 400 }, fields: { text: "Board C: 1 job" } },
    { id: "join", kind: "approval", at: { x: 300, y: 200 }, fields: { question: "Screen these jobs?" } },
    { id: "post", kind: "output", at: { x: 300, y: 600 }, fields: { target: "notify" } },
  ],
  edges: [
    { id: "a>join", from: "a", to: "join", type: "text" },
    { id: "b>join", from: "b", to: "join", type: "text" },
    { id: "c>join", from: "c", to: "join", type: "text" },
    { id: "a>post", from: "a", to: "post", type: "text" },
    { id: "b>post", from: "b", to: "post", type: "text" },
    { id: "c>post", from: "c", to: "post", type: "text" },
  ],
  strokes: [],
};

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-join-"));
let database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;
let generations = 0;

async function open() {
  database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  const workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      // The first search fails, as a board that does not answer; the next one answers.
      generateText: () =>
        ++generations === 1 ? Effect.fail({ message: BOARD_ERROR }) : Effect.succeed("Board B: 2 jobs"),
      notify: (notice) => {
        if (notice.kind === "output") report.outputs.push(notice.text);
      },
      connectionOn: () => false,
      post: () => Effect.die(new Error("No post runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  service = workflows;
  return workflows;
}

async function close() {
  if (service) await Effect.runPromise(service.close()).catch(() => {});
  service = null;
  database.close();
}

/** Waits until the run has a step that waits for a decision. */
async function waiting(workflows: WorkflowsHandle, runId: string): Promise<WorkflowStep> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const step = (await runCauseEffect(workflows.run(runId))).steps.find((each) => each.status === "approval");
    if (step) return step;
    if (Date.now() > deadline) throw new Error("No step waits for a decision.");
    await new Promise((done) => setImmediate(done));
  }
}

/** Waits until the run is no longer open. */
async function ended(workflows: WorkflowsHandle, runId: string): Promise<string> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const status = (await runCauseEffect(workflows.run(runId))).run.status;
    if (status !== "running" && status !== "approval" && status !== "stopping") return status;
    if (Date.now() > deadline) throw new Error(`The run is still ${status}.`);
    await new Promise((done) => setImmediate(done));
  }
}

/** The input of a step, as the store keeps it; the public step does not show it. */
const inputOf = (step: WorkflowStep) => new WorkflowRunStore({ database }).step(step.id)?.input;
const attempts = async (workflows: WorkflowsHandle, runId: string) =>
  (await runCauseEffect(workflows.run(runId))).steps.map((each) => `${each.nodeId}:${each.attempt}:${each.status}`);

try {
  let workflows = await open();
  const created = await runCauseEffect(workflows.create({ title: "Job search" }));
  const workflowId = created.summary.id;
  const saved = await runCauseEffect(workflows.saveGraph({ workflowId, baseRevision: created.revision, graph: GRAPH }));
  check("a graph with two joins saves", saved.ok, saved);

  const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "join-1" }))).run;
  let step = await waiting(workflows, run.id);
  const steps = (await runCauseEffect(workflows.run(run.id))).steps;
  const failed = steps.find((each) => each.nodeId === "b");
  check(
    "the join starts only after every branch ends",
    step.nodeId === "join" && failed?.status === "failed" && failed.error === BOARD_ERROR,
    await attempts(workflows, run.id),
  );
  report.inputs.firstJoin = inputOf(step);
  check(
    "the join keeps the place of the failed branch, with its error",
    inputOf(step) ===
      `Input 1:\n\nBoard A: 3 jobs\n\nInput 2:\n\nNo answer: this step failed. Error: ${BOARD_ERROR}\n\nInput 3:\n\nBoard C: 1 job`,
    inputOf(step),
  );
  check(
    "an output after the branches posts only the answers",
    report.outputs.length === 1 && report.outputs[0] === "Input 1:\n\nBoard A: 3 jobs\n\nInput 2:\n\nBoard C: 1 job",
    report.outputs,
  );

  await runCauseEffect(workflows.decide({ stepId: step.id, approved: true }));
  check("a run with a failed branch ends as failed", (await ended(workflows, run.id)) === "failed");

  if (!failed) throw new Error("The failed branch has no step.");
  await runCauseEffect(workflows.retryStep({ stepId: failed.id, requestId: "join-retry-1" }));
  step = await waiting(workflows, run.id);
  report.inputs.secondJoin = inputOf(step);
  check(
    "after a retry, the join runs again with every answer",
    step.nodeId === "join" &&
      step.attempt === 2 &&
      inputOf(step) === "Input 1:\n\nBoard A: 3 jobs\n\nInput 2:\n\nBoard B: 2 jobs\n\nInput 3:\n\nBoard C: 1 job",
    inputOf(step),
  );
  const retried = await attempts(workflows, run.id);
  check(
    "a retry runs only the failed branch and the steps after it",
    ["a:1:done", "c:1:done", "b:1:failed", "b:2:done", "join:2:approval", "post:2:done"].every((each) =>
      retried.includes(each),
    ) && !retried.some((each) => each.startsWith("a:2") || each.startsWith("c:2")),
    retried,
  );

  await close();
  workflows = await open();
  const kept = await attempts(workflows, run.id);
  check("a restart keeps the steps of every branch", kept.join() === retried.join(), { kept, retried });
  step = await waiting(workflows, run.id);
  check("after a restart, the join still waits for its decision", step.nodeId === "join" && step.attempt === 2, step);
  await runCauseEffect(workflows.decide({ stepId: step.id, approved: true }));
  check("the run ends as done", (await ended(workflows, run.id)) === "done");
  check("no branch runs again after the restart", generations === 2, generations);

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await close();
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks; ${OUT}/report.json\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
