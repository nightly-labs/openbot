// Checks that the Codex warning "Falling back from WebSockets to HTTPS transport." shows no banner,
// and that a final failure after it still does (#2559). Codex sends that warning when it changes
// transport, and the same turn continues over HTTPS. Runs the real agent service on a temporary
// profile with a fake Codex app-server. Two cases: the HTTPS attempt completes, and it fails.
// `bun scripts/codex-transport-fallback-e2e.ts`. Writes .openbot-build/codex-transport-fallback-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-transport-fallback-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-transport-fallback-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");
const FALLBACK = "Falling back from WebSockets to HTTPS transport.";
const FINAL_FAILURE = "stream disconnected before completion: Connection refused (os error 61)";

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
 * A Codex app-server with the methods that the service calls. Each turn sends the transport
 * warning, as `codex-rs/core/src/responses_retry.rs` does, and then completes or fails as
 * `control.json` says.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.162.1\\n");
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const { fallbackFails } = control();
      const turnId = "turn-" + (++turns);
      const threadId = params.threadId;
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
      write({ method: "warning", params: { threadId, message: ${JSON.stringify(`${FALLBACK} `)} + ${JSON.stringify(FINAL_FAILURE)} } });
      setTimeout(() => {
        if (fallbackFails) {
          const error = { message: ${JSON.stringify(FINAL_FAILURE)}, codexErrorInfo: null };
          write({ method: "error", params: { threadId, turnId, error, willRetry: false } });
          write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error } } });
          return;
        }
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      }, 50);
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
  fallbackFails: boolean;
  threadId: string;
  turnStarts: number;
  finalStatus: string;
  finalError: string | null;
  errorEvents: { code: string; message: string }[];
  warningLogLines: string[];
  passed: boolean;
}

const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

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
};

/** The `turn/start` requests that OpenBot sent on a thread. */
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

  const cases = [
    { name: "HTTPS attempt completes", fallbackFails: false, status: "completed" },
    { name: "HTTPS attempt fails", fallbackFails: true, status: "failed" },
  ] as const;

  for (const [index, entry] of cases.entries()) {
    await writeFile(controlPath, JSON.stringify(entry));
    const firstLogLine = logLines.length;
    const agent = await runCauseEffect(
      agents.createAgent({
        name: `Fallback ${index + 1}`,
        description: "Checks the Codex transport fallback.",
        avatarSeed: `fallback-${index}`,
        avatarHue: null,
        initialMessage: "First message.",
      }),
    );
    const delivery = await waitFor("the first message to end", () =>
      agents.listQueue(agent.id).deliveries.find((item) => item.status === "completed" || item.status === "failed"),
    );
    const threadId = store.activeProviderSession(agent.id)?.externalSessionId ?? "missing";
    const result: CaseReport = {
      name: entry.name,
      fallbackFails: entry.fallbackFails,
      threadId,
      turnStarts: turnStarts(threadId),
      finalStatus: delivery.status,
      finalError: mailbox.getDelivery(delivery.id)?.delivery.error ?? null,
      errorEvents: errorEvents
        .filter((event) => event.agentId === agent.id)
        .map(({ code, message }) => ({ code, message })),
      warningLogLines: logLines
        .slice(firstLogLine)
        .filter((line) => line.includes("A provider warning needs no action.")),
      passed: false,
    };
    report.cases.push(result);
    assert.equal(result.finalStatus, entry.status, `${entry.name}: ${result.finalError ?? result.finalStatus}`);
    assert.equal(result.turnStarts, 1, `${entry.name}: OpenBot started the turn again`);
    assert.ok(
      result.errorEvents.every((event) => !event.message.includes(FALLBACK)),
      `${entry.name}: the transport warning reached the banner`,
    );
    assert.equal(result.warningLogLines.length, 1, `${entry.name}: the warning was not logged one time`);
    assert.ok(result.warningLogLines[0]?.includes(FINAL_FAILURE), `${entry.name}: the log lost the close reason`);
    if (entry.fallbackFails)
      assert.ok(
        result.errorEvents.some((event) => event.message === FINAL_FAILURE),
        `${entry.name}: the final failure did not reach the banner`,
      );
    else assert.deepEqual(result.errorEvents, [], `${entry.name}: an error reached the banner`);
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
