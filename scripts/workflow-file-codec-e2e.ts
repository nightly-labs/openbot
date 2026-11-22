import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import {
  decodeWorkflowFile,
  encodeWorkflowFile,
  fillWorkflowFileText,
  matchWorkflowFileReferences,
  serializeWorkflowFile,
  WORKFLOW_FILE_FORMAT,
  WORKFLOW_FILE_VERSION,
  WORKFLOW_FORMAT,
  type WorkflowFile,
  type WorkflowFileSource,
  type WorkflowGraph,
  type WorkflowNode,
  workflowFileAssetBytes,
  workflowFileHostExport,
  workflowFileNeeds,
  workflowFromFile,
  workflowGraphFormat,
} from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-file-codec-e2e");
const APP_VERSION = String(JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")).version);
const TIMEZONE = "Europe/Warsaw";

interface Report {
  checks: string[];
  file?: string;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], passed: false };
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

const logo = Uint8Array.from({ length: 70_000 }, (_, index) => (index * 31) % 256);

const sourceGraph: WorkflowGraph = {
  nodes: [
    { ...node("trigger", "trigger", 0, { trigger: "schedule" }), schedule: { kind: "daily", time: "09:00" } },
    node("asset", "asset", 0, { file: "logo.png", fileId: "file-on-host-a" }),
    node("agent", "agent", 300, { agentId: "agent-on-host-a", task: "Write the daily note.", stepName: "Writer" }),
    node("model", "llm", 300, { prompt: "Sort {{local_date}}.", answer: "title: text" }),
    node("picture", "image", 300, {
      media: "image",
      account: "account-on-host-a",
      firstFrame: "asset",
      prompt: "A logo",
    }),
    node("post", "output", 600, { target: "chat-channel", channelId: "channel-on-host-a", message: "{{title}}" }),
    node("tell", "output", 600, {
      target: "discord",
      connectionId: "connection-on-host-a",
      placeId: "place-on-host-a",
      action: "reply",
      message: "Done",
    }),
  ],
  edges: [
    { id: "trigger-agent", from: "trigger", to: "agent", type: "text" },
    { id: "agent-model", from: "agent", to: "model", type: "text" },
    { id: "asset-picture", from: "asset", to: "picture", type: "image" },
    { id: "model-post", from: "model", to: "post", type: "text" },
    { id: "model-tell", from: "model", to: "tell", type: "text" },
  ],
  strokes: [],
};

const hasSecret = (text: string) => redactText(text) !== text;

const hostA = {
  agents: new Map([["agent-on-host-a", { name: "Writer", title: "Daily notes" }]]),
  channels: new Map([["channel-on-host-a", { name: "news" }]]),
};

const source = (title: string, graph: WorkflowGraph, assets: WorkflowFileSource["assets"]): WorkflowFileSource => ({
  title,
  graph,
  appVersion: APP_VERSION,
  timezone: TIMEZONE,
  agents: hostA.agents,
  channels: hostA.channels,
  assets,
  hasSecret,
});

const withNode = (file: WorkflowFile, id: string, fields: WorkflowNode["fields"]): WorkflowFile => ({
  ...file,
  graph: {
    ...file.graph,
    nodes: file.graph.nodes.map((candidate) =>
      candidate.id === id ? { ...candidate, fields: { ...candidate.fields, ...fields } } : candidate,
    ),
  },
});

const fieldsOf = (graph: WorkflowGraph, id: string) => graph.nodes.find((candidate) => candidate.id === id)?.fields;

const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-file-codec-"));
const database = new OpenBotDatabase(directory);
let service: WorkflowsHandle | null = null;

