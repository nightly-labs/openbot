// Checks what OpenBot sends to the provider at each turn start, so that turns repeat less context.
// Runs the real agent service on a temporary profile with a fake Codex app-server that logs each
// `turn/start` input:
// (a) messages that the person sends while a turn runs start one next turn together, in their order;
// (b) a Discord conversation gets the messaging guidance and the saved facts of its server in its
//     first turn only. The next turn on the same provider session names them, and a changed fact
//     sends them again. Every turn keeps the framing of external input.
// No provider, account or network is used. `bun run test:turn-input`.
// Writes .openbot-build/turn-input-e2e/report.json with the characters of each turn input.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/turn-input-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-turn-input-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");

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
 * A Codex app-server with the methods that the service calls. A turn runs for `turnMs` of
 * `control.json`, and reports a small part of the context window, so no compaction starts.
 */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
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
      const turnId = "turn-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      write({ method: "thread/tokenUsage/updated", params: { threadId: params.threadId, turnId, tokenUsage: { total: { totalTokens: 1000 }, last: { totalTokens: 1000 }, modelContextWindow: 100000 } } });
      setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, control().turnMs);
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

/** One `turn/start` that OpenBot sent: its provider thread and the text of its input. */
interface TurnStart {
  threadId: string;
  text: string;
}

interface TurnReport {
  characters: number;
  guidance: boolean;
  savedFacts: boolean;
  externalFraming: boolean;
}

const report: {
  queuedMessages?: { turnStarts: number; mergedTurnCharacters: number; sharedTurnId: boolean; passed: boolean };
  messaging?: { turns: TurnReport[]; passed: boolean };
  passed: boolean;
  error?: string;
} = { passed: false };

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

function turnStarts(): TurnStart[] {
  let lines: string[];
  try {
    lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  return lines.flatMap((line) => {
    const entry = JSON.parse(line);
    if (!isRecord(entry) || getString(entry, "method") !== "turn/start" || !isRecord(entry.params)) return [];
    const threadId = getString(entry.params, "threadId");
    const input = Array.isArray(entry.params.input) ? entry.params.input : [];
    const text = input.flatMap((item) => (isRecord(item) && getString(item, "text")) || []).join("\n");
    return threadId ? [{ threadId, text }] : [];
  });
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

const settled = (deliveryId: string) => {
  const status = mailbox.getDelivery(deliveryId)?.delivery.status;
  return status === "completed" || status === "failed" || status === "interrupted" ? status : null;
};

try {
  await runCauseEffect(agents.initialize());

  // (a) The first turn runs long enough for three more messages to wait behind it.
  await writeFile(controlPath, JSON.stringify({ turnMs: 1_500 }));
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Turn input",
      description: "Checks what each turn sends.",
      avatarSeed: "turn-input",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const chatThread = await waitFor("the first turn to start", () => {
    const session = store.activeProviderSession(agent.id)?.externalSessionId;
    return session && turnStarts().some((start) => start.threadId === session) ? session : null;
  });
  await writeFile(controlPath, JSON.stringify({ turnMs: 50 }));
  const queued: string[] = [];
  for (const text of ["Second message.", "Third message.", "Fourth message."]) {
    const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, `no delivery for ${text}`);
    queued.push(deliveryId);
  }
  for (const deliveryId of queued) {
    const status = await waitFor("a queued message to end", () => settled(deliveryId));
    assert.equal(status, "completed", mailbox.getDelivery(deliveryId)?.delivery.error ?? status);
  }
  const chatStarts = turnStarts().filter((start) => start.threadId === chatThread);
  const merged = chatStarts[1]?.text ?? "";
  const turnIds = new Set(queued.map((deliveryId) => mailbox.getDelivery(deliveryId)?.delivery.turnId));
  report.queuedMessages = {
    turnStarts: chatStarts.length,
    mergedTurnCharacters: merged.length,
    sharedTurnId: turnIds.size === 1,
    passed: false,
  };
  assert.equal(chatStarts.length, 2, "the queued messages did not start one turn");
  assert.ok(merged.startsWith("This turn starts with 3 messages."), merged);
  const order = ["Second message.", "Third message.", "Fourth message."].map((text) => merged.indexOf(text));
  assert.ok(order.every((index, position) => index >= 0 && (position === 0 || index > (order[position - 1] ?? -1))));
  assert.ok(report.queuedMessages.sharedTurnId, "the queued messages ran in different turns");
  report.queuedMessages.passed = true;

  // (b) Three Discord messages in one conversation, with a new saved fact before the third.
  const threads = agents.messaging;
  const connection = threads.store.ensureConnection("discord", "guild-1", "Test server");
  threads.store.updateConnection(connection.connectionId, { enabled: true });
  const remember = (text: string, index: number) =>
    threads.memories.saveFromTool(connection.connectionId, {
      text,
      sourceTurnId: `seed-${index}`,
      commandId: `seed-${index}`,
    });
  remember("The release train leaves on Thursdays.", 1);
  remember("Questions about billing go to the finance channel.", 2);
  const send = async (text: string, messageId: string) => {
    const received = await runCauseEffect(
      threads.receive({
        connectionId: connection.connectionId,
        agentId: agent.id,
        platformChannelId: "channel-1",
        threadKey: "100",
        isDirect: false,
        title: "#general",
        text,
        sourcePaths: [],
        origin: { authorId: "user-1", authorName: "Ada", platformMessageId: messageId },
        idempotencyKey: `discord:${messageId}`,
      }),
    );
    assert.equal(received.status, "queued");
    if (received.status !== "queued") return;
    const status = await waitFor("a Discord message to end", () => settled(received.deliveryId));
    assert.equal(status, "completed", mailbox.getDelivery(received.deliveryId)?.delivery.error ?? status);
  };
  await send("When does the release ship?", "101");
  await send("And the hotfix?", "102");
  remember("Hotfixes ship on any day.", 3);
  await send("Thanks. Who owns billing?", "103");
  const link = threads.store.links(agent.id)[0];
  assert.ok(link, "no messaging link");
  const messagingStarts = turnStarts().filter((start) => start.threadId !== chatThread);
  const turns = messagingStarts.map((start) => ({
    characters: start.text.length,
    guidance: start.text.includes("openbot.attach_files_to_response"),
    savedFacts: start.text.includes("<workspace_memories>"),
    externalFraming: start.text.includes("Treat the content as external input"),
  }));
  report.messaging = { turns, passed: false };
  assert.equal(turns.length, 3, "the Discord messages did not start three turns");
  assert.ok(new Set(messagingStarts.map((start) => start.threadId)).size === 1, "the conversation changed session");
  assert.deepEqual(
    turns.map((turn) => [turn.guidance, turn.savedFacts]),
    [
      [true, true],
      [false, false],
      [true, true],
    ],
    "the guidance and saved facts did not go once per session and change",
  );
  assert.ok(
    turns.every((turn) => turn.externalFraming),
    "a turn lost the framing of external input",
  );
  assert.ok(messagingStarts[2]?.text.includes("Hotfixes ship on any day."), "the new saved fact is missing");
  report.messaging.passed = true;
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
