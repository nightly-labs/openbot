// Checks that a refused channel handoff or interrupt gives the model a readable result, not a fault.
// Runs the real agent service, channel service and tool router on a temporary profile with a fake
// Codex app-server. The fake calls the tool through `tool_call`, as a model does, and logs the tool
// result that it gets.
// The check asserts: channel_assign without sourceMessageIds, with an unknown source message id,
// and with an existing agent that is not a member return `accepted: false` with a reason and store
// no assignment; interrupt_agent with an
// unknown agent is a tool failure that names openbot.list_agents; a valid handoff is still accepted;
// send_message to an unknown agent in a direct chat turn is a tool failure that names
// openbot.list_agents and sends nothing.
// `bun scripts/channel-handoff-validation-e2e.ts`. Writes
// .openbot-build/channel-handoff-validation-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-handoff-validation-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-handoff-"));
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

const CALL_MARK = "CHANNEL-CALL";
const PERSON = { id: "local", name: "Alex" };

/**
 * A Codex app-server with the methods that the service calls. A turn whose input has
 * `CHANNEL-CALL <<ARGS{"__tool":"…",…}ARGS>>` calls `openbot.<__tool>` with the rest of that JSON
 * through `tool_call`, logs the result, and ends. A channel packet also repeats earlier requests, so
 * the last call in the input is the current assignment. Other turns answer "Done.".
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

/** The arguments the fake passes to the tool. */
interface ToolArgs {
  recipientAgentId?: string;
  task?: string;
  expectedResult?: string;
  sourceMessageIds?: string[];
  agentId?: string;
  recipientAgentIds?: string[];
  text?: string;
  expectsReply?: boolean;
}

interface ToolLog {
  turnId: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

const report: {
  calls: { name: string; turnId: string; success: boolean | null; text: string }[];
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], passed: false };

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

/** Waits for a state of the service or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
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

// Record each check and continue, so that one run shows every check that fails.
const failures: string[] = [];
function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  if (!condition) failures.push(detail ? `${name}: ${detail}` : name);
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
  timezone: () => "UTC",
});

const channels = () => agents.channels;
/** Waits until no task of the channel is open, so the next request starts a task of its own. */
function settled(channelId: string) {
  return waitFor("the channel tasks to end", () =>
    channels()
      .store.tasks(channelId)
      .every((task) => !["queued", "running", "waiting"].includes(task.state)),
  );
}

/**
 * Sends a person's channel message to `recipientAgentId` that makes the fake call `tool`, and returns
 * the tool result that it logged.
 */
