import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type ConversationMessage, type ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-steer-read-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-codex-steer-read-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const steerLog = join(root, "steers.jsonl");
const releaseFile = join(root, "release");
const STEER = "Stop that and use the other folder.";

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_STEERS = steerLog;
process.env.OPENBOT_FAKE_CODEX_RELEASE = releaseFile;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const config = { config: { mcp_servers: {} }, layers: [] };
let buffer = "";
let turns = 0;
let threads = 0;
const steers = [];
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const step = (ms) => new Promise((done) => setTimeout(done, ms));
const released = async () => {
  while (!fs.existsSync(process.env.OPENBOT_FAKE_CODEX_RELEASE)) await step(25);
  fs.rmSync(process.env.OPENBOT_FAKE_CODEX_RELEASE, { force: true });
};
async function runTurn(threadId, turnId, holds) {
  const send = (method, item) => write({ method, params: { threadId, turnId, item } });
  const command = { type: "commandExecution", id: "cmd-" + turnId, command: "sleep 600", status: "inProgress" };
  send("item/started", command);
  if (holds) await released();
  send("item/completed", { ...command, status: "completed" });
  for (const steer of steers.splice(0)) {
    const item = { type: "userMessage", id: "user-" + steer.clientUserMessageId, clientId: steer.clientUserMessageId, content: steer.input };
    send("item/started", item);
    send("item/completed", item);
  }
  send("item/completed", { type: "agentMessage", id: "answer-" + turnId, text: "Switched folders.", phase: "final_answer" });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
}
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + process.pid + "-" + (++threads), turns: [] } } });
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
      void runTurn(params.threadId, turnId, JSON.stringify(params.input || []).includes("HOLD"));
      return;
    }
    case "turn/steer": {
      steers.push({ clientUserMessageId: params.clientUserMessageId, input: params.input });
      fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_STEERS, JSON.stringify({ clientUserMessageId: params.clientUserMessageId }) + "\\n");
      return write({ id: message.id, result: { turnId: params.expectedTurnId } });
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
setInterval(() => {}, 1000);
`;

interface SteerView {
  deliveryStatus: string | null;
  turnId: string | null;
  activeTurnId: string | null;
  steerUnread: boolean;
}

interface SteerCheck {
  passed: boolean;
  acceptedByCodex: boolean;
  beforeRead: SteerView;
  afterRead: SteerView;
  answerAfterSteer: boolean;
}

interface Report {
  passed: boolean;
  chat?: SteerCheck;
  task?: SteerCheck;
  error?: string;
}

const report: Report = { passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
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

async function waitFor<T>(label: string, read: () => Promise<T | null | undefined | false>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
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
  requestTimeoutMs: 5_000,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});

const steerView = (message: ConversationMessage, activeTurnId: string | null): SteerView => ({
  deliveryStatus: message.delivery?.status ?? null,
  turnId: message.turnId ?? null,
  activeTurnId,
  steerUnread:
    message.author === "user" &&
    message.delivery?.status === "starting" &&
    message.turnId !== undefined &&
    message.turnId === activeTurnId,
});

async function checkSteer(
  read: () => Promise<ConversationSnapshot>,
  sendSteer: () => Promise<string | undefined>,
  idle: () => boolean,
): Promise<SteerCheck> {
  const activeTurnId = await waitFor("the turn to start", async () => (await read()).activeTurnId);
  const deliveryId = await sendSteer();
  if (!deliveryId) throw new Error("The steer has no delivery.");
  const steeredMessage = async () => {
    const snapshot = await read();
    const message = snapshot.messages.find((candidate) => candidate.id === deliveryId);
    return message ? { message, snapshot } : null;
  };
  const before = await waitFor("the steer to show in the chat", async () => {
    const found = await steeredMessage();
    return found && found.message.delivery?.status !== "queued" ? found : null;
  });
  const acceptedByCodex = existsSync(steerLog) && readFileSync(steerLog, "utf8").includes(deliveryId);
  const beforeRead = steerView(before.message, before.snapshot.activeTurnId);
  await writeFile(releaseFile, "");
  const after = await waitFor("Codex to read the steer", async () => {
    const found = await steeredMessage();
    return found && found.message.delivery?.status !== "starting" ? found : null;
  });
  const afterRead = steerView(after.message, after.snapshot.activeTurnId);
  await waitFor("the turn to end", async () => idle());
  const final = await read();
  const steerIndex = final.messages.findIndex((message) => message.id === deliveryId);
  const answerIndex = final.messages.findIndex((message) => message.text === "Switched folders.");
  const answerAfterSteer = steerIndex >= 0 && answerIndex > steerIndex;
  return {
    passed:
      acceptedByCodex &&
      beforeRead.deliveryStatus === "starting" &&
      beforeRead.turnId === activeTurnId &&
      beforeRead.steerUnread &&
      (afterRead.deliveryStatus === "running" || afterRead.deliveryStatus === "completed") &&
      !afterRead.steerUnread &&
      answerAfterSteer,
    acceptedByCodex,
    beforeRead,
    afterRead,
    answerAfterSteer,
  };
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Codex steer",
      description: "Checks when a steer reaches a busy Codex agent.",
      avatarSeed: "codex-steer",
      avatarHue: null,
      initialMessage: "HOLD: copy the files to the first folder.",
    }),
  );
  const idle = () =>
    !agents
      .listQueue(agent.id)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  report.chat = await checkSteer(
    () => runCauseEffect(agents.readConversation(agent.id)),
    async () => (await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: STEER }))).deliveries[0]?.id,
    idle,
  );
  const task = await runCauseEffect(agents.startTask({ agentId: agent.id, text: "HOLD: copy the files in a task." }));
  report.task = await checkSteer(
    async () => agents.readTask(agent.id, task.id),
    async () =>
      (await runCauseEffect(agents.sendMessage({ agentId: agent.id, taskId: task.id, text: STEER }))).deliveries[0]?.id,
    idle,
  );
  report.passed = report.chat.passed && report.task.passed;
  if (!report.passed)
    report.error ??=
      "Expected each steer to show as unread while the command ran, and to join the turn when Codex read it.";
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
