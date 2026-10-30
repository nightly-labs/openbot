// Checks that an agent keeps its provider session when OpenBot's child processes stop under it.
// Runs the real agent service on a temporary profile with a fake Codex app-server (or a fake OpenCode
// with `PROBE_PROVIDER=opencode`), and the real Computer Use runtime with a fake driver daemon.
// 1. After one turn the fake provider gets SIGTERM, as it does when the operating system or a process
//    supervisor stops the app's process group. The runtime starts it again, and the next turn must
//    resume the same provider thread rather than start a new one, which would lose its own context.
// 2. The same signal reaches the driver daemon while OpenBot quits. Its exit must not deactivate the
//    stored sessions, which the next run resumes.
// 3. Control: a daemon that dies while OpenBot keeps running still deactivates them, because the live
//    sessions then hold a tool set that is not the one they would be given now.
// `bun run test:provider-exit-session`. Writes .openbot-build/provider-exit-session-e2e/report.json.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-exit-session-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-provider-exit-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const fakeCodex = join(root, "codex");
const fakeOpenCode = join(root, "opencode");
const fakeDriver = join(root, "cua-driver");
// The socket path limit is 103 characters on macOS, and the temporary folder there is long.
const driverRoot = await mkdtemp("/tmp/openbot-cua-");
const PROVIDER = process.env.PROBE_PROVIDER === "opencode" ? "opencode" : "codex";

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_OPENCODE_PATH = fakeOpenCode;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { CuaDriverRuntime } = await import("../src/main/cua-driver-runtime");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// A Codex app-server that keeps its threads in a file, as the real one keeps them on disk, so a
// restarted process resumes a thread that the previous process started.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
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
      log({ method: message.method ?? null, threadId: (message.params || {}).threadId ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

const FAKE_OPENCODE = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
if (process.argv.includes("--version")) { process.stdout.write("1.19.3" + NL); process.exit(0); }
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, ...entry }) + NL);
log({ start: true, argv: process.argv.slice(2) });
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODEL = "opencode/big-pickle";
const setup = (sessionId) => ({ sessionId, models: { availableModels: [{ modelId: MODEL, name: "Big Pickle" }], currentModelId: MODEL } });
function handle(message) {
  const params = message.params ?? {};
  log({ method: message.method ?? null, threadId: params.sessionId ?? null });
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: setup("ses-" + process.pid) });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: setup(params.sessionId) });
  if (message.method === "session/list") return write({ id: message.id, result: { sessions: [] } });
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

// A driver daemon that only listens on its socket, as the real one does until it is asked something.
const FAKE_DRIVER = `#!/usr/bin/env node
const net = require("node:net");
const socket = process.argv[process.argv.indexOf("--socket") + 1];
net.createServer((connection) => connection.on("data", () => {})).listen(socket);
process.stdin.resume();
`;

interface ProtocolLine {
  pid: number;
  start?: boolean;
  method?: string | null;
  threadId?: string | null;
}

interface Report {
  passed: boolean;
  firstThread?: string;
  killedPid?: number;
  sessionAfterExit?: { externalSessionId: string; state: string } | null;
  secondTurn?: { pid: number; resumed: string | null; started: boolean; turnThread: string | null };
  driverExitAtQuit?: { announcements: number; sessionState: string | null };
  driverExitWhileRunning?: { announcements: number; sessionState: string | null };
  error?: string;
}

const report: Report = { passed: false };
const TURN_METHOD = PROVIDER === "codex" ? "turn/start" : "session/prompt";
const START_METHOD = PROVIDER === "codex" ? "thread/start" : "session/new";
const RESUME_METHODS = PROVIDER === "codex" ? ["thread/resume"] : ["session/resume", "session/load"];

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

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
await writeFile(fakeOpenCode, FAKE_OPENCODE, { mode: 0o755 });
await writeFile(fakeDriver, FAKE_DRIVER, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: PROVIDER,
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== PROVIDER),
});

/** A driver wired to the agents as `application-services.ts` wires it, with both grants given. */
function driverRuntime(name: string) {
  const daemon: { child: ChildProcess | null } = { child: null };
  const quit = { started: false };
  const runtime = new CuaDriverRuntime({
    executable: fakeDriver,
    endpoint: { kind: "unix-socket", directory: join(driverRoot, name) },
    supported: true,
    hostBundleId: "run.openbot.e2e",
    platform: "darwin",
    spawnProcess: (command, args, options) => {
      daemon.child = spawn(command, args, options);
      return daemon.child;
    },
    readPermissions: async () => [
      { id: "screen-recording", granted: true },
      { id: "accessibility", granted: true },
    ],
    quitting: () => quit.started,
  });
  const announced = { count: 0 };
  runtime.onMcpServerChanged(() => {
    announced.count += 1;
    void runCauseEffect(agents.notifyComputerUseChanged()).catch(() => {});
  });
  return { runtime, announced, daemon, quit };
}

