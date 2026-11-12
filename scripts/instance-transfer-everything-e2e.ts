// Moves a whole setup between two OpenBot profiles with the real transfer service and checks what
// arrives. Two real agent services run on temporary profiles with a fake Codex app-server.
//
// The source has two agents with memories, routines, a chat with a file, a side thread made by a
// branch, settings that only restrict, and a channel with both agents, a lead, a memory and a routine.
// It also has two hidden agents with active routines: one stays as written, and the file of the other
// is changed to the file of an app that stopped a hidden agent, so its routines arrive turned off.
// The export includes workspace files, server settings, chat history, channel messages and the
// server preferences, one of which is changed to a value the import does not accept. A second export
// has the chats without the channel messages. The import goes into the second profile. The check asserts the agents, memories, routines, settings, the channel, the chat
// messages in order with the file's bytes, the side thread, and that the first turn of an imported
// agent gets the imported history. It also checks that `Shared/Transfers` is not copied as files.
// `bun scripts/instance-transfer-everything-e2e.ts`. Writes .openbot-build/instance-transfer-everything-e2e/report.json.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentDefaults,
  type AgentEvent,
  type AgentMemoryLimit,
  type AgentSummary,
  type BusyMessageMode,
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_MACHINE_ALERT_SETTINGS,
  type MachineAlertSettings,
  type MemoryReviewInterval,
  type PromptCacheTtl,
  type ResponseStyle,
  type ServerNotificationLevel,
  type SkillLearningMode,
  type UpdateHostIdentityInput,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/instance-transfer-everything-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-transfer-everything-"));
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");
const home = join(root, "home");

// Before the service modules load: the Codex process reads these.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { HISTORY_IMPORTED_EVENT } = await import("../src/backend/agent-history-transfer");
const { InstanceTransferService } = await import("../src/main/instance-transfer-service");
type MemberPreferences<Id> = import("../src/main/instance-transfer-service").MemberPreferences<Id>;
const { INSTANCE_TRANSFER_MANIFEST } = await import("../src/main/instance-transfer-manifest");
const { LocalSkillLibrary } = await import("../src/main/local-skill-library");
const { WorkflowStore } = await import("../src/backend/workflows/workflow-store");
const { workflowScheduleDueAt } = await import("../src/backend/workflows/workflow-triggers");
const { HostEventsService } = await import("../src/main/host-events-service");

const HISTORY_MARK = "the blue notebook is on the second shelf";

