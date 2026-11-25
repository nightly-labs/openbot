import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, type AppServerRequest, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";

const out = resolve(import.meta.dirname, "../.openbot-build/hermes-session-processes-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-hermes-processes-"));

const fixtureSource = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const { pathToFileURL } = require("node:url");
const [version, sharing, logPath, clientPath, transportPath] = process.argv.slice(2);
const log = (entry) => fs.appendFileSync(logPath, JSON.stringify({ pid: process.pid, ...entry }) + "\n");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const sessions = new Map();
const processServers = new Map();
let opened = 0;
log({ event: "start" });
async function callWhoami(sessionId) {
  const own = sessions.get(sessionId).find((server) => server.name === "openbot");
  const server = sharing === "process" ? processServers.get("openbot") : own;
  const { Client } = await import(pathToFileURL(clientPath).href);
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(transportPath).href);
  const headers = Object.fromEntries(server.headers.map((header) => [header.name, header.value]));
  const client = new Client({ name: "hermes-fixture", version });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
  try {
    const result = await client.callTool({ name: "whoami", arguments: {} });
    return result.content?.[0]?.text ?? "";
  } finally {
    await client.close().catch(() => undefined);
  }
}
async function handle(message) {
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  if (message.method === "initialize")
    return reply({ protocolVersion: 1, agentInfo: { name: "hermes-agent", version },
      agentCapabilities: { loadSession: true, promptCapabilities: {} } });
  if (message.method === "session/new" || message.method === "session/load") {
    const sessionId = message.params.sessionId ?? "hermes-" + process.pid + "-" + ++opened;
    const servers = message.params.mcpServers ?? [];
    sessions.set(sessionId, servers);
    for (const server of servers) if (!processServers.has(server.name)) processServers.set(server.name, server);
    log({ event: "session", sessionId });
    return reply(message.method === "session/new" ? { sessionId } : {});
  }
  if (message.method === "session/prompt") {
    const sessionId = message.params.sessionId;
    const answeredAs = await callWhoami(sessionId);
    log({ event: "call", sessionId, answeredAs });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OK" } } } });
    return reply({ stopReason: "end_turn" });
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Fixture does not implement " + message.method } });
}
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  handle(message).catch((error) =>
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: String(error) } }));
});
`;

const whoamiTools = {
  type: "namespace",
  name: "openbot",
  tools: [{ type: "function", name: "whoami", inputSchema: { type: "object", properties: {} } }],
};

interface LogEntry {
  pid: number;
  event: "start" | "session" | "call";
  sessionId?: string;
  answeredAs?: string;
}

interface CaseReport {
  agent: string;
  version: string;
  sharing: "process" | "session";
  threads: string[];
  toolCallThreads: string[];
  sessionPids: number[];
  ownProcessPerSession: boolean;
  passed: boolean;
}

const report: {
  passed: boolean;
  cases: CaseReport[];
  cleanup: { pid: number; stopped: boolean }[];
  errors: string[];
} = { passed: false, cases: [], cleanup: [], errors: [] };

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function readLog(path: string): Promise<LogEntry[]> {
  const content = await readFile(path, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ESRCH") return false;
    throw error;
  }
}

async function turn(client: AgentClient, threadId: string, model: string): Promise<void> {
  let finish: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const done = new Promise<void>((resolveTurn, reject) => {
    finish = resolveTurn;
    fail = reject;
  });
  const timer = setTimeout(() => fail(new Error("Turn completion deadline expired.")), 20_000);
  const listener = (event: AppServerNotification) => {
    if (getString(event.params, "threadId") !== threadId) return;
    if (event.method === "error") fail(new Error("Provider reported a turn error."));
    if (event.method === "turn/completed") {
      const status = isRecord(event.params) ? getString(event.params.turn, "status") : null;
      if (status === "completed") finish();
      else fail(new Error(`Turn ended with status ${status}.`));
    }
  };
  client.on("notification", listener);
  try {
    await Promise.all([
      runCauseEffect(
        client.request(
          "turn/start",
          { threadId, model, input: [{ type: "text", text: "Call whoami." }] },
          (value) => value,
        ),
      ),
      done,
    ]);
  } finally {
    clearTimeout(timer);
    client.off("notification", listener);
  }
}

const cases = [
  { agent: "hermes-old", version: "0.21.3", sharing: "process" as const, ownProcessPerSession: true },
  { agent: "hermes-rebuilt", version: "0.22.2", sharing: "process" as const, ownProcessPerSession: true },
  { agent: "hermes-new", version: "0.22.3", sharing: "session" as const, ownProcessPerSession: false },
];
const logs = Object.fromEntries(cases.map((item) => [item.agent, join(root, `${item.agent}.jsonl`)]));
const toolCallThreads: string[] = [];
let client: AgentClient | undefined;
try {
  await writeFile(join(root, "fixture.cjs"), fixtureSource);
  const clientPath = fileURLToPath(import.meta.resolve("@modelcontextprotocol/sdk/client/index.js"));
  const transportPath = fileURLToPath(import.meta.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js"));
  const agents = await Promise.all(
    cases.map(async (item) => {
      const folder = join(root, item.agent);
      await mkdir(folder);
      const command = join(folder, "hermes");
      const args = [
        process.execPath,
        join(root, "fixture.cjs"),
        item.version,
        item.sharing,
        logs[item.agent] ?? "",
        clientPath,
        transportPath,
      ];
      await writeFile(command, `#!/bin/sh\nexec ${args.map(shellQuote).join(" ")}\n`);
      await chmod(command, 0o700);
      return { id: item.agent, name: item.agent, command, args: [], env: [], usagePrompt: null };
    }),
  );
  client = requireProviderDriver("acp").createClient(
    { executable: "acp", version: "fixture" },
    20_000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => [], customAgents: () => agents },
    undefined,
  );
  const agentClient = client;
  agentClient.on("request", (request: AppServerRequest) => {
    if (request.method !== "item/tool/call") return;
    const threadId = getString(request.params, "threadId") ?? "";
    toolCallThreads.push(threadId);
    agentClient.respond(request.id, { success: true, contentItems: [{ type: "inputText", text: threadId }] });
  });
  agentClient.start();

  for (const item of cases) {
    const model = `${item.agent}/default`;
    const threads: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const opened = await runCauseEffect(
        agentClient.request("thread/start", { cwd: root, model, dynamicTools: [whoamiTools] }, (value) => value),
      );
      const id = isRecord(opened) ? getString(opened.thread, "id") : null;
      assert.ok(id, "thread/start must return an id.");
      threads.push(id);
    }
    const before = toolCallThreads.length;
    for (const threadId of threads) await turn(agentClient, threadId, model);
    const calls = toolCallThreads.slice(before);
    const entries = await readLog(logs[item.agent] ?? "");
    const sessionPids = threads.map(
      (threadId) =>
        entries.find((entry) => entry.event === "session" && threadId.endsWith(`:${entry.sessionId}`))?.pid ?? 0,
    );
    const ownProcessPerSession = new Set(sessionPids).size === threads.length;
    report.cases.push({
      agent: item.agent,
      version: item.version,
      sharing: item.sharing,
      threads,
      toolCallThreads: calls,
      sessionPids,
      ownProcessPerSession,
      passed:
        JSON.stringify(calls) === JSON.stringify(threads) &&
        sessionPids.every((pid) => pid !== 0) &&
        ownProcessPerSession === item.ownProcessPerSession,
    });
  }
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  try {
    if (client) await runCauseEffect(client.stop());
  } catch (error) {
    report.errors.push(`Client shutdown failed: ${String(error)}`);
  }
  const started = (await Promise.all(Object.values(logs).map(readLog)))
    .flat()
    .filter((entry) => entry.event === "start");
  report.cleanup = started.map((entry) => ({ pid: entry.pid, stopped: !running(entry.pid) }));
  const cleaned = report.cleanup.every((child) => child.stopped);
  if (!cleaned) report.errors.push("Owned child cleanup was not confirmed.");
  report.passed =
    report.errors.length === 0 && report.cases.length === cases.length && report.cases.every((item) => item.passed);
  if (cleaned) await rm(root, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      passed: report.passed,
      report: join(out, "report.json"),
      cases: report.cases.map(
        (item) =>
          `${item.passed ? "PASS" : "FAIL"} ${item.agent} ${item.version}: calls ${item.toolCallThreads.join(",")} for ${item.threads.join(",")}, pids ${item.sessionPids.join(",")}`,
      ),
      errors: report.errors,
    })}\n`,
  );
  process.exitCode = report.passed ? 0 : 1;
}
