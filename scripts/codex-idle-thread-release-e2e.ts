// Checks the idle release of Codex sessions. One Codex app server holds every thread of its account,
// with the MCP servers and terminals of each thread, until the whole process is idle. OpenBot now
// unsubscribes from each idle thread, so the app server unloads it, and resumes it at the next turn.
// Runs the real agent service with a fake Codex app-server that forgets a thread at
// `thread/unsubscribe`: a turn on it without `thread/resume` first fails.
// 1. Timeout: the session of an idle agent is released after the injected timeout. The next message
//    resumes the same session before its turn starts.
// 2. Background terminal: a session whose thread has a background terminal stays loaded. It is
//    released after the terminal ends.
// 3. Race: a message arrives while the release waits for the terminal check. The turn runs on the
//    loaded session, and the release comes only after that turn ends.
// 4. Limit: with a long timeout, the end of a turn releases at once the older idle session of the same
//    app server, and keeps the newer one.
// `bun run test:codex-idle-thread-release`. Writes .openbot-build/codex-idle-thread-release-e2e/report.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-idle-thread-release-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-codex-idle-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");
const defaultHome = join(home, ".codex");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = defaultHome;
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(defaultHome, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// A Codex app-server that saves a rollout when a turn completes, resumes a thread from it, and
// forgets a thread at `thread/unsubscribe`, as the real one does when it unloads the thread. The
// control file gives each thread a background terminal (`terminals`), holds the answer to the
// terminal list (`holdList`), and holds the end of each turn (`holdTurns`).
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.163.0\\n");
  process.exit(0);
}
const codexHome = process.env.CODEX_HOME;
const rolloutsPath = path.join(codexHome, "fake-rollouts.json");
const rollouts = () => { try { return JSON.parse(fs.readFileSync(rolloutsPath, "utf8")); } catch { return []; } };
const hasRollout = (threadId) => rollouts().some((turn) => turn.threadId === threadId);
const control = () => { try { return JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8")); } catch { return {}; } };
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, ...entry }) + "\\n");
log({ start: true });
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const loaded = new Set();
let buffer = "";
let threads = 0;
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
    case "thread/start": {
      const id = "thread-" + process.pid + "-" + (++threads);
      loaded.add(id);
      return write({ id: message.id, result: { thread: { id, turns: [] } } });
    }
    case "thread/resume":
      if (!loaded.has(params.threadId) && !hasRollout(params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "no rollout found for thread id " + params.threadId } });
      loaded.add(params.threadId);
      return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe":
      loaded.delete(params.threadId);
      return write({ id: message.id, result: { status: "unsubscribed" } });
    case "thread/backgroundTerminals/list": {
      const send = () => {
        if (control().holdList) return setTimeout(send, 25);
        const data = control().terminals ? [{ itemId: "item-1", processId: "1", command: "npm run dev", cwd: "/" }] : [];
        write({ id: message.id, result: { data, nextCursor: null } });
        log({ answered: message.method, threadId: params.threadId });
      };
      return send();
    }
    case "thread/turns/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "turn/start": {
      if (!loaded.has(params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "thread not found: " + params.threadId } });
      const turnId = "turn-" + process.pid + "-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const complete = () => {
        if (control().holdTurns) return setTimeout(complete, 25);
        fs.writeFileSync(rolloutsPath, JSON.stringify([...rollouts(), { threadId: params.threadId, turnId }]));
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
        log({ sent: "turn/completed", threadId: params.threadId });
      };
      setTimeout(complete, 50);
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

interface ProtocolLine {
  pid: number;
  start?: boolean;
  method?: string | null;
  threadId?: string | null;
  answered?: string;
  sent?: string;
}

/** What the next turn of a released session sent, in order. */
interface ResumedTurn {
  sameSession: boolean;
  resumedBeforeTurn: boolean;
  turnStarts: number;
  newThreads: number;
}

