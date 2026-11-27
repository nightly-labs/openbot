import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type McpServerConfig } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { decodeRecordResponse, getRecord, getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-mcp-new-tools-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-codex-mcp-new-tools-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const countPath = join(root, "tool-count");
const mcpLogPath = join(root, "mcp.log");
const mcpScript = join(root, "mcp-server.cjs");
const fakeCodex = join(root, "codex");
const TOOL_NAMES = [
  "send_mail",
  "list_mail",
  "read_mail",
  "search_mail",
  "list_events",
  "create_event",
  "search_drive",
  "list_drive_children",
  "read_drive_file",
  "create_drive_file",
];

const realCodex = await resolveRealCodex();
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const MCP_SERVER = `
const fs = require("node:fs");
const readline = require("node:readline");
const [countFile, logFile] = process.argv.slice(2);
const names = ${JSON.stringify(TOOL_NAMES)};
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
fs.appendFileSync(logFile, "start " + process.pid + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "mail", version: "1" } } });
  } else if (message.method === "tools/list") {
    const count = Number(fs.readFileSync(countFile, "utf8").trim());
    fs.appendFileSync(logFile, "tools/list " + count + "\\n");
    send({ id: message.id, result: { tools: names.slice(0, count).map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) } });
  } else if (message.id !== undefined) {
    send({ id: message.id, result: {} });
  }
});
`;

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.172.0\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
const control = () => JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8"));
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finishWhenReleased = (threadId, turnId) => {
  if (control().holdTurns) return setTimeout(() => finishWhenReleased(threadId, turnId), 25);
  const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start":
    case "thread/resume": {
      const threadId = message.method === "thread/start" ? process.pid + "-thread-" + (++threads) : params.threadId;
      return write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
    }
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/archive": return write({ id: message.id, result: {} });
    case "thread/backgroundTerminals/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = process.pid + "-turn-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      return finishWhenReleased(params.threadId, turnId);
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      log({ method: message.method ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface ModelItem {
  type: string;
  role: string;
  id: string;
  content: Array<{ type: string; text: string }>;
}

interface ModelEvent {
  type: string;
  output_index?: number;
  item?: ModelItem;
  response?: {
    id: string;
    status: string;
    output?: ModelItem[];
    usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  };
}

interface Report {
  realCodex: { version: string; sameProcess: string[]; newProcess: string[] } | { skipped: string };
  steps: Array<{ step: string; detail: unknown }>;
  passed: boolean;
  error?: string;
}

const report: Report = { realCodex: { skipped: "not run" }, steps: [], passed: false };

async function resolveRealCodex() {
  const saved = process.env.OPENBOT_CODEX_PATH;
  delete process.env.OPENBOT_CODEX_PATH;
  try {
    return await Effect.runPromise(resolveCodexCli());
  } catch {
    return null;
  } finally {
    if (saved !== undefined) process.env.OPENBOT_CODEX_PATH = saved;
  }
}

async function realCodexToolLists(executable: string) {
  const bodies: string[] = [];
  const model = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      bodies.push(body);
      const item: ModelItem = {
        type: "message",
        role: "assistant",
        id: "m",
        content: [{ type: "output_text", text: "done" }],
      };
      const send = (event: ModelEvent) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.writeHead(200, { "content-type": "text/event-stream" });
      send({ type: "response.created", response: { id: "r", status: "in_progress" } });
      send({ type: "response.output_item.done", output_index: 0, item });
      send({
        type: "response.completed",
        response: {
          id: "r",
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      response.end();
    });
  });
  await new Promise<void>((done) => model.listen(0, "127.0.0.1", done));
  const address = model.address();
  assert(address && typeof address === "object");
  const codexHome = join(root, "real-codex-home");
  mkdirSync(codexHome, { recursive: true });
  await writeFile(
    join(codexHome, "config.toml"),
    [
      'model = "fake-model"',
      'model_provider = "fake"',
      "[model_providers.fake]",
      'name = "fake"',
      `base_url = "http://127.0.0.1:${address.port}/v1"`,
      'env_key = "FAKE_KEY"',
      'wire_api = "responses"',
      "",
    ].join("\n"),
  );
  const servers = { mail: { command: "node", args: [mcpScript, countPath, mcpLogPath], env: {} } };
  const offered = (from: number) => TOOL_NAMES.filter((name) => bodies.slice(from).join("\n").includes(name));
  const session = async () => {
    const client = new CodexAppServerClient(executable, 30_000, { CODEX_HOME: codexHome, FAKE_KEY: "e2e" });
    let turnDone = () => {};
    client.on("notification", (notification) => {
      if (notification.method === "turn/completed") turnDone();
    });
    client.start();
    await runCauseEffect(
      client.request(
        "initialize",
        { clientInfo: { name: "openbot_e2e", title: "OpenBot E2E", version: "0.0.0" }, capabilities: {} },
        decodeRecordResponse,
      ),
    );
    client.notify("initialized");
    const chat = async () => {
      const started = await runCauseEffect(
        client.request(
          "thread/start",
          { cwd: codexHome, model: "fake-model", config: { mcp_servers: servers } },
          decodeRecordResponse,
        ),
      );
      const threadId = getString(getRecord(started, "thread"), "id");
      assert(threadId, "Codex returned no thread id");
      const from = bodies.length;
      const done = new Promise<void>((finish) => {
        turnDone = finish;
      });
      await runCauseEffect(
        client.request("turn/start", { threadId, input: [{ type: "text", text: "hello" }] }, decodeRecordResponse),
      );
      await done;
      await runCauseEffect(client.request("thread/unsubscribe", { threadId }, decodeRecordResponse));
      return offered(from);
    };
    return { chat, stop: () => runCauseEffect(client.stop()) };
  };
  try {
    await writeFile(countPath, "6");
    const first = await session();
    assert.equal((await first.chat()).length, 6, "the first chat did not get 6 tools");
    await writeFile(countPath, "10");
    const sameProcess = await first.chat();
    await first.stop();
    const second = await session();
    const newProcess = await second.chat();
    await second.stop();
    return { sameProcess, newProcess };
  } finally {
    model.close();
  }
}

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

function protocol(): Array<{ pid: number; method: string | null }> {
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line): unknown => JSON.parse(line))
    .flatMap((entry) =>
      isRecord(entry) && typeof entry.pid === "number"
        ? [{ pid: entry.pid, method: getString(entry, "method") ?? null }]
        : [],
    );
}

function codexProcesses(): number[] {
  return [
    ...new Set(
      protocol()
        .filter((entry) => entry.method === "initialize")
        .map((entry) => entry.pid),
    ),
  ];
}

function turnProcesses(): number[] {
  return protocol()
    .filter((entry) => entry.method === "turn/start")
    .map((entry) => entry.pid);
}

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

await writeFile(mcpScript, MCP_SERVER);
await writeFile(countPath, "6");
await writeFile(mcpLogPath, "");
await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
await writeFile(controlPath, JSON.stringify({ holdTurns: false }));
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});

