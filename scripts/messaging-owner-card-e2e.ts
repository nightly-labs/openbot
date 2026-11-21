import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bugReportPlatform, type Feedback, type FeedbackPhone } from "@openbot/contracts/feedback";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-owner-card-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-owner-card-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

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
const TURN_MS = 20_000;

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
const sent: Feedback[] = [];
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
  feedbackFacts: { platform: bugReportPlatform(process.platform), version: "0.0.0-e2e", os: "e2e (arm64)" },
  feedback: {
    signedIn: () => true,
    similar: () => Effect.succeed([]),
    send: (feedback) =>
      Effect.sync(() => {
        sent.push(feedback);
        return {
          status: "sent" as const,
          url: "https://github.com/nightly-labs/openbot/issues/9001",
          number: 9001,
          comment: false,
        };
      }),
    withdraw: () => Effect.die(new Error("No report is removed in this check.")),
  },
});

const approvals: { requestId: string | number; threadId: string; reason: string | null }[] = [];
agents.on("event", (event) => {
  if (event.type === "approval")
    approvals.push({
      requestId: event.approval.requestId,
      threadId: event.approval.threadId,
      reason: event.approval.reason,
    });
});

async function logged(name: string, index: number) {
  const entry = await waitFor(`${name} tool result`, () => toolLogs()[index]);
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success === true, text });
  return { success: entry.result?.success === true, text };
}

const callText = (title: string) =>
  `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "send_feedback", kind: "idea", title, text: "Let me pick an agent from the Android share sheet." })}ARGS>>`;

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

  const second = await receive("message-2", "Thanks.");
  const third = await receive("message-3", "One more thing.");
  pass(
    "The author's next messages are queued, not refused as busy",
    second.status === "queued" && third.status === "queued",
    `${second.status} ${third.status}`,
  );
  await waitFor("the Discord queue to drain", () => openDeliveries(linkId).length === 0);

  const ownIndex = toolLogs().length;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: callText("From the owner") }, PERSON));
  const card = await waitFor("the owner's feedback card", () => approvals[0]);
  pass("The person's own chat shows the feedback card", card.reason !== null, JSON.stringify(card));
  await runCauseEffect(agents.respondToApproval({ requestId: card.requestId, decision: "decline" }));
  const fromOwner = await logged("send_feedback from the own chat", ownIndex);
  pass("A declined card sends nothing", fromOwner.text.includes('"declined"') && sent.length === 0, fromOwner.text);

  const phoneIndex = toolLogs().length;
  const phoneCall = `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "send_feedback", kind: "bug", title: "The phone app stays on Reconnecting", text: "The phone app never connects while the VPN is on.", surface: "Phone app" })}ARGS>>`;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: phoneCall }, PERSON));
  const phoneCard = await waitFor("the card of the phone report", () => approvals[1]);
  pass(
    "A bug in the phone app shows the card with the notice of a phone report",
    phoneCard.reason === sourceText("status.agent.reportPhoneProblem"),
    JSON.stringify(phoneCard),
  );
  const plain = await runCauseEffect(
    agents.respondToApproval({ requestId: phoneCard.requestId, decision: "accept" }),
  ).then(
    () => "accepted",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  const member = await runCauseEffect(
    agents.respondToApproval({ requestId: phoneCard.requestId, decision: "accept" }, { owner: true }),
  ).then(
    () => "accepted",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  pass(
    "An accept without the phone's data is refused, the card still waits, and nothing is sent",
    plain === sourceText("error.backend.feedbackNeedsPhone") &&
      member === sourceText("error.backend.feedbackNeedsPhone") &&
      agents.pendingApproval(phoneCard.requestId) !== undefined &&
      sent.length === 0 &&
      toolLogs().length === phoneIndex,
    `${plain} | ${member}`,
  );

  const secret = ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_");
  const userHost = "team.kowalska.example.com";
  const serverId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const userAddress = "203.0.113.77";
  const phone: FeedbackPhone = {
    platform: "Android",
    appVersion: "1.4.9 (212) · a1b2c3d4",
    system: "Android 16, Xiaomi 14 (23127PN0CC)",
    network: "Wi-Fi · VPN: Tailscale",
    log: `2026-11-13T10:00:00.000Z WARN  connection host-1 offline (ice_failed)\n2026-11-13T10:00:01.000Z WARN  console Authorization: Bearer ${secret}\n2026-11-13T10:00:02.000Z WARN  network GET https://${userHost}/v1/hosts/${serverId}/state -> failed from ${userAddress}`,
  };
  await runCauseEffect(
    agents.respondToApproval({ requestId: phoneCard.requestId, decision: "accept" }, { owner: true, phone }),
  );
  const fromPhone = await logged("send_feedback for the phone app", phoneIndex);
  const report0 = sent[0];
  const sentPhone = report0?.kind === "bug" ? report0.phone : null;
  pass(
    "The phone's accept sends the report with the phone's system, version, device, network and log",
    fromPhone.text.includes('"sent"') &&
      sent.length === 1 &&
      report0?.surface === "Phone app" &&
      sentPhone?.platform === "Android" &&
      sentPhone.appVersion === phone.appVersion &&
      sentPhone.system === phone.system &&
      sentPhone.network === phone.network &&
      sentPhone.log.includes("host-1 offline (ice_failed)"),
    `${fromPhone.text} ${JSON.stringify(report0)}`,
  );
  pass("A secret in the phone's log does not leave the host", sentPhone !== null && !sentPhone.log.includes(secret));
  pass(
    "A host name, a server ID and a network address in the phone's log do not leave the host",
    sentPhone !== null &&
      !sentPhone.log.includes(userHost) &&
      !sentPhone.log.includes(serverId) &&
      !sentPhone.log.includes(userAddress) &&
      sentPhone.log.includes("GET https://[host]/v1/hosts/[id]/state -> failed from [public-ip]"),
  );

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