try {
  await Effect.runPromise(database.initialize());
  service = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      githubApi: {
        attachFiles: (change) => Effect.succeed({ ...change, files: null }),
        change: () => Effect.die(new Error("No GitHub change runs in this test.")),
        options: () => Effect.succeed({ labels: [], people: [] }),
        recentEvents: () => Effect.succeed([]),
      },
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.die(new Error("No model step runs in this test.")),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No channel output runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  const workflows = service;

  const created = await runCauseEffect(workflows.create({ title: "Daily note", graph: sourceGraph }));
  const saved = await runCauseEffect(workflows.get(created.summary.id));
  const needs = workflowFileNeeds(saved.graph);
  check(
    "the host reads the agents, channels and files that the graph needs",
    JSON.stringify(needs) ===
      JSON.stringify({ agents: ["agent-on-host-a"], channels: ["channel-on-host-a"], files: ["file-on-host-a"] }),
    needs,
  );

  const logoAsset = { name: "logo.png", type: "image/png", size: logo.byteLength };
  const assets = new Map([["file-on-host-a", logoAsset]]);
  const exported = encodeWorkflowFile(source(saved.summary.title, saved.graph, assets));
  assert.ok(exported.ok, JSON.stringify(exported));
  check(
    "the host names the files to add and sends no bytes",
    JSON.stringify(exported.assets) ===
      JSON.stringify([{ key: "file-1", fileId: "file-on-host-a", node: "asset", step: "asset" }]) &&
      exported.file.assets["file-1"]?.data === "",
    exported.assets,
  );
  const hostText = workflowFileHostExport(exported).text ?? "";
  check("a file without asset data does not decode", !decodeWorkflowFile(hostText).ok);
  const unfilled = fillWorkflowFileText(hostText, exported.assets, new Map());
  check(
    "a file id that the client cannot read stops the export",
    !unfilled.ok && unfilled.problem.kind === "asset-missing" && unfilled.problem.node === "asset",
    unfilled,
  );
  const overfilled = fillWorkflowFileText(
    hostText,
    exported.assets,
    new Map([["file-1", new Uint8Array(ATTACHMENT_LIMITS.fileBytes + 1)]]),
  );
  check(
    "bytes over the file limit stop the export",
    !overfilled.ok && overfilled.problem.kind === "asset-too-large",
    !overfilled.ok && overfilled.problem,
  );
  const newerHost = fillWorkflowFileText(
    JSON.stringify({ ...exported.file, graphFormat: WORKFLOW_FORMAT + 1 }),
    exported.assets,
    new Map([["file-1", logo]]),
  );
  check("a client fills the pictures of a file from a newer host", newerHost.ok);
  const filled = fillWorkflowFileText(hostText, exported.assets, new Map([["file-1", logo]]));
  assert.ok(filled.ok, JSON.stringify(filled));
  const filledFile = decodeWorkflowFile(filled.text);
  assert.ok(filledFile.ok, JSON.stringify(filledFile));
  const file = filledFile.file;
  const text = filled.text;
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, "daily-note.openbot-workflow.json");
  writeFileSync(path, text);
  report.file = path;

  check(
    "the file has the format, version, graph format and app version",
    file.format === WORKFLOW_FILE_FORMAT &&
      file.version === WORKFLOW_FILE_VERSION &&
      file.graphFormat === workflowGraphFormat(saved.graph) &&
      file.graphFormat === WORKFLOW_FORMAT &&
      file.minAppVersion === APP_VERSION,
    { format: file.format, version: file.version, graphFormat: file.graphFormat, minAppVersion: file.minAppVersion },
  );
  check(
    "agents and channels are references by name",
    fieldsOf(file.graph, "agent")?.agentId === "agent-1" &&
      fieldsOf(file.graph, "post")?.channelId === "channel-1" &&
      JSON.stringify(file.references) ===
        JSON.stringify({
          "agent-1": { kind: "agent", name: "Writer", title: "Daily notes" },
          "channel-1": { kind: "channel", name: "news" },
        }),
    file.references,
  );
  check(
    "connections are cleared and listed as links to make",
    fieldsOf(file.graph, "tell")?.connectionId === "" &&
      fieldsOf(file.graph, "tell")?.placeId === "" &&
      JSON.stringify(file.links) === JSON.stringify([{ node: "tell", app: "discord" }]),
    file.links,
  );
  check("the media account is cleared", fieldsOf(file.graph, "picture")?.account === "");
  check("the frame source keeps its step id", fieldsOf(file.graph, "picture")?.firstFrame === "asset");
  check("the schedule gets the resolved timezone", fieldsOf(file.graph, "trigger")?.timezone === TIMEZONE);
  const asset = file.assets["file-1"];
  check(
    "the asset bytes are in the file",
    fieldsOf(file.graph, "asset")?.fileId === "file-1" &&
      asset?.name === "logo.png" &&
      asset.type === "image/png" &&
      Buffer.from(workflowFileAssetBytes(asset)).equals(Buffer.from(logo)),
  );
  check("no host id is in the file", !/on-host-a/u.test(text));

  const decoded = decodeWorkflowFile(readFileSync(path, "utf8"));
  assert.ok(decoded.ok, JSON.stringify(decoded));
  check(
    "the written file decodes",
    JSON.stringify(decoded.file) === JSON.stringify(file) && serializeWorkflowFile(file) === text,
  );

  const matches = matchWorkflowFileReferences(decoded.file, {
    agent: [
      { id: "agent-on-host-b", name: "writer", title: "Daily notes" },
      { id: "other-agent", name: "Reviewer" },
    ],
    channel: [{ id: "channel-on-host-b", name: "News" }],
  });
  check(
    "references match agents and channels by name",
    matches.get("agent-1") === "agent-on-host-b" && matches.get("channel-1") === "channel-on-host-b",
    [...matches],
  );
  const ambiguous = matchWorkflowFileReferences(decoded.file, {
    agent: [
      { id: "first", name: "Writer", title: "Blog" },
      { id: "second", name: "Writer", title: "Daily notes" },
    ],
    channel: [
      { id: "a", name: "news" },
      { id: "b", name: "news" },
    ],
  });
  check(
    "a title picks one of two agents with one name; two channels with one name match none",
    ambiguous.get("agent-1") === "second" && !ambiguous.has("channel-1"),
    [...ambiguous],
  );

  const imported = workflowFromFile(decoded.file, {
    references: matches,
    assets: new Map([["file-1", { id: "file-on-host-b", name: "logo.png" }]]),
  });
  const copy = await runCauseEffect(workflows.create(imported));
  const copied = await runCauseEffect(workflows.get(copy.summary.id));
  check(
    "the import uses the ids of the new host",
    fieldsOf(copied.graph, "agent")?.agentId === "agent-on-host-b" &&
      fieldsOf(copied.graph, "post")?.channelId === "channel-on-host-b" &&
      fieldsOf(copied.graph, "asset")?.fileId === "file-on-host-b",
  );
  check(
    "the import keeps every other field, edge and position",
    JSON.stringify(copied.graph.edges) === JSON.stringify(saved.graph.edges) &&
      copied.graph.nodes.every((copiedNode) => {
        const before = saved.graph.nodes.find((candidate) => candidate.id === copiedNode.id);
        return (
          before !== undefined &&
          JSON.stringify(copiedNode.at) === JSON.stringify(before.at) &&
          JSON.stringify(copiedNode.schedule) === JSON.stringify(before.schedule) &&
          Object.entries(before.fields).every(
            ([name, value]) =>
              ["agentId", "channelId", "fileId", "connectionId", "placeId", "account"].includes(name) ||
              copiedNode.fields[name] === value,
          )
        );
      }),
  );

  const again = encodeWorkflowFile({
    ...source(copied.summary.title, copied.graph, new Map([["file-on-host-b", logoAsset]])),
    agents: new Map([["agent-on-host-b", { name: "Writer", title: "Daily notes" }]]),
    channels: new Map([["channel-on-host-b", { name: "news" }]]),
  });
  assert.ok(again.ok, JSON.stringify(again));
  const againFilled = fillWorkflowFileText(
    workflowFileHostExport(again).text ?? "",
    again.assets,
    new Map([["file-1", logo]]),
  );
  assert.ok(againFilled.ok, JSON.stringify(againFilled));
  const againFile = decodeWorkflowFile(againFilled.text);
  assert.ok(againFile.ok, JSON.stringify(againFile));
  const tellAgain = againFile.file.graph.nodes.find((candidate) => candidate.id === "tell");
  check(
    "export after import gives the same file, apart from the link that is still to make",
    serializeWorkflowFile({ ...againFile.file, links: file.links }) === text && tellAgain?.fields.connectionId === "",
  );

  const secretGraph: WorkflowGraph = {
    ...saved.graph,
    nodes: saved.graph.nodes.map((candidate) =>
      candidate.id === "model"
        ? { ...candidate, fields: { ...candidate.fields, prompt: "Use sk-ant-abcdefghijklmnopqrstuvwx to call." } }
        : candidate.id === "agent"
          ? { ...candidate, fields: { ...candidate.fields, task: "Read ghp_abcdefghijklmnopqrstuvwxyz0123456789." } }
          : candidate,
    ),
  };
  const secret = encodeWorkflowFile(source("Daily note", secretGraph, assets));
  check(
    "export refuses a secret and lists the fields",
    !secret.ok &&
      secret.problem.kind === "secret" &&
      JSON.stringify(secret.problem.fields) ===
        JSON.stringify([
          { node: "agent", step: "Writer", field: "task" },
          { node: "model", step: "llm", field: "prompt" },
        ]),
    secret,
  );
  const secretTitle = encodeWorkflowFile(source("Key sk-ant-abcdefghijklmnopqrstuvwx", saved.graph, assets));
  check(
    "export refuses a secret in the title",
    !secretTitle.ok && secretTitle.problem.kind === "secret" && secretTitle.problem.fields[0]?.field === "title",
  );

  const missing = encodeWorkflowFile(source("Daily note", saved.graph, new Map()));
  check(
    "export refuses an asset that the host cannot read",
    !missing.ok && missing.problem.kind === "asset-missing" && missing.problem.node === "asset",
    missing,
  );
  const large = encodeWorkflowFile(
    source(
      "Daily note",
      saved.graph,
      new Map([["file-on-host-a", { name: "big.bin", type: "", size: ATTACHMENT_LIMITS.fileBytes + 1 }]]),
    ),
  );
  check(
    "export refuses an asset over the file limit",
    !large.ok && large.problem.kind === "asset-too-large",
    !large.ok && large.problem,
  );

  const newerVersion = decodeWorkflowFile(JSON.stringify({ ...file, version: WORKFLOW_FILE_VERSION + 1 }));
  check(
    "a newer file version needs an update",
    !newerVersion.ok &&
      newerVersion.problem.kind === "newer" &&
      newerVersion.problem.minAppVersion === APP_VERSION &&
      newerVersion.problem.steps.length === 0,
    newerVersion,
  );
  const newerFormat = decodeWorkflowFile(JSON.stringify({ ...file, graphFormat: WORKFLOW_FORMAT + 1 }));
  check("a newer graph format needs an update", !newerFormat.ok && newerFormat.problem.kind === "newer");
  const repeat = node("repeat", "note", 0, { stepName: "Repeat" });
  const withLoop = withNode(file, "trigger", { trigger: "matrix" });
  const newerSteps = decodeWorkflowFile(
    JSON.stringify({ ...withLoop, graph: { ...withLoop.graph, nodes: [...withLoop.graph.nodes, repeat] } }).replace(
      '"id":"repeat","kind":"note"',
      '"id":"repeat","kind":"loop"',
    ),
  );
  check(
    "a newer file names the steps that this app cannot show",
    !newerSteps.ok &&
      newerSteps.problem.kind === "newer" &&
      JSON.stringify(newerSteps.problem.steps) === JSON.stringify(["trigger", "Repeat"]),
    newerSteps,
  );
  const newerKey = decodeWorkflowFile(JSON.stringify({ ...file, sections: [] }));
  check("a file with an unknown property needs an update", !newerKey.ok && newerKey.problem.kind === "newer");

  const withField = (id: string, name: string, fieldValue: string) =>
    decodeWorkflowFile(JSON.stringify(withNode(file, id, { [name]: fieldValue })));
  const untrusted = [
    withField("asset", "fileId", "file-on-host-a"),
    withField("agent", "agentId", "agent-on-host-a"),
    withField("post", "channelId", "agent-1"),
    withField("tell", "connectionId", "connection-on-host-a"),
    withField("picture", "account", "account-on-host-a"),
  ];
  check(
    "import refuses a host id in the file",
    untrusted.every((result) => !result.ok && result.problem.kind === "invalid"),
    untrusted,
  );
  const badAsset = decodeWorkflowFile(
    JSON.stringify({ ...file, assets: { "file-1": { name: "logo.png", type: "image/png", data: "not base64!" } } }),
  );
  check("import refuses asset data that is not base64", !badAsset.ok && badAsset.problem.kind === "invalid");
  const emptyAsset = decodeWorkflowFile(
    JSON.stringify({ ...file, assets: { "file-1": { name: "logo.png", type: "image/png", data: "" } } }),
  );
  check("import refuses a file without asset data", !emptyAsset.ok && emptyAsset.problem.kind === "invalid");
  const notFile = [decodeWorkflowFile("{"), decodeWorkflowFile("[]"), decodeWorkflowFile('{"format":"other"}')];
  check(
    "other files are not workflow files",
    notFile.every((result) => !result.ok && result.problem.kind === "not-file"),
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