try {
  if (realCodex) {
    const lists = await realCodexToolLists(realCodex.executable);
    report.realCodex = { version: realCodex.version, ...lists };
    assert.equal(lists.sameProcess.length, 6, "the same Codex process did not keep its old tool list");
    assert.equal(lists.newProcess.length, 10, "a new Codex process did not list the new tools");
  } else {
    report.realCodex = { skipped: "No Codex CLI is installed." };
  }

  await writeFile(countPath, "6");
  await runCauseEffect(agents.initialize());
  const saved = await runCauseEffect(
    agents.saveMcpServer({
      config: {
        id: "",
        name: "mail",
        transport: "stdio",
        enabled: true,
        command: "node",
        args: [mcpScript, countPath, mcpLogPath],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    }),
  );
  const server = saved.find((config) => config.name === "mail");
  assert(server, "the MCP server was not saved");
  const test = (config: McpServerConfig) => runCauseEffect(agents.testMcpServer({ config }));
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Mail",
      description: "Reads the mail and the drive.",
      avatarSeed: "mail",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const completed = () => agents.listQueue(agent.id).deliveries.filter((item) => item.status === "completed").length;
  await waitFor("the first message to end", () => completed() === 1);
  const first = await waitFor("a Codex process", () => codexProcesses()[0]);
  const firstTest = await test(server);
  assert.equal(firstTest.toolCount, 6);
  const afterFirstTest = await waitFor("the restart after the first test", () => codexProcesses()[1]);
  report.steps.push({ step: "first test in this run restarts Codex", detail: { first, afterFirstTest } });

  const sameTest = await test(server);
  assert.equal(sameTest.toolCount, 6);
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Second message." }));
  await waitFor("the second message to end", () => completed() === 2);
  assert.deepEqual(codexProcesses(), [first, afterFirstTest], "a test with the same tools restarted Codex");
  assert.equal(turnProcesses().at(-1), afterFirstTest);
  report.steps.push({ step: "same tools: no restart", detail: { turnProcess: turnProcesses().at(-1) } });

  await writeFile(controlPath, JSON.stringify({ holdTurns: true }));
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "A long task." }));
  await waitFor("the long turn to start", () => turnProcesses().length === 3);
  await writeFile(countPath, "10");
  const newTest = await test(server);
  assert.equal(newTest.toolCount, 10);
  assert.equal(codexProcesses().length, 2, "Codex restarted during a running turn");
  await writeFile(controlPath, JSON.stringify({ holdTurns: false }));
  await waitFor("the long turn to end", () => completed() === 3);
  const afterNewTools = await waitFor("the restart after new tools", () => codexProcesses()[2]);
  report.steps.push({ step: "new tools: restart after the running turn", detail: { afterNewTools } });

  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Read my drive." }));
  await waitFor("the fourth message to end", () => completed() === 4);
  assert.equal(turnProcesses().at(-1), afterNewTools, "the next turn did not run in the new Codex process");
  report.steps.push({ step: "next turn runs in the new process", detail: { turnProcess: turnProcesses().at(-1) } });
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
