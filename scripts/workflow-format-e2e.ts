import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  decodeWorkflowFile,
  encodeWorkflowFile,
  fillWorkflowFileText,
  WORKFLOW_FORMAT,
  type WorkflowDetail,
  type WorkflowFileSource,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowRunDetail,
  workflowFileHostExport,
  workflowFromFile,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { decodeRemoteWorkflowDetail } from "../packages/team-client/src/workflow-decoding";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";
import { exportWorkflows, importWorkflows } from "../src/main/instance-transfer-workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-format-e2e");
const APP_VERSION = String(JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")).version);
const WAIT_MS = 10_000;
const AGENT_A = "agent-on-host-a";
const AGENT_B = "agent-on-host-b";

interface FixtureResult {
  title: string;
  pr: string;
  format: number;
  run: string;
  steps: Record<string, string>;
}

interface Report {
  checks: string[];
  fixtures: FixtureResult[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], fixtures: [], passed: false };
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
const edge = (from: string, to: string, extra: Partial<WorkflowGraph["edges"][number]> = {}) => ({
  id: `${from}-${to}`,
  from,
  to,
  type: "text" as const,
  ...extra,
});
const graphOf = (nodes: WorkflowNode[], edges: WorkflowGraph["edges"]): WorkflowGraph => ({
  nodes,
  edges,
  strokes: [],
});

const sortedJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    isDynamicRecord(item) && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const same = (left: unknown, right: unknown) => sortedJson(left) === sortedJson(right);

interface Fixture {
  title: string;
  pr: string;
  format: number;
  graph: WorkflowGraph;
  replies?: string[];
  steps: Record<string, string> | "refused";
}

const TRIGGER = node("start", "trigger", 0, { trigger: "manual" });

const FIXTURES: Fixture[] = [
  {
    title: "First kinds, ports and branches",
    pr: "#3062, #3283",
    format: 1,
    graph: graphOf(
      [
        TRIGGER,
        node("brief", "prompt", 0, { text: "Plan the launch." }),
        node("logo", "asset", 0, { fileId: "file-logo", file: "logo.png" }),
        node("plan", "llm", 300, { prompt: "Make a plan.", system: "Be short." }),
        node("ok", "condition", 600, { rule: "The plan has three steps." }),
        node("writer", "agent", 900, { agentId: AGENT_A, task: "Write the post." }),
        node("ask", "approval", 1200, { question: "Post it?" }),
        node("done", "output", 1500, { target: "notify" }),
        node("later", "output", 900, { target: "channel" }),
        node("words", "text", 0, { text: "Notes for the team." }),
        node("hint", "note", 0, { text: "Ask Ola first." }),
        { ...node("box", "shape", 0, { text: "" }), size: { width: 400, height: 300 } },
      ],
      [
        edge("start", "plan"),
        edge("brief", "plan"),
        edge("logo", "writer", { type: "image" }),
        edge("plan", "ok"),
        edge("ok", "writer", { branch: "yes" }),
        edge("ok", "later", { branch: "no" }),
        edge("writer", "ask"),
        edge("ask", "done"),
      ],
    ),
    replies: ["A plan.", "yes"],
    steps: { plan: "done", ok: "done", writer: "done", ask: "done", done: "done", later: "skipped" },
  },
  {
    title: "Saved steps that never ran",
    pr: "#3062",
    format: 1,
    graph: graphOf(
      [
        node("start", "trigger", 0, { trigger: "message" }),
        node("brief", "prompt", 0, { text: "Keep a copy." }),
        node("save", "output", 300, { target: "file" }),
      ],
      [edge("start", "save"), edge("brief", "save")],
    ),
    steps: "refused",
  },
  {
    title: "GitHub trigger, repositories and output",
    pr: "#4288, #4769",
    format: 1,
    graph: graphOf(
      [
        node("start", "trigger", 0, {
          trigger: "github",
          event: "issue.opened",
          repository: "openbot/demo",
          repositories: "openbot/demo\nopenbot/site",
          filters: "",
          labels: "bug",
        }),
        node("sort", "llm", 300, { prompt: "Sort the issue." }),
        node("label", "output", 600, {
          target: "github",
          action: "label.add",
          item: "event",
          labelsFrom: "list",
          labels: "triage",
          repository: "openbot/demo",
        }),
      ],
      [edge("start", "sort"), edge("sort", "label")],
    ),
    replies: ["Bug."],
    steps: { sort: "done" },
  },
  {
    title: "Discord, Telegram and Slack",
    pr: "#4531, #4743, #4747",
    format: 1,
    graph: graphOf(
      [
        node("start", "trigger", 0, {
          trigger: "discord",
          event: "mention",
          connectionId: "connection-discord",
          placeId: "place-discord",
        }),
        node("answer", "llm", 300, { prompt: "Answer the mention." }),
        node("discord", "output", 600, {
          target: "discord",
          action: "post",
          connectionId: "connection-discord",
          placeId: "place-discord",
        }),
        node("telegram", "output", 600, {
          target: "telegram",
          action: "post",
          connectionId: "connection-telegram",
          placeId: "place-telegram",
        }),
        node("slack", "output", 600, {
          target: "slack",
          action: "post",
          connectionId: "connection-slack",
          placeId: "place-slack",
          emoji: "",
        }),
      ],
      [edge("start", "answer"), edge("answer", "discord"), edge("answer", "telegram"), edge("answer", "slack")],
    ),
    replies: ["Hello."],
    steps: { answer: "done", discord: "done", telegram: "done", slack: "done" },
  },
  {
    title: "Condition provider, model and effort",
    pr: "#4915",
    format: 1,
    graph: graphOf(
      [
        TRIGGER,
        node("brief", "prompt", 0, { text: "Is it Monday?" }),
        node("gate", "condition", 300, {
          rule: "It is Monday.",
          provider: "openai",
          model: "gpt-5",
          effort: "high",
        }),
        node("yes", "output", 600, { target: "notify" }),
      ],
      [edge("start", "gate"), edge("brief", "gate"), edge("gate", "yes", { branch: "yes" })],
    ),
    replies: ["no"],
    steps: { gate: "done", yes: "skipped" },
  },
  {
    title: "Chat channel output",
    pr: "#5572",
    format: 1,
    graph: graphOf(
      [
        TRIGGER,
        node("brief", "prompt", 0, { text: "Daily news." }),
        node("post", "output", 300, { target: "chat-channel", channelId: "channel-news" }),
      ],
      [edge("start", "post"), edge("brief", "post")],
    ),
    steps: { post: "done" },
  },
  {
    title: "Image and video steps",
    pr: "#8389, #8589, #8634, #10425",
    format: 1,
    graph: graphOf(
      [
        TRIGGER,
        node("logo", "asset", 0, { fileId: "file-logo", file: "logo.png" }),
        node("picture", "image", 300, {
          media: "image",
          model: "gpt-image",
          prompt: "A red kite.",
          background: "transparent",
          account: "",
        }),
        node("clip", "image", 600, {
          media: "video",
          model: "grok-imagine",
          prompt: "The kite flies.",
          firstFrame: "picture",
          voice: "eve",
        }),
      ],
      [
        edge("start", "picture"),
        edge("logo", "picture", { type: "image" }),
        edge("picture", "clip", { type: "image" }),
      ],
    ),
    steps: { picture: "done", clip: "done" },
  },
  {
    title: "Size, aspects, duration and resolution",
    pr: "#10730, #11373, #12335, #14199",
    format: 1,
    graph: graphOf(
      [
        TRIGGER,
        node("wide", "image", 300, {
          media: "image",
          model: "gpt-image",
          prompt: "A wide beach.",
          aspect: "custom",
          width: 1600,
          height: 900,
        }),
        node("tall", "image", 300, { media: "image", model: "grok-imagine", prompt: "A tall tower.", aspect: "4:5" }),
        node("film", "image", 600, {
          media: "video",
          model: "grok-imagine",
          prompt: "Waves.",
          aspect: "21:9",
          duration: 7,
          resolution: "720P",
          options: '{"camera":"slow"}',
        }),
      ],
      [edge("start", "wide"), edge("start", "tall"), edge("wide", "film", { type: "image" })],
    ),
    steps: { wide: "done", tall: "done", film: "done" },
  },
  {
    title: "Groups and step names",
    pr: "#12355, #13525",
    format: 1,
    graph: graphOf(
      [
        TRIGGER,
        node("brief", "prompt", 0, { text: "Two ideas.", group: "ideas", groupName: "Ideas", groupFolded: false }),
        node("first", "llm", 300, { prompt: "First idea.", group: "ideas", stepName: "First idea" }),
        node("second", "llm", 300, { prompt: "Second idea.", group: "ideas", stepName: "Second idea" }),
        node("both", "output", 600, { target: "notify", stepName: "Tell me" }),
      ],
      [
        edge("start", "first"),
        edge("brief", "first"),
        edge("brief", "second"),
        edge("first", "both"),
        edge("second", "both"),
      ],
    ),
    replies: ["Idea one.", "Idea two."],
    steps: { first: "done", second: "done", both: "done" },
  },
  {
    title: "Loop start and wider port rules",
    pr: "#12944, #12954",
    format: 1,
    graph: graphOf(
      [
        TRIGGER,
        node("draft", "llm", 300, { prompt: "Write a line." }),
        node("good", "condition", 600, { rule: "The line rhymes." }),
        node("send", "output", 900, { target: "notify" }),
        node("picture", "image", 300, { media: "image", model: "gpt-image", prompt: "A line of text." }),
        node("look", "agent", 600, { agentId: AGENT_A, task: "Look at the picture." }),
      ],
      [
        edge("start", "draft"),
        edge("draft", "good"),
        edge("good", "send", { branch: "yes" }),
        edge("good", "draft", { branch: "no" }),
        edge("start", "picture"),
        edge("picture", "look", { type: "image" }),
      ],
    ),
    replies: ["A line.", "no", "A rhyme.", "yes"],
    steps: { draft: "done", good: "done", send: "done", look: "done" },
  },
  {
    title: "Runtime fields and step settings",
    pr: "#13029",
    format: 1,
    graph: graphOf(
      [
        TRIGGER,
        node("brief", "prompt", 0, { text: "Sum up the week." }),
        node("sum", "llm", 300, {
          prompt: "Sum up.",
          system: "Use short lines.",
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          effort: "low",
        }),
      ],
      [edge("start", "sum"), edge("brief", "sum")],
    ),
    replies: ["A sum."],
    steps: { sum: "done" },
  },
  {
    title: "Output message with names",
    pr: "#14732",
    format: 2,
    graph: graphOf(
      [
        TRIGGER,
        node("rate", "llm", 300, { prompt: "Rate the ticket.", answer: "priority: high|low" }),
        node("tell", "output", 600, { target: "notify", message: "Priority: {{priority}}" }),
      ],
      [edge("start", "rate"), edge("rate", "tell")],
    ),
    replies: ['{"priority":"high"}'],
    steps: { rate: "done", tell: "done" },
  },
  {
    title: "Built-in trigger fields",
    pr: "#14738",
    format: 3,
    graph: graphOf(
      [
        {
          ...node("start", "trigger", 0, { trigger: "schedule", timezone: "UTC" }),
          schedule: { kind: "daily", time: "09:00" },
        },
        node("plan", "llm", 300, { prompt: "Plan {{weekday}}, {{local_date}}." }),
      ],
      [edge("start", "plan")],
    ),
    replies: ["A plan."],
    steps: { plan: "done" },
  },
];

let modelReplies: string[] = [];
const modelPrompts: string[] = [];
const posts: string[] = [];

interface Host {
  directory: string;
  database: OpenBotDatabase;
  workflows: WorkflowsHandle;
}

async function openHost(name: string): Promise<Host> {
  const directory = await mkdtemp(join(tmpdir(), `openbot-workflow-format-${name}-`));
  const database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  const addedAt = new Date().toISOString();
  const addConnection = database.connection.prepare(
    `INSERT INTO projection_messaging_connections
       (connection_id, platform, workspace_id, workspace_name, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 'Nightly', 1, ?, ?)`,
  );
  for (const platform of ["discord", "telegram", "slack"])
    addConnection.run(`connection-${platform}`, platform, `workspace-${platform}`, addedAt, addedAt);
  const posted = (label: string) => () =>
    Effect.sync(() => {
      posts.push(label);
      return { posted: true as const };
    });
  const workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: (deliveryId) => ({ status: "completed", turnId: `turn-${deliveryId}`, error: null }),
      turnAnswer: () => "The agent is done.",
      sendHandoff: ({ idempotencyKey }) => Effect.succeed(`delivery-${idempotencyKey}`),
      filePath: (attachmentId) => Effect.succeed(join(directory, attachmentId)),
      stopDelivery: () => Effect.void,
      generateText: (request) =>
        Effect.sync(() => {
          modelPrompts.push(request.prompt);
          return modelReplies.shift() ?? "Done.";
        }),
      generateMedia: () => Effect.succeed("file-media"),
      mediaProviders: () => ({ sunra: false, higgsfield: false, accounts: null }),
      notify: () => {},
      connectionOn: () => true,
      post: posted("post"),
      channelPost: () =>
        Effect.sync(() => {
          posts.push("channel");
          return "posted" as const;
        }),
      discordSend: posted("discord"),
      telegramSend: posted("telegram"),
      slackSend: posted("slack"),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  return { directory, database, workflows };
}

async function closeHost(host: Host | null) {
  if (!host) return;
  try {
    await Effect.runPromise(host.workflows.close());
    host.database.close();
  } finally {
    await rm(host.directory, { recursive: true, force: true });
  }
}

const stepOf = (detail: WorkflowRunDetail, nodeId: string) =>
  detail.steps.filter((step) => step.nodeId === nodeId).sort((a, b) => b.attempt - a.attempt)[0];

async function runToEnd(workflows: WorkflowsHandle, runId: string): Promise<WorkflowRunDetail> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    await Effect.runPromise(workflows.sweep());
    const detail = await runCauseEffect(workflows.run(runId));
    const asking = detail.steps.find((step) => step.status === "approval");
    if (asking) await runCauseEffect(workflows.decide({ stepId: asking.id, approved: true }));
    else if (detail.run.status !== "running" && detail.run.status !== "stopping") return detail;
    if (Date.now() > deadline) throw new Error(`The run did not end: ${JSON.stringify(detail)}`);
    await new Promise((done) => setImmediate(done));
  }
}

