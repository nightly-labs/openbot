import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WORKFLOW_MEDIA_MODELS, type WorkflowGraph, type WorkflowStep } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { type StoredWorkflowStep, WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-step-settings-e2e");
const WAIT_MS = 5_000;
const PHOTO = "0123456789abcdef0123456789abcdef";
const PICTURE = "fedcba9876543210fedcba9876543210";

interface Recorded {
  nodeId: string;
  attempt: number;
  status: string;
  settings: StoredWorkflowStep["settings"];
  sources: StoredWorkflowStep["sources"];
}

interface Report {
  checks: string[];
  prompts: string[];
  steps: Record<string, Recorded>;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], prompts: [], steps: {}, passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

function graph(prompt: string): WorkflowGraph {
  return {
    nodes: [
      { id: "brief", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: 'Spring sale 界"\\' } },
      { id: "photo", kind: "asset", at: { x: 0, y: 200 }, fields: { fileId: PHOTO } },
      { id: "tagline", kind: "llm", at: { x: 300, y: 300 }, fields: { prompt: "Write a tagline" } },
      { id: "poster", kind: "image", at: { x: 600, y: 0 }, fields: { media: "image", prompt: "A red bicycle" } },
      {
        id: "title",
        kind: "llm",
        at: { x: 300, y: 0 },
        fields: { provider: "claude", model: "claude-sonnet-5-5", effort: "low", prompt, label: "Title" },
      },
    ],
    edges: [
      { id: "brief>title", from: "brief", to: "title", type: "text" },
      { id: "photo>title", from: "photo", to: "title", type: "file" },
    ],
    strokes: [],
  };
}

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-step-settings-"));
let database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

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
      generateText: (request) => {
        report.prompts.push(request.prompt);
        return request.prompt.includes("FAIL")
          ? Effect.fail({ message: "The model failed." })
          : Effect.succeed(`Title from ${request.model}`);
      },
      chooseTextModel: (request) =>
        Effect.succeed({
          provider: request.provider ?? "codex",
          model: request.model ?? "gpt-5.5",
          effort: request.effort ?? "medium",
        }),
      generateMedia: () => Effect.succeed(PICTURE),
      notify: () => {},
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

const stored = (step: WorkflowStep) => {
  const found = new WorkflowRunStore({ database }).step(step.id);
  if (!found) throw new Error(`Step ${step.id} is missing.`);
  return found;
};

function remember(name: string, step: StoredWorkflowStep): StoredWorkflowStep {
  report.steps[name] = {
    nodeId: step.nodeId,
    attempt: step.attempt,
    status: step.status,
    settings: step.settings,
    sources: step.sources,
  };
  return step;
}

async function ended(step: WorkflowStep): Promise<StoredWorkflowStep> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const current = stored(step);
    if (current.status !== "running") return current;
    if (Date.now() > deadline) throw new Error(`${step.nodeId} attempt ${step.attempt} did not end.`);
    await new Promise((done) => setImmediate(done));
  }
}

async function runEnded(workflows: WorkflowsHandle, runId: string) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const detail = await runCauseEffect(workflows.run(runId));
    if (detail.run.status !== "running" && detail.run.status !== "stopping") return detail;
    if (Date.now() > deadline) throw new Error(`The run is still ${detail.run.status}.`);
    await new Promise((done) => setImmediate(done));
  }
}

async function save(workflows: WorkflowsHandle, workflowId: string, revision: number, prompt: string) {
  const saved = await runCauseEffect(workflows.saveGraph({ workflowId, baseRevision: revision, graph: graph(prompt) }));
  if (!saved.ok) throw new Error("The graph did not save.");
  return saved.revision;
}

const stepOf = (steps: readonly WorkflowStep[], nodeId: string) => {
  const step = steps.find((each) => each.nodeId === nodeId);
  if (!step) throw new Error(`No step for ${nodeId}.`);
  return step;
};

const TITLE_SETTINGS = (prompt: string) => ({
  provider: "claude",
  model: "claude-sonnet-5-5",
  effort: "low",
  prompt,
});

