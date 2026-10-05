// Runs custom ACP agents end to end on the real modules: the encrypted agent store, Check agent, and
// the `acp` provider driver with its router over real agent processes. Two fake agents speak ACP over
// stdio and give the same session id, so the router must keep them apart. A fake cipher replaces the
// operating system's secret storage, which exists only in Electron.
// `bun scripts/custom-acp-agent-e2e.ts`. Writes .openbot-build/custom-acp-agent-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { checkAcpAgent } from "../src/backend/acp-agent-check";
import { isMissingProviderSessionError } from "../src/backend/agent/thread-items";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import type { CustomProviderCipher } from "../src/main/custom-provider-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/custom-acp-agent-e2e");
const SECRET = "sk-e2e-agent-secret";

const FAKE_AGENT = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const log = (entry) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ pid: process.pid, token: process.env.FAKE_TOKEN ?? null, ...entry }) + NL);
log({ event: "start", argv: process.argv.slice(2) });
let buffer = "";
let sessions = 0;
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (process.env.FAKE_CRASH) {
    process.stderr.write("fatal: token " + process.env.FAKE_TOKEN + " refused" + NL);
    process.exit(3);
  }
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
function handle(message) {
  if (message.id === undefined) return;
  log({ event: "request", method: message.method, sessionId: message.params?.sessionId ?? null });
  if (message.method === "initialize") {
    write({ id: message.id, result: {
      protocolVersion: 1,
      agentInfo: { name: "fake", title: process.env.FAKE_TITLE, version: "1.2.3" },
      agentCapabilities: { loadSession: true },
    } });
    return;
  }
  if (message.method === "session/new") {
    sessions += 1;
    const models = process.env.FAKE_MODELS
      ? { availableModels: [{ modelId: "fast", name: "Fast" }, { modelId: "deep", name: "Deep" }], currentModelId: "fast" }
      : undefined;
    write({ id: message.id, result: { sessionId: "s-" + sessions, ...(models ? { models } : {}) } });
    return;
  }
  if (message.method === "session/prompt") {
    const text = message.params.prompt.filter((block) => block.type === "text").map((block) => block.text).join(" ");
    write({ method: "session/update", params: { sessionId: message.params.sessionId, update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: process.env.FAKE_TITLE + " heard: " + text.slice(-40) },
    } } });
    write({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  write({ id: message.id, result: {} });
}
setInterval(() => {}, 1000);
`;

interface LogEntry {
  pid: number;
  token: string | null;
  event: "start" | "request";
  method?: string;
  sessionId?: string | null;
}

interface Report {
  passed: boolean;
  save?: { agents: string[]; secretOnDisk: boolean; secretInSummary: boolean };
  check?: { agentName: string | null; version: string | null; requests: string[]; stopped: boolean };
  crashMasked?: { message: string };
  turns?: { models: string[]; alphaThread: string; betaThread: string; alphaReply: string; betaReply: string };
  restart?: { processesStopped: number; loadedSession: string | null | undefined; resumedReply: string };
  switch?: { missingSession: boolean };
  delete?: { refused: string };
}

const cipher: CustomProviderCipher = {
  canPersist: () => true,
  encrypt: (value) => Buffer.from(Buffer.from(value, "utf8").map((byte) => byte ^ 0x5a)),
  decrypt: (value) => Buffer.from(value.map((byte) => byte ^ 0x5a)).toString("utf8"),
};

const root = await mkdtemp(join(tmpdir(), "openbot-custom-agent-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function readLog(path: string): Promise<LogEntry[]> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

try {
  const executable = join(root, "bin", "fake-acp-agent");
  const workspace = join(root, "workspace");
  const alphaLog = join(root, "alpha.jsonl");
  const betaLog = join(root, "beta.jsonl");
  await mkdir(join(root, "bin"));
  await mkdir(workspace);
  await writeFile(executable, FAKE_AGENT);
  await chmod(executable, 0o755);

  // 1. Save two agents. The secret is encrypted on disk and is in no summary.
  const store = new CustomAgentStore({ path: join(root, "custom-agents.json"), cipher });
  await runCauseEffect(store.load());
  await runCauseEffect(
    store.save({
      id: "alpha",
      name: "Alpha",
      command: executable,
      args: ["--acp"],
      env: [
        { name: "FAKE_LOG", value: alphaLog },
        { name: "FAKE_TITLE", value: "Alpha" },
        { name: "FAKE_MODELS", value: "1" },
        { name: "FAKE_TOKEN", value: SECRET },
      ],
    }),
  );
  await runCauseEffect(
    store.save({
      id: "beta",
      name: "Beta",
      command: executable,
      args: [],
      env: [
        { name: "FAKE_LOG", value: betaLog },
        { name: "FAKE_TITLE", value: "Beta" },
      ],
    }),
  );
  const file = await readFile(join(root, "custom-agents.json"), "utf8");
  assert.ok(!file.includes(SECRET), "The agent file holds no plain env value.");
  const summaries = await Effect.runPromise(store.list());
  assert.ok(!JSON.stringify(summaries).includes(SECRET), "A summary holds no env value.");
  assert.deepEqual(summaries.find((agent) => agent.id === "alpha")?.envNames, [
    "FAKE_LOG",
    "FAKE_TITLE",
    "FAKE_MODELS",
    "FAKE_TOKEN",
  ]);
  report.save = { agents: summaries.map((agent) => agent.id), secretOnDisk: false, secretInSummary: false };

  // 2. Check agent: `initialize` only, then the process is gone.
  const checkLog = join(root, "check.jsonl");
  const check = await runCauseEffect(
    checkAcpAgent({
      executable,
      args: ["--acp"],
      env: { FAKE_LOG: checkLog, FAKE_TITLE: "Alpha", FAKE_TOKEN: SECRET },
    }),
  );
  assert.equal(check.agentName, "Alpha");
  assert.equal(check.version, "1.2.3");
  const checkEntries = await readLog(checkLog);
  assert.deepEqual(
    checkEntries.filter((entry) => entry.event === "request").map((entry) => entry.method),
    ["initialize"],
  );
  const checkPid = checkEntries[0]?.pid ?? 0;
  assert.equal(isRunning(checkPid), false, "Check agent stops the process.");
  const crash = await runCauseEffect(
    checkAcpAgent({
      executable,
      args: [],
      env: { FAKE_LOG: checkLog, FAKE_CRASH: "1", FAKE_TOKEN: SECRET },
      timeoutMs: 5_000,
    }),
  ).catch((error: unknown) => error);
  assert.ok(crash instanceof Error, "A crashing agent fails the check.");
  assert.ok(!crash.message.includes(SECRET), "The check error masks the agent's env value.");
  report.check = { agentName: check.agentName, version: check.version, requests: ["initialize"], stopped: true };
  report.crashMasked = { message: crash.message };

  // 3. The router: one process per agent, the models of both, and equal session ids kept apart.
  const driver = requireProviderDriver("acp");
  const context = {
    apiKey: () => null,
    customProviders: () => [],
    mcpServers: () => [],
    customAgents: () => store.configs(),
  };
  const cli = await runCauseEffect(driver.resolveCli());
  const open = () => {
    const client = driver.createClient(cli, 20_000, context, undefined);
    clients.push(client);
    client.start();
    return client;
  };
  let client = open();
  const models = await runCauseEffect(client.request("model/list", {}, (value) => value));
  const modelIds = JSON.stringify(models);
  for (const id of ["alpha/fast", "alpha/deep", "beta/default"]) assert.ok(modelIds.includes(`"${id}"`), id);

  const alphaThread = await threadId(client, { model: "alpha/deep", cwd: workspace });
  const betaThread = await threadId(client, { model: "beta/default", cwd: workspace });
  assert.match(alphaThread, /^alpha:s-\d+$/);
  assert.match(betaThread, /^beta:s-\d+$/);
  assert.equal(alphaThread.split(":")[1], betaThread.split(":")[1], "Both agents give the same session id.");

  const alphaReply = await runTurn(client, alphaThread, "alpha/deep", "hello alpha");
  const betaReply = await runTurn(client, betaThread, "beta/default", "hello beta");
  assert.match(alphaReply, /^Alpha heard: .*hello alpha$/);
  assert.match(betaReply, /^Beta heard: .*hello beta$/);
  const alphaEntries = await readLog(alphaLog);
  assert.ok(
    alphaEntries.every((entry) => entry.token === SECRET),
    "The agent process gets its env value.",
  );
  assert.equal((await readLog(betaLog)).find((entry) => entry.event === "start")?.token, null);
  report.turns = {
    models: ["alpha/fast", "alpha/deep", "beta/default"],
    alphaThread,
    betaThread,
    alphaReply,
    betaReply,
  };

  // 4. Restart: a new router loads the saved session on a new process and runs a turn on it.
  const pidsBefore = [...new Set([...alphaEntries, ...(await readLog(betaLog))].map((entry) => entry.pid))];
  await runCauseEffect(client.stop());
  assert.ok(
    pidsBefore.every((pid) => !isRunning(pid)),
    "Stopping the router stops every agent process.",
  );
  client = open();
  await runCauseEffect(
    client.request("thread/resume", { threadId: alphaThread, model: "alpha/deep", cwd: workspace }, (v) => v),
  );
  const loaded = (await readLog(alphaLog)).filter((entry) => entry.method === "session/load");
  assert.equal(loaded.at(-1)?.sessionId, alphaThread.split(":")[1], "The agent loads its own session id.");
  const resumedReply = await runTurn(client, alphaThread, "alpha/deep", "after restart");
  assert.match(resumedReply, /after restart$/);
  report.restart = { processesStopped: pidsBefore.length, loadedSession: loaded.at(-1)?.sessionId, resumedReply };

  // 5. Switch: a turn on another agent's model reads as a missing session, so the runtime hands over.
  const switched = await runCauseEffect(
    client.request("turn/start", { threadId: alphaThread, model: "beta/default", input: [] }, (v) => v),
  ).catch((error: unknown) => error);
  assert.equal(isMissingProviderSessionError(switched, "acp"), true);
  report.switch = { missingSession: true };

  // 6. Delete: the agent's models are refused, and the other agent still works.
  await runCauseEffect(store.remove("beta"));
  const deleted = await threadId(client, { model: "beta/default", cwd: workspace }).catch((error: unknown) => error);
  assert.ok(deleted instanceof Error && /not saved now/.test(deleted.message), String(deleted));
  assert.match(await runTurn(client, alphaThread, "alpha/deep", "still here"), /still here$/);
  report.delete = { refused: deleted.message };

  report.passed = true;
} finally {
  await Promise.all(clients.map((client) => runCauseEffect(client.stop()).catch(() => undefined)));
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function threadId(client: AgentClient, params: { model: string; cwd: string }): Promise<string> {
  const response = await runCauseEffect(client.request("thread/start", params, (value) => value));
  const id = JSON.stringify(response).match(/"id":"([^"]+)"/)?.[1];
  assert.ok(id, "thread/start answers a thread id.");
  return id;
}

/** Starts a turn and waits for its completion; the reply is the text of the completed agent items. */
async function runTurn(client: AgentClient, thread: string, model: string, text: string): Promise<string> {
  let reply = "";
  // `AgentClient` has no `off`, so a finished turn's listener stays and ignores what follows.
  let finished = false;
  const done = new Promise<void>((finish, fail) => {
    client.on("notification", (notification: AppServerNotification) => {
      if (finished || getString(notification.params, "threadId") !== thread) return;
      if (notification.method === "item/completed" && isRecord(notification.params)) {
        reply += getString(notification.params.item, "text") ?? "";
      }
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
      { threadId: thread, model, input: [{ type: "text", text, text_elements: [] }] },
      (v) => v,
    ),
  );
  await done;
  return reply;
}