function firstDifference(first: string, second: string) {
  const lines = (text: string) => JSON.stringify(JSON.parse(text), null, 2).split("\n");
  const a = lines(first);
  const b = lines(second);
  const index = a.findIndex((line, at) => line !== b[at]);
  return {
    line: index,
    first: a.slice(Math.max(0, index - 3), index + 2),
    second: b.slice(Math.max(0, index - 3), index + 2),
  };
}

const hasSecret = (text: string) => redactText(text) !== text;

let hostA: Host | null = null;
let hostB: Host | null = null;

try {
  hostA = await openHost("a");
  hostB = await openHost("b");
  const a = hostA.workflows;
  const b = hostB.workflows;

  for (const fixture of FIXTURES) {
    const created = await runCauseEffect(a.create({ title: fixture.title, graph: fixture.graph }));
    const opened = await runCauseEffect(a.get(created.summary.id));
    check(`${fixture.title}: the host opens the graph with no loss`, same(opened.graph, fixture.graph), opened.graph);
    check(
      `${fixture.title}: the graph has format ${fixture.format}`,
      opened.format === fixture.format && opened.hostFormat === WORKFLOW_FORMAT,
      [opened.format, opened.hostFormat],
    );
    const saved = await runCauseEffect(
      a.saveGraph({ workflowId: opened.summary.id, baseRevision: opened.revision, graph: opened.graph }),
    );
    const reopened = await runCauseEffect(a.get(opened.summary.id));
    check(
      `${fixture.title}: a save of the same graph keeps it`,
      saved.ok && same(reopened.graph, fixture.graph),
      saved.ok ? reopened.graph : saved,
    );
    modelReplies = [...(fixture.replies ?? [])];
    const start = a.startRun({ workflowId: opened.summary.id, requestId: crypto.randomUUID() });
    if (fixture.steps === "refused") {
      const refused = await Effect.runPromise(Effect.result(start));
      check(
        `${fixture.title}: a run is refused as before`,
        refused._tag === "Failure" &&
          String(refused.failure.cause).includes(sourceText("error.workflow.nodeUnsupported")),
        refused,
      );
      report.fixtures.push({ title: fixture.title, pr: fixture.pr, format: fixture.format, run: "refused", steps: {} });
      continue;
    }
    const expected = fixture.steps;
    const started = await runCauseEffect(start);
    const detail = await runToEnd(a, started.run.id);
    const steps = Object.fromEntries(Object.keys(expected).map((id) => [id, stepOf(detail, id)?.status ?? "none"]));
    check(
      `${fixture.title}: the graph runs on this host`,
      same(steps, expected),
      detail.steps.map((step) => [step.nodeId, step.status, step.error]),
    );
    report.fixtures.push({
      title: fixture.title,
      pr: fixture.pr,
      format: fixture.format,
      run: detail.run.status,
      steps,
    });
  }

  const settingsRun = await runCauseEffect(a.list()).then((rows) =>
    rows.find((row) => row.title === "Runtime fields and step settings"),
  );
  assert.ok(settingsRun);
  const settingsRuns = await runCauseEffect(a.runs({ workflowId: settingsRun.id, limit: 1 }));
  const settingsDetail = await runCauseEffect(a.run(settingsRuns.runs[0]?.run.id ?? ""));
  const sumStep = stepOf(settingsDetail, "sum");
  assert.ok(sumStep);
  const settings = await runCauseEffect(a.stepSettings(sumStep.id));
  check(
    "a step keeps the runtime fields it ran with",
    settings.settings?.model === "claude-sonnet-5-5" &&
      settings.settings.effort === "low" &&
      settings.settings.system === "Use short lines.",
    settings,
  );
  check(
    "the trigger fields fill the prompt",
    modelPrompts.some((prompt) => /Plan "\w+day", "\d{4}-\d{2}-\d{2}"\./u.test(prompt)),
    modelPrompts.filter((prompt) => prompt.startsWith("Plan")),
  );

  const newerFixture = FIXTURES[0];
  assert.ok(newerFixture);
  const newer = await runCauseEffect(a.create({ title: "Newer graph", graph: newerFixture.graph }));
  const newerDetail = await runCauseEffect(a.get(newer.summary.id));
  const fromNewerHost = { ...newerDetail, format: WORKFLOW_FORMAT + 1 };
  const olderView = decodeRemoteWorkflowDetail(JSON.parse(JSON.stringify(fromNewerHost)));
  check(
    "an older client opens a newer graph read-only and keeps every value",
    olderView.needsNewerApp === true && same(olderView.graph, newerDetail.graph),
    olderView.needsNewerApp,
  );
  const unknownKind = JSON.parse(
    JSON.stringify(newerDetail).replace('"id":"plan","kind":"llm"', '"id":"plan","kind":"research"'),
  );
  const placeholderView: WorkflowDetail = decodeRemoteWorkflowDetail(unknownKind);
  const placeholder = placeholderView.graph.nodes.find((candidate) => candidate.id === "plan");
  check(
    "an older client shows a step of an unknown kind as a locked note with its settings",
    placeholderView.needsNewerApp === true &&
      placeholder?.kind === "note" &&
      placeholder.locked === true &&
      placeholder.fields.prompt === "Make a plan.",
    placeholder,
  );
  hostA.database.connection
    .prepare("UPDATE workflow_nodes SET fields_json = ? WHERE workflow_id = ? AND node_id = 'ok'")
    .run(JSON.stringify({ rule: "The plan has three steps.", effort: "ludicrous" }), newer.summary.id);
  const withUnknown = await runCauseEffect(a.get(newer.summary.id));
  const unknownView = decodeRemoteWorkflowDetail(JSON.parse(JSON.stringify(withUnknown)));
  const moved: WorkflowGraph = {
    ...unknownView.graph,
    nodes: unknownView.graph.nodes.map((candidate) =>
      candidate.id === "brief" ? { ...candidate, at: { x: 40, y: 80 } } : candidate,
    ),
  };
  const movedSave = await runCauseEffect(
    a.saveGraph({ workflowId: newer.summary.id, baseRevision: withUnknown.revision, graph: moved }),
  );
  const afterMove = await runCauseEffect(a.get(newer.summary.id));
  check(
    "a client that moves a step keeps a value that only a newer version knows",
    unknownView.needsNewerApp === true &&
      movedSave.ok &&
      afterMove.graph.nodes.find((candidate) => candidate.id === "ok")?.fields.effort === "ludicrous" &&
      afterMove.graph.nodes.find((candidate) => candidate.id === "brief")?.at.x === 40,
    afterMove.graph.nodes.find((candidate) => candidate.id === "ok"),
  );

  const portable = FIXTURES.filter((fixture) => fixture.title !== "Discord, Telegram and Slack");
  const filesA: string[] = [];
  const filesB: string[] = [];
  const logo = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const encode = (title: string, graph: WorkflowGraph, agents: Map<string, { name: string }>) => {
    const source: WorkflowFileSource = {
      title,
      graph,
      appVersion: APP_VERSION,
      timezone: "UTC",
      agents,
      channels: new Map([
        ["channel-news", { name: "news" }],
        ["channel-news-b", { name: "news" }],
      ]),
      assets: new Map([
        ["file-logo", { name: "logo.png", type: "image/png", size: logo.byteLength }],
        ["file-logo-b", { name: "logo.png", type: "image/png", size: logo.byteLength }],
      ]),
      hasSecret,
    };
    const exported = encodeWorkflowFile(source);
    assert.ok(exported.ok, JSON.stringify(exported));
    const filled = fillWorkflowFileText(
      workflowFileHostExport(exported).text ?? "",
      exported.assets,
      new Map(exported.assets.map((asset) => [asset.key, logo])),
    );
    assert.ok(filled.ok, JSON.stringify(filled));
    return filled.text;
  };
  const storedOnA = await runCauseEffect(a.list());
  for (const fixture of portable) {
    const row = storedOnA.find((candidate) => candidate.title === fixture.title);
    assert.ok(row);
    const stored = await runCauseEffect(a.get(row.id));
    const text = encode(fixture.title, stored.graph, new Map([[AGENT_A, { name: "Writer" }]]));
    filesA.push(text);
    const decoded = decodeWorkflowFile(text);
    assert.ok(decoded.ok, JSON.stringify(decoded));
    const imported = workflowFromFile(decoded.file, {
      references: new Map(
        Object.entries(decoded.file.references).map(([key, reference]) => [
          key,
          reference.kind === "agent" ? AGENT_B : "channel-news-b",
        ]),
      ),
      assets: new Map(Object.keys(decoded.file.assets).map((key) => [key, { id: "file-logo-b", name: "logo.png" }])),
    });
    const copy = await runCauseEffect(b.create({ ...imported, paused: true }));
    const copied = await runCauseEffect(b.get(copy.summary.id));
    filesB.push(encode(copied.summary.title, copied.graph, new Map([[AGENT_B, { name: "Writer" }]])));
  }
  check(
    "export, import on a second host and export again gives the same file for each fixture",
    filesA.every((text, index) => text === filesB[index]),
    filesA.flatMap((text, index) =>
      text === filesB[index] ? [] : [{ title: portable[index]?.title, ...firstDifference(text, filesB[index] ?? "") }],
    ),
  );
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "files.json"),
    `${JSON.stringify(
      filesA.map((text) => JSON.parse(text)),
      null,
      2,
    )}\n`,
  );

  const listA = await runCauseEffect(a.list());
  const graphsA = await Promise.all(
    listA
      .filter((row) => FIXTURES.some((fixture) => fixture.title === row.title))
      .map(async (row) => ({ title: row.title, graph: (await runCauseEffect(a.get(row.id))).graph })),
  );
  const keys = new Map([[AGENT_A, "agent-writer"]]);
  const channelKeys = new Map([["channel-news", "channel-news"]]);
  const transferred = JSON.parse(JSON.stringify(exportWorkflows(graphsA, keys, channelKeys)));
  const warnings: string[] = [];
  const before = new Set((await runCauseEffect(b.list())).map((row) => row.id));
  await Effect.runPromise(
    importWorkflows(
      transferred,
      {
        workflows: () => Effect.succeed([]),
        createWorkflow: (input) => b.create(input),
      },
      new Map([["agent-writer", AGENT_B]]),
      new Map([["channel-news", "channel-news-b"]]),
      warnings,
    ),
  );
  const moved2 = (await runCauseEffect(b.list())).filter((row) => !before.has(row.id));
  const graphsB = await Promise.all(
    moved2.map(async (row) => ({ title: row.title, graph: (await runCauseEffect(b.get(row.id))).graph })),
  );
  const again = JSON.parse(
    JSON.stringify(
      exportWorkflows(graphsB, new Map([[AGENT_B, "agent-writer"]]), new Map([["channel-news-b", "channel-news"]])),
    ),
  );
  const byTitle = (entries: { title: string; relink?: boolean }[]) =>
    [...entries].map(({ relink: _relink, ...entry }) => entry).sort((x, y) => x.title.localeCompare(y.title));
  check(
    "a transfer to a second host and back gives the same entries, and each moved workflow is paused",
    moved2.length === FIXTURES.length &&
      moved2.every((row) => row.paused === true) &&
      same(byTitle(again), byTitle(transferred)),
    {
      moved: moved2.length,
      ...firstDifference(JSON.stringify(byTitle(transferred)), JSON.stringify(byTitle(again))),
    },
  );
  const relinked = transferred.filter((entry: { relink?: boolean }) => entry.relink === true);
  check(
    "a transfer marks only the workflow with chat app links and warns to link it again",
    relinked.length === 1 &&
      relinked[0].title === "Discord, Telegram and Slack" &&
      warnings.includes(
        sourceText("error.import.transferWorkflowConnection", { name: "Discord, Telegram and Slack" }),
      ) &&
      warnings.includes(sourceText("error.import.transferWorkflowPaused")),
    warnings,
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    await closeHost(hostA);
  } finally {
    await closeHost(hostB);
  }
  mkdirSync(OUT, { recursive: true });
  const artifact = join(OUT, "report.json");
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${artifact}\n`);
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
