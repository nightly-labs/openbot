// Checks that a spent Gemini quota moves an agent to its backup model, also after the turn started
// work. Runs the real agent service on a temporary profile with a fake Antigravity 1.4.5 ACP server.
// A prompt with `QUOTA-NOW` on a `gemini-quota-*` model gets Antigravity's quota text as answer text
// and the stop reason `refusal`; with `ACT-FIRST` it runs a tool step before that. `gemini-spent`
// gets the quota text before any step. `gemini-flash` always answers. Each case has its own primary
// model: a spent quota holds its model for all agents.
// Checks:
//   1. Quota before work, set to switch without asking: the message runs again on the backup.
//   2. Quota after a tool step, set to switch without asking: the backup continues the work, with
//      the work steps and no error.
//   3. Quota after a tool step, set to ask: the backup continues the work too, as after a plan limit.
//   4. As 3, but the first backup's quota is spent too: the next backup continues the same work.
// `bun run test:antigravity-quota-failover`. Writes .openbot-build/antigravity-quota-failover-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-quota-failover-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-quota-failover-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const install = join(root, "antigravity");
const fakeAgy = join(install, "bin", "agy_acp_server");
const logPath = join(root, "agy.jsonl");
const BACKUP = "gemini-flash";
// The continuation note that a backup model gets for work that a usage limit stopped.
const CONTINUATION = "The previous provider reached its usage limit after starting this task.";

// Before the service modules load: the stores read the home folder.
process.env.HOME = home;
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;
process.env.FAKE_AGY_LOG = logPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/** An Antigravity ACP server that keeps each session's model and sends a spent quota as 1.4.5 does. */
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODELS = ["gemini-quota-a", "gemini-quota-b", "gemini-quota-c", "gemini-quota-d", "gemini-spent", "gemini-flash"];
const models = { availableModels: MODELS.map((modelId) => ({ modelId, name: modelId })) };
const current = new Map();
const setup = (sessionId) => ({ sessionId, models: { ...models, currentModelId: current.get(sessionId) ?? MODELS[0] } });
const update = (sessionId, value) => write({ method: "session/update", params: { sessionId, update: value } });
let sessions = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: setup("agy-" + process.pid + "-" + ++sessions) });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: setup(params.sessionId) });
  if (message.method === "session/set_model") {
    current.set(params.sessionId, params.modelId);
    return write({ id: message.id, result: {} });
  }
  if (message.method === "session/prompt") {
    const text = params.prompt.map((block) => block.text ?? "").join("");
    const model = current.get(params.sessionId) ?? MODELS[0];
    const quota = (model.startsWith("gemini-quota-") || model === "gemini-spent") && text.includes("QUOTA-NOW");
    log({ model, quota, text });
    if (quota) {
      if (text.includes("ACT-FIRST") && model !== "gemini-spent")
        update(params.sessionId, { sessionUpdate: "tool_call", toolCallId: "read-" + Date.now(), title: "Read notes.txt", kind: "read", status: "completed", rawInput: { path: "notes.txt" } });
      update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Usage Limit Reached" + NL + NL + "You have reached your current quota for this period. Your limit will reset in 6 days, 22 hours." } });
      return write({ id: message.id, result: { stopReason: "refusal" } });
    }
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
  model: string;
  quota: boolean;
  text: string;
}

interface CaseReport {
  name: string;
  status: string;
  model: string | undefined;
  prompts: { model: string; quota: boolean; continuation: boolean; workSteps: boolean }[];
  errors: number;
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

/** Waits for a state of the service. */
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

await mkdir(join(install, "bin"), { recursive: true });
await writeFile(join(install, "antigravity-package.json"), `${JSON.stringify({ version: "1.4.5" })}\n`);
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
const events: AgentEvent[] = [];
agents.on("event", (event) => events.push(event));

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

/** Makes an agent on `model` with the backup models in `order`, and sends `text` after its first turn. */
async function runCase(
  name: string,
  model: string,
  automatic: boolean,
  text: string,
  order: readonly string[] = [BACKUP],
): Promise<CaseReport> {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks a spent Gemini quota.",
      avatarSeed: model,
      avatarHue: null,
      provider: "antigravity",
      model,
      initialMessage: "Hello.",
    }),
  );
  await waitFor(`${name}: the first turn`, () => idle(agent.id));
  await runCauseEffect(
    agents.updateAgent({
      agentId: agent.id,
      backupModels: { automatic, order: order.map((backup) => ({ provider: "antigravity", model: backup })) },
    }),
  );
  const since = events.length;
  const before = prompts().length;
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: the message has a delivery`);
  const status = await waitFor(`${name}: the message to end`, () => {
    const value = mailbox.getDelivery(deliveryId)?.delivery.status;
    return value === "completed" || value === "failed" || value === "interrupted" ? value : null;
  });
  const result: CaseReport = {
    name,
    status,
    model: store.list().find((candidate) => candidate.id === agent.id)?.model,
    prompts: prompts()
      .slice(before)
      .map((prompt) => ({
        model: prompt.model,
        quota: prompt.quota,
        continuation: prompt.text.includes(CONTINUATION),
        workSteps: prompt.text.includes("Read notes.txt"),
      })),
    errors: events.slice(since).filter((event) => event.type === "error" && event.agentId === agent.id).length,
    passed: false,
  };
  report.cases.push(result);
  assert.equal(status, "completed", `${name}: ${mailbox.getDelivery(deliveryId)?.delivery.error ?? status}`);
  assert.equal(result.model, BACKUP, `${name}: the agent is on the backup model`);
  assert.equal(result.errors, 0, `${name}: no error shows`);
  return result;
}

try {
  await runCauseEffect(agents.initialize());

  const before = await runCase("quota before work", "gemini-quota-a", true, "QUOTA-NOW");
  assert.deepEqual(
    before.prompts.map((prompt) => [prompt.model, prompt.continuation]),
    [
      ["gemini-quota-a", false],
      [BACKUP, false],
    ],
    "The message runs again on the backup, as a new message.",
  );
  before.passed = true;

  for (const [name, model, automatic] of [
    ["quota after work, switch without asking", "gemini-quota-b", true],
    ["quota after work, ask before switching", "gemini-quota-c", false],
  ] as const) {
    const after = await runCase(name, model, automatic, "ACT-FIRST QUOTA-NOW");
    assert.deepEqual(
      after.prompts.map((prompt) => [prompt.model, prompt.continuation]),
      [
        [model, false],
        [BACKUP, true],
      ],
      `${name}: the backup continues the started work.`,
    );
    after.passed = true;
  }

  const chained = await runCase(
    "quota after work, first backup spent too, ask before switching",
    "gemini-quota-d",
    false,
    "ACT-FIRST QUOTA-NOW",
    ["gemini-spent", BACKUP],
  );
  assert.deepEqual(
    chained.prompts.map((prompt) => [prompt.model, prompt.continuation, prompt.workSteps]),
    [
      ["gemini-quota-d", false, false],
      ["gemini-spent", true, true],
      [BACKUP, true, true],
    ],
    "The next backup continues the work that the first provider started.",
  );
  chained.passed = true;
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
