// Checks that an agent creates and changes a channel from its own chat, with its picture: an icon
// on a colour or an image file. Runs the real agent service, channel service and tool router on a
// temporary profile with a fake Codex app-server. The fake calls the tool through `tool_call`, as a
// model does, and logs the tool result that it gets.
// The check asserts the stored channel after each call: the members, lead, icon and image of a new
// channel; a rename, member changes, a new lead and an image that replaces the icon; an icon that
// removes the image; archive and restore; and the refusals: a hidden agent, a lead that is not a
// member, an unusable image file, and a call from a channel task. A repeated tool call makes one
// channel.
// `bun scripts/agent-channel-create-e2e.ts`. Writes .openbot-build/agent-channel-create-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-channel-create-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-create-"));
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
const { handleChannelAgentTool } = await import("../src/backend/agent/channel-agent-tools");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const CALL_MARK = "CHANNEL-CALL";
const PERSON = { id: "local", name: "Alex" };
/** A team member, whose app has only what the Team API gives it. */
const MEMBER = { id: "member-remote", name: "Sam" };
// A 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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

/** The arguments the fake passes to the tool, valid or not. */
interface ChannelToolArgs {
  channelId?: string;
  name?: string;
  title?: string;
  instructions?: string;
  memberAgentIds?: string[];
  addMemberAgentIds?: string[];
  removeMemberAgentIds?: string[];
  leadAgentId?: string;
  icon?: { name: string; hue: number };
  imagePath?: string;
  archived?: boolean;
  /** A key that list_channels does not know. */
  query?: string;
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
  channelPersonAgentLevel: () => "manage",
  channelRemotePerson: (personId) => personId === MEMBER.id,
});

const channels = () => agents.channels;
const channelOf = (channelId: string) => channels().store.get(channelId);
const memberIds = (channelId: string) => channelOf(channelId).members.map((member) => member.agentId);

/** Waits until the agent's chat has no open delivery. */
function idle(agentId: string) {
  return waitFor("the chat turn to end", () =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
}

/** Logs and returns the tool result of the fake's last call. */
async function logged(name: string, before: number) {
  const entry = await waitFor(`${name} tool result`, () => toolLogs()[before]);
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, text });
  return { success: entry.result?.success === true, text };
}

