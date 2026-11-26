import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CreditMediaJob, CreditMediaModel } from "@openbot/contracts/credit-media";
import type { WorkflowGraph } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  type CreditMediaGateway,
  CreditMediaGatewayFailed,
  CreditMediaWorkflows,
  creditWorkflowModel,
  creditWorkflowModelId,
} from "../src/backend/workflows/credit-media";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { type StoredWorkflowStep, WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-paid-media-e2e");
const WAIT_MS = 60_000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const MODEL: CreditMediaModel = {
  id: "image-one",
  name: "Image One",
  maker: "Maker",
  variant: null,
  kind: "image",
  aspects: ["1:1"],
  defaultAspect: "1:1",
  resolutions: [],
  defaultResolution: null,
  durations: [],
  defaultDuration: null,
  frames: 0,
  references: 0,
  audio: false,
  maxCount: 1,
  promptRequired: true,
  prices: [{ resolution: null, unit: "item", credits: 1.5, silentCredits: null }],
};

interface Report {
  checks: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

interface FakeJob {
  status: "processing" | "completed" | "failed";
  submits: number;
  downloads: number;
}

const jobs = new Map<string, FakeJob>();
const files: string[] = [];
const flaky = { submit: 0, job: 0, output: 0 };
let calls = { submit: 0, job: 0, output: 0 };

const shaky = (kind: keyof typeof flaky) => {
  if (flaky[kind] <= 0) return null;
  flaky[kind] -= 1;
  return new CreditMediaGatewayFailed({
    message: "The network is down.",
    status: kind === "output" ? 503 : 0,
    code: "",
  });
};

const view = (jobId: string, job: FakeJob): CreditMediaJob => ({
  jobId,
  model: MODEL.id,
  status: job.status,
  credits: 1.5,
  pollAfterSeconds: 0,
  outputs:
    job.status === "completed"
      ? [{ index: 0, mimeType: "image/png", width: null, height: null, durationMs: null }]
      : [],
  failure: job.status === "failed" ? "failed" : null,
  reason: null,
});

const gateway: CreditMediaGateway = {
  available: () => true,
  catalog: () => Effect.succeed({ models: [MODEL] }),
  balance: () => Effect.succeed({ wallet: "personal", available: 100 }),
  submit: (request) =>
    Effect.suspend(() => {
      calls.submit += 1;
      const failure = shaky("submit");
      if (failure) return Effect.fail(failure);
      const job = jobs.get(request.jobId) ?? { status: "processing" as const, submits: 0, downloads: 0 };
      job.submits += 1;
      jobs.set(request.jobId, job);
      return Effect.succeed(view(request.jobId, job));
    }),
  job: (jobId) =>
    Effect.suspend(() => {
      calls.job += 1;
      const job = jobs.get(jobId);
      if (!job)
        return Effect.fail(new CreditMediaGatewayFailed({ message: "Not found.", status: 404, code: "not_found" }));
      const failure = shaky("job");
      if (failure) return Effect.fail(failure);
      return Effect.succeed(view(jobId, job));
    }),
  output: (jobId) =>
    Effect.suspend(() => {
      calls.output += 1;
      const failure = shaky("output");
      if (failure) return Effect.fail(failure);
      const job = jobs.get(jobId);
      if (job?.status !== "completed")
        return Effect.fail(new CreditMediaGatewayFailed({ message: "Not found.", status: 404, code: "not_found" }));
      job.downloads += 1;
      return Effect.succeed(PNG);
    }),
};

const graph: WorkflowGraph = {
  nodes: [
    {
      id: "poster",
      kind: "image",
      at: { x: 0, y: 0 },
      fields: { media: "image", model: creditWorkflowModelId(MODEL.id), prompt: "A red boat" },
    },
  ],
  edges: [],
  strokes: [],
};

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-paid-media-"));
let database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

async function open() {
  database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  const credits = new CreditMediaWorkflows({ gateway, warn: () => undefined });
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
      generateText: () => Effect.fail({ message: "No text step runs in this test." }),
      chooseTextModel: () => Effect.fail({ message: "No text step runs in this test." }),
      mediaCatalog: () => Effect.succeed({ models: [creditWorkflowModel(MODEL)] }),
      generateMedia: (request) =>
        request.provider === "openbot"
          ? credits.generate(
              {
                resolveAttachment: () => Effect.succeed(null),
                store: () =>
                  Effect.sync(() => {
                    files.push(`file-${files.length + 1}`);
                    return { id: `file-${files.length}` };
                  }),
              },
              {
                jobId: request.jobId,
                earlierJobIds: request.earlierJobIds,
                kind: request.kind,
                model: request.catalogId,
                prompt: request.prompt,
                specs: request.specs,
                images: [],
              },
            )
          : Effect.fail({ message: "Only credit media runs in this test." }),
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

const stored = (stepId: string): StoredWorkflowStep => {
  const found = new WorkflowRunStore({ database }).step(stepId);
  if (!found) throw new Error(`Step ${stepId} is missing.`);
  return found;
};

async function until<T>(
  what: string,
  read: () => T | null | undefined | false | Promise<T | null | undefined | false>,
) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}.`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

async function startPoster(workflows: WorkflowsHandle, workflowId: string, requestId: string) {
  const run = (await runCauseEffect(workflows.startRun({ workflowId, requestId }))).run;
  const step = await until("the poster step starts", async () => {
    const detail = await runCauseEffect(workflows.run(run.id));
    return detail.steps.find((each) => each.nodeId === "poster");
  });
  await until("the job reaches the account service", () => jobs.get(step.id));
  return { runId: run.id, stepId: step.id };
}

async function runEnded(workflows: WorkflowsHandle, runId: string) {
  return until("the run ends", async () => {
    const detail = await runCauseEffect(workflows.run(runId));
    return detail.run.status !== "running" && detail.run.status !== "stopping" ? detail : null;
  });
}

const finish = (stepId: string) => {
  const job = jobs.get(stepId);
  if (job) job.status = "completed";
};

try {
  let workflows = await open();
  const created = await runCauseEffect(workflows.create({ title: "Paid poster" }));
  const workflowId = created.summary.id;
  const saved = await runCauseEffect(workflows.saveGraph({ workflowId, baseRevision: created.revision, graph }));
  if (!saved.ok) throw new Error("The graph did not save.");

  const stopped = await startPoster(workflows, workflowId, "paid-stop");
  await runCauseEffect(workflows.stopStep(stopped.stepId));
  await runCauseEffect(workflows.stopRun(stopped.runId));
  const whileStopping = await runCauseEffect(workflows.run(stopped.runId));
  check(
    "a stop does not cancel a paid generation that was sent",
    stored(stopped.stepId).status === "running" && whileStopping.run.status === "stopping",
    { step: stored(stopped.stepId).status, run: whileStopping.run.status },
  );
  finish(stopped.stepId);
  const afterStop = await runEnded(workflows, stopped.runId);
  const stoppedStep = stored(stopped.stepId);
  check(
    "the stopped run still gets the file, then stops",
    stoppedStep.status === "done" &&
      stoppedStep.output === files.at(-1) &&
      afterStop.run.status === "stopped" &&
      jobs.get(stopped.stepId)?.submits === 1 &&
      jobs.get(stopped.stepId)?.downloads === 1,
    { step: stoppedStep.status, output: stoppedStep.output, run: afterStop.run.status, job: jobs.get(stopped.stepId) },
  );

  const restarted = await startPoster(workflows, workflowId, "paid-restart");
  await close();
  finish(restarted.stepId);
  const filesBefore = files.length;
  workflows = await open();
  check(
    "closing the app leaves the paid step open",
    stored(restarted.stepId).status === "running",
    stored(restarted.stepId).status,
  );
  await runCauseEffect(workflows.sweep());
  const afterRestart = await runEnded(workflows, restarted.runId);
  const restartedStep = stored(restarted.stepId);
  check(
    "after a restart the step finds its job and gets the file without a new job",
    restartedStep.status === "done" &&
      restartedStep.output === files.at(-1) &&
      files.length === filesBefore + 1 &&
      afterRestart.run.status === "done" &&
      jobs.get(restarted.stepId)?.submits === 1 &&
      jobs.get(restarted.stepId)?.downloads === 1,
    { step: restartedStep.status, run: afterRestart.run.status, job: jobs.get(restarted.stepId) },
  );

  calls = { submit: 0, job: 0, output: 0 };
  const shaky = await startPoster(workflows, workflowId, "paid-network");
  flaky.job = 1;
  const afterCheckFailure = await runEnded(workflows, shaky.runId);
  const failedStep = stored(shaky.stepId);
  check(
    "a network failure fails the paid step at once and keeps its job",
    failedStep.status === "failed" &&
      failedStep.error !== null &&
      afterCheckFailure.run.status === "failed" &&
      calls.submit === 1 &&
      jobs.get(shaky.stepId)?.submits === 1,
    { calls, step: failedStep.status, run: afterCheckFailure.run.status, job: jobs.get(shaky.stepId) },
  );

  finish(shaky.stepId);
  flaky.output = 1;
  const jobsBeforeRetry = jobs.size;
  const firstRetry = await runCauseEffect(workflows.retryStep({ stepId: shaky.stepId, requestId: "paid-retry-1" }));
  await runEnded(workflows, shaky.runId);
  check(
    "a Retry uses the job of the failed attempt, and a failed download fails it again",
    stored(firstRetry.id).status === "failed" &&
      !jobs.has(firstRetry.id) &&
      jobs.size === jobsBeforeRetry &&
      calls.submit === 1 &&
      flaky.output === 0,
    { calls, step: stored(firstRetry.id).status, jobs: jobs.size },
  );

  const filesBeforeRetry = files.length;
  const secondRetry = await runCauseEffect(workflows.retryStep({ stepId: firstRetry.id, requestId: "paid-retry-2" }));
  const afterRetry = await runEnded(workflows, shaky.runId);
  const retriedStep = stored(secondRetry.id);
  check(
    "a second Retry still finds the first job and gets the file with one charge",
    retriedStep.status === "done" &&
      retriedStep.output === files.at(-1) &&
      files.length === filesBeforeRetry + 1 &&
      afterRetry.run.status === "done" &&
      jobs.size === jobsBeforeRetry &&
      calls.submit === 1 &&
      jobs.get(shaky.stepId)?.submits === 1 &&
      jobs.get(shaky.stepId)?.downloads === 1,
    { calls, step: retriedStep.status, run: afterRetry.run.status, job: jobs.get(shaky.stepId) },
  );

  const refused = await startPoster(workflows, workflowId, "paid-server-failure");
  const refusedJob = jobs.get(refused.stepId);
  if (refusedJob) refusedJob.status = "failed";
  await runEnded(workflows, refused.runId);
  const freshRetry = await runCauseEffect(workflows.retryStep({ stepId: refused.stepId, requestId: "paid-retry-3" }));
  await until("the Retry sends a new job", () => jobs.get(freshRetry.id));
  finish(freshRetry.id);
  const afterFresh = await runEnded(workflows, refused.runId);
  check(
    "a Retry after the generation failed on the server sends a new job",
    stored(refused.stepId).status === "failed" &&
      stored(freshRetry.id).status === "done" &&
      afterFresh.run.status === "done" &&
      jobs.get(freshRetry.id)?.submits === 1,
    { step: stored(freshRetry.id).status, job: jobs.get(freshRetry.id) },
  );

  const edited = await startPoster(workflows, workflowId, "paid-edited");
  flaky.job = 1;
  await runEnded(workflows, edited.runId);
  finish(edited.stepId);
  const detail = await runCauseEffect(workflows.get(workflowId));
  const editedGraph: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, fields: { ...node.fields, prompt: "A blue boat" } })),
  };
  const resaved = await runCauseEffect(
    workflows.saveGraph({ workflowId, baseRevision: detail.revision, graph: editedGraph }),
  );
  if (!resaved.ok) throw new Error("The edited graph did not save.");
  const editedRetry = await runCauseEffect(workflows.retryStep({ stepId: edited.stepId, requestId: "paid-retry-4" }));
  await until("the Retry of the edited step sends a new job", () => jobs.get(editedRetry.id));
  finish(editedRetry.id);
  await runEnded(workflows, edited.runId);
  check(
    "a Retry after the prompt changed sends a new job, not the old result",
    stored(editedRetry.id).status === "done" &&
      jobs.get(editedRetry.id)?.submits === 1 &&
      jobs.get(edited.stepId)?.downloads === 0,
    { step: stored(editedRetry.id).status, old: jobs.get(edited.stepId), fresh: jobs.get(editedRetry.id) },
  );

  const BATCH = 4;
  const batch: string[] = [];
  for (let take = 0; take < BATCH; take += 1)
    batch.push(
      (await runCauseEffect(workflows.runStep({ workflowId, nodeId: "poster", requestId: `paid-batch-${take}` }))).id,
    );
  await until("every take of the batch reaches the account service", () => batch.every((id) => jobs.has(id)));
  check(
    "a batch of 4 paid takes runs at the same time",
    batch.every((id) => jobs.get(id)?.status === "processing" && stored(id).status === "running"),
    batch.map((id) => ({ step: stored(id).status, job: jobs.get(id) })),
  );
  const filesBeforeBatch = files.length;
  for (const id of batch) finish(id);
  await until("every take of the batch ends", () => batch.every((id) => stored(id).status !== "running"));
  const outputs = new Set(batch.map((id) => stored(id).output));
  check(
    "each take of the batch gets its own file with one charge",
    batch.every((id) => stored(id).status === "done" && jobs.get(id)?.submits === 1 && jobs.get(id)?.downloads === 1) &&
      outputs.size === BATCH &&
      files.length === filesBeforeBatch + BATCH,
    batch.map((id) => ({ step: stored(id).status, output: stored(id).output, job: jobs.get(id) })),
  );

  const current = await runCauseEffect(workflows.get(workflowId));
  const switchedOff = await runCauseEffect(
    workflows.saveGraph({
      workflowId,
      baseRevision: current.revision,
      graph: {
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          fields: { ...node.fields, model: creditWorkflowModelId("switched-off") },
        })),
      },
    }),
  );
  if (!switchedOff.ok) throw new Error("The graph with an unavailable model did not save.");
  const unavailable = (
    await runCauseEffect(workflows.runStep({ workflowId, nodeId: "poster", requestId: "paid-unavailable" }))
  ).id;
  await until("the step with an unavailable model ends", () => stored(unavailable).status !== "running");
  check(
    "a step whose credit model is not in the catalog fails as not available and sends no job",
    stored(unavailable).status === "failed" &&
      stored(unavailable).error === sourceText("error.workflow.modelUnavailable") &&
      !jobs.has(unavailable),
    { step: stored(unavailable) },
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