interface Report {
  passed: boolean;
  timeout?: { thread: string; released: boolean; next: ResumedTurn };
  backgroundTerminal?: { thread: string; checksWhileHeld: number; releasedWhileHeld: boolean; releasedAfter: boolean };
  race?: { thread: string; turnResumed: boolean; releasedAfterTurnEnd: boolean };
  limit?: {
    older: string;
    newer: string;
    olderReleasedAtOnce: boolean;
    newerKept: boolean;
    olderNext: ResumedTurn;
    newerReleasedAfterOlderTurn: boolean;
  };
  errors?: { agentId: string; code: string; message: string }[];
  error?: string;
}

const report: Report = { passed: false };
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
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

const control = (value: { terminals?: boolean; holdList?: boolean; holdTurns?: boolean }) =>
  writeFileSync(controlPath, JSON.stringify(value));
const requested = (method: string, threadId: string, from = 0) =>
  protocol()
    .slice(from)
    .findIndex((line) => line.method === method && line.threadId === threadId);
const count = (method: string, threadId: string, from = 0) =>
  protocol()
    .slice(from)
    .filter((line) => line.method === method && line.threadId === threadId).length;

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });

/** One run of the app on the profile, with the injected idle release. */
async function startApp(codexIdleSessions: { releaseAfterMs: number; idleLimit: number }) {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    codexIdleSessions,
  });
  const errors: { agentId: string; code: string; message: string }[] = [];
  agents.on("event", (event) => {
    if (event.type === "error" && event.agentId)
      errors.push({ agentId: event.agentId, code: event.code ?? "", message: event.message });
  });
  return { database, store, agents, errors };
}

type App = Awaited<ReturnType<typeof startApp>>;

const idle = (app: App, agentId: string) =>
  !app.agents
    .listQueue(agentId)
    .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

