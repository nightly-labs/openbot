// Checks a Codex turn whose own compaction loses the connection (#5822). Runs the real agent service
// on a temporary profile with a fake Codex app-server. The current message names its turns in
// `<<TURNS[...]TURNS>>`: each element is one turn of the thread. "ok" answers. "fail" starts a
// compaction and fails with Codex's text for a refused connection. "stall" starts a compaction and
// then sends nothing, as Codex 0.167.0 did when the connection stopped answering. "loop" compacts
// again after each step, as Codex does when a compaction leaves the session above its own limit (#8985).
// Checks:
//   1. A compaction that fails on the connection continues the turn once, with a note and not the
//      message again. No error shows, and the request completes.
//   2. A compaction that sends nothing is stopped at the compaction run deadline, and the turn
//      continues once. Without the deadline, the turn showed "Compacting context" until a Stop.
//   3. A second failure in the same request does not continue again. The error shows in plain words,
//      not Codex's text.
//   4. A turn that compacts again and again with no growth is stopped after its third compaction. It
//      does not continue, and the error says what to do.
// No provider, account or network is used. `bun run test:codex-midturn-compaction`.
// Writes .openbot-build/codex-midturn-compaction-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentProviderName } from "@openbot/contracts/agent-providers";
import { AGENT_PROVIDERS, type AgentEvent, PLAN_CONTINUATION_ITEM_TYPE } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-midturn-compaction-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-midturn-compaction-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const NOTE_MARKER = "OpenBot note, not a message from the user";
const CODEX_ERROR = "Error running remote compact task: Connection failed: error sending request";
// A compaction may start in 200 ms, and a started compaction runs for 2 s at most.
const COMPACTION_TIMEOUT_MS = 200;

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

