// Checks that a channel member changes its channel at a person's request: it adds and removes
// members, replaces the instructions, and lists, creates, changes and deletes the channel's routines.
// Runs the real agent service, channel service and tool router on a temporary profile with a fake
// Codex app-server. The fake calls the tool through `tool_call`, as a model does, and logs the tool
// result that it gets.
// The check asserts the stored channel and routines after each call, one change note per change
// that names the agent and the person, and the refusals: the caller removing itself, a person who
// cannot chat with the agent they ask to add, and a routine run, which is not a person's request.
// `bun scripts/agent-channel-manage-e2e.ts`. Writes .openbot-build/agent-channel-manage-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type ChannelMessage, isChannelChangeMarker } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-channel-manage-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-manage-"));
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
// A team member whose roles do not let them chat with the agents they ask to add.
const LIMITED = { id: "member-limited", name: "Rui" };
let limitedVisibleAgentId = "";

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

/** The arguments the fake passes to the channel tool. */
interface ChannelToolArgs {
  agentId?: string;
  instructions?: string;
  routineId?: string;
  name?: string;
  instruction?: string;
  schedule?: { kind: "daily"; time: string } | { kind: "once"; date: string; time: string };
  active?: boolean;
}

interface ToolLog {
  turnId: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

const report: {
  calls: { name: string; turnId: string; success: boolean | null; text: string }[];
  notes: string[];
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], notes: [], checks: [], passed: false };

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

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
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
  // The limited member sees Tester but cannot chat with it, and does not see the other agents.
  channelPersonAgentLevel: (personId, agentId) =>
    personId !== LIMITED.id ? "manage" : agentId === limitedVisibleAgentId ? "view" : "none",
  channelRemotePerson: (personId) => personId === LIMITED.id,
});

const channels = () => agents.channels;
const channelOf = (channelId: string) => channels().store.get(channelId);
const notes = (channelId: string): ChannelMessage[] =>
  channels()
    .store.messages(channelId)
    .filter((entry) => isChannelChangeMarker(entry.message));

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
async function callTool(
  name: string,
  channelId: string,
  recipientAgentId: string,
  tool: string,
  args: ChannelToolArgs,
  person = PERSON,
) {
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
      person,
    ),
  );
  const entry = await waitFor(`${name} tool result`, () => toolLogs()[before]);
  await settled(channelId);
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, text });
  return { success: entry.result?.success === true, text };
}

