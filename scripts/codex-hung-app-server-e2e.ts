// Checks issue #3141: a Codex app-server that stays alive but stops answering is replaced, and the
// agents' next turns run on the new process. Runs the real Codex client and the real agent service
// on a temporary profile with a fake Codex app-server.
// 1. Control: a process that does not answer `model/list`, as on a slow network, but answers the
//    `config/read` probe, keeps running.
// 2. A process that answers nothing is ended, with the error that says why.
// 3. With an MCP server configured, a delivery that meets a hung process fails with the timeout
//    message, not with the `config.toml` guidance. The runtime starts a new process, and the next turn runs.
// `bun run test:codex-hung-app-server`. Writes .openbot-build/codex-hung-app-server-e2e/report.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-hung-app-server-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-codex-hung-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const modesPath = join(root, "modes.json");
const fakeCodex = join(root, "codex");
const REQUEST_TIMEOUT_MS = 1_000;

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_MODES = modesPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { CodexAppServerClient } = await import("../src/backend/app-server-client");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { decodeRecordResponse } = await import("../src/backend/protocol");
const { providerLabel } = await import("../src/backend/agent/thread-items");

// A Codex app-server whose behaviour the check sets for each process id in the modes file:
// `slow` leaves `model/list` unanswered, and `hung` leaves every request unanswered. The process
// stays alive in both, as the hung codex.exe of the issue did.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
const mode = () => {
  try { return JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_MODES, "utf8"))[process.pid] ?? null; } catch { return null; }
};
log({ start: true });
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + process.pid, turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/archive": return write({ id: message.id, result: {} });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 50);
      return;
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
      const current = mode();
      log({ method: message.method ?? null, mode: current });
      const silent = current === "hung" || (current === "slow" && message.method === "model/list");
      if (message.method && message.id !== undefined && !silent) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
setInterval(() => {}, 1000);
`;

interface ProtocolLine {
  pid: number;
  start?: boolean;
  method?: string | null;
  mode?: string | null;
}

interface Report {
  passed: boolean;
  slowProcess?: { probed: boolean; exited: boolean; answeredAfter: boolean };
  hungProcess?: { exitMessage: string | null; alive: boolean };
  service?: {
    hungPid: number;
    restartedPid: number;
    failedDeliveryError: string | null;
    nextTurnPid: number | null;
  };
  error?: string;
}

const report: Report = { passed: false };
const modes: Record<number, string> = {};
const setMode = (pid: number, mode: string) => {
  modes[pid] = mode;
  writeFileSync(modesPath, JSON.stringify(modes));
};

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

// One server, so the thread start registers it in the Codex file as the issue's agents did.
const MCP_SERVER: McpServerConfig = {
  id: "e2e-mcp",
  name: "e2e",
  transport: "stdio",
  enabled: true,
  command: process.execPath,
  args: [],
  env: [],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [],
};

function protocol(): ProtocolLine[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): ProtocolLine => JSON.parse(line));
  } catch {
    return [];
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits for a state of the service or of the fake Codex. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const lastStartPid = () => protocol().findLast((line) => line.start)?.pid ?? 0;

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  computerUseMcpServer: () => MCP_SERVER,
});
const client = new CodexAppServerClient(fakeCodex, REQUEST_TIMEOUT_MS);

try {
  // 1. Control: a slow `model/list` alone does not end a process that answers the probe.
  let exitMessage: string | null = null;
  client.on("exit", (error) => {
    exitMessage = error.message;
  });
  client.start();
  await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
  const clientPid = lastStartPid();
  setMode(clientPid, "slow");
  const listed = await Effect.runPromise(Effect.result(client.request("model/list", {}, decodeRecordResponse)));
  const probed = await waitFor("the probe", () => {
    const lines = protocol().filter((line) => line.pid === clientPid);
    const list = lines.findIndex((line) => line.method === "model/list");
    return list >= 0 && lines.slice(list + 1).some((line) => line.method === "config/read");
  });
  const after = await Effect.runPromise(Effect.result(client.request("account/read", {}, decodeRecordResponse)));
  report.slowProcess = {
    probed: probed && Result.isFailure(listed),
    exited: exitMessage !== null || !client.running,
    answeredAfter: Result.isSuccess(after),
  };

  // 2. A process that answers nothing, the probe included, is ended.
  setMode(clientPid, "hung");
  await Effect.runPromise(Effect.result(client.request("account/read", {}, decodeRecordResponse)));
  await waitFor("the hung process to be ended", () => exitMessage !== null);
  await waitFor("the hung process to exit", () => !alive(clientPid), 5_000).catch(() => false);
  report.hungProcess = { exitMessage, alive: alive(clientPid) };

  // 3. The service: one turn, then the shared process hangs between turns.
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Codex hang",
      description: "Checks the recovery from a hung Codex app-server.",
      avatarSeed: "codex-hang",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const idle = () =>
    !agents
      .listQueue(agent.id)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  await waitFor("the first turn to end", () => protocol().some((line) => line.method === "turn/start") && idle());
  const hungPid = lastStartPid();
  setMode(hungPid, "hung");

  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Second message." }));
  const restarted = await waitFor("Codex to start again", () =>
    protocol().find((line) => line.start && line.pid !== hungPid && line.pid !== clientPid),
  );
  await waitFor("the second message to settle", idle);
  await waitFor("the provider to be ready again", () => agents.getStatus().phase === "ready");
  const failed = agents
    .listQueue(agent.id)
    .deliveries.find((delivery) => delivery.status === "failed" && delivery.error !== null);

  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Third message." }));
  const turn = await waitFor("a turn on the new process", () =>
    protocol().find((line) => line.pid === restarted.pid && line.method === "turn/start"),
  );
  await waitFor("the third turn to end", idle);
  report.service = {
    hungPid,
    restartedPid: restarted.pid,
    failedDeliveryError: failed?.error ?? null,
    nextTurnPid: turn.pid,
  };

  report.passed =
    report.slowProcess.probed &&
    !report.slowProcess.exited &&
    report.slowProcess.answeredAfter &&
    report.hungProcess.exitMessage === sourceText("error.provider.codexUnresponsive") &&
    !report.hungProcess.alive &&
    report.service.failedDeliveryError ===
      sourceText("error.provider.cliTimedOut", { provider: providerLabel("codex") }) &&
    report.service.nextTurnPid === restarted.pid;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(client.stop()).catch(() => {});
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
