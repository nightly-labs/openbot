import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentEvent } from "@openbot/contracts/ipc";
import { uiBlockAnswersFromResponse } from "@openbot/contracts/ui-blocks";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-channel-create-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-create-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

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
const { API_KEY_FIELD_ID, API_KEY_SCOPE_FIELD_ID, apiKeyFormSpec } = await import("../src/backend/agent/prompts");
const { AgentApiKeys } = await import("../src/backend/agent-api-keys");
const { VaultService } = await import("../src/main/vault-service");
const { VaultStore } = await import("../src/main/vault-store");

const CALL_MARK = "CHANNEL-CALL";
const PERSON = { id: "local", name: "Alex" };
const MEMBER = { id: "member-remote", name: "Sam" };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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
  query?: string;
  hue?: number;
  key?: string;
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
const vault = new VaultService({
  store: new VaultStore(join(root, "openbot-vault.json"), {
    encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
    decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
  }),
  canPersist: () => true,
});
await Effect.runPromise(vault.load());
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
  vaultItems: vault.items,
  agentApiKeys: new AgentApiKeys(join(root, "api-keys"), vault.items),
});
const prompts: Extract<AgentEvent, { type: "prompt" }>[] = [];
agents.on("event", (event) => {
  if (event.type === "prompt") prompts.push(event);
});

const channels = () => agents.channels;
const channelOf = (channelId: string) => channels().store.get(channelId);
const memberIds = (channelId: string) => channelOf(channelId).members.map((member) => member.agentId);

