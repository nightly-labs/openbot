// Checks Slack triggers and outputs of workflows on the real SQLite and the real workflow service, on a
// temporary profile. The Slack connection is a row in the real table; only the send to Slack is a
// stand-in, as is the model step's answer, so no Signal, provider, account or network is started. A mention starts the matching
// workflow; a reply goes to the mention's thread; a reaction acts on the mention with its Slack name; a
// post goes to the chosen channel; a reply does not post the trigger's raw event; the same message
// timestamp in another channel is another mention; a webhook payload that copies a mention's event
// cannot make an output reply to or react on a Slack message.
//
// Run: bun scripts/workflow-slack-e2e.ts
// Writes .openbot-build/workflow-slack-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkflowGraph, WorkflowNode, WorkflowRunDetail } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { MessagingSlackMention, MessagingSlackSend } from "../src/backend/messaging/messaging-threads";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { EXTERNAL_EVENT_START } from "../src/backend/webhook-trigger";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-slack-e2e");
const CONNECTION = "messaging-slack-e2e";
const CHANNEL = "C0E2E00001";
const OTHER_CHANNEL = "C0E2E00002";
const ANNOUNCE = "C0E2E00003";
const WAIT_MS = 5_000;

interface Report {
  checks: string[];
  /** The sends without their text: the action, the channel, the thread or message, and the emoji. */
  sends: { connectionId: string; action: string; channelId: string; target: string | null; emoji?: string }[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], sends: [], passed: false };
const sends: MessagingSlackSend[] = [];
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
const ANSWER_TEXT = "Deploy started.";
/**
 * A trigger with a reply of a model step, a reply of the trigger's event, a reaction and a post in another
 * channel.
 */
const graphOf = (trigger: WorkflowNode): WorkflowGraph => ({
  nodes: [
    trigger,
    node("answer", "llm", { text: "Answer the mention." }, 300),
    node("reply", "output", { target: "slack", connectionId: "trigger", action: "reply" }, 600),
    node("raw", "output", { target: "slack", connectionId: "trigger", action: "reply" }, 300),
    node("react", "output", { target: "slack", connectionId: "trigger", action: "react", emoji: "✅" }, 300),
    node("post", "output", { target: "slack", connectionId: CONNECTION, action: "post", placeId: ANNOUNCE }, 600),
  ],
  edges: [
    { id: "to-answer", from: trigger.id, to: "answer", type: "text" },
    { id: "to-reply", from: "answer", to: "reply", type: "text" },
    { id: "to-post", from: "answer", to: "post", type: "text" },
    { id: "to-raw", from: trigger.id, to: "raw", type: "text" },
    { id: "to-react", from: trigger.id, to: "react", type: "text" },
  ],
  strokes: [],
});
const slackTrigger = node(
  "trigger",
  "trigger",
  { trigger: "slack", event: "mention", connectionId: CONNECTION, placeId: "", text: "deploy" },
  0,
);
const webhookTrigger = node("trigger", "trigger", { trigger: "webhook" }, 0);

