import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-failing-session-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-failing-session-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const install = join(root, "antigravity");
const fakeAgy = join(install, "1.5.4", "bin", "antigravity");
const logPath = join(root, "agy.jsonl");

process.env.HOME = home;
process.env.GEMINI_HOME = join(home, ".gemini");
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;
process.env.FAKE_AGY_LOG = logPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
if (process.argv[2] === "--version") {
  process.stdout.write("1.5.4" + NL);
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const models = { availableModels: [{ modelId: "gemini-flash", name: "gemini-flash" }], currentModelId: "gemini-flash" };
const update = (sessionId, value) => write({ method: "session/update", params: { sessionId, update: value } });
let sessions = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: { sessionId: "agy-" + process.pid + "-" + ++sessions, models } });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: { sessionId: params.sessionId, models } });
  if (message.method === "session/prompt") {
    const text = params.prompt.map((block) => block.text ?? "").join("");
    const fail = text.includes("FAIL") && !text.includes("PELICAN");
    log({ sessionId: params.sessionId, fail, text });
    if (fail) return write({ id: message.id, error: { code: -32603, message: "stream idle timeout (5m0s): context deadline exceeded" } });
    update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } });
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

interface Prompt {
  sessionId: string;
  fail: boolean;
  text: string;
}

interface Step {
  text: string;
  status: string;
  error: string | null;
  sessions: string[];
}

const report: { steps: Step[]; passed: boolean; error?: string } = { steps: [], passed: false };

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

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function prompts(): Prompt[] {
  let text = "";
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

await mkdir(join(install, "1.5.4", "bin"), { recursive: true });
await writeFile(fakeAgy, FAKE_AGY, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "antigravity",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "antigravity"),
});

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

async function send(agentId: string, text: string): Promise<Step> {
  const before = prompts().length;
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${text}: the message has a delivery`);
  const status = await waitFor(`${text}: the message to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  await waitFor(`${text}: the queue to be idle`, () => idle(agentId));
  const step: Step = {
    text,
    status,
    error: mailbox.getDelivery(deliveryId)?.delivery.error ?? null,
    sessions: prompts()
      .slice(before)
      .map((prompt) => prompt.sessionId),
  };
  report.steps.push(step);
  return step;
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Failing session",
      description: "Checks a Gemini session that fails each turn.",
      avatarSeed: "failing-session",
      avatarHue: null,
      provider: "antigravity",
      model: "gemini-flash",
      initialMessage: "Remember the word PELICAN.",
    }),
  );
  await waitFor("the first turn", () => idle(agent.id));
  const first = prompts()[0]?.sessionId;
  assert.ok(first, "The first turn ran on a session.");

  const once = await send(agent.id, "FAIL once");
  assert.equal(once.status, "failed", "A prompt with FAIL fails its turn.");
  const answered = await send(agent.id, "Hello.");
  assert.equal(answered.status, "completed", "The next prompt answers.");
  assert.deepEqual([...once.sessions, ...answered.sessions], [first, first], "One failed turn keeps the session.");

  const failedA = await send(agent.id, "FAIL two");
  const failedB = await send(agent.id, "FAIL three");
  assert.deepEqual([failedA.status, failedB.status], ["failed", "failed"], "Both turns fail.");
  assert.deepEqual(
    [...failedA.sessions, ...failedB.sessions],
    [first, first],
    "A completed turn resets the count: both failed turns ran on the first session.",
  );

  const recovered = await send(agent.id, "Are you there?");
  assert.equal(recovered.status, "completed", `The next message answers: ${recovered.error ?? ""}`);
  const next = recovered.sessions[0];
  assert.ok(next && next !== first, "The next message runs on a new session.");
  const handoff = prompts().find((prompt) => prompt.sessionId === next)?.text ?? "";
  assert.ok(handoff.includes("PELICAN"), "The new session gets the conversation so far.");
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