function idle(agentId: string) {
  return waitFor("the chat turn to end", () =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
}

async function logged(name: string, before: number) {
  const entry = await waitFor(`${name} tool result`, () => toolLogs()[before]);
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, text });
  return { success: entry.result?.success === true, text };
}

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

  const channelCount = () => channels().store.ids().length;
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
  const miscopied = await callFromChat("create with a miscopied member id", lead.id, "create_channel", {
    name: "launch",
    memberAgentIds: [lead.id, tester.id.slice(0, -1)],
  });
  pass(
    "A miscopied member id names the near agent and creates no channel",
    !miscopied.success &&
      miscopied.text.includes(tester.id) &&
      miscopied.text.includes(tester.name) &&
      channelCount() === 0,
    miscopied.text,
  );
  const misplacedHue = await callFromChat("create with a hue outside icon", lead.id, "create_channel", {
    name: "launch",
    memberAgentIds: [lead.id],
    hue: 30,
  });
  pass(
    "A field that create_channel does not take is refused with the fields that it takes",
    !misplacedHue.success &&
      misplacedHue.text.includes("Remove the fields that create_channel does not take. It takes: name,") &&
      misplacedHue.text.includes("icon") &&
      !misplacedHue.text.includes("profile") &&
      channelCount() === 0,
    misplacedHue.text,
  );

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
  const listed = await callFromChat("list", lead.id, "list_channels", {});
  pass(
    "list_channels shows the instructions of the new channel",
    listed.success && listed.text.includes('"instructions":"Ship the release."'),
    listed.text,
  );
  pass(
    "list_channels shows the new channel",
    channels()
      .handoffTargets()
      .some((target) => target.id === channelId),
  );

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

  const noLead = await callFromChat("remove the lead", lead.id, "update_channel", {
    channelId,
    removeMemberAgentIds: [writer.id],
  });
  pass(
    "Removing the lead clears the lead",
    noLead.success && channelOf(channelId).leadAgentId === null && memberIds(channelId).join() === lead.id,
    noLead.text,
  );

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

  const fromChannel = async (
    name: string,
    tool: string,
    args: ChannelToolArgs,
    sender: { id: string; name: string },
    rawArgs?: string,
    beforeResult?: () => Promise<void>,
  ) => {
    const before = toolLogs().length;
    await runCauseEffect(
      channels().command(
        {
          type: "send",
          operationId: randomUUID(),
          channelId,
          text: `${CALL_MARK} <<ARGS${rawArgs ?? JSON.stringify({ __tool: tool, ...args })}ARGS>>`,
          recipientAgentId: lead.id,
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        sender,
      ),
    );
    await beforeResult?.();
    const result = await logged(name, before);
    await waitFor("the channel tasks to end", () =>
      channels()
        .store.tasks(channelId)
        .every((task) => !["queued", "running", "waiting"].includes(task.state)),
    );
    return result;
  };
  const ownChannel = await fromChannel(
    "update the task's own channel",
    "update_channel",
    { channelId, name: "taken" },
    PERSON,
  );
  pass(
    "A channel task cannot change its own channel with update_channel",
    !ownChannel.success && ownChannel.text.includes("channel_add_member") && channelOf(channelId).name === "release",
    ownChannel.text,
  );
  const countBeforeTask = channelCount();
  const createdInTask = await fromChannel(
    "create from a channel task",
    "create_channel",
    { name: "training", memberAgentIds: [lead.id, tester.id] },
    PERSON,
  );
  const trainingId = createdInTask.success ? resultChannelId(createdInTask.text) : "";
  pass(
    "A channel task that the user started creates a channel",
    createdInTask.success &&
      channelCount() === countBeforeTask + 1 &&
      memberIds(trainingId).join() === [lead.id, tester.id].join(),
    createdInTask.text,
  );
  const updatedInTask = await fromChannel(
    "update another channel from a channel task",
    "update_channel",
    { channelId: trainingId, addMemberAgentIds: [writer.id], title: "Onboarding" },
    PERSON,
  );
  pass(
    "A channel task that the user started changes another channel",
    updatedInTask.success &&
      memberIds(trainingId).includes(writer.id) &&
      channelOf(trainingId).title === "Onboarding" &&
      channelOf(channelId).name === "release",
    updatedInTask.text,
  );
  const memberInTask = await fromChannel(
    "create from a team member's channel request",
    "create_channel",
    { name: "from-member-task", memberAgentIds: [lead.id] },
    MEMBER,
  );
  pass(
    "A team member's channel request cannot use create_channel",
    !memberInTask.success &&
      memberInTask.text.includes("this computer's user") &&
      channelCount() === countBeforeTask + 1,
    memberInTask.text,
  );

  const vaultKey = (name: string) => vault.items.apiKeys(lead.id).find((key) => key.name === name)?.value;
  const pastedKey = "e2e-channel-key-6369-a1";
  const saved = await fromChannel(
    "save a key from the user's channel request",
    "save_api_key",
    { name: "CHANNEL_TOKEN", key: pastedKey },
    PERSON,
  );
  pass(
    "A key in the user's channel request goes to the Vault",
    saved.success && vaultKey("CHANNEL_TOKEN") === pastedKey && !saved.text.includes(pastedKey),
    saved.text,
  );
  const notInRequest = await fromChannel(
    "save a key that the request does not hold",
    "save_api_key",
    {},
    PERSON,
    '{"__tool":"save_api_key","name":"CHANNEL_TOKEN","key":"e2e-other-\\u0041-6369"}',
  );
  pass(
    "A key that is not in the user's channel request is refused, and the agent gets the form tool",
    !notInRequest.success && notInRequest.text.includes("request_api_key") && vaultKey("CHANNEL_TOKEN") === pastedKey,
    notInRequest.text,
  );
  const partOfToken = await fromChannel(
    "save a part of a token in the request",
    "save_api_key",
    {},
    PERSON,
    '{"__tool":"save_api_key","name":"CHANNEL_TOKEN","key":"e2e-chann\\u0065l-key","notes":"from e2e-channel-key-6369-zz"}',
  );
  const shortKey = await fromChannel(
    "save a short word of the request",
    "save_api_key",
    { name: "CHANNEL_TOKEN", key: "short" },
    PERSON,
  );
  pass(
    "A part of a token or a short word of the user's channel request is refused",
    !partOfToken.success &&
      !shortKey.success &&
      shortKey.text.includes("request_api_key") &&
      vaultKey("CHANNEL_TOKEN") === pastedKey,
    `${partOfToken.text}\n${shortKey.text}`,
  );
  const memberKey = await fromChannel(
    "save a key from a team member's channel request",
    "save_api_key",
    { name: "CHANNEL_TOKEN", key: "e2e-member-key-6369" },
    MEMBER,
  );
  pass(
    "A team member's channel request cannot save a key to the Vault",
    !memberKey.success && memberKey.text.includes("request_api_key") && vaultKey("CHANNEL_TOKEN") === pastedKey,
    memberKey.text,
  );
  const replaced = await fromChannel(
    "replace a saved key from the user's channel request",
    "save_api_key",
    { name: "CHANNEL_TOKEN", key: "e2e-channel-key-6369-new" },
    PERSON,
  );
  pass(
    "A channel request cannot replace a saved key",
    !replaced.success && replaced.text.includes("saved already") && vaultKey("CHANNEL_TOKEN") === pastedKey,
    replaced.text,
  );
  const envKey = "e2e-env-key-6369-c3";
  const fromEnvLine = await fromChannel(
    "save a key from a NAME=value line",
    "save_api_key",
    {},
    PERSON,
    '{"__tool":"save_api_key","name":"ENV_TOKEN","key":"e2e-env-k\\u0065y-6369-c3","notes":"ENV_TOKEN=e2e-env-key-6369-c3"}',
  );
  pass(
    "A key after NAME= in the user's channel request goes to the Vault",
    fromEnvLine.success && vaultKey("ENV_TOKEN") === envKey,
    fromEnvLine.text,
  );
  const formArgs = { name: "FORM_TOKEN", title: "Form token" };
  const formKey = "e2e-form-key-6369-b2";
  const promptsBefore = prompts.length;
  const fromForm = await fromChannel(
    "request a key in a channel task",
    "request_api_key",
    formArgs,
    PERSON,
    undefined,
    async () => {
      const prompt = await waitFor("the key form", () =>
        prompts.slice(promptsBefore).find((item) => item.agentId === lead.id),
      );
      const spec = apiKeyFormSpec({ ...formArgs, vault: true });
      assert.ok(spec?.type === "form", "the router would refuse this form");
      const scope = spec.fields?.find((field) => field.id === API_KEY_SCOPE_FIELD_ID)?.value;
      const values = {
        [API_KEY_FIELD_ID]: formKey,
        ...(scope === undefined ? {} : { [API_KEY_SCOPE_FIELD_ID]: scope }),
      };
      await runCauseEffect(
        agents.respondToPrompt({
          requestId: prompt.requestId,
          answers: uiBlockAnswersFromResponse(spec, { actionId: "submit", values }),
        }),
      );
    },
  );
  pass(
    "request_api_key shows its form in a channel task, and the answer saves the key to the Vault",
    fromForm.success && vaultKey("FORM_TOKEN") === formKey && !fromForm.text.includes(formKey),
    fromForm.text,
  );

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

  const params = {
    threadId: "retry-thread",
    turnId: "retry-turn",
    callId: "retry-call",
    namespace: "openbot",
    tool: "create_channel",
    arguments: { name: "retry", memberAgentIds: [lead.id, writer.id], icon: { name: "star", hue: 55 } },
  };
  const dependencies = { channels: channels(), listAgents: () => agents.listAgents(), decodeAvatar: null };
  const first = await runCauseEffect(handleChannelAgentTool(params, lead.id, dependencies));
  const count = channelCount();
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

  const hiddenMember = await callFromChat("create with a hidden agent", lead.id, "create_channel", {
    name: "night",
    memberAgentIds: [lead.id, hidden.id],
  });
  pass(
    "A hidden agent becomes a member",
    hiddenMember.success && memberIds(resultChannelId(hiddenMember.text)).includes(hidden.id),
    hiddenMember.text,
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
