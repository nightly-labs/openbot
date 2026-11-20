import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mistral-stuck-turn-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-mistral-stuck-turn-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const install = join(root, "vibe", "bin");
const fakeVibe = join(install, "vibe-acp");
const logPath = join(root, "vibe.jsonl");
const statePath = join(root, "stuck-sessions.json");

process.env.HOME = home;
process.env.VIBE_HOME = join(home, ".vibe");
process.env.OPENBOT_MISTRAL_PATH = fakeVibe;
process.env.FAKE_VIBE_LOG = logPath;
process.env.FAKE_VIBE_STATE = statePath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_VIBE = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
if (process.argv.includes("--version")) {
  process.stdout.write("vibe-acp 3.1.0" + NL);
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.FAKE_VIBE_LOG, JSON.stringify(entry) + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const readStuck = () => {
  try {
    return JSON.parse(fs.readFileSync(process.env.FAKE_VIBE_STATE, "utf8"));
  } catch {
    return [];
  }
};
const markStuck = (sessionId) => fs.writeFileSync(process.env.FAKE_VIBE_STATE, JSON.stringify([...readStuck(), sessionId]));
const models = { availableModels: [{ modelId: "devstral", name: "devstral" }], currentModelId: "devstral" };
const VALIDATION =
  "1 validation error for tagged-union[RustAcceptedApplyResult,RustRejectedApplyResult] accepted.transition.observations.1.tool_result_committed.call.runtime_builtin.arguments Input should be an object [type=dict_type, input_value='ls', input_type=str]";
let sessions = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true } } });
  if (message.method === "session/new")
    return write({ id: message.id, result: { sessionId: "vibe-" + process.pid + "-" + ++sessions, models } });
  if (message.method === "session/load") return write({ id: message.id, result: { models } });
  if (message.method === "session/prompt") {
    const prompt = params.prompt.map((block) => block.text ?? "").join("");
    const stuck = readStuck().includes(params.sessionId);
    const crash = !stuck && prompt.includes("CRASH") && !prompt.includes("PELICAN");
    log({ sessionId: params.sessionId, stuck, crash, text: prompt });
    if (stuck) return write({ id: message.id, error: { code: -32603, message: "A turn is already running" } });
    if (crash) {
      markStuck(params.sessionId);
      return write({ id: message.id, error: { code: -32603, message: VALIDATION } });
    }
    write({
      method: "session/update",
      params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } } },
    });
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
  stuck: boolean;
  crash: boolean;
  text: string;
}

interface Step {
  text: string;
  status: string;
  error: string | null;
  prompts: Omit<Prompt, "text">[];
}

const report: { steps: Step[]; passed: boolean; error?: string } = { steps: [], passed: false };

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

await mkdir(install, { recursive: true });
await writeFile(fakeVibe, FAKE_VIBE, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "mistral",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "mistral"),
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
  await waitFor(`${text}: the queue to be idle`, () => {
    const status = mailbox.getDelivery(deliveryId)?.delivery.status;
    return (status === "completed" || status === "failed" || status === "interrupted") && idle(agentId);
  });
  const step: Step = {
    text,
    status: mailbox.getDelivery(deliveryId)?.delivery.status ?? "missing",
    error: mailbox.getDelivery(deliveryId)?.delivery.error ?? null,
    prompts: prompts()
      .slice(before)
      .map(({ sessionId, stuck, crash }) => ({ sessionId, stuck, crash })),
  };
  report.steps.push(step);
  return step;
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Stuck turn",
      description: "Checks a Mistral session that keeps a failed turn open.",
      avatarSeed: "stuck-turn",
      avatarHue: null,
      provider: "mistral",
      model: "devstral",
      initialMessage: "Remember the word PELICAN.",
    }),
  );
  await waitFor("the first turn", () => idle(agent.id));
  const first = prompts()[0]?.sessionId;
  assert.ok(first, "The first turn ran on a session.");

  const crash = await send(agent.id, "Run CRASH now.");
  assert.equal(crash.status, "failed", "The turn that Mistral Vibe could not finish fails.");
  assert.deepEqual(
    crash.prompts,
    [{ sessionId: first, stuck: false, crash: true }],
    "The crash came on the first session.",
  );

  const stuck = await send(agent.id, "Say hello.");
  assert.equal(stuck.status, "completed", `The next message answers: ${stuck.error ?? ""}`);
  assert.deepEqual(
    stuck.prompts.map(({ stuck }) => stuck),
    [true, false],
    "The message ran two times: refused on the stuck session, then answered.",
  );
  assert.equal(stuck.prompts[0]?.sessionId, first, "The refusal came on the stuck session.");
  const second = stuck.prompts[1]?.sessionId;
  assert.ok(second && second !== first, "The message ran again on a new session.");
  const handoff = prompts().find((prompt) => prompt.sessionId === second)?.text ?? "";
  assert.ok(handoff.includes("PELICAN"), "The new session gets the conversation so far.");

  const after = await send(agent.id, "Are you there?");
  assert.equal(after.status, "completed", `A later message answers: ${after.error ?? ""}`);
  assert.deepEqual(
    after.prompts,
    [{ sessionId: second, stuck: false, crash: false }],
    "A later message runs on the new session only.",
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
