// Checks agent steps of workflows on the real SQLite, the real workflow service and the real agent
// delete, on a temporary profile. Only the agent mailbox is a stand-in that keeps each delivery
// running, so no provider, app, account or network is started. A deleted agent fails the step that it
// was answering, removes the agent from the graph and fails the run; a run that a restart cut off
// while it stopped ends stopped at the first sweep, and the sweep stops its delivery.
//
// Run: bun scripts/workflow-agent-step-e2e.ts
// Writes .openbot-build/workflow-agent-step-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkflowGraph, WorkflowRunDetail } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-agent-step-e2e");
const WAIT_MS = 5_000;

interface Report {
  checks: string[];
  handoffs: { agentId: string; deliveryId: string }[];
  stopped: { agentId: string; deliveryId: string }[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], handoffs: [], stopped: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const graphOf = (agentId: string): WorkflowGraph => ({
  nodes: [
    { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Check the competitor sites." } },
    { id: "agent", kind: "agent", at: { x: 300, y: 0 }, fields: { agentId, task: "Write a short note." } },
  ],
  edges: [{ id: "edge", from: "prompt", to: "agent", type: "text" }],
  strokes: [],
});

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-agent-step-"));
let database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

async function open() {
  await Effect.runPromise(database.initialize());
  const runs = new WorkflowRunStore({ database });
  const workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs,
      // Each delivery stays running: only a delete, a stop or a restart ends the step.
      delivery: () => ({ status: "running", turnId: null, error: null }),
      turnAnswer: () => null,
      sendHandoff: (input) =>
        Effect.sync(() => {
          const deliveryId = `delivery-${report.handoffs.length + 1}`;
          report.handoffs.push({ agentId: input.agentId, deliveryId });
          return deliveryId;
        }),
      stopDelivery: (agentId, deliveryId) =>
        Effect.sync(() => {
          report.stopped.push({ agentId, deliveryId });
        }),
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No output step runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  service = workflows;
  return { workflows, runs };
}

async function close() {
  if (service) await Effect.runPromise(service.close());
  service = null;
  database.close();
}

/** Waits for a run to reach a state; a step is sent in the pass after the start. */
async function runUntil(
  workflows: WorkflowsHandle,
  runId: string,
  until: (detail: WorkflowRunDetail) => boolean,
): Promise<WorkflowRunDetail> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const detail = await runCauseEffect(workflows.run(runId));
    if (until(detail)) return detail;
    if (Date.now() > deadline) throw new Error(`The run did not reach the state: ${JSON.stringify(detail)}`);
    await new Promise((done) => setImmediate(done));
  }
}
const agentStep = (detail: WorkflowRunDetail) => detail.steps.find((step) => step.nodeId === "agent");
const answering = (detail: WorkflowRunDetail) => agentStep(detail)?.status === "running";

async function startRun(workflows: WorkflowsHandle, title: string, agentId: string) {
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph: graphOf(agentId) }),
  );
  assert.ok(saved.ok);
  const started = await runCauseEffect(
    workflows.startRun({ workflowId: created.summary.id, requestId: crypto.randomUUID() }),
  );
  return { workflowId: created.summary.id, revision: saved.revision, runId: started.run.id };
}

try {
  let { workflows, runs } = await open();

  // 1. A deleted agent fails the step that it was answering.
  const research = await startRun(workflows, "Competitor watch", "agent-research");
  await runUntil(workflows, research.runId, answering);
  check(
    "the agent step is sent to its agent",
    report.handoffs.some((handoff) => handoff.agentId === "agent-research"),
    report.handoffs,
  );
  database.hardDeleteAgent(`agents:hard-delete:${crypto.randomUUID()}`, "agent-research", null, []);
  // The agent service asks for a sweep on `agents-changed`.
  await Effect.runPromise(workflows.sweep());
  const failed = await runUntil(workflows, research.runId, (detail) => detail.run.status !== "running");
  check(
    "the open step fails with the missing-agent reason",
    agentStep(failed)?.status === "failed" && agentStep(failed)?.error === sourceText("error.workflow.agentMissing"),
    agentStep(failed),
  );
  check("the run fails", failed.run.status === "failed", failed.run);
  const afterDelete = await runCauseEffect(workflows.get(research.workflowId));
  check(
    "the graph keeps the node without the agent, on a new revision",
    afterDelete.revision > research.revision &&
      afterDelete.graph.nodes.some((node) => node.id === "agent" && node.fields.agentId === undefined),
    { revision: afterDelete.revision, nodes: afterDelete.graph.nodes },
  );

  // 2. A restart cut a stop off: the run is stopping and its step still runs.
  const writer = await startRun(workflows, "Weekly note", "agent-writer");
  await runUntil(workflows, writer.runId, answering);
  const writerDelivery = report.handoffs.find((handoff) => handoff.agentId === "agent-writer")?.deliveryId;
  assert.ok(runs.setRunStatus(writer.runId, "stopping", null));
  await close();
  database = new OpenBotDatabase(directory);
  ({ workflows } = await open());
  const cut = await runCauseEffect(workflows.run(writer.runId));
  check(
    "after the restart the run is stopping with a running step",
    cut.run.status === "stopping" && agentStep(cut)?.status === "running",
    cut,
  );
  await Effect.runPromise(workflows.sweep());
  const ended = await runUntil(workflows, writer.runId, (detail) => detail.run.status !== "stopping");
  check("the first sweep ends the run as stopped", ended.run.status === "stopped", ended.run);
  check("its step is stopped", agentStep(ended)?.status === "stopped", agentStep(ended));
  check(
    "the sweep stops the step's delivery",
    report.stopped.some((stop) => stop.agentId === "agent-writer" && stop.deliveryId === writerDelivery),
    report.stopped,
  );
  check(
    "the agent gets no second message",
    report.handoffs.filter((handoff) => handoff.agentId === "agent-writer").length === 1,
    report.handoffs,
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
} finally {
  await close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks; ${OUT}/report.json\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
