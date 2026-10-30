// Checks workflow loops on the real SQLite and the real workflow service, on a temporary profile. The
// graph is a prompt, two approvals and an output, with a connection from the second approval back to
// the first. Approvals need no provider, so no model, agent, account or network is started. A save
// keeps the loop; each approval of the second step starts the next pass with its answer as one more
// input, and the output runs once for each pass; a rejection ends the loop and stops the run. A run
// from a node inside the loop starts at that node and takes the earlier answer of the node before it.
//
// Run: bun scripts/workflow-loop-e2e.ts
// Writes .openbot-build/workflow-loop-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type WorkflowGraph, type WorkflowStep, workflowLoopEdges } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-loop-e2e");
const WAIT_MS = 5_000;

interface Report {
  checks: string[];
  outputs: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], outputs: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const GRAPH: WorkflowGraph = {
  nodes: [
    { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Draft" } },
    { id: "review", kind: "approval", at: { x: 300, y: 0 }, fields: { question: "Review?" } },
    { id: "check", kind: "approval", at: { x: 600, y: 0 }, fields: { question: "Again?" } },
    { id: "output", kind: "output", at: { x: 900, y: 0 }, fields: { target: "notify" } },
  ],
  edges: [
    { id: "prompt>review", from: "prompt", to: "review", type: "text" },
    { id: "review>check", from: "review", to: "check", type: "text" },
    { id: "check>output", from: "check", to: "output", type: "text" },
    { id: "check>review", from: "check", to: "review", type: "text" },
  ],
  strokes: [],
};

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-loop-"));
const database = new OpenBotDatabase(directory);
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

/** Waits until the run has a step that waits for a decision, and gives it. */
async function waiting(workflows: WorkflowsHandle, runId: string): Promise<WorkflowStep> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const step = (await runCauseEffect(workflows.run(runId))).steps.find((each) => each.status === "approval");
    if (step) return step;
    if (Date.now() > deadline) throw new Error("No step waits for a decision.");
    await new Promise((done) => setImmediate(done));
  }
}
/** The input of a step, as the store keeps it; the public step does not show it. */
const inputOf = (step: WorkflowStep) => new WorkflowRunStore({ database }).step(step.id)?.input;
const runStatus = async (workflows: WorkflowsHandle, runId: string) =>
  (await runCauseEffect(workflows.run(runId))).run.status;

try {
  const workflows = await open();
  check(
    "the graph has one loop: the connection back",
    [...workflowLoopEdges(GRAPH.nodes, GRAPH.edges)].join() === "check>review",
  );

  const created = await runCauseEffect(workflows.create({ title: "Review loop" }));
  const workflowId = created.summary.id;
  const saved = await runCauseEffect(workflows.saveGraph({ workflowId, baseRevision: created.revision, graph: GRAPH }));
  check("a graph with a loop saves", saved.ok, saved);
  const detail = await runCauseEffect(workflows.get(workflowId));
  check(
    "the saved graph keeps the loop",
    detail.graph.edges.some((edge) => edge.id === "check>review"),
  );

  const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "loop-1" }))).run;
  let step = await waiting(workflows, run.id);
  check(
    "pass 1 waits at the first approval",
    step.nodeId === "review" && step.attempt === 1 && inputOf(step) === "Draft",
    step,
  );
  check("the run waits for a decision", (await runStatus(workflows, run.id)) === "approval");

  await runCauseEffect(workflows.decide({ stepId: step.id, approved: true }));
  step = await waiting(workflows, run.id);
  check("pass 1 goes on to the second approval", step.nodeId === "check" && step.attempt === 1, step);

  await runCauseEffect(workflows.decide({ stepId: step.id, approved: true }));
  step = await waiting(workflows, run.id);
  check(
    "the loop starts pass 2 at the first approval, with the loop's answer as one more input",
    step.nodeId === "review" && step.attempt === 2 && inputOf(step) === "Input 1:\n\nDraft\n\nInput 2:\n\nDraft",
    step,
  );
  check("the output runs after pass 1", report.outputs.length === 1, report.outputs);

  await runCauseEffect(workflows.decide({ stepId: step.id, approved: true }));
  step = await waiting(workflows, run.id);
  check("pass 2 goes on to the second approval", step.nodeId === "check" && step.attempt === 2, step);
  check("the output does not run before the pass ends", report.outputs.length === 1, report.outputs);

  await runCauseEffect(workflows.decide({ stepId: step.id, approved: true }));
  step = await waiting(workflows, run.id);
  check("pass 3 starts", step.nodeId === "review" && step.attempt === 3, step);
  check("the output runs after pass 2", report.outputs.length === 2, report.outputs);

  await runCauseEffect(workflows.decide({ stepId: step.id, approved: false }));
  check("a rejection ends the loop and stops the run", (await runStatus(workflows, run.id)) === "stopped");
  const steps = (await runCauseEffect(workflows.run(run.id))).steps;
  check(
    "each pass is the next attempt of its node",
    steps.filter((each) => each.nodeId === "review").length === 3 &&
      steps.filter((each) => each.nodeId === "check").length === 2 &&
      steps.filter((each) => each.nodeId === "prompt").length === 1,
    steps.map((each) => `${each.nodeId}:${each.attempt}:${each.status}`),
  );

  const from = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "loop-2", fromNodeId: "check" }))).run;
  step = await waiting(workflows, from.id);
  const reused = (await runCauseEffect(workflows.run(from.id))).steps.find((each) => each.nodeId === "review");
  check(
    "a run from a node in the loop starts at that node with the earlier answer before it",
    step.nodeId === "check" && step.attempt === 1 && reused?.status === "done" && reused.attempt === 1,
    { step, reused },
  );
  const checked = step;
  await runCauseEffect(workflows.decide({ stepId: checked.id, approved: true }));
  step = await waiting(workflows, from.id);
  const answer = (await runCauseEffect(workflows.run(from.id))).steps.find((each) => each.id === checked.id)?.output;
  check(
    "its loop goes back to the node before it, with only the loop's answer",
    step.nodeId === "review" && step.attempt === 2 && answer !== undefined && inputOf(step) === answer?.trim(),
    { step, answer, input: inputOf(step) },
  );
  await runCauseEffect(workflows.stopRun(from.id));
  check("a stop ends the loop", (await runStatus(workflows, from.id)) === "stopped");

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