/** Sends the person's message to the agent's own chat that makes the fake call `tool`. */
async function callFromChat(
  name: string,
  agentId: string,
  tool: string,
  args: ChannelToolArgs,
  sender: { id: string; name: string } = PERSON,
) {
  const before = toolLogs().length;
  await runCauseEffect(
    agents.sendMessage(
      { agentId, text: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: tool, ...args })}ARGS>>` },
      sender,
    ),
  );
  const result = await logged(name, before);
  await idle(agentId);
  return result;
}

/** The channel id in a tool result. */
function resultChannelId(text: string): string {
  return z.object({ channel: z.object({ id: z.string() }) }).parse(JSON.parse(text)).channel.id;
}

try {
  await runCauseEffect(agents.initialize());
  const create = async (name: string) => {
    const agent = await runCauseEffect(
      agents.createAgent({
        name,
        description: `${name} works in a channel.`,
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
      }),
    );
    await idle(agent.id);
    return agent;
  };
  const lead = await create("Lead");
  const tester = await create("Tester");
  const writer = await create("Writer");
  const hidden = await create("Hidden");
  await runCauseEffect(agents.setAgentHidden({ agentId: hidden.id, hidden: true }));
  const imagePath = join(lead.workspacePath, "channel.png");
  await writeFile(imagePath, PNG);
  await writeFile(join(lead.workspacePath, "notes.txt"), "Not an image.");

  // 1. Refusals change nothing.
  const channelCount = () => channels().store.ids().length;
  const hiddenMember = await callFromChat("create with a hidden agent", lead.id, "create_channel", {
    name: "launch",
    memberAgentIds: [lead.id, hidden.id],
  });
  pass(
    "A hidden agent cannot become a member",
    !hiddenMember.success && hiddenMember.text.includes("Hidden is hidden") && channelCount() === 0,
    hiddenMember.text,
  );
  const outsideLead = await callFromChat("create with an outside lead", lead.id, "create_channel", {
    name: "launch",
    memberAgentIds: [lead.id],
    leadAgentId: tester.id,
  });
  pass(
    "The lead must be a member",
    !outsideLead.success && outsideLead.text.includes("leadAgentId") && channelCount() === 0,
    outsideLead.text,
  );
  const badImage = await callFromChat("create with a text file as image", lead.id, "create_channel", {
    name: "launch",
    memberAgentIds: [lead.id],
    imagePath: "notes.txt",
  });
  pass(
    "A file that is not an image refuses the call",
    !badImage.success && badImage.text.includes("valid PNG") && channelCount() === 0,
    badImage.text,
  );
  const both = await callFromChat("create with icon and image", lead.id, "create_channel", {
    name: "launch",
    memberAgentIds: [lead.id],
    icon: { name: "megaphone", hue: 30 },
    imagePath: "channel.png",
  });
  pass("An icon and an image together are refused", !both.success && both.text.includes("not both"), both.text);
  const badHue = await callFromChat("create with an unknown hue", lead.id, "create_channel", {
    name: "launch",
    memberAgentIds: [lead.id],
    icon: { name: "megaphone", hue: 31 },
  });
  pass("An unknown hue is refused", !badHue.success && channelCount() === 0, badHue.text);

  // 2. Create a channel with members and an icon. The lead is the first member.
  const created = await callFromChat("create", lead.id, "create_channel", {
    name: "launch",
    title: "Release work",
    instructions: "Ship the release.",
    memberAgentIds: [lead.id, tester.id],
    icon: { name: "megaphone", hue: 30 },
  });
  pass("Creating a channel succeeds", created.success, created.text);
  const channelId = resultChannelId(created.text);
  const made = channelOf(channelId);
  pass(
    "The new channel has the name, members, lead and icon",
    made.name === "launch" &&
      made.title === "Release work" &&
      made.instructions === "Ship the release." &&
      memberIds(channelId).join() === [lead.id, tester.id].join() &&
      made.leadAgentId === lead.id &&
      made.icon?.name === "megaphone" &&
      made.icon.hue === 30 &&
      !made.imageUrl &&
      !made.archived,
    JSON.stringify(made),
  );
  pass(
    "list_channels shows the new channel",
    channels()
      .handoffTargets()
      .some((target) => target.id === channelId),
  );

  // 3. Rename, add and remove members, change the lead, and set an image in one call.
  const updated = await callFromChat("update", lead.id, "update_channel", {
    channelId,
    name: "release",
    addMemberAgentIds: [writer.id],
    removeMemberAgentIds: [tester.id],
    leadAgentId: writer.id,
    imagePath,
  });
  const changed = channelOf(channelId);
  pass(
    "The update changes the name, members, lead and image",
    updated.success &&
      changed.name === "release" &&
      changed.instructions === "Ship the release." &&
      memberIds(channelId).join() === [lead.id, writer.id].join() &&
      changed.leadAgentId === writer.id &&
      Boolean(changed.imageUrl),
    updated.text,
  );
  pass("The result shows the image", updated.text.includes('"hasImage":true'), updated.text);

  // 4. An icon replaces the image, as in the channel settings.
  const iconAgain = await callFromChat("set an icon", lead.id, "update_channel", {
    channelId,
    icon: { name: "code", hue: 245 },
  });
  const withIcon = channelOf(channelId);
  pass(
    "An icon removes the image",
    iconAgain.success && withIcon.icon?.name === "code" && withIcon.icon.hue === 245 && !withIcon.imageUrl,
    iconAgain.text,
  );

  // 5. Removing the lead without a new one leaves no lead.
  const noLead = await callFromChat("remove the lead", lead.id, "update_channel", {
    channelId,
    removeMemberAgentIds: [writer.id],
  });
  pass(
    "Removing the lead clears the lead",
    noLead.success && channelOf(channelId).leadAgentId === null && memberIds(channelId).join() === lead.id,
    noLead.text,
  );

  // 6. Archive, then restore with a change.
  const archived = await callFromChat("archive", lead.id, "update_channel", { channelId, archived: true });
  pass("Archiving succeeds", archived.success && channelOf(channelId).archived, archived.text);
  pass(
    "list_channels shows the archived channel only with archived",
    !channels()
      .handoffTargets()
      .some((target) => target.id === channelId) &&
      channels()
        .handoffTargets(true)
        .some((target) => target.id === channelId),
  );
  const refusedRestore = await callFromChat("restore with a refused change", lead.id, "update_channel", {
    channelId,
    archived: false,
    leadAgentId: hidden.id,
  });
  pass(
    "A restore with a refused change leaves the channel archived",
    !refusedRestore.success && refusedRestore.text.includes("leadAgentId") && channelOf(channelId).archived,
    refusedRestore.text,
  );
  const extraKey = await callFromChat("list with an extra key", lead.id, "list_channels", { query: "release" });
  pass(
    "list_channels ignores a key it does not know",
    extraKey.success && extraKey.text.includes('"channels"'),
    extraKey.text,
  );
  const restored = await callFromChat("restore", lead.id, "update_channel", {
    channelId,
    archived: false,
    title: "Back again",
  });
  pass(
    "Restoring with a change succeeds",
    restored.success && !channelOf(channelId).archived && channelOf(channelId).title === "Back again",
    restored.text,
  );
  const unknown = await callFromChat("update an unknown channel", lead.id, "update_channel", {
    channelId: randomUUID(),
    name: "x",
  });
  pass("An unknown channel is refused", !unknown.success && unknown.text.includes("list_channels"), unknown.text);

  // 7. A channel task cannot use the tools: there, only a person's request changes the channel.
  const before = toolLogs().length;
  await runCauseEffect(
    channels().command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId,
        text: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "update_channel", channelId, name: "taken" })}ARGS>>`,
        recipientAgentId: lead.id,
        replyToMessageId: null,
        attachmentDraftIds: [],
      },
      PERSON,
    ),
  );
  const inTask = await logged("update from a channel task", before);
  await waitFor("the channel tasks to end", () =>
    channels()
      .store.tasks(channelId)
      .every((task) => !["queued", "running", "waiting"].includes(task.state)),
  );
  pass(
    "A channel task cannot use update_channel",
    !inTask.success && inTask.text.includes("only in your own chats") && channelOf(channelId).name === "release",
    inTask.text,
  );

  // 7b. A routine run can carry text from outside, such as a webhook body, so it cannot use the tools.
  const beforeRun = toolLogs().length;
  const countBeforeRun = channelCount();
  const runner = agents.createRoutine({
    agentId: lead.id,
    name: "Injected",
    instruction: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "create_channel", name: "from-run", memberAgentIds: [lead.id] })}ARGS>>`,
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  await runCauseEffect(agents.testRoutine({ agentId: lead.id, routineId: runner.id }));
  const fromRun = await logged("create from a routine run", beforeRun);
  await idle(lead.id);
  pass(
    "A routine run cannot use create_channel",
    !fromRun.success && fromRun.text.includes("Only a person's message") && channelCount() === countBeforeRun,
    fromRun.text,
  );

  // 7c. A team member's message is refused: the Team API checks that member's agent access.
  const fromMember = await callFromChat(
    "create from a team member",
    lead.id,
    "create_channel",
    { name: "from-member", memberAgentIds: [lead.id] },
    MEMBER,
  );
  pass(
    "A team member's message cannot use create_channel",
    !fromMember.success && fromMember.text.includes("Only a person's message") && channelCount() === countBeforeRun,
    fromMember.text,
  );

  // 8. A repeated tool call makes one channel and gives the same result.
  const params = {
    threadId: "retry-thread",
    turnId: "retry-turn",
    callId: "retry-call",
    namespace: "openbot",
    tool: "create_channel",
    arguments: { name: "retry", memberAgentIds: [lead.id, writer.id], icon: { name: "star", hue: 55 } },
  };
  const dependencies = { channels: channels(), listAgents: () => agents.listAgents() };
  const first = await runCauseEffect(handleChannelAgentTool(params, lead.id, dependencies));
  const count = channelCount();
  // The user hides a member between the attempts: the retry still finds the first result.
  await runCauseEffect(agents.setAgentHidden({ agentId: writer.id, hidden: true }));
  const second = await runCauseEffect(handleChannelAgentTool(params, lead.id, dependencies));
  const firstText = first.contentItems.map((item) => ("text" in item ? item.text : "")).join();
  const secondText = second.contentItems.map((item) => ("text" in item ? item.text : "")).join();
  pass(
    "A repeated call makes one channel, also after a member is hidden",
    first.success &&
      second.success &&
      channelCount() === count &&
      resultChannelId(firstText) === resultChannelId(secondText),
    secondText,
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
