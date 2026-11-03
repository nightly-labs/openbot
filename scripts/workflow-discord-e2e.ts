// Checks Discord triggers and outputs of workflows on the real SQLite and the real workflow service, on
// a temporary profile. The Discord connection is a row in the real table; only the send to Discord is a
// stand-in, so no Signal, provider, account or network is started. A mention starts the matching
// workflow; a reaction acts on the mention; a reply does not post the trigger's raw event; a mention
// that Signal gives again while its run is open is not skipped; a webhook payload that copies a
// mention's event cannot make an output reply to or react on a Discord message.
//
// Run: bun scripts/workflow-discord-e2e.ts
// Writes .openbot-build/workflow-discord-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkflowGraph, WorkflowNode, WorkflowRunDetail } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { MessagingDiscordMention, MessagingDiscordSend } from "../src/backend/messaging/messaging-threads";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { EXTERNAL_EVENT_START } from "../src/backend/webhook-trigger";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-discord-e2e");
const CONNECTION = "messaging-discord-e2e";
const CHANNEL = "110000000000000001";
const WAIT_MS = 5_000;

interface Report {
  checks: string[];
  /** The sends without their text: the action, the channel and the message. */
  sends: { connectionId: string; action: string; channelId: string; messageId: string | null }[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], sends: [], passed: false };
const sends: MessagingDiscordSend[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

/** `hang` keeps the next sends open, so that their run stays open. */
let answer: "posted" | "hang" = "posted";

const node = (id: string, kind: WorkflowNode["kind"], fields: WorkflowNode["fields"], x: number): WorkflowNode => ({
  id,
  kind,
  at: { x, y: 0 },
  fields,
});
/** A trigger with a reply output and a reaction output, both on the trigger's message. */
const graphOf = (trigger: WorkflowNode): WorkflowGraph => ({
  nodes: [
    trigger,
    node("reply", "output", { target: "discord", connectionId: "trigger", action: "reply" }, 300),
    node("react", "output", { target: "discord", connectionId: "trigger", action: "react", emoji: "✅" }, 300),
  ],
  edges: [
    { id: "to-reply", from: trigger.id, to: "reply", type: "text" },
    { id: "to-react", from: trigger.id, to: "react", type: "text" },
  ],
  strokes: [],
});
const discordTrigger = node(
  "trigger",
  "trigger",
  { trigger: "discord", event: "mention", connectionId: CONNECTION, placeId: "", text: "deploy" },
  0,
);
const webhookTrigger = node("trigger", "trigger", { trigger: "webhook" }, 0);

let nextMessage = 700000000000000000n;
const mentionOf = (text: string): MessagingDiscordMention => {
  nextMessage += 1n;
  return {
    connectionId: CONNECTION,
    serverName: "Nightly",
    channelId: CHANNEL,
    channelName: "general",
    messageId: nextMessage.toString(),
    authorId: "500000000000000002",
    authorName: "Bob",
    authorRoleIds: [],
    text,
    files: [],
    receivedAt: new Date().toISOString(),
  };
};

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-discord-"));
const database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

async function open() {
  await Effect.runPromise(database.initialize());
  service = await Effect.runPromise(
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
      connectionOn: (connectionId) =>
        database.connection
          .prepare("SELECT 1 FROM projection_messaging_connections WHERE connection_id = ? AND enabled = 1")
          .get(connectionId) !== undefined,
      post: () => Effect.succeed({ failure: "refused" as const }),
      discordSend: (connectionId, send) =>
        Effect.suspend(() => {
          sends.push(send);
          report.sends.push({
            connectionId,
            action: send.action,
            channelId: send.channelId,
            messageId: send.action === "post" ? null : send.messageId,
          });
          return answer === "hang" ? Effect.never : Effect.succeed({ posted: true as const });
        }),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  return service;
}

async function close() {
  if (service) await Effect.runPromise(service.close());
  service = null;
  database.close();
}

async function workflowWith(workflows: WorkflowsHandle, title: string, graph: WorkflowGraph) {
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(saved.ok);
  return created.summary.id;
}

/** Waits for the newest run of a workflow to reach a state. */
async function newestRun(
  workflows: WorkflowsHandle,
  workflowId: string,
  until: (run: WorkflowRunDetail) => boolean,
): Promise<WorkflowRunDetail> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const newest = (await runCauseEffect(workflows.runs({ workflowId, limit: 1 }))).runs[0];
    if (newest && until(newest)) return newest;
    if (Date.now() > deadline) throw new Error(`The run did not reach the state: ${JSON.stringify(newest?.run)}`);
    await new Promise((done) => setImmediate(done));
  }
}
const ended = (detail: WorkflowRunDetail) => detail.run.status !== "running" && detail.run.status !== "stopping";
const stepOf = (detail: WorkflowRunDetail, nodeId: string) => detail.steps.find((step) => step.nodeId === nodeId);