try {
  let workflows = await open();
  const created = await runCauseEffect(workflows.create({ title: "Poster" }));
  const workflowId = created.summary.id;
  let revision = await save(workflows, workflowId, created.revision, "Write a title v1");

  const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId: "settings-run-1" }))).run;
  const first = await runEnded(workflows, run.id);
  const brief = remember("run brief", stored(stepOf(first.steps, "brief")));
  const photo = remember("run photo", stored(stepOf(first.steps, "photo")));
  const title = remember("run title", await ended(stepOf(first.steps, "title")));
  check(
    "a run step keeps the settings it ran with, without the label",
    title.status === "done" && JSON.stringify(title.settings) === JSON.stringify(TITLE_SETTINGS("Write a title v1")),
    title.settings,
  );
  check(
    "a run step keeps the step of each text input and the file of each file input",
    JSON.stringify(title.sources) ===
      JSON.stringify([
        { from: "brief", type: "text", stepId: brief.id, attachmentId: null },
        { from: "photo", type: "file", stepId: photo.id, attachmentId: PHOTO },
      ]),
    title.sources,
  );
  check(
    "a source step keeps its own settings and has no inputs",
    JSON.stringify(brief.settings) === JSON.stringify({ text: 'Spring sale 界"\\' }) &&
      JSON.stringify(photo.settings) === JSON.stringify({ fileId: PHOTO }) &&
      brief.sources?.length === 0,
    { brief: brief.settings, photo: photo.settings },
  );

  const tagline = remember("run tagline", await ended(stepOf(first.steps, "tagline")));
  check(
    "a step with no model keeps the provider, model and effort that answered",
    tagline.status === "done" &&
      JSON.stringify(tagline.settings) ===
        JSON.stringify({ prompt: "Write a tagline", provider: "codex", model: "gpt-5.5", effort: "medium" }),
    tagline.settings,
  );
  const poster = remember("run poster", await ended(stepOf(first.steps, "poster")));
  check(
    "an image step with no model keeps the model, aspect and background that made it",
    poster.status === "done" &&
      poster.output === PICTURE &&
      poster.settings?.model === WORKFLOW_MEDIA_MODELS.find((model) => model.kinds.includes("image"))?.id &&
      poster.settings?.aspect === "1:1" &&
      poster.settings?.background === "solid" &&
      poster.settings?.prompt === "A red bicycle",
    poster.settings,
  );

  revision = await save(workflows, workflowId, revision, "Write a title v2");
  const solo = remember(
    "solo title",
    await ended(await runCauseEffect(workflows.runStep({ workflowId, nodeId: "title", requestId: "settings-solo-1" }))),
  );
  check(
    "a single step keeps the edited settings, and the earlier result keeps its own",
    solo.runId === null &&
      solo.settings?.prompt === "Write a title v2" &&
      stored(title).settings?.prompt === "Write a title v1",
    { solo: solo.settings, run: stored(title).settings },
  );
  check(
    "a single step keeps the done source steps that it read",
    JSON.stringify(solo.sources?.map((source) => source.stepId)) === JSON.stringify([brief.id, photo.id]),
    solo.sources,
  );

  revision = await save(workflows, workflowId, revision, "Write a title FAIL");
  const failed = remember(
    "failed title",
    await ended(await runCauseEffect(workflows.runStep({ workflowId, nodeId: "title", requestId: "settings-solo-2" }))),
  );
  check(
    "a failed step keeps the settings that failed",
    failed.status === "failed" && failed.settings?.prompt === "Write a title FAIL",
  );

  revision = await save(workflows, workflowId, revision, "Write a title v4");
  const retried = remember(
    "retried title",
    await ended(await runCauseEffect(workflows.retryStep({ stepId: failed.id, requestId: "settings-retry" }))),
  );
  check(
    "a retry keeps the settings that it really ran with",
    retried.status === "done" &&
      retried.settings?.prompt === "Write a title v4" &&
      report.prompts.at(-1)?.includes("Write a title v4") === true,
    { settings: retried.settings, prompt: report.prompts.at(-1) },
  );

  const from = (
    await runCauseEffect(workflows.startRun({ workflowId, requestId: "settings-run-2", fromNodeId: "title" }))
  ).run;
  const second = await runEnded(workflows, from.id);
  const reused = remember("reused brief", stored(stepOf(second.steps, "brief")));
  const rerun = remember("rerun title", await ended(stepOf(second.steps, "title")));
  check(
    "a reused step keeps the settings of the step that it copies",
    JSON.stringify(reused.settings) === JSON.stringify(brief.settings) &&
      JSON.stringify(reused.sources) === JSON.stringify(brief.sources),
    reused,
  );
  check(
    "a run from a step reads the reused step",
    rerun.settings?.prompt === "Write a title v4" &&
      rerun.sources?.find((source) => source.from === "brief")?.stepId === reused.id,
    rerun.sources,
  );

  await close();
  workflows = await open();
  check(
    "a restart keeps the settings and inputs of every step",
    JSON.stringify(stored(title).settings) === JSON.stringify(report.steps["run title"]?.settings) &&
      JSON.stringify(stored(rerun).sources) === JSON.stringify(report.steps["rerun title"]?.sources),
  );

  database.connection
    .prepare("UPDATE workflow_steps SET settings_json = NULL, sources_json = NULL WHERE step_id = ?")
    .run(title.id);
  const older = stored(title);
  const detail = await runCauseEffect(workflows.run(run.id));
  check(
    "a step from an older release reads as not recorded, and the run still reads",
    older.settings === null && older.sources === null && detail.steps.some((step) => step.id === title.id),
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