async function callTool(name: string, channelId: string, recipientAgentId: string, tool: string, args: ToolArgs) {
  const before = toolLogs().length;
  await runCauseEffect(
    channels().command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: tool, ...args })}ARGS>>`,
        recipientAgentId,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      PERSON,
    ),
  );
  const entry = await waitFor(`${name} tool result`, () => toolLogs()[before]);
  await settled(channelId);
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, text });
  const fault = entry.error !== null || entry.result === null;
  return { success: entry.result?.success === true, text, fault };
}

/** Sends a direct chat message to the agent (not a channel) that makes the fake call `tool`. */
async function callToolInChat(name: string, agentId: string, tool: string, args: ToolArgs) {
  const receipt = await runCauseEffect(
    agents.sendMessage({ agentId, text: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: tool, ...args })}ARGS>>` }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: no delivery`);
  // Match the log by turn, as an earlier channel task can still log a late result.
  const turnId = await waitFor(`${name} turn`, () => mailbox.getDelivery(deliveryId)?.delivery.turnId);
  const entry = await waitFor(`${name} tool result`, () => toolLogs().find((log) => log.turnId === turnId));
  await waitFor(`${name} turn end`, () => {
    const status = mailbox.getDelivery(deliveryId)?.delivery.status;
    return status === "completed" || status === "failed" || status === "interrupted";
  });
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, text });
  return { success: entry.result?.success === true, text, fault: entry.error !== null || entry.result === null };
}

try {
  await runCauseEffect(agents.initialize());
  const create = async (name: string) => {
    const agent = await runCauseEffect(
      agents.createAgent({
        name,
        description: `${name} works in the team channel.`,
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
      }),
    );
    await waitFor(`the first chat turn of ${name} to end`, () =>
      agents
        .listQueue(agent.id)
        .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
    );
    return agent;
  };
  const lead = await create("Lead");
  const writer = await create("Writer");
  // An existing agent that is not a member of the channel.
  const stranger = await create("Stranger");
  const channelId = randomUUID();
  await runCauseEffect(
    channels().command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "team",
          title: "",
          instructions: "Ship the release.",
          members: [{ agentId: lead.id }, { agentId: writer.id }],
          leadAgentId: lead.id,
        },
      },
      PERSON,
    ),
  );
  // A first message gives the handoff a source message id to cite.
  await runCauseEffect(
    channels().command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text: "Please prepare the release notes.",
        recipientAgentId: lead.id,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      PERSON,
    ),
  );
  await waitFor("the first request to end", () => channels().store.tasks(channelId).length > 0 || null);
  await settled(channelId);

  const assignmentsOf = (id: string) =>
    channels()
      .store.assignments(channelId)
      .filter((item) => item.agentId === id);
  // The lead owns each task that a request starts. A handoff to anyone else adds another owner.
  const handoffAssignments = () =>
    channels()
      .store.assignments(channelId)
      .filter((item) => item.agentId !== lead.id);
  const sourceMessage = channels().store.messages(channelId).at(-1)?.message;
  assert.ok(sourceMessage, "The channel has a message to cite.");
  const sourceMessageId = sourceMessage.id;

  // 1. No sourceMessageIds: a normal result that names the field.
  const noSources = await callTool("assign without sources", channelId, lead.id, "channel_assign", {
    recipientAgentId: writer.id,
    task: "Draft the notes.",
    expectedResult: "A list of notes.",
  });
  pass(
    "A handoff without sourceMessageIds is a refusal, not a fault",
    !noSources.fault &&
      noSources.success &&
      noSources.text.includes('"accepted":false') &&
      noSources.text.includes("sourceMessageIds"),
    noSources.text,
  );
  pass("No assignment is stored for the refused handoff", handoffAssignments().length === 0);

  // 2. An unknown source message id: a normal result that names the id.
  const badSource = await callTool("assign with an unknown source", channelId, lead.id, "channel_assign", {
    recipientAgentId: writer.id,
    task: "Draft the notes.",
    expectedResult: "A list of notes.",
    sourceMessageIds: ["no-such-message"],
  });
  pass(
    "A handoff with an unknown source message id is a refusal, not a fault",
    !badSource.fault &&
      badSource.success &&
      badSource.text.includes('"accepted":false') &&
      badSource.text.includes("no-such-message"),
    badSource.text,
  );
  pass("No assignment is stored for the unknown source", handoffAssignments().length === 0);

  // 3. An existing agent that is not a channel member.
  const outsider = await callTool("assign to a non-member", channelId, lead.id, "channel_assign", {
    recipientAgentId: stranger.id,
    task: "Draft the notes.",
    expectedResult: "A list of notes.",
    sourceMessageIds: [sourceMessageId],
  });
  pass(
    "A recipient that is not a member is a refusal, not a fault",
    !outsider.fault &&
      outsider.success &&
      outsider.text.includes('"accepted":false') &&
      outsider.text.includes(stranger.id) &&
      outsider.text.includes("Select an available member of this channel."),
    outsider.text,
  );
  pass("No assignment is stored for the non-member", handoffAssignments().length === 0);

  // 4. The interrupt tool with an unknown agent.
  const unknown = await callTool("interrupt an unknown agent", channelId, lead.id, "interrupt_agent", {
    agentId: "no-such-agent",
  });
  pass(
    "Interrupting an unknown agent is a tool failure that names openbot.list_agents",
    !unknown.fault &&
      !unknown.success &&
      unknown.text.includes("Unknown OpenBot agent") &&
      unknown.text.includes("openbot.list_agents"),
    unknown.text,
  );

  // 5. Control: a valid handoff is accepted.
  const valid = await callTool("valid assign", channelId, lead.id, "channel_assign", {
    recipientAgentId: writer.id,
    task: "Draft the notes.",
    expectedResult: "A list of notes.",
    sourceMessageIds: [sourceMessageId],
  });
  pass(
    "A valid handoff is accepted",
    !valid.fault && valid.success && valid.text.includes('"accepted":true') && assignmentsOf(writer.id).length > 0,
    valid.text,
  );

  // 6. send_message to an unknown agent in a direct chat turn (a channel thread refuses it earlier).
  const queued = () => agents.listQueue(lead.id).deliveries.length + agents.listQueue(writer.id).deliveries.length;
  const queuedBefore = queued();
  const unknownRecipient = await callToolInChat("send to an unknown agent", lead.id, "send_message", {
    recipientAgentIds: ["no-such-agent"],
    text: "Hello",
    expectsReply: false,
  });
  pass(
    "Sending to an unknown agent is a tool failure that names openbot.list_agents",
    !unknownRecipient.fault &&
      !unknownRecipient.success &&
      unknownRecipient.text.includes("Unknown OpenBot agent") &&
      unknownRecipient.text.includes("openbot.list_agents"),
    unknownRecipient.text,
  );
  // Only the chat message that started the turn is new. The call adds no delivery of its own.
  pass("Nothing is sent to an unknown agent", queued() === queuedBefore + 1, `${queuedBefore} -> ${queued()}`);

  // 7. One unknown id refuses the whole call: the valid co-recipient and the sender get nothing.
  const leadBefore = agents.listQueue(lead.id).deliveries.length;
  const writerBefore = agents.listQueue(writer.id).deliveries.length;
  const mixed = await callToolInChat("send to a known and an unknown agent", lead.id, "send_message", {
    recipientAgentIds: [writer.id, "no-such-agent"],
    text: "Hello",
    expectsReply: false,
  });
  pass(
    "One unknown recipient makes the whole send a tool failure that names openbot.list_agents",
    !mixed.fault &&
      !mixed.success &&
      mixed.text.includes("Unknown OpenBot agent") &&
      mixed.text.includes("openbot.list_agents"),
    mixed.text,
  );
  const leadAfter = agents.listQueue(lead.id).deliveries.length;
  const writerAfter = agents.listQueue(writer.id).deliveries.length;
  pass("The valid co-recipient gets nothing", writerAfter === writerBefore, `${writerBefore} -> ${writerAfter}`);
  // Only the chat message that started the turn is new for the sender.
  pass("The sender gets nothing from the call", leadAfter === leadBefore + 1, `${leadBefore} -> ${leadAfter}`);

  assert.equal(failures.length, 0, failures.join("\n"));
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
