import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  WORKFLOW_FORMAT,
  WORKFLOW_TRIGGER_FIELDS_FORMAT,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowRunDetail,
  workflowAnswerProblems,
  workflowGraphFormat,
  workflowInputAnswerFields,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { WorkflowGitHubApi } from "../src/backend/workflows/workflow-github-api";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowNotice, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-trigger-fields-e2e");
const WAIT_MS = 5_000;
const REPOSITORY = "acme/app";
const RECEIVED_AT = "2026-11-22T12:00:00.000Z";

interface Report {
  checks: string[];
  notices: WorkflowNotice[];
  formats: Record<string, number>;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], notices: [], formats: {}, passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const node = (id: string, kind: WorkflowNode["kind"], x: number, fields: WorkflowNode["fields"]): WorkflowNode => ({
  id,
  kind,
  at: { x, y: 0 },
  fields,
});

const chain = (trigger: WorkflowNode["fields"], steps: readonly WorkflowNode[]): WorkflowGraph => ({
  nodes: [node("trigger", "trigger", 0, trigger), ...steps],
  edges: steps.map((step, index) => {
    const from = index === 0 ? undefined : steps[index - 1];
    return {
      id: `edge-${step.id}`,
      from: from?.id ?? "trigger",
      to: step.id,
      type: "text" as const,
      ...(from?.kind === "condition" ? { branch: "yes" as const } : {}),
    };
  }),
  strokes: [],
});

const notify = (id: string, fields: WorkflowNode["fields"]) => node(id, "output", 600, { target: "notify", ...fields });

const githubTrigger = { trigger: "github", repository: REPOSITORY, event: "issue.opened" };

const githubBranches: WorkflowGraph = {
  nodes: [
    node("trigger", "trigger", 0, githubTrigger),
    node("check", "condition", 300, { check: "author = ana and number > 10" }),
    notify("yes", { message: "{{title}} #{{number}} by {{author}}, labels {{labels}}" }),
    notify("no", { message: "Not for ana: {{author}}" }),
  ],
  edges: [
    { id: "trigger-check", from: "trigger", to: "check", type: "text" },
    { id: "check-yes", from: "check", to: "yes", type: "text", branch: "yes" },
    { id: "check-no", from: "check", to: "no", type: "text", branch: "no" },
  ],
  strokes: [],
};

const issueBody = (number: number, author: string) => ({
  action: "opened",
  repository: { full_name: REPOSITORY },
  sender: { login: author, type: "User" },
  issue: {
    number,
    title: "Login fails",
    body: "Users cannot log in.",
    html_url: `https://github.com/${REPOSITORY}/issues/${number}`,
    state: "open",
    labels: [{ name: "bug" }, { name: "auth" }],
    user: { login: author, type: "User" },
  },
});

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-trigger-fields-"));
const database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

const githubApi: WorkflowGitHubApi = {
  attachFiles: (change) => Effect.succeed({ ...change, files: null }),
  change: () => Effect.die(new Error("No GitHub change runs in this test.")),
  options: () => Effect.succeed({ labels: [], people: [] }),
  recentEvents: () => Effect.succeed([]),
};

const ended = (detail: WorkflowRunDetail) => detail.run.status !== "running" && detail.run.status !== "stopping";
const stepOf = (detail: WorkflowRunDetail, nodeId: string) =>
  detail.steps.filter((step) => step.nodeId === nodeId).sort((a, b) => b.attempt - a.attempt)[0];

async function lastRun(workflowId: string): Promise<WorkflowRunDetail> {
  assert.ok(service);
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    await Effect.runPromise(service.sweep());
    const page = await runCauseEffect(service.runs({ workflowId, limit: 1 }));
    const detail = page.runs[0];
    if (detail && ended(detail)) return detail;
    if (Date.now() > deadline) throw new Error(`No run ended: ${JSON.stringify(page)}`);
    await new Promise((done) => setImmediate(done));
  }
}

