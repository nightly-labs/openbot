import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-server-lost-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-server-lost-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const fakeOpenCode = join(root, "opencode");

process.env.HOME = home;
process.env.OPENBOT_OPENCODE_PATH = fakeOpenCode;
process.env.OPENBOT_FAKE_OPENCODE_LOG = logPath;
process.env.OPENBOT_FAKE_OPENCODE_LOST = join(root, "server-lost");
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_OPENCODE = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
if (process.argv.includes("--version")) { process.stdout.write("2.3.0" + NL); process.exit(0); }
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_OPENCODE_LOG, JSON.stringify({ pid: process.pid, ...entry }) + NL);
log({ start: true });
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODEL = "opencode/big-pickle";
const setup = (sessionId) => ({ sessionId, models: { availableModels: [{ modelId: MODEL, name: "Big Pickle" }], currentModelId: MODEL } });
const chunk = (sessionId, text) => write({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
function handle(message) {
  const params = message.params ?? {};
  const text = (params.prompt ?? []).map((part) => part.text ?? "").join(" ");
  log({ method: message.method ?? null, sessionId: params.sessionId ?? null, text: text.slice(-300) });
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: setup("ses-" + process.pid) });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: setup(params.sessionId) });
  if (message.method === "session/list") return write({ id: message.id, result: { sessions: [] } });
  if (message.method === "session/prompt") {
    const lost = text.includes("Second message") ? "exit" : text.includes("Third message") ? "stay" : null;
    const marker = process.env.OPENBOT_FAKE_OPENCODE_LOST + "-" + lost;
    if (lost && !fs.existsSync(marker)) {
      fs.writeFileSync(marker, "");
      chunk(params.sessionId, "Here is the first part");
      setTimeout(() => {
        write({ id: message.id, error: { code: -32603, message: "Internal error: OpenCode server is unavailable", data: { errorName: "ServerUnavailable" } } });
        if (lost === "exit") setTimeout(() => process.exit(1), 300);
      }, 200);
      return;
    }
    chunk(params.sessionId, "Done.");
    return write({ id: message.id, result: { stopReason: "end_turn" } });
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  buffer += data;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

interface ProtocolLine {
  pid: number;
  start?: boolean;
  method?: string | null;
  sessionId?: string | null;
  text?: string;
}

interface Report {
  passed: boolean;
  lostPid?: number;
  restartedPid?: number;
  continuationPrompt?: string | null;
  secondDelivery?: { status: string; error: string | null } | null;
  thirdDelivery?: { status: string; shownError: string | null; startsAfter: number } | null;
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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

await writeFile(fakeOpenCode, FAKE_OPENCODE, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "opencode",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "opencode"),
});

const errors: string[] = [];
agents.on("event", (event) => {
  if (event.type === "error") errors.push(event.message);
});

const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Server lost",
      description: "Checks a turn whose OpenCode server stops.",
      avatarSeed: "server-lost",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  await waitFor(
    "the first turn to end",
    () => protocol().some((line) => line.method === "session/prompt") && idle(agent.id),
  );

  const firstPid = protocol().find((line) => line.method === "session/prompt")?.pid ?? 0;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Second message." }));
  const lost = await waitFor("the server to stop", () =>
    protocol().find((line) => line.method === "session/prompt" && line.text?.includes("Second message")),
  );
  report.lostPid = lost.pid;
  const restarted = await waitFor("OpenCode to start again", () =>
    protocol().find((line) => line.start && line.pid !== lost.pid && line.pid !== firstPid),
  );
  report.restartedPid = restarted.pid;
  await waitFor(
    "the second message to settle",
    () =>
      idle(agent.id) &&
      (protocol().some((line) => line.pid === restarted.pid && line.method === "session/prompt") ||
        agents.listQueue(agent.id).deliveries.some((delivery) => delivery.status === "failed")),
    30_000,
  );
  await waitFor("the agent to be idle", () => idle(agent.id), 30_000);
  report.continuationPrompt =
    protocol().find((line) => line.pid === restarted.pid && line.method === "session/prompt")?.text ?? null;
  const second = agents.listQueue(agent.id).deliveries.find((delivery) => delivery.text === "Second message.");
  report.secondDelivery = second ? { status: second.status, error: second.error ?? null } : null;

  const starts = protocol().filter((line) => line.start).length;
  const errorsBefore = errors.length;
  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Third message." }));
  const third = await waitFor(
    "the third message to fail",
    () =>
      agents
        .listQueue(agent.id)
        .deliveries.find((delivery) => delivery.text === "Third message." && delivery.status === "failed"),
    30_000,
  );
  report.thirdDelivery = {
    status: third.status,
    shownError: errors.slice(errorsBefore).find((message) => message.includes("OpenCode")) ?? null,
    startsAfter: protocol().filter((line) => line.start).length - starts,
  };
  report.passed =
    report.continuationPrompt !== null &&
    report.secondDelivery?.status === "completed" &&
    report.thirdDelivery.startsAfter === 0 &&
    report.thirdDelivery.shownError?.startsWith("OpenCode could not complete this turn") === true;
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
