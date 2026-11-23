import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-refused-history-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-refused-history-"));
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
const { providerLabel } = await import("../src/backend/agent/thread-items");
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
const text = (sessionId, value) => update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } });
const poisoned = new Map();
const INVALID = "INVALID_ARGUMENT (code 400): Request contains an invalid argument.";
const OVERSIZED = "FAILED_PRECONDITION (code 400): The message size exceeds 30.000MB limit";
const UNENCODABLE = "Agent execution error: agent executor error: generating and executing: proto: field google.protobuf.Value.string_value contains invalid UTF-8";
const answer = (failure) => (failure.startsWith("Agent execution error: ") ? failure : NL + "\\u26A0 " + failure);
let sessions = 0;
let tools = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: { sessionId: "agy-" + process.pid + "-" + ++sessions, models } });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: { sessionId: params.sessionId, models } });
  if (message.method === "session/prompt") {
    const prompt = params.prompt.map((block) => block.text ?? "").join("");
    if (prompt.includes("POISON") && !prompt.includes("PELICAN")) poisoned.set(params.sessionId, INVALID);
    if (prompt.includes("OVERSIZE") && !prompt.includes("PELICAN")) poisoned.set(params.sessionId, OVERSIZED);
    if (prompt.includes("UNENCODABLE") && !prompt.includes("PELICAN")) poisoned.set(params.sessionId, UNENCODABLE);
    const refused = poisoned.has(params.sessionId);
    const tool = refused && prompt.includes("TOOL") && !prompt.includes("PELICAN");
    log({ sessionId: params.sessionId, refused, tool, text: prompt });
    if (tool) {
      const toolCallId = "read-" + ++tools;
      update(params.sessionId, { sessionUpdate: "tool_call", toolCallId, title: "Read broken.png", kind: "read", status: "in_progress" });
      update(params.sessionId, { sessionUpdate: "tool_call_update", toolCallId, status: "completed" });
    }
    text(params.sessionId, refused ? answer(poisoned.get(params.sessionId)) : "Done.");
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
  refused: boolean;
  tool: boolean;
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
      .map(({ sessionId, refused, tool }) => ({ sessionId, refused, tool })),
  };
  report.steps.push(step);
  return step;
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Refused history",
      description: "Checks a Gemini session whose history Google refuses.",
      avatarSeed: "refused-history",
      avatarHue: null,
      provider: "antigravity",
      model: "gemini-flash",
      initialMessage: "Remember the word PELICAN.",
    }),
  );
  await waitFor("the first turn", () => idle(agent.id));
  const first = prompts()[0]?.sessionId;
  assert.ok(first, "The first turn ran on a session.");

  const before = await send(agent.id, "POISON this session.");
  assert.equal(before.status, "completed", `A refusal before any work runs again and answers: ${before.error ?? ""}`);
  assert.deepEqual(
    before.prompts.map(({ refused }) => refused),
    [true, false],
    "The message ran two times: refused on the first session, then answered.",
  );
  assert.equal(before.prompts[0]?.sessionId, first, "The refusal came on the first session.");
  const second = before.prompts[1]?.sessionId;
  assert.ok(second && second !== first, "The message ran again on a new session.");

  const after = await send(agent.id, "POISON with a TOOL step.");
  assert.equal(after.status, "failed", "A refusal after a tool step fails the message.");
  assert.deepEqual(
    after.prompts,
    [{ sessionId: second, refused: true, tool: true }],
    "The message did not run again, so its tool step ran one time.",
  );
  assert.equal(
    after.error,
    sourceText("error.provider.antigravitySessionRejected"),
    "The message shows the refused-history text.",
  );

  const recovered = await send(agent.id, "Are you there?");
  assert.equal(recovered.status, "completed", `The next message answers: ${recovered.error ?? ""}`);
  const next = recovered.prompts[0]?.sessionId;
  assert.ok(next && next !== first && next !== second, "The next message runs on a new session.");
  const handoff = prompts().find((prompt) => prompt.sessionId === next)?.text ?? "";
  assert.ok(handoff.includes("PELICAN"), "The new session gets the conversation so far.");

  const oversized = await send(agent.id, "OVERSIZE this session.");
  assert.equal(oversized.status, "completed", `A too large chat runs again and answers: ${oversized.error ?? ""}`);
  assert.deepEqual(
    oversized.prompts.map(({ refused }) => refused),
    [true, false],
    "The message ran two times: refused on the old session, then answered.",
  );
  assert.equal(oversized.prompts[0]?.sessionId, next, "The refusal came on the old session.");
  const fresh = oversized.prompts[1]?.sessionId;
  assert.ok(fresh && fresh !== next, "The message ran again on a new session.");

  const oversizedTool = await send(agent.id, "OVERSIZE with a TOOL step.");
  assert.equal(oversizedTool.status, "failed", "A too large chat after a tool step fails the message.");
  assert.equal(
    oversizedTool.error,
    sourceText("error.provider.requestTooLarge", { provider: providerLabel("antigravity") }),
    "The message shows the too-large-chat text.",
  );

  const handedOff = await send(agent.id, "Are you back?");
  assert.equal(handedOff.status, "completed", `The message after the too large chat answers: ${handedOff.error ?? ""}`);

  const unencodable = await send(agent.id, "UNENCODABLE text in this session.");
  assert.equal(
    unencodable.status,
    "completed",
    `A history that Gemini cannot encode runs again and answers: ${unencodable.error ?? ""}`,
  );
  assert.deepEqual(
    unencodable.prompts.map(({ refused }) => refused),
    [true, false],
    "The message ran two times: refused on the old session, then answered.",
  );
  assert.notEqual(unencodable.prompts[0]?.sessionId, unencodable.prompts[1]?.sessionId, "It ran on a new session.");

  const unencodableTool = await send(agent.id, "UNENCODABLE text with a TOOL step.");
  assert.equal(unencodableTool.status, "failed", "An encoding failure after a tool step fails the message.");
  assert.equal(
    unencodableTool.error,
    sourceText("error.provider.antigravityHistoryUnreadable"),
    "The message shows the unreadable-history text.",
  );
  const afterUnencodable = await send(agent.id, "Are you still there?");
  assert.equal(afterUnencodable.status, "completed", `The next message answers: ${afterUnencodable.error ?? ""}`);
  assert.notEqual(
    afterUnencodable.prompts[0]?.sessionId,
    unencodableTool.prompts[0]?.sessionId,
    "The next message runs on a new session.",
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
