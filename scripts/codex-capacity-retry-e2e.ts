// Checks that a Codex turn that retries because its model is at capacity shows a notice while the
// turn still runs. Codex 0.167.2 sends that retry as `error` with `willRetry: true`, the text
// "Reconnecting... 2/5", `responseStreamDisconnected` as its info, and the cause only in
// `additionalDetails` (`codex-rs/core/src/session/mod.rs` `notify_stream_error`). It waits about
// 5 minutes between tries, so the agent showed as working with no output and no notice. The notice
// shows one time per turn, also for the `serverOverloaded` info. A retry for another cause shows no
// notice before the third retry, and a capacity retry does not replace that notice. Runs the real
// agent service on a temporary profile with a fake Codex app-server.
// `bun scripts/codex-capacity-retry-e2e.ts`. Writes .openbot-build/codex-capacity-retry-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-capacity-retry-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-capacity-retry-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");
// The text of `CodexErr::ServerOverloaded` in `codex-rs/protocol/src/error.rs` of Codex 0.167.2.
const AT_CAPACITY = "Selected model is at capacity. Please try a different model.";
const DISCONNECTED = "stream disconnected before completion: Connection reset by peer (os error 54)";
const NOTICE = sourceText("error.backend.providerModelAtCapacity");
const RETRYING = sourceText("error.backend.providerRetrying", { attempts: "3" });

/** One retry that the fake Codex sends: the info of Codex's retry notice, or `serverOverloaded`. */
interface Retry {
  info: "disconnected" | "overloaded";
  details: string | null;
}
const capacity: Retry = { info: "disconnected", details: AT_CAPACITY };
const reset: Retry = { info: "disconnected", details: DISCONNECTED };

// Before the service modules load: the Codex process and the stores read the home folder.
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

/**
 * A Codex app-server with the methods that the service calls. Each turn sends the retry errors that
 * `control.json` lists, from retry 2/5 on, and then waits until `control.json` releases the turn.
 * The turn then completes with an answer.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.167.2\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify(entry) + "\\n");
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
      const threadId = message.method === "thread/start" ? "thread-" + (++threads) : params.threadId;
      return write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
    }
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const { retries } = control();
      const turnId = "turn-" + (++turns);
      const threadId = params.threadId;
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
      for (const [index, retry] of retries.entries()) {
        const error = {
          message: "Reconnecting... " + (index + 2) + "/5",
          codexErrorInfo:
            retry.info === "overloaded" ? "serverOverloaded" : { responseStreamDisconnected: { httpStatusCode: null } },
          additionalDetails: retry.details,
        };
        write({ method: "error", params: { error, willRetry: true, threadId, turnId } });
      }
      const wait = setInterval(() => {
        if (control().release !== true) return;
        clearInterval(wait);
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      }, 20);
      return;
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
      log({ method: message.method ?? null, id: message.id ?? null, params: message.params ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface CaseReport {
  name: string;
  retries: Retry[];
  /** The delivery status when all retries were logged. */
  statusDuringRetries: string;
  finalStatus: string;
  /** The `turn/start` requests of the agent's thread. Codex retries inside one turn. */
  turnStarts: number;
  errorEvents: { code: string; message: string }[];
  retryLogLines: string[];
  passed: boolean;
}

const report: { notice: string; cases: CaseReport[]; passed: boolean; error?: string } = {
  notice: NOTICE,
  cases: [],
  passed: false,
};

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
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

/** Counts the `turn/start` requests that the fake Codex received for a thread. */
function turnStarts(threadId: string): number {
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line): unknown => JSON.parse(line))
    .filter(
      (entry) =>
        isRecord(entry) &&
        getString(entry, "method") === "turn/start" &&
        isRecord(entry.params) &&
        getString(entry.params, "threadId") === threadId,
    ).length;
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
const errorEvents: { agentId: string | null; code: string; message: string }[] = [];
agents.on("event", (event) => {
  if (event.type === "error")
    errorEvents.push({ agentId: event.agentId ?? null, code: event.code, message: event.message });
});
const logLines: string[] = [];
const stopLog = teeLogLines(["turn-lifecycle"], (line) => logLines.push(line));

try {
  await runCauseEffect(agents.initialize());

  const cases: { name: string; retries: Retry[]; notices: string[] }[] = [
    { name: "model at capacity", retries: [capacity, capacity, capacity], notices: [NOTICE] },
    { name: "server overloaded info", retries: [{ info: "overloaded", details: null }], notices: [NOTICE] },
    { name: "connection reset", retries: [reset, reset], notices: [] },
    { name: "capacity, then connection resets", retries: [capacity, reset, reset], notices: [NOTICE, RETRYING] },
  ];

  for (const [index, entry] of cases.entries()) {
    await writeFile(controlPath, JSON.stringify({ retries: entry.retries, release: null }));
    const firstLogLine = logLines.length;
    const agent = await runCauseEffect(
      agents.createAgent({
        name: `Capacity ${index + 1}`,
        description: "Checks the Codex retry notice.",
        avatarSeed: `capacity-${index}`,
        avatarHue: null,
        initialMessage: "First message.",
      }),
    );
    const agentEvents = () => errorEvents.filter((event) => event.agentId === agent.id);
    const retryLines = () =>
      logLines.slice(firstLogLine).filter((line) => line.includes("A provider retries a request."));
    // All retries are in the log before the turn can end, so a notice that comes from them is in
    // the events too: the service logs a retry and emits its notice in one synchronous step.
    await waitFor("all retries", () => retryLines().length === entry.retries.length);
    const running = agents
      .listQueue(agent.id)
      .deliveries.find((item) => item.status !== "completed" && item.status !== "failed");
    const statusDuringRetries = running?.status ?? "ended";
    await writeFile(controlPath, JSON.stringify({ retries: entry.retries, release: true }));
    const delivery = await waitFor("the message to end", () =>
      agents.listQueue(agent.id).deliveries.find((item) => item.status === "completed" || item.status === "failed"),
    );
    const result: CaseReport = {
      name: entry.name,
      retries: entry.retries,
      statusDuringRetries,
      finalStatus: delivery.status,
      turnStarts: turnStarts(store.activeProviderSession(agent.id)?.externalSessionId ?? "missing"),
      errorEvents: agentEvents().map(({ code, message }) => ({ code, message })),
      retryLogLines: retryLines(),
      passed: false,
    };
    report.cases.push(result);
    assert.notEqual(result.statusDuringRetries, "ended", `${entry.name}: the turn ended before the check`);
    assert.equal(result.finalStatus, "completed", `${entry.name}: the turn did not complete`);
    assert.equal(result.turnStarts, 1, `${entry.name}: OpenBot started the turn again`);
    assert.deepEqual(
      result.retryLogLines.map((line) => line.includes('"atCapacity":true')),
      entry.retries.map((retry) => retry !== reset),
      `${entry.name}: the log has the wrong cause`,
    );
    assert.deepEqual(
      result.errorEvents,
      entry.notices.map((message) => ({ code: "agent_warning", message })),
      `${entry.name}: the wrong notices showed`,
    );
    result.passed = true;
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  stopLog();
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
