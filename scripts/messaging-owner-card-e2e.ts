// Checks that an external chat turn never waits on a card that only the owner can answer. A Discord
// message that makes the agent call `openbot.send_feedback` gets the refusal at once: no card shows,
// the turn ends and the chat's queue is free for the author's next message. Before the fix the router
// checked the provider's thread id, the Discord thread passed as the agent's own chat, and the turn
// waited on the owner's card until the provider's tool timeout (100 minutes for Grok), so every later
// message of that author got "Too many requests are waiting". The person's own chat still gets the card.
// Runs the real agent service, messaging threads and tool router on a temporary profile with a fake
// Codex app-server. The fake calls the tool through `tool_call`, as a model does, and logs the result.
// `bun scripts/messaging-owner-card-e2e.ts`. Writes .openbot-build/messaging-owner-card-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bugReportPlatform } from "@openbot/contracts/feedback";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-owner-card-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-owner-card-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

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

const CALL_MARK = "FEEDBACK-CALL";
const PERSON = { id: "local", name: "Alex" };
const REFUSAL = "Only a person's message";
/** Longer than a fake turn, much shorter than the provider's tool timeout. */
const TURN_MS = 20_000;

/**
 * A Codex app-server with the methods that the service calls. A turn whose input has
 * `FEEDBACK-CALL <<ARGS{"__tool":"…",…}ARGS>>` calls `openbot.<__tool>` with the rest of that JSON
 * through `tool_call`, logs the result, and ends. Other turns answer "Done.".
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
/** Tool request id -> the turn that waits for its result. */
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
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
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const calls = text.includes(${JSON.stringify(CALL_MARK)}) ? [...text.matchAll(/<<ARGS([\\s\\S]*?)ARGS>>/g)] : [];
      const match = calls.at(-1);
      if (!match) return setTimeout(() => finish(params.threadId, turnId), 20);
      const id = "tool-" + turnId;
      waiting.set(id, { threadId: params.threadId, turnId });
      // The packet carries the request as JSON text, so its quotes arrive escaped.
      const { __tool, ...args } = JSON.parse(match[1].replace(/\\\\"/g, '"'));
      return write({
        id,
        method: "item/tool/call",
        params: {
          threadId: params.threadId,
          turnId,
          callId: "call-" + turnId,
          namespace: "openbot",
          tool: "tool_call",
          arguments: { name: "openbot." + __tool, arguments: args },
        },
      });
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
      if (message.method && message.id !== undefined) answer(message);
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        log({ turnId: turn.turnId, result: message.result ?? null, error: message.error ?? null });
        finish(turn.threadId, turn.turnId);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface ToolLog {
  turnId: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

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

/** Waits for a state of the service or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = TURN_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function toolLogs(): ToolLog[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

const report: {
  calls: { name: string; turnId: string; success: boolean | null; text: string }[];
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], passed: false };

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
  timezone: () => "UTC",
  // Signed in, with the facts a release build has, so the call reaches the person check.
  feedbackFacts: { platform: bugReportPlatform(process.platform), version: "0.0.0-e2e", os: "e2e (arm64)" },
  feedback: {
    signedIn: () => true,
    similar: () => Effect.succeed([]),
    send: () => Effect.die(new Error("No report is sent in this check.")),
  },
});

/** The approval cards that the service shows, in order. */
const approvals: { requestId: string | number; threadId: string; reason: string | null }[] = [];
agents.on("event", (event) => {
  if (event.type === "approval")
    approvals.push({
      requestId: event.approval.requestId,
      threadId: event.approval.threadId,
      reason: event.approval.reason,
    });
});

/** Logs and returns the tool result of the fake's call number `index`. */
async function logged(name: string, index: number) {
  const entry = await waitFor(`${name} tool result`, () => toolLogs()[index]);
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success === true, text });
  return { success: entry.result?.success === true, text };
}

const callText = (title: string) =>
  `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "send_feedback", kind: "idea", title, text: "Let me pick an agent from the Android share sheet." })}ARGS>>`;

/** The deliveries of a Discord link that have not ended. */
const openDeliveries = (linkId: string) => mailbox.unresolvedMessagingDeliveries(linkId);

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Helper",
      description: "Helper answers a Discord server.",
      avatarSeed: "helper",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await waitFor("the first turn to end", () =>
    agents
      .listQueue(agent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );

  // 1. A Discord message makes the agent call send_feedback. The router refuses it at once.
  const connection = agents.messaging.store.ensureConnection("discord", "guild-e2e", "OpenBot e2e");
  const receive = (id: string, text: string) =>
    runCauseEffect(
      agents.messaging.receive({
        connectionId: connection.connectionId,
        agentId: agent.id,
        platformChannelId: "channel-e2e",
        threadKey: "channel-e2e",
        isDirect: false,
        title: "#general · feedback",
        text,
        sourcePaths: [],
        origin: { authorId: "author-e2e", authorName: "Norbert", platformMessageId: id },
        idempotencyKey: `messaging:${connection.connectionId}:${id}`,
      }),
    );
  const first = await receive("message-1", callText("Android share target"));
  assert.ok(first.status === "queued", `The first message was not queued: ${first.status}`);
  const linkId = first.link.linkId;
  const fromDiscord = await logged("send_feedback from Discord", 0);
  pass(
    "A Discord message cannot send feedback, and the router says so at once",
    !fromDiscord.success && fromDiscord.text.includes(REFUSAL),
    fromDiscord.text,
  );
  pass("No owner card showed for the Discord turn", approvals.length === 0, JSON.stringify(approvals));
  await waitFor("the Discord turn to end", () => openDeliveries(linkId).length === 0);

  // 2. The same author sends two more messages. Neither is refused as busy.
  const second = await receive("message-2", "Thanks.");
  const third = await receive("message-3", "One more thing.");
  pass(
    "The author's next messages are queued, not refused as busy",
    second.status === "queued" && third.status === "queued",
    `${second.status} ${third.status}`,
  );
  await waitFor("the Discord queue to drain", () => openDeliveries(linkId).length === 0);

  // 3. The person's own chat still gets the card. A decline sends nothing.
  const ownIndex = toolLogs().length;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: callText("From the owner") }, PERSON));
  const card = await waitFor("the owner's feedback card", () => approvals[0]);
  pass("The person's own chat shows the feedback card", card.reason !== null, JSON.stringify(card));
  await runCauseEffect(agents.respondToApproval({ requestId: card.requestId, decision: "decline" }));
  const fromOwner = await logged("send_feedback from the own chat", ownIndex);
  pass("A declined card sends nothing", fromOwner.text.includes('"declined"'), fromOwner.text);

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
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
