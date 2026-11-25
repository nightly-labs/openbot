import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentModelOption, isAgentModel } from "@openbot/contracts/ipc";
import { generateTextWithoutTools } from "../src/backend/agent/profile-generation";
import type { AgentClient } from "../src/backend/agent-client";
import { resolveAntigravityCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-session-files-e2e");
const VERSION = "1.5.4";
const MODEL = "gemini-fake";

const FAKE_ANTIGRAVITY = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const NL = String.fromCharCode(10);
if (process.argv[2] === "--version") {
  process.stdout.write("${VERSION}" + NL);
  process.exit(0);
}
const flag = (name) => process.argv.find((arg) => arg.startsWith(name + "="))?.slice(name.length + 1);
const root = path.join(flag("--gemini-dir"), flag("--app-data-dir"));
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const models = { availableModels: [{ modelId: "${MODEL}", name: "Gemini Fake" }], currentModelId: "${MODEL}" };
function createSessionFiles(sessionId) {
  for (const folder of ["conversations", "brain", "annotations"]) fs.mkdirSync(path.join(root, folder), { recursive: true });
  fs.writeFileSync(path.join(root, "conversations", sessionId + ".db"), "db");
  fs.writeFileSync(path.join(root, "conversations", sessionId + ".db-wal"), "wal");
  fs.mkdirSync(path.join(root, "brain", sessionId));
  fs.writeFileSync(path.join(root, "brain", sessionId, "task.md"), "task");
  fs.writeFileSync(path.join(root, "annotations", sessionId + ".pbtxt"), "annotation");
}
function handle(message) {
  const params = message.params ?? {};
  if (message.method) log({ method: message.method, sessionId: params.sessionId ?? null });
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {} } } } });
  if (message.method === "session/new") {
    const sessionId = crypto.randomUUID();
    createSessionFiles(sessionId);
    log({ method: "created", sessionId });
    return write({ id: message.id, result: { sessionId, models } });
  }
  if (message.method === "session/resume" || message.method === "session/load")
    return write({ id: message.id, result: { sessionId: params.sessionId, models } });
  if (message.method === "session/prompt") {
    write({ method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } } } });
    return write({ id: message.id, result: { stopReason: "end_turn" } });
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
  method: string;
  sessionId: string | null;
}

interface Report {
  passed: boolean;
  chatSession?: string;
  createdSessions?: string[];
  keptSessions?: string[];
  removedSessions?: string[];
  log?: LogEntry[];
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-session-files-e2e-"));
const geminiHome = join(root, "home", ".gemini");
const appData = join(geminiHome, "antigravity-acp");
const logPath = join(root, "agy.jsonl");
const workspace = join(root, "workspace");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
process.env.GEMINI_HOME = geminiHome;
process.env.FAKE_AGY_LOG = logPath;
delete process.env.OPENBOT_ANTIGRAVITY_PATH;

const sessionFiles = (sessionId: string) => [
  join(appData, "conversations", `${sessionId}.db`),
  join(appData, "conversations", `${sessionId}.db-wal`),
  join(appData, "brain", sessionId),
  join(appData, "annotations", `${sessionId}.pbtxt`),
];

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

try {
  await mkdir(workspace, { recursive: true });
  const executable = join(root, "antigravity", VERSION, "bin", "antigravity");
  await mkdir(join(root, "antigravity", VERSION, "bin"), { recursive: true });
  await writeFile(executable, FAKE_ANTIGRAVITY);
  await chmod(executable, 0o755);
  const cli = await runCauseEffect(resolveAntigravityCli({ systemCandidates: [], bundledExecutable: executable }));
  const driver = requireProviderDriver("antigravity");

  const client = driver.createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const chat = await startThread(client, { model: MODEL, cwd: workspace, runtimeWorkspaceRoots: [workspace] });
  const turn = await runTurn(client, chat, { model: MODEL, text: "hello" });
  assert.equal(turn.status, "completed", `The chat turn completes: ${turn.error ?? ""}`);
  report.chatSession = chat;

  const createProfileClient = driver.createProfileClient;
  assert.ok(createProfileClient, "Antigravity has a profile client.");
  const profileClient = createProfileClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(profileClient);
  const modelId = `antigravity/${MODEL}`;
  assert.ok(isAgentModel(modelId) || isAgentModel(MODEL), "The fake model id is valid.");
  const model: AgentModelOption = {
    provider: "antigravity",
    id: isAgentModel(MODEL) ? MODEL : modelId,
    name: "Gemini Fake",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  };
  await runCauseEffect(generateTextWithoutTools(profileClient, model, "Say done."));

  await runCauseEffect(client.stop());
  await runCauseEffect(profileClient.stop());

  report.log = await readLog();
  const created = report.log.filter((entry) => entry.method === "created").map((entry) => entry.sessionId ?? "");
  report.createdSessions = created;
  report.keptSessions = created.filter((id) => sessionFiles(id).every((path) => existsSync(path)));
  report.removedSessions = created.filter((id) => sessionFiles(id).every((path) => !existsSync(path)));
  assert.ok(created.includes(chat), "The chat session was created.");
  assert.ok(created.length >= 3, `The probes and the tool-less turn made more sessions: ${created.length}`);
  assert.deepEqual(report.keptSessions, [chat], "Only the chat session keeps its files.");
  assert.deepEqual(
    [...report.removedSessions].sort(),
    created.filter((id) => id !== chat).sort(),
    "The files of each probe and tool-less session are removed.",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
