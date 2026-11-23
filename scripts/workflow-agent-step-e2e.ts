import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { WorkflowGraph, WorkflowRunDetail } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-agent-step-e2e");
const WAIT_MS = 5_000;
const STEP_NAME = "Research competitors";

interface Report {
  checks: string[];
  handoffs: { agentId: string; deliveryId: string; text: string; sourcePaths: readonly string[] }[];
  stopped: { agentId: string; deliveryId: string }[];
  modelRequests: { prompt: string; images: readonly string[] }[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], handoffs: [], stopped: [], modelRequests: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const graphOf = (agentId: string): WorkflowGraph => ({
  nodes: [
    { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Check the competitor sites." } },
    {
      id: "agent",
      kind: "agent",
      at: { x: 300, y: 0 },
      fields: { agentId, task: "Write a short note.", stepName: STEP_NAME },
    },
  ],
  edges: [{ id: "edge", from: "prompt", to: "agent", type: "text" }],
  strokes: [],
});

const picturesGraph = (agentId: string): WorkflowGraph => ({
  nodes: [
    { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Compare the two pictures." } },
    { id: "asset", kind: "asset", at: { x: 0, y: 200 }, fields: { fileId: "asset-file" } },
    { id: "image", kind: "image", at: { x: 0, y: 400 }, fields: { prompt: "A red bicycle." } },
    { id: "agent", kind: "agent", at: { x: 300, y: 0 }, fields: { agentId, task: "Describe the pictures." } },
  ],
  edges: [
    { id: "text", from: "prompt", to: "agent", type: "text" },
    { id: "asset-image", from: "asset", to: "agent", type: "image" },
    { id: "asset-file", from: "asset", to: "agent", type: "file" },
    { id: "image-image", from: "image", to: "agent", type: "image" },
  ],
  strokes: [],
});
const GENERATED_FILE = "generated-file";
const DELETED_FILE = "deleted-file";
const NOTES_FILE = "notes-file";
const storedPath = (attachmentId: string) => `/stored/${attachmentId}.${attachmentId === NOTES_FILE ? "txt" : "png"}`;

const modelGraph = (task: string, pictures: readonly string[]): WorkflowGraph => ({
  nodes: [
    { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: "Compare the pictures." } },
    { id: "image", kind: "image", at: { x: 0, y: 200 }, fields: { prompt: "A red bicycle." } },
    ...pictures.map((fileId, index) => ({
      id: `asset-${index}`,
      kind: "asset" as const,
      at: { x: 0, y: 400 + index * 200 },
      fields: { fileId },
    })),
    { id: "model", kind: "llm", at: { x: 300, y: 0 }, fields: { prompt: task } },
  ],
  edges: [
    { id: "text", from: "prompt", to: "model", type: "text" },
    ...(pictures.length > 0 ? [{ id: "image-image", from: "image", to: "model", type: "image" as const }] : []),
    ...pictures.flatMap((_, index) => [
      { id: `asset-${index}-image`, from: `asset-${index}`, to: "model", type: "image" as const },
      { id: `asset-${index}-file`, from: `asset-${index}`, to: "model", type: "file" as const },
    ]),
  ],
  strokes: [],
});

const assetsGraph = (agentId: string, fileIds: readonly string[]): WorkflowGraph => ({
  nodes: [
    ...fileIds.map((fileId, index) => ({
      id: `asset-${index}`,
      kind: "asset" as const,
      at: { x: 0, y: index * 200 },
      fields: { fileId },
    })),
    { id: "agent", kind: "agent", at: { x: 300, y: 0 }, fields: { agentId, task: "Describe the files." } },
  ],
  edges: fileIds.map((_, index) => ({ id: `edge-${index}`, from: `asset-${index}`, to: "agent", type: "file" })),
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
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => ({ status: "running", turnId: null, error: null }),
      turnAnswer: () => null,
      sendHandoff: (input) =>
        Effect.sync(() => {
          const deliveryId = `delivery-${report.handoffs.length + 1}`;
          report.handoffs.push({
            agentId: input.agentId,
            deliveryId,
            text: input.text,
            sourcePaths: input.sourcePaths,
          });
          return deliveryId;
        }),
      stopDelivery: (agentId, deliveryId) =>
        Effect.sync(() => {
          report.stopped.push({ agentId, deliveryId });
        }),
      generateText: (request) =>
        Effect.sync(() => {
          report.modelRequests.push({ prompt: request.prompt, images: request.images });
          return "Seen";
        }),
      generateMedia: () => Effect.succeed(GENERATED_FILE),
      filePath: (attachmentId) => Effect.succeed(attachmentId === DELETED_FILE ? null : storedPath(attachmentId)),
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
const modelStep = (detail: WorkflowRunDetail) => detail.steps.find((step) => step.nodeId === "model");
const requestFor = (task: string) => report.modelRequests.find((request) => request.prompt.includes(task));
const answering = (detail: WorkflowRunDetail) => agentStep(detail)?.status === "running";

async function startRun(workflows: WorkflowsHandle, title: string, agentId: string, graph = graphOf(agentId)) {
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(saved.ok);
  const started = await runCauseEffect(
    workflows.startRun({ workflowId: created.summary.id, requestId: crypto.randomUUID() }),
  );
  return { workflowId: created.summary.id, revision: saved.revision, runId: started.run.id };
}

try {
  let { workflows, runs } = await open();

  const research = await startRun(workflows, "Competitor watch", "agent-research");
  await runUntil(workflows, research.runId, answering);
  check(
    "the agent step is sent to its agent",
    report.handoffs.some((handoff) => handoff.agentId === "agent-research"),
    report.handoffs,
  );
  const named = await runCauseEffect(workflows.get(research.workflowId));
  check(
    "the saved graph keeps the step name",
    named.graph.nodes.some((node) => node.id === "agent" && node.fields.stepName === STEP_NAME),
    named.graph.nodes,
  );
  check(
    "the step name is not sent to the agent",
    report.handoffs.every((handoff) => !handoff.text.includes(STEP_NAME)),
    report.handoffs,
  );
  database.hardDeleteAgent(`agents:hard-delete:${crypto.randomUUID()}`, "agent-research", null, []);
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
    "the graph keeps the node and its name without the agent, on a new revision",
    afterDelete.revision > research.revision &&
      afterDelete.graph.nodes.some(
        (node) => node.id === "agent" && node.fields.agentId === undefined && node.fields.stepName === STEP_NAME,
      ),
    { revision: afterDelete.revision, nodes: afterDelete.graph.nodes },
  );

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

  const viewer = await startRun(workflows, "Picture review", "agent-viewer", picturesGraph("agent-viewer"));
  await runUntil(workflows, viewer.runId, answering);
  const viewerHandoff = report.handoffs.find((handoff) => handoff.agentId === "agent-viewer");
  check(
    "the agent step gets the files of the image step and the asset, each one time",
    JSON.stringify(viewerHandoff?.sourcePaths) ===
      JSON.stringify([storedPath("asset-file"), storedPath(GENERATED_FILE)]),
    viewerHandoff,
  );
  check(
    "the agent step text tells the agent to use the attached files together and not invent a substitute",
    viewerHandoff?.text.includes("Describe the pictures.") === true &&
      viewerHandoff.text.includes(
        "The 2 attached files come from the steps before this one. Use them together as given: keep what they show, and do not invent a substitute.",
      ),
    viewerHandoff?.text,
  );
  check(
    "an agent step with no file gets no file note",
    report.handoffs
      .filter((handoff) => handoff.sourcePaths.length === 0)
      .every((handoff) => !handoff.text.includes("attached file")),
    report.handoffs,
  );
  check(
    "an agent step with only a text edge gets no file",
    report.handoffs
      .filter((handoff) => handoff.agentId !== "agent-viewer")
      .every((handoff) => handoff.sourcePaths.length === 0),
    report.handoffs,
  );

  const lost = await startRun(workflows, "Lost picture", "agent-lost", assetsGraph("agent-lost", [DELETED_FILE]));
  const lostEnd = await runUntil(workflows, lost.runId, (detail) => detail.run.status !== "running");
  check(
    "a deleted file fails the agent step with the missing-picture reason",
    agentStep(lostEnd)?.status === "failed" &&
      agentStep(lostEnd)?.error === sourceText("error.workflow.mediaInputMissing"),
    agentStep(lostEnd),
  );
  check(
    "the agent of a deleted file gets no message",
    !report.handoffs.some((handoff) => handoff.agentId === "agent-lost"),
    report.handoffs,
  );

  const fileIds = Array.from({ length: INPUT_LIMITS.attachments + 1 }, (_, index) => `file-${index}`);
  const many = await startRun(workflows, "Many files", "agent-many", assetsGraph("agent-many", fileIds));
  const manyEnd = await runUntil(workflows, many.runId, (detail) => detail.run.status !== "running");
  check(
    "too many files fail the agent step with the attachment limit",
    agentStep(manyEnd)?.status === "failed" &&
      agentStep(manyEnd)?.error === sourceText("error.backend.attachLimit", { limit: INPUT_LIMITS.attachments }),
    agentStep(manyEnd),
  );
  check(
    "the agent of too many files gets no message",
    !report.handoffs.some((handoff) => handoff.agentId === "agent-many"),
    report.handoffs,
  );

  const modelRun = async (title: string, task: string, pictures: readonly string[]) => {
    const run = await startRun(workflows, title, "unused", modelGraph(task, pictures));
    return runUntil(workflows, run.runId, (detail) => detail.run.status !== "running");
  };

  const seen = await modelRun("Model pictures", "Describe the pictures.", ["asset-file", "asset-file"]);
  check("a model step with pictures is done", modelStep(seen)?.status === "done", modelStep(seen));
  check(
    "the model step gets the files of the image step and the asset, each one time",
    JSON.stringify(requestFor("Describe the pictures.")?.images) ===
      JSON.stringify([storedPath(GENERATED_FILE), storedPath("asset-file")]),
    requestFor("Describe the pictures."),
  );

  const plain = await modelRun("Model text", "Summarize the text.", []);
  check(
    "a model step with only a text edge gets no picture",
    modelStep(plain)?.status === "done" && requestFor("Summarize the text.")?.images.length === 0,
    requestFor("Summarize the text."),
  );

  const notes = await modelRun("Model notes", "Read the notes.", [NOTES_FILE]);
  check(
    "a file that is not a picture fails the model step with the picture-type reason",
    modelStep(notes)?.status === "failed" && modelStep(notes)?.error === sourceText("error.workflow.modelImageType"),
    modelStep(notes),
  );
  check("the model of a file that is not a picture gets no request", requestFor("Read the notes.") === undefined);

  const gone = await modelRun("Model lost picture", "Find the lost picture.", [DELETED_FILE]);
  check(
    "a deleted picture fails the model step with the missing-picture reason",
    modelStep(gone)?.status === "failed" && modelStep(gone)?.error === sourceText("error.workflow.mediaInputMissing"),
    modelStep(gone),
  );
  check("the model of a deleted picture gets no request", requestFor("Find the lost picture.") === undefined);

  const crowd = await modelRun("Model many pictures", "Count the pictures.", fileIds);
  check(
    "too many pictures fail the model step with the attachment limit",
    modelStep(crowd)?.status === "failed" &&
      modelStep(crowd)?.error === sourceText("error.backend.attachLimit", { limit: INPUT_LIMITS.attachments }),
    modelStep(crowd),
  );
  check("the model of too many pictures gets no request", requestFor("Count the pictures.") === undefined);

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