let nextSecond = 1_760_000_000;
const mentionOf = (text: string, options: { channelId?: string; messageId?: string; threadId?: string } = {}) => {
  nextSecond += 1;
  const messageId = options.messageId ?? `${nextSecond}.000100`;
  return {
    connectionId: CONNECTION,
    workspaceName: "Nightly",
    channelId: options.channelId ?? CHANNEL,
    channelName: "general",
    messageId,
    threadId: options.threadId ?? messageId,
    authorId: "U0E2E0BOB",
    authorName: "Bob",
    text,
    files: [],
    receivedAt: new Date().toISOString(),
  } satisfies MessagingSlackMention;
};

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-slack-"));
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
      // The model step answers with fixed text, so no provider starts.
      generateText: () => Effect.succeed(ANSWER_TEXT),
      notify: () => {},
      connectionOn: (connectionId) =>
        database.connection
          .prepare("SELECT 1 FROM projection_messaging_connections WHERE connection_id = ? AND enabled = 1")
          .get(connectionId) !== undefined,
      post: () => Effect.succeed({ failure: "refused" as const }),
      discordSend: () => Effect.succeed({ failure: "refused" as const }),
      slackSend: (connectionId, send) =>
        Effect.suspend(() => {
          sends.push(send);
          report.sends.push({
            connectionId,
            action: send.action,
            channelId: send.channelId,
            target: send.action === "reply" ? send.threadId : send.action === "react" ? send.messageId : null,
            ...(send.action === "react" ? { emoji: send.emoji } : {}),
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
       VALUES (?, 'slack', 'T0E2E00001', 'Nightly', 1, ?, ?)`,
    )
    .run(CONNECTION, now, now);

  const deploy = await workflowWith(workflows, "Deploy", graphOf(slackTrigger));

  check(
    "a mention that no trigger matches stays with the agents",
    (await runCauseEffect(workflows.receiveSlack(mentionOf("hello")))) === "none",
  );

  const thread = `${nextSecond + 100}.000100`;
  const first = mentionOf("please deploy now", { threadId: thread });
  check("a matching mention starts a run", (await runCauseEffect(workflows.receiveSlack(first))) === "started");
  const firstRun = await newestRun(workflows, deploy, ended);
  check("the run's source is Slack", firstRun.run.source === "slack", firstRun.run);
  check(
    "the reply goes to the mention's thread",
    sends.some(
      (send) =>
        send.action === "reply" && send.channelId === CHANNEL && send.threadId === thread && send.text === ANSWER_TEXT,
    ),
    report.sends,
  );
  check(
    "the reaction acts on the mention with the Slack name of the emoji",
    sends.some(
      (send) =>
        send.action === "react" &&
        send.channelId === CHANNEL &&
        send.messageId === first.messageId &&
        send.emoji === "white_check_mark",
    ),
    report.sends,
  );
  check(
    "the post goes to the chosen channel",
    sends.some((send) => send.action === "post" && send.channelId === ANNOUNCE && send.text === ANSWER_TEXT),
    report.sends,
  );
  const raw = stepOf(firstRun, "raw");
  check(
    "a reply with only the trigger's event fails",
    raw?.status === "failed" && raw.error === sourceText("error.workflow.githubEventText"),
    raw,
  );
  check(
    "no send carries the trigger's raw event",
    sends.every((send) => send.action === "react" || !send.text.includes(EXTERNAL_EVENT_START)),
  );

  const sameStamp = mentionOf("deploy there", { channelId: OTHER_CHANNEL, messageId: first.messageId });
  check(
    "the same timestamp in another channel is another mention",
    (await runCauseEffect(workflows.receiveSlack(sameStamp))) === "started",
  );
  const sameStampRun = await newestRun(
    workflows,
    deploy,
    (detail) => detail.run.id !== firstRun.run.id && ended(detail),
  );

  // The sends do not answer, so the run stays open.
  answer = "hang";
  const repeated = mentionOf("deploy again");
  check("a third mention starts a run", (await runCauseEffect(workflows.receiveSlack(repeated))) === "started");
  await newestRun(workflows, deploy, (detail) => detail.run.id !== sameStampRun.run.id);
  check(
    "the same mention again, while its run is open, is not skipped",
    (await runCauseEffect(workflows.receiveSlack(repeated))) === "started",
  );
  check(
    "another mention, while the run is open, is skipped",
    (await runCauseEffect(workflows.receiveSlack(mentionOf("deploy once more")))) === "skipped",
  );
  check(
    "the repeated mention made no second run",
    (await runCauseEffect(workflows.runs({ workflowId: deploy, limit: 10 }))).runs.length === 3,
  );
  answer = "posted";

  const hook = await workflowWith(workflows, "Hook", graphOf(webhookTrigger));
  /** The replies and reactions on the first mention; only the first run made them. */
  const onFirst = () =>
    sends.filter(
      (send) =>
        send.channelId === CHANNEL &&
        ((send.action === "react" && send.messageId === first.messageId) ||
          (send.action === "reply" && send.threadId === thread)),
    ).length;
  const received = await runCauseEffect(
    workflows.receiveWebhook({
      workflowId: hook,
      nodeId: "trigger",
      event: {
        deliveryId: "delivery-1",
        eventType: "slack.mention",
        data: { connectionId: CONNECTION, channelId: CHANNEL, messageId: first.messageId, threadId: thread },
        occurredAt: now,
        receivedAt: now,
      },
    }),
  );
  check("the webhook starts a run", received.kind === "started");
  const hookRun = await newestRun(workflows, hook, ended);
  const noMessage = sourceText("error.workflow.slackNoMessage");
  check(
    "a webhook event shaped as a mention cannot reply or react in Slack",
    onFirst() === 2 && stepOf(hookRun, "reply")?.error === noMessage && stepOf(hookRun, "react")?.error === noMessage,
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