function lastNote(channelId: string): ChannelMessage | undefined {
  return notes(channelId).at(-1);
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
  const tester = await create("Tester");
  const writer = await create("Writer");
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
          members: [{ agentId: lead.id }, { agentId: tester.id }],
          leadAgentId: lead.id,
        },
      },
      PERSON,
    ),
  );

  // 1. Add a member.
  const added = await callTool("add member", channelId, lead.id, "channel_add_member", { agentId: writer.id });
  pass("Adding a member succeeds", added.success, added.text);
  pass(
    "The channel has the new member",
    channelOf(channelId).members.some((member) => member.agentId === writer.id),
  );
  const addNote = lastNote(channelId);
  pass(
    "A change note names the agent, the member and the person",
    addNote?.author.kind === "agent" &&
      addNote.author.id === lead.id &&
      addNote.message.source === "system" &&
      addNote.message.text === "Lead added Writer to the channel. Alex asked for it.",
    addNote?.message.text,
  );

  // 2. Remove a member.
  const removed = await callTool("remove member", channelId, lead.id, "channel_remove_member", { agentId: tester.id });
  pass(
    "Removing a member succeeds",
    removed.success && !channelOf(channelId).members.some((member) => member.agentId === tester.id),
    removed.text,
  );
  pass(
    "The removal has a note",
    lastNote(channelId)?.message.text === "Lead removed Tester from the channel. Alex asked for it.",
  );

  // 3. The caller cannot remove itself.
  const self = await callTool("remove self", channelId, lead.id, "channel_remove_member", { agentId: lead.id });
  pass(
    "An agent cannot remove itself",
    !self.success &&
      self.text.includes("cannot remove yourself") &&
      channelOf(channelId).members.some((member) => member.agentId === lead.id),
    self.text,
  );

  // 4. Replace the instructions.
  const instructions = await callTool("set instructions", channelId, lead.id, "channel_set_instructions", {
    instructions: "Ship the release on Friday.",
  });
  pass(
    "The instructions change",
    instructions.success && channelOf(channelId).instructions === "Ship the release on Friday.",
    instructions.text,
  );
  pass(
    "The instructions change has a note",
    lastNote(channelId)?.message.text === "Lead changed the channel instructions. Alex asked for it.",
  );

  // 5. Create, list, change and delete a channel routine.
  const created = await callTool("create routine", channelId, lead.id, "channel_create_routine", {
    name: "Standup",
    instruction: "Each member posts what they finished yesterday.",
    schedule: { kind: "daily", time: "09:00" },
  });
  const routine = agents.listChannelRoutines(channelId).find((item) => item.name === "Standup");
  pass(
    "The routine is created in the channel with the server timezone",
    created.success && routine?.active === true && routine.timezone === "UTC",
    created.text,
  );
  assert.ok(routine);
  pass(
    "The creation has a note",
    lastNote(channelId)?.message.text === "Lead created the routine Standup. Alex asked for it.",
  );
  const duplicate = await callTool("duplicate routine", channelId, lead.id, "channel_create_routine", {
    name: "standup",
    instruction: "Again.",
    schedule: { kind: "daily", time: "10:00" },
  });
  pass("A duplicate routine name is a tool failure", !duplicate.success && duplicate.text.includes("already exists"));
  const listed = await callTool("list routines", channelId, lead.id, "channel_list_routines", {});
  pass("The list has the routine", listed.success && listed.text.includes(routine.id), listed.text);
  const paused = await callTool("pause routine", channelId, lead.id, "channel_update_routine", {
    routineId: routine.id,
    active: false,
  });
  pass(
    "The routine pauses",
    paused.success && agents.listChannelRoutines(channelId).find((item) => item.id === routine.id)?.active === false,
    paused.text,
  );
  const deleted = await callTool("delete routine", channelId, lead.id, "channel_delete_routine", {
    routineId: routine.id,
  });
  pass(
    "The routine is deleted",
    deleted.success && !agents.listChannelRoutines(channelId).some((item) => item.id === routine.id),
    deleted.text,
  );
  pass(
    "The deletion has a note",
    lastNote(channelId)?.message.text === "Lead deleted the routine Standup. Alex asked for it.",
  );

  // 6. A person whose roles do not let them chat with the agent cannot have it added, and a person
  // who cannot see a member cannot have it removed.
  limitedVisibleAgentId = tester.id;
  const limited = await callTool(
    "add for a limited member",
    channelId,
    lead.id,
    "channel_add_member",
    { agentId: tester.id },
    LIMITED,
  );
  pass(
    "A member without chat access cannot have the agent added",
    !limited.success &&
      limited.text.includes("cannot chat with Tester") &&
      !channelOf(channelId).members.some((member) => member.agentId === tester.id),
    limited.text,
  );
  const unseen = await callTool(
    "remove for a limited member",
    channelId,
    lead.id,
    "channel_remove_member",
    { agentId: writer.id },
    LIMITED,
  );
  pass(
    "A member who cannot see the agent cannot have it removed",
    !unseen.success &&
      unseen.text.includes("is not a member") &&
      channelOf(channelId).members.some((member) => member.agentId === writer.id),
    unseen.text,
  );
  // The Team API has no one-time channel routine, so a team member's request cannot make one.
  const remoteOnce = await callTool(
    "one-time routine for a team member",
    channelId,
    lead.id,
    "channel_create_routine",
    {
      name: "Reminder",
      instruction: "Remind the channel.",
      schedule: { kind: "once", date: "2099-01-01", time: "09:00" },
    },
    LIMITED,
  );
  pass(
    "A team member's request cannot make a one-time channel routine",
    !remoteOnce.success &&
      remoteOnce.text.includes("one-time channel routine") &&
      !agents.listChannelRoutines(channelId).some((item) => item.name === "Reminder"),
    remoteOnce.text,
  );

  // 7. Removing the lead leaves the channel without one.
  const noLead = await callTool("remove lead", channelId, writer.id, "channel_remove_member", { agentId: lead.id });
  pass("Removing the lead clears the lead", noLead.success && channelOf(channelId).leadAgentId === null, noLead.text);

  // 8. A routine run is not a person's request, so it cannot change the channel.
  const soloId = randomUUID();
  await runCauseEffect(
    channels().command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId: soloId,
        draft: { name: "solo", title: "", instructions: "", members: [{ agentId: lead.id }], leadAgentId: lead.id },
      },
      PERSON,
    ),
  );
  const runner = agents.createChannelRoutine({
    channelId: soloId,
    name: "Injected",
    instruction: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "channel_add_member", agentId: tester.id })}ARGS>>`,
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  const before = toolLogs().length;
  await runCauseEffect(agents.testChannelRoutine({ channelId: soloId, routineId: runner.id }));
  const fromRun = await waitFor("the routine run tool result", () => toolLogs()[before]);
  await settled(soloId);
  const fromRunText = fromRun.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(fromRun.error);
  report.calls.push({
    name: "routine run",
    turnId: fromRun.turnId,
    success: fromRun.result?.success ?? null,
    text: fromRunText,
  });
  pass(
    "A routine run cannot change the channel",
    fromRun.result?.success !== true &&
      fromRunText.includes("Only a person's request") &&
      channelOf(soloId).members.length === 1 &&
      notes(soloId).length === 0,
    fromRunText,
  );

  pass("Each change has one note", notes(channelId).length === 7);
  report.notes = notes(channelId).map((entry) => entry.message.text);
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