async function createAgent(app: App, name: string): Promise<{ agentId: string; thread: string }> {
  const agent = await runCauseEffect(
    app.agents.createAgent({
      name,
      description: "Checks the idle release of Codex sessions.",
      avatarSeed: name.toLowerCase(),
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const thread = await waitFor(`the first turn of ${name} to end`, () => {
    const session = app.store.activeProviderSession(agent.id)?.externalSessionId;
    return session && count("turn/start", session) > 0 && idle(app, agent.id) ? session : null;
  });
  return { agentId: agent.id, thread };
}

/** Sends a message to an agent whose session was released, and reads what its turn sent. */
async function nextTurn(app: App, agentId: string, thread: string): Promise<ResumedTurn> {
  const from = protocol().length;
  await runCauseEffect(app.agents.sendMessage({ agentId, text: "Next message." }));
  await waitFor("the next turn to end", () => count("turn/start", thread, from) > 0 && idle(app, agentId));
  const resume = requested("thread/resume", thread, from);
  const turn = requested("turn/start", thread, from);
  return {
    sameSession: app.store.activeProviderSession(agentId)?.externalSessionId === thread,
    resumedBeforeTurn: resume >= 0 && resume < turn,
    turnStarts: count("turn/start", thread, from),
    newThreads: protocol()
      .slice(from)
      .filter((line) => line.method === "thread/start").length,
  };
}

const resumedCleanly = (turn: ResumedTurn) =>
  turn.sameSession && turn.resumedBeforeTurn && turn.turnStarts === 1 && turn.newThreads === 0;

control({});
// A short timeout, so each idle session goes soon.
let app = await startApp({ releaseAfterMs: 300, idleLimit: 1 });
const errors: Report["errors"] = [];
try {
  await runCauseEffect(app.agents.initialize());
  await waitFor("Codex to be ready", () => app.agents.getStatus().phase === "ready");

  // 1. Timeout.
  const timeout = await createAgent(app, "Timeout");
  await waitFor("the idle release of the first session", () => requested("thread/unsubscribe", timeout.thread) >= 0);
  report.timeout = {
    thread: timeout.thread,
    released: true,
    next: await nextTurn(app, timeout.agentId, timeout.thread),
  };

  // 2. Background terminal. Each check finds a terminal, so the timer starts again.
  control({ terminals: true });
  const terminal = await createAgent(app, "Terminal");
  await waitFor("two terminal checks", () => count("thread/backgroundTerminals/list", terminal.thread) >= 2);
  const releasedWhileHeld = requested("thread/unsubscribe", terminal.thread) >= 0;
  const checksWhileHeld = count("thread/backgroundTerminals/list", terminal.thread);
  control({});
  await waitFor("the release after the terminal ended", () => requested("thread/unsubscribe", terminal.thread) >= 0);
  report.backgroundTerminal = { thread: terminal.thread, checksWhileHeld, releasedWhileHeld, releasedAfter: true };

  // 3. Race. The terminal check waits, and a turn starts on the loaded session in that time.
  const raceFrom = protocol().length;
  control({ holdList: true });
  const race = await createAgent(app, "Race");
  await waitFor(
    "the terminal check of the race session",
    () => count("thread/backgroundTerminals/list", race.thread, raceFrom) > 0,
  );
  control({ holdList: true, holdTurns: true });
  const messageFrom = protocol().length;
  await runCauseEffect(app.agents.sendMessage({ agentId: race.agentId, text: "Message during the release." }));
  await waitFor("the turn during the release", () => count("turn/start", race.thread, messageFrom) > 0);
  // The check answers while the turn runs. A release now would unsubscribe the running turn.
  control({ holdTurns: true });
  await waitFor("the terminal answer", () =>
    protocol()
      .slice(raceFrom)
      .some((line) => line.answered === "thread/backgroundTerminals/list" && line.threadId === race.thread),
  );
  control({});
  await waitFor("the race turn to end", () => idle(app, race.agentId));
  await waitFor(
    "the release after the race turn",
    () => requested("thread/unsubscribe", race.thread, messageFrom) >= 0,
  );
  const turnEnd = protocol()
    .slice(messageFrom)
    .findIndex((line) => line.sent === "turn/completed" && line.threadId === race.thread);
  report.race = {
    thread: race.thread,
    turnResumed: requested("thread/resume", race.thread, messageFrom) >= 0,
    releasedAfterTurnEnd: turnEnd >= 0 && requested("thread/unsubscribe", race.thread, messageFrom) > turnEnd,
  };
  errors.push(...app.errors);

  // 4. Limit. A new run of the app with a long timeout: only the limit releases a session.
  await runCauseEffect(app.agents.stop());
  app.database.close();
  app = await startApp({ releaseAfterMs: 10 * 60_000, idleLimit: 1 });
  await runCauseEffect(app.agents.initialize());
  await waitFor("Codex to be ready again", () => app.agents.getStatus().phase === "ready");
  const older = { agentId: timeout.agentId, thread: timeout.thread };
  const newer = { agentId: terminal.agentId, thread: terminal.thread };
  const limitFrom = protocol().length;
  await nextTurn(app, older.agentId, older.thread);
  await nextTurn(app, newer.agentId, newer.thread);
  await waitFor(
    "the release of the older idle session",
    () => requested("thread/unsubscribe", older.thread, limitFrom) >= 0,
  );
  const newerKept = requested("thread/unsubscribe", newer.thread, limitFrom) < 0;
  const olderNext = await nextTurn(app, older.agentId, older.thread);
  await waitFor(
    "the release of the session that is now older",
    () => requested("thread/unsubscribe", newer.thread, limitFrom) >= 0,
  );
  report.limit = {
    older: older.thread,
    newer: newer.thread,
    olderReleasedAtOnce: true,
    newerKept,
    olderNext,
    newerReleasedAfterOlderTurn: true,
  };
  errors.push(...app.errors);
  report.errors = errors;

  report.passed =
    resumedCleanly(report.timeout.next) &&
    !report.backgroundTerminal.releasedWhileHeld &&
    report.backgroundTerminal.checksWhileHeld >= 2 &&
    !report.race.turnResumed &&
    report.race.releasedAfterTurnEnd &&
    report.limit.newerKept &&
    resumedCleanly(report.limit.olderNext) &&
    errors.length === 0;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  report.errors = [...errors, ...app.errors];
} finally {
  await runCauseEffect(app.agents.stop()).catch(() => {});
  app.database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
