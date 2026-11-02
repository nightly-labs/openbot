// Lists and selects Gemini models end to end on the real Antigravity driver, with a fake server that
// answers as Antigravity 1.3.0 and later do: the `models` field lists each reasoning effort as a model
// of its own, and `configOptions` offers each family once, with a `thought_level` option. Checks that
// the picker gets one model for each family with that family's efforts, that the discovery session
// goes back to the exact model it opened on, that a selected family and effort reach the session, and
// that an agent whose option lists the same models keeps today's catalog, also with a provider option.
// Like Antigravity 1.4.3, the fake server offers its Claude and GPT models only to a client that names
// itself `zed` (or Xcode, JetBrains, Android Studio), so the picker also checks the name OpenBot sends.
// `bun scripts/acp-effort-variants-e2e.ts`. Writes .openbot-build/acp-effort-variants-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  type AppServerNotification,
  decodeModelListResponse,
  getString,
  type ModelListResponse,
} from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-effort-variants-e2e");

// The selection rules of Antigravity's `config_options.py`: a family value resolves to the variant
// nearest the current effort, and a listed model ID passes through. `FAKE_AGY_MODE=flat` offers the
// listed models in the option, with no effort option, as an agent that does not group.
// `FAKE_AGY_MODE=provider` also puts a provider option of the model category first, as Cline does.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const provider = process.env.FAKE_AGY_MODE === "provider";
const flat = provider || process.env.FAKE_AGY_MODE === "flat";
const LEVELS = ["low", "medium", "high"];
const GEMINI = [
  { modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", family: "gemini-3.8-flash", level: "high" },
  { modelId: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)", family: "gemini-3.8-flash", level: "medium" },
  { modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", family: "gemini-3.8-flash", level: "low" },
  { modelId: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)", family: "gemini-3.1-pro", level: "high" },
  { modelId: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", family: "gemini-3.1-pro", level: "low" },
  { modelId: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
];
const THIRD_PARTY = [
  { modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  { modelId: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
  { modelId: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
];
let LISTED = GEMINI;
const FAMILIES = { "gemini-3.8-flash": "Gemini 3.8 Flash", "gemini-3.1-pro": "Gemini 3.1 Pro" };
const sessions = new Map();
let count = 0;
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const listed = (id) => LISTED.find((model) => model.modelId === id);
function configOptions(current) {
  const model = listed(current);
  const options = [];
  if (provider) {
    options.push({ id: "provider", name: "Provider", category: "model", type: "select", currentValue: "google",
      options: [{ value: "google", name: "Google" }] });
  }
  if (flat) {
    options.push({ id: "model", name: "Model", category: "model", type: "select", currentValue: current,
      options: LISTED.map((entry) => ({ value: entry.modelId, name: entry.name })) });
  } else {
    const values = [];
    for (const entry of LISTED) {
      const value = entry.family ?? entry.modelId;
      if (!values.some((existing) => existing.value === value)) values.push({ value, name: FAMILIES[value] ?? entry.name });
    }
    options.push({ id: "model", name: "Model", category: "model", type: "select",
      currentValue: model.family ?? current, options: values });
    if (model.family) {
      const levels = LISTED.filter((entry) => entry.family === model.family).map((entry) => entry.level);
      options.push({ id: "thinking_level", name: "Thinking Level", category: "thought_level", type: "select",
        currentValue: model.level,
        options: LEVELS.filter((level) => levels.includes(level)).map((level) => ({ value: level, name: level })) });
    }
  }
  options.push({ id: "mode", name: "Session Mode", category: "mode", type: "select", currentValue: "default",
    options: [{ value: "default", name: "Default" }] });
  return options;
}
function setup(sessionId) {
  const current = sessions.get(sessionId);
  return { sessionId, configOptions: configOptions(current),
    models: { availableModels: LISTED.map(({ modelId, name }) => ({ modelId, name })), currentModelId: current } };
}
function resolveModel(current, configId, value) {
  const model = listed(current);
  if (configId === "model") {
    const variants = LISTED.filter((entry) => entry.family === value);
    if (variants.length === 0) return listed(value) ? value : null;
    if (!model.family) return variants[0].modelId;
    const rank = LEVELS.indexOf(model.level);
    return variants.slice().sort((a, b) =>
      Math.abs(LEVELS.indexOf(a.level) - rank) - Math.abs(LEVELS.indexOf(b.level) - rank) ||
      LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level))[0].modelId;
  }
  if (configId === "thinking_level" && model.family) {
    return LISTED.find((entry) => entry.family === model.family && entry.level === value)?.modelId ?? null;
  }
  return null;
}
function handle(message) {
  if (message.id === undefined) return;
  const params = message.params ?? {};
  if (message.method === "initialize") {
    const name = String(params.clientInfo?.name ?? "").toLowerCase();
    log({ event: "initialize", sessionId: "", model: null, value: params.clientInfo?.name });
    const thirdParty = name === "zed" || name === "xcode" || name.startsWith("jetbrains.") || name.startsWith("android studio");
    LISTED = thirdParty ? [...GEMINI, ...THIRD_PARTY] : GEMINI;
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    count += 1;
    const sessionId = "s-" + count;
    sessions.set(sessionId, "gemini-3.8-flash-high");
    write({ id: message.id, result: setup(sessionId) });
    return;
  }
  if (message.method === "session/set_config_option") {
    const next = resolveModel(sessions.get(params.sessionId), params.configId, params.value);
    log({ event: "set", sessionId: params.sessionId, configId: params.configId, value: params.value, model: next });
    if (!next) {
      write({ id: message.id, error: { code: -32602, message: "Invalid value " + params.value } });
      return;
    }
    sessions.set(params.sessionId, next);
    write({ id: message.id, result: { configOptions: configOptions(next) } });
    return;
  }
  if (message.method === "session/prompt") {
    log({ event: "prompt", sessionId: params.sessionId, model: sessions.get(params.sessionId) });
    write({ method: "session/update", params: { sessionId: params.sessionId, update: {
      sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } } });
    write({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

interface LogEntry {
  event: "initialize" | "set" | "prompt";
  sessionId: string;
  configId?: string;
  value?: string;
  model: string | null;
}

interface Report {
  passed: boolean;
  grouped?: {
    clientNames: (string | undefined)[];
    models: { id: string; efforts: string[]; configurable: boolean }[];
    discoveryEndsOn: Record<string, string | null>;
    turns: { model: string; effort: string; sessionModel: string | null }[];
  };
  flat?: { models: string[]; discoveryRequests: number };
  provider?: { models: string[]; discoveryRequests: number };
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-effort-variants-e2e-"));
const log = join(root, "agy.jsonl");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
process.env.FAKE_AGY_LOG = log;

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function open(cli: AgentCliInfo): AgentClient {
  const client = requireProviderDriver("antigravity").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  return client;
}

async function listModels(client: AgentClient): Promise<ModelListResponse["data"]> {
  const response = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
  return response.data;
}

/** Starts a turn and waits for its completion. */
async function runTurn(client: AgentClient, thread: string, model: string, effort: string): Promise<void> {
  // `AgentClient` has no `off`, so a finished turn's listener stays and ignores what follows.
  let finished = false;
  const done = new Promise<void>((finish, fail) => {
    client.on("notification", (notification: AppServerNotification) => {
      if (finished || getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "error") fail(new Error(getString(notification.params, "message") ?? "error"));
      if (notification.method === "turn/completed") {
        finished = true;
        finish();
      }
    });
  });
  await runCauseEffect(
    client.request(
      "turn/start",
      { threadId: thread, model, effort, input: [{ type: "text", text: "hello", text_elements: [] }] },
      (value) => value,
    ),
  );
  await done;
}

try {
  const executable = join(root, "agy", "bin", "agy_acp_server");
  const workspace = join(root, "workspace");
  await mkdir(join(root, "agy", "bin"), { recursive: true });
  await mkdir(workspace);
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);
  const cli: AgentCliInfo = { executable, version: "1.4.0", source: "managed" };

  // 1. A grouping agent: one model for each family, with the efforts of that family alone.
  process.env.FAKE_AGY_MODE = "grouped";
  const client = open(cli);
  const models = await listModels(client);
  const grouped = models.map((model) => ({
    id: model.model ?? "",
    efforts: (model.supportedReasoningEfforts ?? []).flatMap((entry) => entry.reasoningEffort ?? []),
    configurable: model.reasoningEffortConfigurable !== false,
  }));
  assert.deepEqual(
    grouped,
    [
      { id: "gemini-3.8-flash", efforts: ["low", "medium", "high"], configurable: true },
      { id: "gemini-3.1-pro", efforts: ["low", "high"], configurable: true },
      { id: "gemini-2.5-flash-lite", efforts: ["medium"], configurable: false },
      { id: "claude-sonnet-4-6", efforts: ["medium"], configurable: false },
      { id: "claude-opus-4-6-thinking", efforts: ["medium"], configurable: false },
      { id: "gpt-oss-120b-medium", efforts: ["medium"], configurable: false },
    ],
    "The picker lists each family once, with its own efforts, and the Claude and GPT models.",
  );

  // 2. Each discovery session goes back to the exact model it opened on, not to its family.
  const discovery = await readLog();
  const clientNames = discovery.filter((entry) => entry.event === "initialize").map((entry) => entry.value);
  assert.ok(clientNames.length > 0, "The discovery process is initialized.");
  assert.ok(
    clientNames.every((name) => name === "zed"),
    "OpenBot names itself zed to Antigravity, which offers Claude and GPT models only to the clients it lists.",
  );
  const discoveryEndsOn: Record<string, string | null> = {};
  for (const entry of discovery) if (entry.event === "set") discoveryEndsOn[entry.sessionId] = entry.model;
  assert.ok(Object.keys(discoveryEndsOn).length > 0, "Discovery asks the agent for each family's efforts.");
  for (const [session, model] of Object.entries(discoveryEndsOn)) {
    assert.equal(model, "gemini-3.8-flash-high", `Discovery session ${session} goes back to its opening model.`);
  }

  // 3. A selected family and effort reach the session, on start and on each turn.
  const started = await runCauseEffect(
    client.request("thread/start", { model: "gemini-3.1-pro", effort: "low", cwd: workspace }, (value) => value),
  );
  const thread = JSON.stringify(started).match(/"id":"([^"]+)"/)?.[1];
  assert.ok(thread, "thread/start answers a thread id.");
  const turns: { model: string; effort: string; sessionModel: string | null }[] = [];
  for (const [model, effort, expected] of [
    ["gemini-3.1-pro", "low", "gemini-3.1-pro-low"],
    ["gemini-3.1-pro", "high", "gemini-3.1-pro-high"],
    ["gemini-3.8-flash", "medium", "gemini-3.8-flash-medium"],
    ["claude-sonnet-4-6", "medium", "claude-sonnet-4-6"],
  ] as const) {
    await runTurn(client, thread, model, effort);
    const prompt = (await readLog()).filter((entry) => entry.event === "prompt" && entry.sessionId === thread).at(-1);
    turns.push({ model, effort, sessionModel: prompt?.model ?? null });
    assert.equal(prompt?.model, expected, `${model} at ${effort} runs on ${expected}.`);
  }
  report.grouped = { clientNames, models: grouped, discoveryEndsOn, turns };

  // 4. An agent whose option lists the same models keeps the listed catalog, and is not asked again.
  // A provider option of the model category before the model option (Cline) changes nothing.
  await runCauseEffect(client.stop());
  for (const mode of ["flat", "provider"] as const) {
    await rm(log, { force: true });
    process.env.FAKE_AGY_MODE = mode;
    const listed = (await listModels(open(cli))).map((model) => model.model ?? "");
    const discoveryRequests = (await readLog()).filter((entry) => entry.event === "set").length;
    assert.deepEqual(
      listed,
      [
        "gemini-3.8-flash-high",
        "gemini-3.8-flash-medium",
        "gemini-3.8-flash-low",
        "gemini-3.1-pro-high",
        "gemini-3.1-pro-low",
        "gemini-2.5-flash-lite",
        "claude-sonnet-4-6",
        "claude-opus-4-6-thinking",
        "gpt-oss-120b-medium",
      ],
      `An agent that does not group (${mode}) keeps its listed models.`,
    );
    assert.equal(discoveryRequests, 0, `An agent that does not group (${mode}) is not asked for each model's efforts.`);
    report[mode] = { models: listed, discoveryRequests };
  }
  report.passed = true;
} finally {
  await Promise.all(clients.map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