async function saved(title: string, graph: WorkflowGraph) {
  assert.ok(service);
  const created = await runCauseEffect(service.create({ title }));
  const result = await runCauseEffect(
    service.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(result.ok, JSON.stringify(result));
  return created.summary.id;
}

const lastNotice = () => report.notices.at(-1);

try {
  await Effect.runPromise(database.initialize());
  service = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      githubApi,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.die(new Error("No model step runs in this test.")),
      notify: (notice) => report.notices.push(notice),
      connectionOn: () => false,
      post: () => Effect.die(new Error("No channel output runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  const workflows = service;

  const declared: WorkflowGraph = chain(githubTrigger, [
    node("model", "llm", 300, { prompt: "Sort it.", answer: "title: text" }),
    notify("tell", { title: "{{title}}" }),
  ]);
  const plainGitHub = chain(githubTrigger, [notify("tell", {})]);
  const titled = chain(githubTrigger, [notify("tell", { title: "{{title}}" })]);
  report.formats = {
    note: workflowGraphFormat({
      ...plainGitHub,
      nodes: [...plainGitHub.nodes, node("note", "text", 600, { text: "{{title}}" })],
    }),
    otherBranch: workflowGraphFormat({
      ...titled,
      nodes: [...titled.nodes, node("other", "llm", 600, { prompt: "Sort it.", answer: "title: text" })],
    }),
    branches: workflowGraphFormat(githubBranches),
    checkOnly: workflowGraphFormat(chain(githubTrigger, [node("check", "condition", 300, { check: "actor = ana" })])),
    declared: workflowGraphFormat(declared),
    plain: workflowGraphFormat(plainGitHub),
  };
  check(
    "a graph that reads a built-in trigger field needs format 3; a declared name or no name keeps the older format",
    WORKFLOW_FORMAT >= WORKFLOW_TRIGGER_FIELDS_FORMAT &&
      report.formats.branches === WORKFLOW_TRIGGER_FIELDS_FORMAT &&
      report.formats.checkOnly === WORKFLOW_TRIGGER_FIELDS_FORMAT &&
      report.formats.declared === 2 &&
      report.formats.plain === 1 &&
      report.formats.note === 1 &&
      report.formats.otherBranch === WORKFLOW_TRIGGER_FIELDS_FORMAT,
    report.formats,
  );

  const olderHost = { triggerFields: false };
  check(
    "the editor offers the built-in fields of a trigger only when the host has format 3",
    workflowAnswerProblems(githubBranches).length === 0 &&
      workflowAnswerProblems(githubBranches, olderHost).some(
        (problem) => problem.code === "template" && problem.name === "title",
      ) &&
      workflowInputAnswerFields(githubBranches, "yes").has("labels") &&
      workflowInputAnswerFields(githubBranches, "yes", olderHost).size === 0,
    {
      host: workflowAnswerProblems(githubBranches),
      olderHost: workflowAnswerProblems(githubBranches, olderHost),
    },
  );

  const githubId = await saved("GitHub fields", githubBranches);
  const githubDetail = await runCauseEffect(workflows.get(githubId));
  check(
    "the host saves the graph as format 3 and says its own format",
    githubDetail.format === WORKFLOW_TRIGGER_FIELDS_FORMAT && githubDetail.hostFormat === WORKFLOW_FORMAT,
    { format: githubDetail.format, hostFormat: githubDetail.hostFormat },
  );

  const received = await runCauseEffect(
    workflows.receiveGitHub({ event: "issues", deliveryId: "delivery-ana", body: issueBody(12, "ana") }),
  );
  const anaRun = await lastRun(githubId);
  check(
    "a check reads the GitHub author and number with no model step, and the message fills the issue fields",
    received.kind === "saved" &&
      stepOf(anaRun, "check")?.branch === "yes" &&
      stepOf(anaRun, "yes")?.status === "done" &&
      stepOf(anaRun, "no")?.status === "skipped" &&
      lastNotice()?.text === "Login fails #12 by ana, labels bug, auth",
    { steps: anaRun.steps, notice: lastNotice() },
  );

  await runCauseEffect(
    workflows.receiveGitHub({ event: "issues", deliveryId: "delivery-ben", body: issueBody(13, "ben") }),
  );
  const benRun = await lastRun(githubId);
  check(
    "the same check takes the other branch for another author",
    benRun.run.id !== anaRun.run.id &&
      stepOf(benRun, "check")?.branch === "no" &&
      stepOf(benRun, "yes")?.status === "skipped" &&
      lastNotice()?.text === "Not for ana: ben",
    { steps: benRun.steps, notice: lastNotice() },
  );

  const discordId = await saved(
    "Discord fields",
    chain({ trigger: "discord", event: "mention", connectionId: "discord-1" }, [
      notify("tell", { message: "{{author}} in #{{channel}} on {{server}}: {{text}}" }),
    ]),
  );
  const discord = await runCauseEffect(
    workflows.receiveDiscord({
      connectionId: "discord-1",
      serverName: "Acme",
      channelId: "c-1",
      channelName: "support",
      messageId: "m-1",
      authorId: "u-1",
      authorName: "ana",
      authorRoleIds: [],
      text: "the login is broken",
      files: [],
      receivedAt: RECEIVED_AT,
    }),
  );
  const discordRun = await lastRun(discordId);
  check(
    "a Discord mention gives the author, channel, server and text",
    discord === "started" &&
      stepOf(discordRun, "tell")?.status === "done" &&
      lastNotice()?.text === "ana in #support on Acme: the login is broken",
    { steps: discordRun.steps, notice: lastNotice() },
  );

  const telegramId = await saved(
    "Telegram fields",
    chain({ trigger: "telegram", event: "mention" }, [notify("tell", { message: "{{author}} in {{chat}}: {{text}}" })]),
  );
  const telegram = await runCauseEffect(
    workflows.receiveTelegram({
      connectionId: "telegram-1",
      chatName: "Team",
      chatId: "chat-1",
      threadKey: "thread-1",
      messageId: "m-2",
      authorId: "u-2",
      authorName: "ben",
      text: "deploy is done",
      receivedAt: RECEIVED_AT,
    }),
  );
  const telegramRun = await lastRun(telegramId);
  check(
    "a Telegram message gives the author, chat and text",
    telegram === "started" &&
      stepOf(telegramRun, "tell")?.status === "done" &&
      lastNotice()?.text === "ben in Team: deploy is done",
    { steps: telegramRun.steps, notice: lastNotice() },
  );

  const slackId = await saved(
    "Slack fields",
    chain({ trigger: "slack", event: "mention", connectionId: "slack-1" }, [
      node("check", "condition", 300, { check: "thread_id and author = cy" }),
      notify("tell", { message: "{{author}} in #{{channel}} ({{workspace}}), thread {{thread_id}}" }),
    ]),
  );
  const slack = await runCauseEffect(
    workflows.receiveSlack({
      connectionId: "slack-1",
      workspaceName: "Acme",
      channelId: "c-2",
      channelName: "ops",
      messageId: "m-3",
      threadId: "t-3",
      authorId: "u-3",
      authorName: "cy",
      text: "please look",
      files: [],
      receivedAt: RECEIVED_AT,
    }),
  );
  const slackRun = await lastRun(slackId);
  check(
    "a Slack mention gives the author, channel, workspace and thread",
    slack === "started" &&
      stepOf(slackRun, "check")?.branch === "yes" &&
      lastNotice()?.text === "cy in #ops (Acme), thread t-3",
    { steps: slackRun.steps, notice: lastNotice() },
  );

  const scheduleId = await saved(
    "Schedule fields",
    chain({ trigger: "schedule", timezone: "Europe/Warsaw" }, [
      notify("tell", { message: "{{weekday}} {{local_date}} {{local_time}} ({{run_time}}) {{there}}" }),
    ]),
  );
  await runCauseEffect(
    workflows.startScheduled({ workflowId: scheduleId, nodeId: "trigger", scheduledFor: "2026-11-23T09:30:00.000Z" }),
  );
  const scheduleRun = await lastRun(scheduleId);
  check(
    "a schedule gives the local day, date and time, and a name that no step gives stays as written",
    stepOf(scheduleRun, "tell")?.status === "done" &&
      lastNotice()?.text === "Monday 2026-11-23 10:30 (2026-11-23T09:30:00.000Z) {{there}}",
    { steps: scheduleRun.steps, notice: lastNotice() },
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    if (service) await Effect.runPromise(service.close());
    database.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });
  const artifact = join(OUT, "report.json");
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${artifact}\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