/** A Codex app-server that answers each turn with "Done." and logs what each turn starts with. */
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
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
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
    case "thread/start":
      appendFileSync(LOG, JSON.stringify({ method: "thread/start", params }) + "\\n");
      return write({ id: message.id, result: { thread: { id: "thread-" + process.pid + "-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      appendFileSync(LOG, JSON.stringify({ method: "turn/start", params }) + "\\n");
      const turnId = "turn-" + process.pid + "-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      return setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 20);
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
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

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

const report: {
  checks: { name: string; passed: boolean; detail?: string }[];
  exportWarnings?: string[];
  importWarnings?: string[];
  archiveEntries?: number;
  passed: boolean;
  error?: string;
} = { checks: [], passed: false };

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition, ...(detail ? { detail } : {}) });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
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

function codexLog(): Array<{ method: string; params: unknown }> {
  try {
    return readFileSync(fakeLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/** One OpenBot profile: its database, stores, agent service and transfer service. */
function profile(name: string) {
  const userData = join(root, name, "user-data");
  const profileHome = join(root, name, "home");
  mkdirSync(profileHome, { recursive: true });
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, profileHome, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    timezone: () => "UTC",
  });
  const library = new LocalSkillLibrary(join(userData, "local-skills"), () => agents.listAgents());
  const workflows = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") });
  const events = new HostEventsService({
    routines: agents.routineRecords,
    cipher: {
      encrypt: (value) => Buffer.from(`sealed:${Buffer.from(value).toString("base64")}`),
      decrypt: (value) => Buffer.from(value.toString().slice("sealed:".length), "base64").toString(),
    },
    relay: {
      connected: () => true,
      setEnabled: () => {},
      setAccountActive: () => {},
      refresh: () => {},
      ensureHost: () => Effect.void,
      registerRoute: (routeId) => Effect.succeed(`https://signal.example.test/v1/webhooks/${routeId}`),
      revokeRoute: () => Effect.void,
    },
    accountPrincipal: () => "account-1",
  });
  const positions = new Map<string, { nodeKey: string; x: number; y: number }[]>();
  const pins = new Set<string>();
  const levels = new Map<string, "all" | "needs-me" | "nothing">();
  const approvals = new Map<string, boolean>();
  // The host-wide preferences, as the Server settings stores keep them.
  const serverPreferences: {
    timezone: string | null;
    personality: { responseStyle: ResponseStyle };
    busyMessageMode: { mode: BusyMessageMode };
    agentDefaults: AgentDefaults;
    memoryLimit: { limit: AgentMemoryLimit };
    memoryReview: { interval: MemoryReviewInterval };
    skillLearning: { mode: SkillLearningMode };
    promptCacheTtl: PromptCacheTtl;
    ownerNotificationLevel: ServerNotificationLevel | null;
    browsingMemory: { enabled: boolean };
    claudeUserSetup: boolean;
    claudeCompactWindow: number | null;
    machineAlerts: MachineAlertSettings;
    modelVisibility: { provider: string; hidden: string[] }[];
  } = {
    timezone: null,
    personality: { responseStyle: "natural" },
    busyMessageMode: { mode: "queue" },
    agentDefaults: DEFAULT_AGENT_DEFAULTS,
    memoryLimit: { limit: 128 },
    memoryReview: { interval: 0 },
    skillLearning: { mode: "automatic" },
    promptCacheTtl: "5m",
    ownerNotificationLevel: null,
    browsingMemory: { enabled: true },
    claudeUserSetup: false,
    claudeCompactWindow: null,
    machineAlerts: DEFAULT_MACHINE_ALERT_SETTINGS,
    modelVisibility: [],
  };
  // The server's name and logo, as Server settings > General keeps them.
  const identity: {
    name: string;
    logo: { path: string; mimeType: "image/png" } | null;
    saved: UpdateHostIdentityInput[];
  } = {
    name: `Newsroom ${name}`,
    logo: null,
    saved: [],
  };
  // Members' choices by account. Each server has its own member ids for the same accounts.
  const members = new Map<string, MemberPreferences<string>>();
  /** One preference of the in-memory server settings, as the transfer port reads and writes it. */
  const preference = <K extends keyof typeof serverPreferences>(key: K) => ({
    get: () => serverPreferences[key],
    set: (value: (typeof serverPreferences)[K]) =>
      Effect.sync(() => {
        serverPreferences[key] = value;
      }),
  });
  const transfer = new InstanceTransferService({
    agents,
    skills: { library: () => library, installLocal: () => Effect.void },
    sharedSkills: {
      list: () =>
        library
          .list()
          .pipe(Effect.map((list) => list.map(({ id, slug, name, version }) => ({ id, slug, name, version })))),
      // No agent of the check installs a library skill, so each one counts as shared.
      assigned: () => Effect.succeed(new Set<string>()),
      bundle: (id, version) => library.bundle(id, version),
      add: (bytes) => library.createFromBundle(bytes),
    },
    sharedRoot: store.sharedRoot,
    channelActor: () => ({ id: "local", name: "You" }),
    webhookRoutines: {
      list: (owner) => events.listRoutines({ owner }),
      save: (input) => events.saveRoutine(input),
    },
    preferences: {
      notificationLevel: (agentId) => levels.get(agentId) ?? null,
      setNotificationLevel: (agentId, level) => Effect.sync(() => levels.set(agentId, level)),
      pinned: (agentId) => pins.has(agentId),
      pin: (agentId) => Effect.sync(() => pins.add(agentId)),
      autoApproves: (agentId) => approvals.get(agentId) ?? true,
      setAutoApprove: (agentId, value) => Effect.sync(() => approvals.set(agentId, value)),
      apiKeyNames: () => Effect.succeed(["WEATHER_API_KEY"]),
    },
    serverPreferences: {
      timezone: preference("timezone"),
      personality: preference("personality"),
      busyMessageMode: preference("busyMessageMode"),
      agentDefaults: preference("agentDefaults"),
      memoryLimit: preference("memoryLimit"),
      memoryReview: preference("memoryReview"),
      skillLearning: preference("skillLearning"),
      promptCacheTtl: preference("promptCacheTtl"),
      ownerNotificationLevel: preference("ownerNotificationLevel"),
      browsingMemory: preference("browsingMemory"),
      claudeUserSetup: preference("claudeUserSetup"),
      claudeCompactWindow: preference("claudeCompactWindow"),
      machineAlerts: preference("machineAlerts"),
      modelVisibility: preference("modelVisibility"),
    },
    memberPreferences: {
      read: () => [...members.values()],
      apply: (preferences) =>
        Effect.sync(() => {
          const member = members.get(preferences.accountId);
          if (!member) return false;
          members.set(preferences.accountId, {
            ...member,
            server: preferences.server,
            agents: [...member.agents, ...preferences.agents],
            pins: [...member.pins, ...preferences.pins],
          });
          return true;
        }),
    },
    serverIdentity: {
      read: () => ({ name: identity.name, logo: identity.logo }),
      save: (input) =>
        Effect.sync(() => {
          identity.saved.push(input);
          if (input.serverName) identity.name = input.serverName;
        }),
    },
    appVersion: "e2e",
    timezone: () => "UTC",
    settings: {
      mcpServers: () => [],
      saveMcpServer: () => Effect.void,
      customProviders: () => [],
      saveCustomProvider: () => Effect.void,
      customAgents: () => Effect.succeed([]),
      providersOff: () => AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
      sidebar: () => ({ revision: 0, sections: [], order: [], agentAssignments: {}, agentOrder: [] }),
      mutateSidebar: () => Effect.die("The check has no sidebar sections."),
      routineFlowLinks: () => Effect.succeed([]),
      connectRoutineFlow: () => Effect.die("The check has no routine flows."),
      routineFlowPositions: (agentId) => Effect.succeed(positions.get(agentId) ?? []),
      saveRoutineFlowPosition: (input) =>
        Effect.sync(() =>
          positions.set(input.agentId, [
            ...(positions.get(input.agentId) ?? []),
            { nodeKey: input.nodeKey, x: input.x, y: input.y },
          ]),
        ),
      workflows: {
        workflows: () =>
          Effect.sync(() => workflows.listWithGraphs().map(({ summary, graph }) => ({ title: summary.title, graph }))),
        createWorkflow: (input) => Effect.try(() => workflows.create(input)),
      },
      signedInProviders: () => [],
    },
  });
  return {
    database,
    store,
    mailbox,
    agents,
    transfer,
    pins,
    levels,
    approvals,
    workflows,
    events,
    positions,
    serverPreferences,
    identity,
    library,
    members,
  };
}

function idle(agents: InstanceType<typeof AgentService>, agentId: string) {
  return waitFor("the turn to end", () =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

try {
  await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
  const source = profile("source");
  const target = profile("target");
  // A server that a released client imports into: "Import server settings" without the new flag.
  const released = profile("released");
  await runCauseEffect(source.agents.initialize());
  await runCauseEffect(target.agents.initialize());
  await runCauseEffect(released.agents.initialize());

  // --- The source setup.
  const create = (name: string) =>
    runCauseEffect(
      source.agents.createAgentProfile({
        name,
        description: `${name} agent.`,
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
      }),
    );
  const writer = await create("Writer");
  const editor = await create("Editor");
  source.agents.createMemory({ agentId: writer.id, text: "The user writes in British English." });
  const routine = source.agents.createRoutine({
    agentId: writer.id,
    name: "Morning notes",
    instruction: "Summarise yesterday's notes.",
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "08:00" },
  });
  await runCauseEffect(source.agents.updateAgent({ agentId: editor.id, computerUse: false, allowAutomation: true }));
  // Two hidden agents with an active routine each. The file of the first one is changed below to the
  // file of an app that stopped a hidden agent.
  const archivist = await create("Archivist");
  const keeper = await create("Keeper");
  for (const agent of [archivist, keeper]) {
    source.agents.createRoutine({
      agentId: agent.id,
      name: "Night backup",
      instruction: "Back up the notes.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "02:00" },
    });
    await runCauseEffect(source.agents.setAgentHidden({ agentId: agent.id, hidden: true }));
  }
  await runCauseEffect(
    source.events.saveRoutine({
      owner: { kind: "agent", id: archivist.id },
      name: "Backup alarm",
      instruction: "Check the backup.",
      active: true,
      timezone: "UTC",
      trigger: { kind: "webhook", eventType: "backup.failed", filters: [] },
    }),
  );
  source.pins.add(writer.id);
  source.levels.set(writer.id, "needs-me");
  source.approvals.set(editor.id, false);

  // A real chat turn with a file, then a branch of it as a side thread.
  const notePath = join(root, "shelf-note.txt");
  const noteBytes = new TextEncoder().encode(`Note: ${HISTORY_MARK}.\n`);
  await writeFile(notePath, noteBytes);
  const drafts = await runCauseEffect(source.mailbox.prepareAttachments([notePath]));
  await runCauseEffect(
    source.agents.sendMessage({
      agentId: writer.id,
      text: `Remember: ${HISTORY_MARK}.`,
      attachmentDraftIds: drafts.map((draft) => draft.id),
    }),
  );
  await idle(source.agents, writer.id);
  // A test run of the writer's routine, which leaves a finished run and its messages in the chat.
  const sourceRun = await runCauseEffect(source.agents.testRoutine({ agentId: writer.id, routineId: routine.id }));
  await idle(source.agents, writer.id);
  const finishedRun = await waitFor("the test run to finish", () =>
    source.agents
      .listRoutineRuns({ agentId: writer.id, routineId: routine.id }, true)
      .find(
        (run) => run.id === sourceRun.id && ["succeeded", "failed", "interrupted", "cancelled"].includes(run.status),
      ),
  );
  const sourceHistory = source.agents.readTransferHistory(writer.id);
  const sourceMain = sourceHistory.find((thread) => thread.main);
  assert.ok(sourceMain, "The source chat has no messages.");
  const answer = sourceMain.messages.findLast((message) => message.author === "assistant");
  assert.ok(answer, "The source chat has no answer.");
  await runCauseEffect(
    source.agents.branchTask(
      { agentId: writer.id, taskId: null, messageId: answer.id, requestId: randomUUID() },
      "local",
    ),
  );
  const sourceThreads = source.agents.readTransferHistory(writer.id);
  pass("source has its chat and a side thread", sourceThreads.length === 2, `${sourceThreads.length} chats`);

  const channel = await runCauseEffect(
    source.agents.channels.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId: randomUUID(),
        draft: {
          name: "Newsroom",
          title: "Daily paper",
          instructions: "Write and edit the daily paper.",
          members: [{ agentId: writer.id }, { agentId: editor.id }],
          leadAgentId: editor.id,
          isolated: true,
          icon: { name: "book", hue: 210 },
        },
      },
      { id: "local", name: "You" },
    ),
  );
  // A database can keep channel instructions from before the 2,000-character limit (#5929).
  const longDesk = await runCauseEffect(
    source.agents.channels.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId: randomUUID(),
        draft: {
          name: "Long desk",
          title: "",
          instructions: "Short.",
          members: [{ agentId: writer.id }],
          leadAgentId: null,
        },
      },
      { id: "local", name: "You" },
    ),
  );
  source.agents.channels.store.update({ ...longDesk, instructions: "x".repeat(2_500) });
  source.agents.createChannelMemory({ channelId: channel.id, text: "Headlines stay under ten words." });
  source.agents.createChannelRoutine({
    channelId: channel.id,
    name: "Evening edition",
    instruction: "Plan the evening edition.",
    active: true,
    timezone: "UTC",
    schedule: { kind: "daily", time: "17:00" },
  });

  // A real message with a file in the channel, which an agent answers.
  const layoutPath = join(root, "front-page-layout.txt");
  const layoutBytes = new TextEncoder().encode("Lead story left, weather right.\n");
  await writeFile(layoutPath, layoutBytes);
  const channelDrafts = await runCauseEffect(source.mailbox.prepareAttachments([layoutPath]));
  await runCauseEffect(
    source.agents.channels.command(
      {
        type: "send",
        operationId: randomUUID(),
        channelId: channel.id,
        text: "Plan the front page.",
        // To one member, so no routing turn runs.
        recipientAgentId: writer.id,
        replyToMessageId: null,
        attachmentDraftIds: channelDrafts.map((draft) => draft.id),
      },
      { id: "local", name: "You" },
    ),
  );
  const sourceChannelMessages = await waitFor("an agent answer in the channel", () => {
    const messages = source.agents.channels.store.messages(channel.id);
    return messages.some((entry) => entry.author.kind === "agent" && entry.message.status === "completed") && messages;
  });

  // A routine that a webhook starts, and the places of the routines on the writer's canvas.
  const hooked = await runCauseEffect(
    source.events.saveRoutine({
      owner: { kind: "agent", id: writer.id },
      name: "Breaking news",
      instruction: "Write a short item.",
      active: true,
      timezone: "UTC",
      trigger: { kind: "webhook", eventType: "news.breaking", filters: [] },
    }),
  );
  source.positions.set(writer.id, [
    { nodeKey: `routine:${routine.id}`, x: 120, y: 40 },
    { nodeKey: `routine:${hooked.routine.id}`, x: 320, y: 40 },
    { nodeKey: `agent:${editor.id}`, x: 520, y: 40 },
  ]);

  // A workflow with an agent step, a channel output, a Slack trigger and a webhook trigger.
  const at = { x: 0, y: 0 };
  source.workflows.create({
    title: "Paper pipeline",
    graph: {
      nodes: [
        { id: "hook", kind: "trigger", at, fields: { trigger: "webhook" } },
        {
          id: "slack",
          kind: "trigger",
          at,
          fields: { trigger: "slack", connectionId: "messaging-1", event: "message" },
        },
        { id: "write", kind: "agent", at, fields: { agentId: writer.id, task: "Write it." } },
        { id: "post", kind: "output", at, fields: { target: "chat-channel", channelId: channel.id } },
      ],
      edges: [
        { id: "e1", from: "hook", to: "write", type: "text" },
        { id: "e2", from: "write", to: "post", type: "text" },
      ],
      strokes: [],
    },
  });

  // --- Server preferences that differ from a new server's.
  Object.assign(source.serverPreferences, {
    timezone: "Europe/Warsaw",
    personality: { responseStyle: "classic" },
    busyMessageMode: { mode: "steer" },
    agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, commitCoAuthor: !DEFAULT_AGENT_DEFAULTS.commitCoAuthor },
    memoryLimit: { limit: 256 },
    memoryReview: { interval: 20 },
    skillLearning: { mode: "ask" },
    promptCacheTtl: "1h",
    ownerNotificationLevel: "needs-me",
    browsingMemory: { enabled: false },
    claudeUserSetup: true,
    claudeCompactWindow: 400_000,
    // The member who gets the alerts belongs to the old server; the import gives them to the owner.
    machineAlerts: { diskPercent: 70, memoryPercent: 75, cpuPercent: 80, responsibleMemberId: "member-on-old-server" },
    modelVisibility: [{ provider: "codex", hidden: ["gpt-old-model"] }],
  } satisfies typeof source.serverPreferences);

  // Shared skills that no agent has. The target already has one with the same name and other files.
  const fflate = await import("fflate");
  const skillBundle = (name: string, body: string) =>
    fflate.zipSync({
      "SKILL.md": fflate.strToU8(`---\nname: ${name}\ndescription: ${name} for the newsroom.\n---\n\n${body}\n`),
    });
  await runCauseEffect(source.library.createFromBundle(skillBundle("Style guide", "Use short headlines.")));
  await runCauseEffect(source.library.createFromBundle(skillBundle("Fact check", "Check two sources.")));
  await runCauseEffect(target.library.createFromBundle(skillBundle("Fact check", "Check one source.")));

  // A logo for the source server: a 1×1 PNG.
  const logoPath = join(root, "server-logo.png");
  const logoBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(logoPath, logoBytes);
  source.identity.logo = { path: logoPath, mimeType: "image/png" };

  // Two members with their choices. Only the first one has joined the target server, with no choices yet.
  source.members.set("account-ada", {
    accountId: "account-ada",
    server: "needs-me",
    agents: [{ agentId: editor.id, level: "nothing" }],
    pins: [
      { kind: "agent", id: writer.id },
      { kind: "channel", id: channel.id },
    ],
  });
  source.members.set("account-bob", { accountId: "account-bob", server: "all", agents: [], pins: [] });
  target.members.set("account-ada", { accountId: "account-ada", server: null, agents: [], pins: [] });

  // --- The chats without the channel messages: each part is chosen on its own.
  const chatsOnly = join(root, "chats-only.zip");
  await runCauseEffect(
    source.transfer.exportTo(chatsOnly, {
      agentIds: [writer.id, editor.id],
      includeFiles: false,
      includeSettings: false,
      includeHistory: true,
      includeChannelMessages: false,
    }),
  );
  {
    const { unzipSync } = await import("fflate");
    const entries = unzipSync(new Uint8Array(await readFile(chatsOnly)));
    const chatsManifest: {
      agents: { history?: string }[];
      channels?: { messages?: string[] }[];
      serverPreferences?: unknown;
    } = JSON.parse(new TextDecoder().decode(entries[INSTANCE_TRANSFER_MANIFEST]));
    pass(
      "a file without channel messages keeps the chats and the channel",
      chatsManifest.agents.some((agent) => agent.history) && (chatsManifest.channels?.length ?? 0) > 0,
    );
    pass(
      "a file without channel messages has none",
      (chatsManifest.channels ?? []).every((channel) => !channel.messages?.length) &&
        !Object.keys(entries).some((name) => /^channels\/[^/]+\/messages-/u.test(name)),
    );
    pass("a file without server preferences has none", chatsManifest.serverPreferences === undefined);
  }

  // --- Export everything.
  const file = join(root, "transfer.zip");
  const exported = await runCauseEffect(
    source.transfer.exportTo(file, {
      agentIds: [writer.id, editor.id, archivist.id, keeper.id],
      includeFiles: true,
      includeSettings: true,
      includeHistory: true,
      includeChannelMessages: true,
      includeServerPreferences: true,
    }),
  );
  report.exportWarnings = exported.warnings;
  const { unzipSync, zipSync } = await import("fflate");
  const archive = unzipSync(new Uint8Array(await readFile(file)));
  report.archiveEntries = Object.keys(archive).length;
  const manifestBytes = archive[INSTANCE_TRANSFER_MANIFEST];
  assert.ok(manifestBytes, "The file has no manifest.");
  const manifest: {
    agents: { name: string; preferences?: { hidden?: boolean; hiddenWorks?: boolean } }[];
    serverPreferences?: { timezone?: unknown; promptCacheTtl?: unknown; ownerNotificationLevel?: unknown };
  } = JSON.parse(new TextDecoder().decode(manifestBytes));
  pass(
    "the file has the server preferences",
    manifest.serverPreferences?.timezone === "Europe/Warsaw" &&
      manifest.serverPreferences.ownerNotificationLevel === "needs-me",
    JSON.stringify(manifest.serverPreferences),
  );
  // A value that this app does not accept is left out, and the other preferences are still saved.
  if (manifest.serverPreferences) manifest.serverPreferences.promptCacheTtl = "9h";
  const filePreferences = (name: string) => manifest.agents.find((agent) => agent.name === name)?.preferences;
  pass(
    "the file says that its hidden agents work",
    ["Archivist", "Keeper"].every(
      (name) => filePreferences(name)?.hidden === true && filePreferences(name)?.hiddenWorks === true,
    ),
    JSON.stringify([filePreferences("Archivist"), filePreferences("Keeper")]),
  );
  // An app that stopped a hidden agent wrote `hidden` only.
  delete filePreferences("Archivist")?.hiddenWorks;
  archive[INSTANCE_TRANSFER_MANIFEST] = new TextEncoder().encode(JSON.stringify(manifest));
  await writeFile(file, zipSync(archive));
  pass(
    "Shared/Transfers is not copied as files",
    !Object.keys(archive).some((name) => name.toLowerCase().startsWith("shared/transfers/")),
  );

  // --- Import into the second profile.
  const preview = await runCauseEffect(target.transfer.stage(file));
  pass("preview offers each agent", preview.agents.length === 4);
  // The open views read a channel again on each change that the channel service publishes.
  const published: { channelId: string; revision: number }[] = [];
  target.agents.on("event", (event: AgentEvent) => {
    if (event.type === "channels-changed") published.push({ channelId: event.channelId, revision: event.revision });
  });
  const result = await runCauseEffect(
    target.transfer.apply({
      token: preview.token,
      keys: preview.agents.map((agent) => agent.key),
      includeSettings: true,
      includeServerPreferences: true,
    }),
  );
  report.importWarnings = result.warnings;
  const releasedPreview = await runCauseEffect(released.transfer.stage(file));
  pass("the preview says that the file has server preferences", releasedPreview.hasServerPreferences === true);
  const releasedResult = await runCauseEffect(
    released.transfer.apply({
      token: releasedPreview.token,
      keys: releasedPreview.agents.filter((agent) => agent.name === "Editor").map((agent) => agent.key),
      includeSettings: true,
    }),
  );
  pass(
    "an import without server preferences, as a released client sends, replaces none of them",
    released.serverPreferences.timezone === null &&
      released.serverPreferences.personality.responseStyle === "natural" &&
      released.identity.saved.length === 0 &&
      !released.identity.name.endsWith("source") &&
      !releasedResult.warnings.some((warning) => warning.includes("server preference")),
    JSON.stringify({ timezone: released.serverPreferences.timezone, saved: released.identity.saved.length }),
  );
  const { promptCacheTtl: _ttl, ...movedPreferences } = {
    ...source.serverPreferences,
    machineAlerts: { ...source.serverPreferences.machineAlerts, responsibleMemberId: null },
  };
  const { promptCacheTtl: targetTtl, ...arrivedPreferences } = target.serverPreferences;
  pass(
    "the server preferences arrive",
    JSON.stringify(arrivedPreferences) === JSON.stringify(movedPreferences),
    JSON.stringify(target.serverPreferences),
  );
  pass("a server preference that is not valid is left out", targetTtl === "5m", targetTtl);
  const targetSkills = await runCauseEffect(target.library.list());
  const factCheck = targetSkills.filter((skill) => skill.slug === "fact-check");
  pass(
    "a shared skill that no agent has moves",
    targetSkills.some((skill) => skill.slug === "style-guide"),
    JSON.stringify(targetSkills.map((skill) => skill.slug)),
  );
  pass(
    "a shared skill with a name that is already here is not replaced",
    factCheck.length === 1 &&
      factCheck[0]?.version === 1 &&
      factCheck[0].instructions.includes("one source") &&
      result.warnings.some((warning) => warning.includes("Fact check")),
    JSON.stringify(factCheck.map((skill) => ({ version: skill.version, instructions: skill.instructions }))),
  );
  const savedIdentity = target.identity.saved.at(-1);
  pass(
    "the server name and logo arrive through the save of Server settings",
    target.identity.name === "Newsroom source" &&
      savedIdentity?.logo?.mimeType === "image/png" &&
      sha(savedIdentity.logo.bytes) === sha(logoBytes),
    JSON.stringify({ name: target.identity.name, saved: target.identity.saved.length }),
  );
  pass(
    "the import says that one server preference was left out",
    result.warnings.some((warning) => warning.includes("1 server preference")),
    JSON.stringify(result.warnings),
  );
  pass("each agent is imported", result.agents.length === 4 && result.skipped.length === 0);
  const byName = (name: string): AgentSummary => {
    const agent = target.agents.listAgents().find((candidate) => candidate.name === name);
    assert.ok(agent, `${name} is missing.`);
    return agent;
  };
  const newWriter = byName("Writer");
  const newRoutine = target.agents.listRoutines(newWriter.id).find((item) => item.name === "Morning notes");
  const newRuns = newRoutine
    ? target.agents.listRoutineRuns({ agentId: newWriter.id, routineId: newRoutine.id }, true)
    : [];
  const movedRun = newRuns.find((run) => run.createdAt === finishedRun.createdAt);
  pass(
    "the run history of a routine moves as finished runs with their times",
    movedRun !== undefined &&
      movedRun.id !== finishedRun.id &&
      movedRun.status === finishedRun.status &&
      movedRun.source === "test" &&
      movedRun.triggerId === null &&
      movedRun.deliveryId === null,
    JSON.stringify({ finishedRun, newRuns }),
  );
  const runMessages = target.agents
    .readTransferHistory(newWriter.id)
    .flatMap((thread) => thread.messages)
    .filter((message) => message.routine);
  pass(
    "the chat names the imported run and routine",
    runMessages.length > 0 &&
      runMessages.every(
        (message) => message.routine?.runId === movedRun?.id && message.routine?.routineId === newRoutine?.id,
      ),
    JSON.stringify(runMessages.map((message) => message.routine)),
  );
  const newEditor = byName("Editor");

  pass(
    "memories move",
    target.agents.listMemories(newWriter.id).some((memory) => memory.text === "The user writes in British English."),
  );
  pass(
    "routines move",
    target.agents.listRoutines(newWriter.id).some((item) => item.name === routine.name && item.active),
  );
  const newArchivist = byName("Archivist");
  const newKeeper = byName("Keeper");
  const hiddenIds = target.agents.listHiddenAgents().agents.map((agent) => agent.agentId);
  pass(
    "hidden agents stay hidden",
    hiddenIds.includes(newArchivist.id) && hiddenIds.includes(newKeeper.id) && !hiddenIds.includes(newWriter.id),
    JSON.stringify(hiddenIds),
  );
  pass(
    "the routine of a hidden agent that worked stays on",
    target.agents.listRoutines(newKeeper.id).some((item) => item.name === "Night backup" && item.active),
  );
  const archivistRoutines = [
    ...target.agents.listRoutines(newArchivist.id),
    ...(await runCauseEffect(target.events.listRoutines({ owner: { kind: "agent", id: newArchivist.id } }))).filter(
      (item) => item.trigger.kind === "webhook",
    ),
  ];
  pass(
    "the routines of a hidden agent that an older app stopped are added turned off",
    archivistRoutines.length === 2 && archivistRoutines.every((item) => !item.active),
    JSON.stringify(archivistRoutines.map((item) => ({ name: item.name, active: item.active }))),
  );
  const newHooked = (
    await runCauseEffect(target.events.listRoutines({ owner: { kind: "agent", id: newWriter.id } }))
  ).find((item) => item.name === "Breaking news");
  pass(
    "the webhook routine moves with its event type and a new address",
    newHooked?.trigger.kind === "webhook" &&
      newHooked.trigger.eventType === "news.breaking" &&
      hooked.routine.trigger.kind === "webhook" &&
      newHooked.trigger.url !== hooked.routine.trigger.url,
  );
  pass(
    "the user is told about the new webhook address",
    result.warnings.some((warning) => warning.includes("Breaking news") && warning.includes("webhook")),
  );
  const newRoutineId = target.agents.listRoutines(newWriter.id).find((item) => item.name === routine.name)?.id;
  pass(
    "canvas places point to the new routines and agent",
    JSON.stringify(target.positions.get(newWriter.id)) ===
      JSON.stringify([
        { nodeKey: `routine:${newRoutineId}`, x: 120, y: 40 },
        { nodeKey: `routine:${newHooked?.id}`, x: 320, y: 40 },
        { nodeKey: `agent:${newEditor.id}`, x: 520, y: 40 },
      ]),
    JSON.stringify(target.positions.get(newWriter.id)),
  );
  pass("a restriction moves: Computer Use off", newEditor.computerUse === false);
  pass("a permission does not move: Local scripts stay off", newEditor.allowAutomation !== true);
  pass(
    "the user is told to turn Local scripts on again",
    result.warnings.some((warning) => warning.includes("Local scripts")),
  );
  pass(
    "the pin and the notification level move",
    target.pins.has(newWriter.id) && target.levels.get(newWriter.id) === "needs-me",
  );
  pass("an approval choice that restricts moves", target.approvals.get(newEditor.id) === false);
  pass(
    "no approval warning when this computer already allows the agent",
    !result.warnings.some((warning) => warning.startsWith("Writer:") && warning.includes("always allowed")),
  );
  pass(
    "API key names are listed",
    result.warnings.some((warning) => warning.includes("WEATHER_API_KEY")),
  );

  const channels = target.agents.channels.store.ids().map((id) => target.agents.channels.store.get(id));
  const newChannel = channels.find((item) => item.name === "Newsroom");
  pass("the channel moves", newChannel !== undefined);
  const newLongDesk = channels.find((item) => item.name === "Long desk");
  pass(
    "a channel with long stored instructions moves with the first 2,000 characters and a warning",
    newLongDesk?.instructions.length === 2_000 &&
      exported.warnings.some((warning) => warning.startsWith("Long desk:") && warning.includes("2000")),
    JSON.stringify({ length: newLongDesk?.instructions.length, warnings: exported.warnings }),
  );
  assert.ok(newChannel);
  pass(
    "channel members and lead are the new agents",
    newChannel.members.length === 2 &&
      newChannel.members.every((member) => [newWriter.id, newEditor.id].includes(member.agentId)) &&
      newChannel.leadAgentId === newEditor.id,
  );
  pass("channel settings move", newChannel.isolated === true && newChannel.icon?.name === "book");
  pass(
    "channel memory moves",
    target.agents
      .listChannelMemories(newChannel.id)
      .some((memory) => memory.text === "Headlines stay under ten words."),
  );
  pass(
    "channel routine moves",
    target.agents.listChannelRoutines(newChannel.id).some((item) => item.name === "Evening edition"),
  );

  const ada = target.members.get("account-ada");
  pass(
    "a member's levels and pins go to the same account on the new server",
    ada?.server === "needs-me" &&
      ada.agents.length === 1 &&
      ada.agents[0]?.agentId === newEditor.id &&
      ada.agents[0]?.level === "nothing" &&
      ada.pins.some((pin) => pin.kind === "agent" && pin.id === newWriter.id) &&
      ada.pins.some((pin) => pin.kind === "channel" && pin.id === newChannel.id),
    JSON.stringify(ada),
  );
  pass("a member who is not on the new server gets nothing", !target.members.has("account-bob"));
  const newChannelMessages = target.agents.channels.store.messages(newChannel.id);
  const channelFile = newChannelMessages.flatMap((entry) => entry.message.attachments ?? []).at(0);
  const sourceChannelFile = sourceChannelMessages.flatMap((entry) => entry.message.attachments ?? []).at(0);
  const storedChannelFile = channelFile ? await runCauseEffect(target.mailbox.resolveAttachment(channelFile.id)) : null;
  pass(
    "the file of a channel message opens with the same bytes",
    storedChannelFile !== null &&
      channelFile?.id !== sourceChannelFile?.id &&
      sha(new Uint8Array(await readFile(storedChannelFile.path))) === sha(layoutBytes),
    JSON.stringify({ channelFile, sourceChannelFile }),
  );
  pass(
    "channel messages move in order",
    JSON.stringify(newChannelMessages.map((entry) => entry.message.text)) ===
      JSON.stringify(sourceChannelMessages.map((entry) => entry.message.text)),
    JSON.stringify(newChannelMessages.map((entry) => entry.message.text)),
  );
  pass(
    "channel authors are the new agents and the importing person",
    newChannelMessages.every((entry) =>
      entry.author.kind === "agent"
        ? [newWriter.id, newEditor.id].includes(entry.author.id)
        : entry.author.kind !== "member" || entry.author.id === "local",
    ),
  );
  const newSummary = target.agents.channels.store.list("local").find((item) => item.id === newChannel.id);
  pass(
    "the open views get the imported channel messages",
    published.filter((entry) => entry.channelId === newChannel.id).at(-1)?.revision ===
      target.agents.channels.store.get(newChannel.id).revision,
    JSON.stringify(published.filter((entry) => entry.channelId === newChannel.id)),
  );
  pass(
    "imported channel messages are not unread",
    newSummary !== undefined && newSummary.unreadCount === 0,
    JSON.stringify(newSummary),
  );

  const newWorkflow = target.workflows.listWithGraphs().find((item) => item.summary.title === "Paper pipeline");
  pass("the workflow moves", newWorkflow !== undefined);
  const node = (id: string) => newWorkflow?.graph.nodes.find((item) => item.id === id)?.fields;
  pass(
    "workflow steps point to the new agent and channel",
    node("write")?.agentId === newWriter.id && node("post")?.channelId === newChannel.id,
    JSON.stringify(newWorkflow?.graph.nodes.map((item) => item.fields)),
  );
  pass("the workflow's messaging connection is left empty", node("slack")?.connectionId === "");
  pass(
    "the user is told to make the webhook address and choose the connection again",
    result.warnings.some((warning) => warning.startsWith("Paper pipeline:") && warning.includes("webhook")) &&
      result.warnings.some((warning) => warning.startsWith("Paper pipeline:") && warning.includes("connection")),
  );

  // --- The chats.
  const page = await runCauseEffect(target.agents.readConversationPageFor(newWriter.id, "local"));
  const texts = (messages: readonly { text: string }[]) => messages.map((message) => message.text);
  // The shown order of both chats: a message with no turn, such as a routine run's status, has its
  // place by time there, and the stored order of the source can differ from it.
  const sourcePage = await runCauseEffect(source.agents.readConversationPageFor(writer.id, "local"));
  pass(
    "the chat shows the same messages in order",
    JSON.stringify(texts(page.messages)) === JSON.stringify(texts(sourcePage.messages)),
    JSON.stringify({ source: texts(sourcePage.messages), target: texts(page.messages) }),
  );
  pass("the imported chat is not unread", page.readState?.unreadCount === 0, JSON.stringify(page.readState ?? null));
  const sourcePreview = source.agents.listAgents().find((agent) => agent.id === writer.id)?.preview;
  const targetPreview = target.agents.listAgents().find((agent) => agent.id === newWriter.id)?.preview;
  pass(
    "the sidebar shows the same last message",
    Boolean(sourcePreview) && targetPreview === sourcePreview,
    JSON.stringify({ source: sourcePreview, target: targetPreview }),
  );
  const imported = page.messages.find((message) => message.attachments?.length);
  const attachment = imported?.attachments?.[0];
  assert.ok(attachment, "The imported message has no file.");
  const stored = await runCauseEffect(target.mailbox.resolveAttachment(attachment.id));
  pass(
    "the file of the message opens with the same bytes",
    stored !== null && sha(new Uint8Array(await readFile(stored.path))) === sha(noteBytes),
  );
  const targetThreads = target.agents.readTransferHistory(newWriter.id);
  const side = targetThreads.find((thread) => !thread.main);
  pass("the side thread moves", side !== undefined && side.messages.length > 0);
  pass(
    "the side thread is in the side-thread list",
    target.agents.listTasks(newWriter.id).tasks.some((task) => task.title === side?.title),
  );
  pass(
    "the imported chat has the import event",
    newWriter.threadId !== null && target.database.threadHasEvent(newWriter.threadId, HISTORY_IMPORTED_EVENT),
  );

  // --- The first turn of the imported agent gets the history.
  const before = codexLog().length;
  await runCauseEffect(target.agents.sendMessage({ agentId: newWriter.id, text: "Where is the notebook?" }));
  await idle(target.agents, newWriter.id);
  const started = codexLog()
    .slice(before)
    .map((entry) => JSON.stringify(entry.params));
  pass(
    "the first turn of the imported agent gets the imported history",
    started.some((params) => params.includes(HISTORY_MARK)),
  );

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, checks: report.checks.length, error: report.error }, null, 2)}\n`,
  );
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  process.exit();
}