try {
  const workflows = await open();
  const now = new Date().toISOString();
  database.connection
    .prepare(
      `INSERT INTO projection_messaging_connections
         (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
       VALUES (?, 'discord', '100000000000000001', 'Nightly', 1, ?, ?)`,
    )
    .run(CONNECTION, now, now);

  const deploy = await workflowWith(workflows, "Deploy", graphOf(discordTrigger));

  check(
    "a mention that no trigger matches stays with the agents",
    (await runCauseEffect(workflows.receiveDiscord(mentionOf("hello")))) === "none",
  );

  const first = mentionOf("please deploy now");
  check("a matching mention starts a run", (await runCauseEffect(workflows.receiveDiscord(first))) === "started");
  const firstRun = await newestRun(workflows, deploy, ended);
  check(
    "the reaction acts on the mention",
    report.sends.some(
      (send) => send.action === "react" && send.messageId === first.messageId && send.channelId === CHANNEL,
    ),
    report.sends,
  );
  const reply = stepOf(firstRun, "reply");
  check(
    "a reply with only the trigger's event fails and posts nothing",
    reply?.status === "failed" &&
      reply.error === sourceText("error.workflow.githubEventText") &&
      !sends.some((send) => send.action === "reply"),
    reply,
  );
  check(
    "no send carries the trigger's raw event",
    sends.every((send) => send.action === "react" || !send.text.includes(EXTERNAL_EVENT_START)),
  );

  // The reaction does not answer, so the run stays open.
  answer = "hang";
  const repeated = mentionOf("deploy again");
  check("a second mention starts a run", (await runCauseEffect(workflows.receiveDiscord(repeated))) === "started");
  await newestRun(workflows, deploy, (detail) => detail.run.id !== firstRun.run.id);
  check(
    "the same mention again, while its run is open, is not skipped",
    (await runCauseEffect(workflows.receiveDiscord(repeated))) === "started",
  );
  check(
    "another mention, while the run is open, is skipped",
    (await runCauseEffect(workflows.receiveDiscord(mentionOf("deploy once more")))) === "skipped",
  );
  check(
    "the repeated mention made no second run",
    (await runCauseEffect(workflows.runs({ workflowId: deploy, limit: 10 }))).runs.length === 2,
  );
  answer = "posted";

  const hook = await workflowWith(workflows, "Hook", graphOf(webhookTrigger));
  const before = sends.length;
  const received = await runCauseEffect(
    workflows.receiveWebhook({
      workflowId: hook,
      nodeId: "trigger",
      event: {
        deliveryId: "delivery-1",
        eventType: "discord.mention",
        data: { connectionId: CONNECTION, channelId: CHANNEL, messageId: first.messageId },
        occurredAt: now,
        receivedAt: now,
      },
    }),
  );
  check("the webhook starts a run", received.kind === "started");
  const hookRun = await newestRun(workflows, hook, ended);
  const noMessage = sourceText("error.workflow.discordNoMessage");
  check(
    "a webhook event shaped as a mention cannot reply or react in Discord",
    sends.length === before &&
      stepOf(hookRun, "reply")?.error === noMessage &&
      stepOf(hookRun, "react")?.error === noMessage,
    hookRun.steps,
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${report.checks.length} checks; ${OUT}/report.json\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
