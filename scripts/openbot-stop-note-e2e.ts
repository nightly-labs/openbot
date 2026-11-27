import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getArray } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/openbot-stop-note-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-stop-note-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeAgy = join(root, "antigravity", "1.5.15", "bin", "antigravity");
const promptLog = join(root, "prompts.jsonl");
const STOP_NOTE_TAG = "<openbot_stop>";
const TOOL_LOOP_REASON = "the same tool call failed again and again";

process.env.HOME = home;
process.env.GEMINI_HOME = join(home, ".gemini");
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;
process.env.STOP_NOTE_PROMPT_LOG = promptLog;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { NO_PROVIDER_CREDENTIALS, requireProviderDriver } = await import("../src/backend/provider-drivers");

const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
if (process.argv[2] === "--version") { process.stdout.write("1.5.15" + NL); process.exit(0); }
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const models = { availableModels: [{ modelId: "gemini-flash", name: "gemini-flash" }], currentModelId: "gemini-flash" };
const update = (sessionId, value) => write({ method: "session/update", params: { sessionId, update: value } });
let sessions = 0;
let held = null;
function prompt(message) {
  const params = message.params;
  const texts = (params.prompt ?? []).filter((block) => block.type === "text").map((block) => block.text);
  fs.appendFileSync(process.env.STOP_NOTE_PROMPT_LOG, JSON.stringify({ texts }) + NL);
  const request = texts.at(-1) ?? "";
  if (request.includes("LOOP")) {
    held = message;
    for (let index = 1; index <= 5; index += 1)
      update(params.sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "call_" + index,
        title: "Run checks",
        kind: "execute",
        status: "failed",
        rawInput: { command: "run-checks" },
        content: [{ type: "content", content: { type: "text", text: "checks failed" } }],
      });
    return;
  }
  if (request.includes("HOLD")) {
    held = message;
    update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working." } });
    return;
  }
  update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } });
  write({ id: message.id, result: { stopReason: "end_turn" } });
}
function handle(message) {
  const params = message.params ?? {};
  if (message.method === "session/cancel") {
    if (held) write({ id: held.id, result: { stopReason: "cancelled" } });
    held = null;
    return;
  }
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: { sessionId: "agy-" + process.pid + "-" + ++sessions, models } });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: { sessionId: params.sessionId, models } });
  if (message.method === "session/prompt") return prompt(message);
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

interface Prompt {
  texts: string[];
}

function decodePrompt(line: string): Prompt {
  return { texts: getArray(JSON.parse(line), "texts").filter((text) => typeof text === "string") };
}

function prompts(): Prompt[] {
  if (!existsSync(promptLog)) return [];
  return readFileSync(promptLog, "utf8").split("\n").filter(Boolean).map(decodePrompt);
}

function promptFor(marker: string): Prompt | undefined {
  return prompts().find((prompt) => prompt.texts.at(-1)?.includes(marker));
}

const hasStopNote = (prompt: Prompt) => prompt.texts.some((text) => text.startsWith(`${STOP_NOTE_TAG}\n`));

const report: {
  afterOpenBotStop?: { stopNote: boolean; reason: boolean; firstBlock: string | undefined };
  secondPromptStopNote?: boolean;
  afterUserStopNote?: boolean;
  noteShownInChat?: boolean;
  passed: boolean;
  error?: string;
} = { passed: false };

await mkdir(join(root, "antigravity", "1.5.15", "bin"), { recursive: true });
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
  busyMessageMode: () => "queue",
  clientFactory: (_provider, cli) =>
    requireProviderDriver("antigravity").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS),
});
const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));
const send = async (agentId: string, text: string) => {
  await runCauseEffect(agents.sendMessage({ agentId, text }));
  await waitFor(`the turn for "${text}" to end`, () => idle(agentId));
};
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Stop note",
      description: "Checks the note after OpenBot stops a turn.",
      avatarSeed: "stop-note",
      avatarHue: null,
      provider: "antigravity",
      model: "gemini-flash",
      initialMessage: "Start.",
    }),
  );
  await waitFor("the first turn to end", () => idle(agent.id));

  await send(agent.id, "LOOP on the failing tool.");
  await send(agent.id, "FIRST message after the OpenBot stop.");
  const afterStop = await waitFor("the prompt after the OpenBot stop", () => promptFor("FIRST message"));
  report.afterOpenBotStop = {
    stopNote: hasStopNote(afterStop),
    reason: afterStop.texts.some((text) => text.includes(TOOL_LOOP_REASON)),
    firstBlock: afterStop.texts[0]?.split("\n").slice(0, 2).join(" "),
  };
  assert.ok(report.afterOpenBotStop.stopNote, "The prompt after an OpenBot stop carries the stop note.");
  assert.ok(report.afterOpenBotStop.reason, "The stop note names the tool loop.");

  await send(agent.id, "SECOND message after the OpenBot stop.");
  const second = await waitFor("the second prompt", () => promptFor("SECOND message"));
  report.secondPromptStopNote = hasStopNote(second);
  assert.equal(report.secondPromptStopNote, false, "OpenBot sends the stop note only once.");

  await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "HOLD until the user stops it." }));
  await waitFor("the held prompt", () => promptFor("HOLD"));
  const heldTurnId = await waitFor("the held turn", () => {
    const delivery = agents.listQueue(agent.id).deliveries.find((item) => item.status === "running");
    return delivery?.turnId ?? null;
  });
  await runCauseEffect(agents.interrupt(agent.id, heldTurnId));
  await waitFor("the user stop to end the turn", () => idle(agent.id));
  await send(agent.id, "THIRD message after the user stop.");
  const afterUserStop = await waitFor("the prompt after the user stop", () => promptFor("THIRD message"));
  report.afterUserStopNote = hasStopNote(afterUserStop);
  assert.equal(report.afterUserStopNote, false, "A user stop adds no OpenBot stop note.");

  const conversation = await runCauseEffect(agents.readConversation(agent.id));
  report.noteShownInChat = conversation.messages.some(
    (message) => message.text.includes(STOP_NOTE_TAG) || message.text.includes("OpenBot stopped a recent turn"),
  );
  assert.equal(report.noteShownInChat, false, "The chat does not show the stop note.");
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