type FakeTurn = "ok" | "fail" | "stall" | "loop";
const turns = (...list: FakeTurn[]) => `<<TURNS${JSON.stringify(list)}TURNS>>`;

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.167.0\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const NOTE = ${JSON.stringify(NOTE_MARKER)};
const CODEX_ERROR = ${JSON.stringify(CODEX_ERROR)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let count = 0;
/** The turns that each thread has still to run, from the message that named them. */
const scripts = new Map();
/** The turns that stall in a compaction, until a \`turn/interrupt\`. */
const stalled = new Set();
/** The turns that compact again after each step, until a \`turn/interrupt\` or 20 compactions. */
const looping = new Set();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => fs.appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const compaction = (threadId, turnId) => {
  const item = { type: "contextCompaction", id: "compact-" + turnId };
  write({ method: "item/started", params: { threadId, turnId, item } });
};
const run = (threadId, turnId, kind) => {
  // A small context, so OpenBot does not compact the thread by itself.
  const tokenUsage = { total: { totalTokens: 30000 }, last: { totalTokens: 30000 }, modelContextWindow: 100000 };
  write({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage } });
  const work = { type: "commandExecution", id: "command-" + turnId, command: "ls", status: "completed", aggregatedOutput: "" };
  write({ method: "item/completed", params: { threadId, turnId, item: work } });
  if (kind === "fail") {
    compaction(threadId, turnId);
    return setTimeout(() => {
      const error = { message: CODEX_ERROR, codexErrorInfo: { responseStreamConnectionFailed: { httpStatusCode: null } } };
      write({ method: "error", params: { threadId, turnId, error, willRetry: false } });
      write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error } } });
    }, 50);
  }
  if (kind === "stall") {
    compaction(threadId, turnId);
    return stalled.add(turnId);
  }
  if (kind === "loop") {
    let left = 20;
    looping.add(turnId);
    const again = () => {
      if (!looping.has(turnId)) return;
      if (left-- === 0) {
        looping.delete(turnId);
        return finish(threadId, turnId);
      }
      const item = { type: "contextCompaction", id: "compact-" + turnId + "-" + left };
      write({ method: "item/started", params: { threadId, turnId, item } });
      log({ method: "compaction", threadId, turnId });
      setTimeout(() => {
        if (!looping.has(turnId)) return;
        write({ method: "item/completed", params: { threadId, turnId, item } });
        // The compaction leaves 60% of the window, which is still above this fake's own limit.
        const usage = { total: { totalTokens: 60000 }, last: { totalTokens: 60000 }, modelContextWindow: 100000 };
        write({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: usage } });
        setTimeout(again, 10);
      }, 10);
    };
    return again();
  }
  finish(threadId, turnId);
};
function finish(threadId, turnId) {
  setTimeout(() => {
    const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
    write({ method: "item/completed", params: { threadId, turnId, item } });
    write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
  }, 20);
}
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
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
      const turnId = "turn-" + (++count);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      const note = text.includes(NOTE);
      if (!note) {
        const named = /<<TURNS([\\s\\S]*?)TURNS>>/.exec(text.split("--- current message ---").at(-1));
        scripts.set(params.threadId, named ? JSON.parse(named[1]) : []);
      }
      const kind = (scripts.get(params.threadId) || []).shift() || "ok";
      log({ method: "turn", threadId: params.threadId, turnId, note, kind, text });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      return run(params.threadId, turnId, kind);
    }
    case "turn/interrupt": {
      log({ method: "interrupt", threadId: params.threadId, turnId: params.turnId, stalled: stalled.has(params.turnId) });
      stalled.delete(params.turnId);
      looping.delete(params.turnId);
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
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

const report: {
  compactionRunDeadlineMs: number;
  checks: { name: string; passed: boolean; detail?: unknown }[];
  passed: boolean;
  checkedAt?: string;
  error?: string;
} = { compactionRunDeadlineMs: COMPACTION_TIMEOUT_MS * 10, checks: [], passed: false };

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

/** Waits for a state of the service, its database or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

interface LoggedEntry {
  method: "turn" | "interrupt" | "compaction";
  threadId: string;
  turnId: string;
  note?: boolean;
  kind?: FakeTurn;
  text?: string;
  stalled?: boolean;
}

function logged(): LoggedEntry[] {
  try {
    return readFileSync(fakeLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): LoggedEntry => JSON.parse(line));
  } catch {
    return [];
  }
}

async function check(name: string, run: () => Promise<unknown>) {
  const detail = await run();
  report.checks.push({ name, passed: true, detail });
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const service = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  contextCompactionTimeoutMs: COMPACTION_TIMEOUT_MS,
});
const events: AgentEvent[] = [];
service.on("event", (event) => events.push(event));

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

/** Sends one request to a new agent and answers what OpenBot did with it. */
async function request(name: string, script: FakeTurn[]) {
  const agent = await runCauseEffect(
    service.createAgent({
      name,
      description: "Checks a compaction that loses the connection.",
      avatarSeed: name.toLowerCase(),
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}'s first turn`, () =>
    service.listQueue(agent.id).deliveries.every((delivery) => ended(delivery.status)),
  );
  const mark = logged().length;
  const since = events.length;
  const startedAt = Date.now();
  const receipt = await runCauseEffect(
    service.sendMessage({ agentId: agent.id, text: `Do the work. ${turns(...script)}`, attachmentDraftIds: [] }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "The message has a delivery.");
  const status = await waitFor(`${name}'s request to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return ended(value) ? value : null;
  });
  const threadId = store.list().find((entry) => entry.id === agent.id)?.threadId ?? null;
  const messages = database.readConversation(agent.id, threadId).messages;
  const entries = logged().slice(mark);
  return {
    status,
    durationMs: Date.now() - startedAt,
    deliveryError: mailbox.getDelivery(deliveryId)?.delivery.error ?? null,
    turns: entries.filter((entry) => entry.method === "turn").map(({ kind, note }) => ({ kind, note })),
    interrupts: entries.filter((entry) => entry.method === "interrupt").map(({ stalled }) => ({ stalled })),
    compactions: entries.filter((entry) => entry.method === "compaction").length,
    continuationTexts: entries
      .filter((entry) => entry.method === "turn" && entry.note)
      .map((entry) => entry.text ?? ""),
    lines: messages.filter((message) => message.itemType === PLAN_CONTINUATION_ITEM_TYPE).map((line) => line.text),
    errors: events
      .slice(since)
      .flatMap((event) => (event.type === "error" && event.agentId === agent.id ? [event.message] : [])),
  };
}

const continuesLine = sourceText("status.agent.compactionContinues");
const plainError = sourceText("error.agent.compactionConnectionLost");
const loopError = sourceText("error.agent.compactionLoopStopped", { provider: agentProviderName("codex") });

try {
  await runCauseEffect(service.initialize());

  await check("a compaction that fails on the connection continues the turn once", async () => {
    const result = await request("Failed", ["fail", "ok"]);
    assert.equal(result.status, "completed", "The request did not complete.");
    assert.deepEqual(result.turns, [
      { kind: "fail", note: false },
      { kind: "ok", note: true },
    ]);
    assert.ok(
      result.continuationTexts.every((text) => !text.includes("Do the work.")),
      "The continuation sent the message again.",
    );
    assert.deepEqual(result.lines, [continuesLine]);
    assert.deepEqual(result.errors, [], "An error showed.");
    return result;
  });

  await check("a compaction that sends nothing is stopped at the deadline, then continues", async () => {
    const result = await request("Stalled", ["stall", "ok"]);
    assert.equal(result.status, "completed", "The request did not complete.");
    assert.deepEqual(result.interrupts, [{ stalled: true }], "OpenBot did not stop the stalled turn.");
    assert.deepEqual(result.turns, [
      { kind: "stall", note: false },
      { kind: "ok", note: true },
    ]);
    assert.ok(result.durationMs >= report.compactionRunDeadlineMs, "The turn stopped before the deadline.");
    assert.deepEqual(result.lines, [continuesLine]);
    assert.deepEqual(result.errors, [], "An error showed.");
    return result;
  });

  await check("a second failure shows the error in plain words and does not continue", async () => {
    const result = await request("Twice", ["fail", "fail", "ok"]);
    assert.equal(result.status, "failed", "The request did not fail.");
    assert.deepEqual(result.turns, [
      { kind: "fail", note: false },
      { kind: "fail", note: true },
    ]);
    assert.deepEqual(result.errors, [plainError], "The error is not the plain text.");
    assert.equal(result.deliveryError, plainError);
    return result;
  });

  await check("a turn that compacts again and again is stopped and does not continue", async () => {
    const result = await request("Looping", ["loop", "ok"]);
    assert.equal(result.status, "failed", "The request did not fail.");
    assert.equal(result.compactions, 3, "OpenBot did not stop the loop at its third compaction.");
    assert.equal(result.interrupts.length, 1, "OpenBot did not stop the turn once.");
    assert.deepEqual(result.turns, [{ kind: "loop", note: false }], "The stopped turn continued.");
    assert.deepEqual(result.errors, [loopError], "The error is not the plain text.");
    assert.equal(result.deliveryError, loopError);
    return result;
  });

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(service.stop()).catch(() => {});
  database.close();
  report.checkedAt = new Date().toISOString();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
