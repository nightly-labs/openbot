// Checks the output of workflows into an OpenBot channel on the real SQLite, the real channel service
// and the real workflow service, on a temporary profile. No agent, provider, account or network is
// started. An output with no channel fails; a post shows the input in the channel as a note of the
// workflow, and starts no task; empty text posts nothing; a missing or an archived channel fails the step
// with its sentence; a second post with the same operation id adds nothing; after a restart between the
// post and the end of the step, the step ends as done and the channel keeps one note.
//
// Run: bun scripts/workflow-channel-output-e2e.ts
// Writes .openbot-build/workflow-channel-output-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChannelMessage, WorkflowGraph, WorkflowNode, WorkflowStep } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelService } from "../src/backend/channel-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-channel-output-e2e");
const CHANNEL = "channel-e2e";
const ARCHIVED = "channel-e2e-archived";
const OWNER = { id: "member-e2e", name: "Owner" };
const WAIT_MS = 5_000;

interface Report {
  checks: string[];
  notes: Pick<ChannelMessage, "author" | "taskId">[];
  scheduled: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], notes: [], scheduled: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const graphOf = (text: string, output: WorkflowNode["fields"]): WorkflowGraph => ({
  nodes: [
    { id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text } },
    { id: "output", kind: "output", at: { x: 300, y: 0 }, fields: { target: "chat-channel", ...output } },
  ],
  edges: [{ id: "edge", from: "prompt", to: "output", type: "text" }],
  strokes: [],
});

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-channel-output-"));
let database = new OpenBotDatabase(directory);
let channels: ChannelService | null = null;
let service: WorkflowsHandle | null = null;

async function open() {
  await Effect.runPromise(database.initialize());
  const channelService = new ChannelService(
    database,
    new MailboxStore(directory, join(directory, "shared"), database),
    new ChannelImages(join(directory, "channel-images")),
    {
      agents: () => [],
      generate: () => Effect.die(new Error("No model runs in this test.")),
      schedule: (agentId) => report.scheduled.push(agentId),
      interrupt: () => Effect.void,
      busy: () => false,
      changed: () => {},
      error: (error) => {
        throw error;
      },
    },
  );
  channels = channelService;
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
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No messaging post runs in this test.")),
      channelPost: (input) => channelService.postNote(input),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  service = workflows;
  return { workflows, channels: channelService };
}

async function close() {
  if (service) await Effect.runPromise(service.close());
  if (channels) await Effect.runPromise(channels.stop());
  service = null;
  channels = null;
  database.close();
}

/** Waits for the output step of a run to end. */
async function outputStep(workflows: WorkflowsHandle, runId: string): Promise<WorkflowStep> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const steps = (await runCauseEffect(workflows.run(runId))).steps.filter((step) => step.nodeId === "output");
    const newest = steps.sort((a, b) => b.attempt - a.attempt)[0];
    if (newest && newest.status !== "running") return newest;
    if (Date.now() > deadline) throw new Error(`The output step did not end: ${JSON.stringify(newest)}`);
    await new Promise((done) => setImmediate(done));
  }
}

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
const draft = (name: string) => ({ name, title: "", instructions: "", members: [], leadAgentId: null });
const notesOf = (service: ChannelService) =>
  service.store.messages(CHANNEL).filter((entry) => entry.author.kind === "coordinator");

try {
  let opened = await open();
  for (const channelId of [CHANNEL, ARCHIVED])
    await runCauseEffect(
      opened.channels.command(
        { type: "save", operationId: `save-${channelId}`, channelId, draft: draft(channelId) },
        OWNER,
      ),
    );
  await runCauseEffect(
    opened.channels.command({ type: "archive", operationId: "archive", channelId: ARCHIVED }, OWNER),
  );

  const noChannel = await workflowWith(opened.workflows, "No channel", graphOf("Hello", {}));
  let step = await outputStep(opened.workflows, (await runOnce(opened.workflows, noChannel)).id);
  check(
    "an output with no channel fails and posts nothing",
    step.status === "failed" &&
      step.error === sourceText("error.workflow.outputChannelMissing") &&
      notesOf(opened.channels).length === 0,
    step,
  );

  const digest = await workflowWith(
    opened.workflows,
    "Daily digest",
    graphOf("Three new competitors.", { channelId: CHANNEL }),
  );
  step = await outputStep(opened.workflows, (await runOnce(opened.workflows, digest)).id);
  check(
    "a post ends the step as done with its input",
    step.status === "done" && step.output === "Three new competitors.",
    step,
  );
  const [note] = notesOf(opened.channels);
  report.notes = notesOf(opened.channels).map(({ author, taskId }) => ({ author, taskId }));
  check(
    "the channel shows the input as a note of the workflow",
    notesOf(opened.channels).length === 1 &&
      note?.message.text === "Three new competitors." &&
      note.author.id === `workflow:${digest}` &&
      note.author.name === "Daily digest" &&
      note.taskId === null,
    note,
  );
  check(
    "the note starts no task and asks no agent",
    opened.channels.store.tasks(CHANNEL).length === 0 && report.scheduled.length === 0,
  );

  const quiet = await workflowWith(opened.workflows, "Quiet", graphOf("   ", { channelId: CHANNEL }));
  step = await outputStep(opened.workflows, (await runOnce(opened.workflows, quiet)).id);
  check("empty text posts nothing", step.status === "done" && notesOf(opened.channels).length === 1, step);

  for (const [channelId, key] of [
    ["channel-e2e-missing", "error.backend.channelNotFound"],
    [ARCHIVED, "error.backend.channelArchived"],
  ] as const) {
    const workflowId = await workflowWith(opened.workflows, channelId, graphOf("Hello", { channelId }));
    step = await outputStep(opened.workflows, (await runOnce(opened.workflows, workflowId)).id);
    check(
      `a post into the ${channelId} channel fails the step with its sentence`,
      step.status === "failed" && step.error === sourceText(key),
      step,
    );
  }
  check(
    "the archived channel gets no note",
    opened.channels.store.messages(ARCHIVED).every((entry) => entry.author.kind !== "coordinator"),
  );

  const again = {
    operationId: "same",
    channelId: CHANNEL,
    author: { id: "workflow:same", name: "Same" },
    text: "Once",
  };
  await runCauseEffect(opened.channels.postNote(again));
  await runCauseEffect(opened.channels.postNote(again));
  check(
    "a second post with the same operation id adds nothing",
    notesOf(opened.channels).filter((entry) => entry.message.text === "Once").length === 1,
  );

  // A restart between the post and the end of the step: the first pass after it ends the step and posts
  // nothing more.
  const run = await runOnce(opened.workflows, digest);
  const posted = await outputStep(opened.workflows, run.id);
  const notesBefore = notesOf(opened.channels).length;
  await close();
  database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  database.connection
    .prepare("UPDATE workflow_steps SET status = 'running', ended_at = NULL, output = NULL WHERE step_id = ?")
    .run(posted.id);
  database.connection
    .prepare("UPDATE workflow_runs SET status = 'running', ended_at = NULL WHERE run_id = ?")
    .run(run.id);
  database.close();
  database = new OpenBotDatabase(directory);
  opened = await open();
  await runCauseEffect(opened.workflows.sweep());
  step = await outputStep(opened.workflows, run.id);
  check(
    "after a restart the step ends as done and the channel keeps one note of it",
    step.status === "done" && notesOf(opened.channels).length === notesBefore,
    { step, notes: notesOf(opened.channels).length, notesBefore },
  );

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