/** Stops the daemon from outside, as a signal to the process group does, and waits for the runtime to see it. */
async function killDaemon({ runtime, daemon }: ReturnType<typeof driverRuntime>): Promise<void> {
  let stopped = false;
  runtime.onStateChanged((state) => {
    if (state.status === "error") stopped = true;
  });
  daemon.child?.kill("SIGTERM");
  await waitFor("the runtime to see the daemon stop", () => stopped);
}

const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

const atQuit = driverRuntime("driver-at-quit");
const whileRunning = driverRuntime("driver-while-running");

/** The state of the agent's first provider session. */
function sessionState(agentId: string, externalSessionId: string): string | null {
  const threadId = store.list().find((one) => one.id === agentId)?.threadId ?? "";
  return (
    store.database.listProviderSessions(threadId).find((one) => one.externalSessionId === externalSessionId)?.state ??
    null
  );
}

try {
  await runCauseEffect(agents.initialize());
  // At startup, as `application-services.ts` does: a user who granted Computer Use gets the daemon.
  await runCauseEffect(atQuit.runtime.warmUp());
  if (!atQuit.runtime.mcpServerForProviders())
    throw new Error(`The fake driver did not become ready: ${JSON.stringify(atQuit.runtime.lastState)}`);
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Provider exit",
      description: "Checks the provider session after a provider process exit.",
      avatarSeed: "provider-exit",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const firstThread = await waitFor("the first turn to end", () => {
    const session = store.activeProviderSession(agent.id)?.externalSessionId;
    const started = protocol().some((line) => line.method === TURN_METHOD && line.threadId === session);
    return session && started && idle(agent.id) ? session : null;
  });
  report.firstThread = firstThread;

  // 1. The process stops between turns, as a SIGTERM to the app's process group stops it.
  const killedPid = protocol().find((line) => line.start)?.pid ?? 0;
  report.killedPid = killedPid;
  process.kill(killedPid, "SIGTERM");
  const restarted = await waitFor("Codex to start again", () =>
    protocol().find((line) => line.start && line.pid !== killedPid),
  );
  await waitFor("the provider to be ready again", () => agents.getStatus().phase === "ready");
  const state = sessionState(agent.id, firstThread);
  report.sessionAfterExit = state ? { externalSessionId: firstThread, state } : null;

  // 2. The next turn resumes the thread on the new process.
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Second message." }));
  const turn = await waitFor("the second turn to start", () =>
    protocol().find((line) => line.pid === restarted.pid && line.method === TURN_METHOD),
  );
  await waitFor("the second turn to end", () => idle(agent.id));
  const lines = protocol().filter((line) => line.pid === restarted.pid);
  report.secondTurn = {
    pid: restarted.pid,
    resumed: lines.find((line) => RESUME_METHODS.includes(line.method ?? ""))?.threadId ?? null,
    started: lines.some((line) => line.method === START_METHOD),
    turnThread: turn.threadId ?? null,
  };

  // 3. OpenBot quits, and the same signal stops the driver daemon before the teardown does.
  atQuit.quit.started = true;
  await killDaemon(atQuit);
  report.driverExitAtQuit = {
    announcements: atQuit.announced.count,
    sessionState: sessionState(agent.id, firstThread),
  };

  // 4. Control: a daemon that dies while OpenBot runs still deactivates the session.
  await runCauseEffect(whileRunning.runtime.warmUp());
  await killDaemon(whileRunning);
  const deactivated = await waitFor("the session to be deactivated", () => {
    const current = sessionState(agent.id, firstThread);
    return current !== "active" && current;
  });
  report.driverExitWhileRunning = { announcements: whileRunning.announced.count, sessionState: deactivated };

  report.passed =
    report.sessionAfterExit?.state === "active" &&
    report.secondTurn.resumed === firstThread &&
    // An ACP provider opens a discovery session for its model list, so only Codex can tell.
    (PROVIDER !== "codex" || !report.secondTurn.started) &&
    report.secondTurn.turnThread === firstThread &&
    report.driverExitAtQuit.announcements === 0 &&
    report.driverExitAtQuit.sessionState === "active" &&
    report.driverExitWhileRunning.announcements === 1;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(atQuit.runtime.stop()).catch(() => {});
  await runCauseEffect(whileRunning.runtime.stop()).catch(() => {});
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  await rm(driverRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
