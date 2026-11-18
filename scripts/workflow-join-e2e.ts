// Checks a workflow join on the real SQLite and the real workflow service, on a temporary profile
// (#5553). Three branches go into a model step, an approval and an output: two prompts, and a model
// step that fails once. Each join starts only when all three branches end. The model join keeps the
// place of the failed branch with its error, redacted, and the place of the step after it that was
// skipped. The approval and the output get only the answers, and so
// does an output after the approval, because an approval hands its input on. A retry runs the failed
// branch again and not the others, and the joins run again with all three answers. The run keeps its
// steps over a restart. The model steps are a fake, so no model, agent, account or network is started.
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
const BOARD_ERROR = "The job board did not answer. Authorization: Bearer abcdefghijklmnop1234567890";
const SAFE_ERROR = "The job board did not answer. Authorization: [redacted]";
const ANSWERS = "Input 1:\n\nBoard A: 3 jobs\n\nInput 2:\n\nBoard C: 1 job";
const ALL_ANSWERS = "Input 1:\n\nBoard A: 3 jobs\n\nInput 2:\n\nBoard B: 2 jobs\n\nInput 3:\n\nBoard C: 1 job";

interface Report {
  checks: string[];
  inputs: Record<string, string | undefined>;
  outputs: string[];
  joinPrompts: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], inputs: {}, outputs: [], joinPrompts: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const GRAPH: WorkflowGraph = {
  nodes: [
    { id: "a", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Board A: 3 jobs" } },
    { id: "b", kind: "llm", at: { x: 0, y: 200 }, fields: { prompt: "Search board B" } },
    { id: "c", kind: "prompt", at: { x: 0, y: 400 }, fields: { text: "Board C: 1 job" } },
    { id: "parse", kind: "llm", at: { x: 150, y: 200 }, fields: { prompt: "Parse board B" } },
    { id: "count", kind: "llm", at: { x: 300, y: 0 }, fields: { prompt: "Count the jobs" } },
    { id: "join", kind: "approval", at: { x: 300, y: 200 }, fields: { question: "Screen these jobs?" } },
    { id: "post", kind: "output", at: { x: 300, y: 600 }, fields: { target: "notify" } },
    { id: "after", kind: "output", at: { x: 600, y: 200 }, fields: { target: "notify" } },
  ],
  edges: [
    ...["count", "join", "post"].flatMap((to) =>
      ["a", "b", "c"].map((from) => ({ id: `${from}>${to}`, from, to, type: "text" as const })),
    ),
    { id: "join>after", from: "join", to: "after", type: "text" },
    { id: "b>parse", from: "b", to: "parse", type: "text" },
    { id: "parse>count", from: "parse", to: "count", type: "text" },
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
      generateText: (request) => {
        if (request.prompt.includes("Count the jobs")) {
          report.joinPrompts.push(request.prompt);
          return Effect.succeed("Counted");
        }
        if (request.prompt.includes("Parse board B")) return Effect.succeed("Parsed B");
        return ++generations === 1 ? Effect.fail({ message: BOARD_ERROR }) : Effect.succeed("Board B: 2 jobs");
      },
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

/** Waits until an attempt of a node ends, and gives its step. */
async function settled(workflows: WorkflowsHandle, runId: string, nodeId: string, attempt: number) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const step = (await runCauseEffect(workflows.run(runId))).steps.find(
      (each) => each.nodeId === nodeId && each.attempt === attempt,
    );
    if (step && step.status !== "running") return step;
    if (Date.now() > deadline) throw new Error(`${nodeId} attempt ${attempt} did not end.`);
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
  const count = await settled(workflows, run.id, "count", 1);
  report.inputs.firstCount = inputOf(count);
  check(
    "a model join keeps the place of the failed branch and of the step after it, with the error redacted",
    count.status === "done" &&
      inputOf(count) ===
        `Input 1:\n\nBoard A: 3 jobs\n\nInput 2:\n\nNo answer: this step failed. Error: ${SAFE_ERROR}\n\nInput 3:\n\nBoard C: 1 job\n\nInput 4:\n\nNo answer: a step before this one failed. Error: ${SAFE_ERROR}` &&
      report.joinPrompts.length === 1 &&
      report.joinPrompts[0]?.includes(`No answer: this step failed. Error: ${SAFE_ERROR}`) === true &&
      !report.joinPrompts[0]?.includes("abcdefghijklmnop"),
    { input: inputOf(count), prompts: report.joinPrompts },
  );
  check("an approval join gets only the answers", inputOf(step) === ANSWERS, inputOf(step));
  check(
    "an output after the branches posts only the answers",
    report.outputs.length === 1 && report.outputs[0] === ANSWERS,
    report.outputs,
  );

  await runCauseEffect(workflows.decide({ stepId: step.id, approved: true }));
  check("a run with a failed branch ends as failed", (await ended(workflows, run.id)) === "failed");
  check(
    "an output after the approval posts only the answers",
    report.outputs.length === 2 && report.outputs[1] === ANSWERS,
    report.outputs,
  );

  if (!failed) throw new Error("The failed branch has no step.");
  await runCauseEffect(workflows.retryStep({ stepId: failed.id, requestId: "join-retry-1" }));
  step = await waiting(workflows, run.id);
  await settled(workflows, run.id, "count", 2);
  report.inputs.secondJoin = inputOf(step);
  check(
    "after a retry, the joins run again with every answer",
    step.nodeId === "join" &&
      step.attempt === 2 &&
      inputOf(step) === ALL_ANSWERS &&
      report.joinPrompts.length === 2 &&
      report.joinPrompts[1]?.includes(`${ALL_ANSWERS}\n\nInput 4:\n\nParsed B`) === true &&
      !report.joinPrompts[1]?.includes("No answer"),
    { input: inputOf(step), prompts: report.joinPrompts },
  );
  const retried = await attempts(workflows, run.id);
  check(
    "a retry runs only the failed branch and the steps after it",
    [
      "a:1:done",
      "c:1:done",
      "b:1:failed",
      "b:2:done",
      "parse:2:done",
      "count:2:done",
      "join:2:approval",
      "post:2:done",
    ].every((each) => retried.includes(each)) &&
      !retried.some((each) => each.startsWith("a:2") || each.startsWith("c:2")),
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
  check(
    "no branch runs again after the restart",
    generations === 2 && report.joinPrompts.length === 2 && report.outputs.at(-1) === ALL_ANSWERS,
    { generations, prompts: report.joinPrompts.length, outputs: report.outputs },
  );

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
