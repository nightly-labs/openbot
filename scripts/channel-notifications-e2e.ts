import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentEvent,
  type ChannelBrowser,
  type ChannelMessage,
  type ChannelTask,
  decodeChannel,
  decodeChannelPage,
  decodeChannelSummaries,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  type NotificationOpenedEvent,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V8,
  TEAM_PROTOCOL_V9,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol";
import { CHANNEL_ROUTES, channelResponse } from "@openbot/contracts/team-protocol/channels-v1";
import { CHAT_HISTORY_CAPABILITY, CHAT_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/chat-history-v1";
import {
  CHANNEL_BROWSER_CAPABILITY,
  CHANNEL_ISOLATION_CAPABILITY,
  CHANNEL_SEEN_SUBTASKS_CAPABILITY,
  CHANNEL_TASK_WAITS_CAPABILITY,
  TEAM_CHANNEL_ATTENTION_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import {
  STORAGE_CHANNEL_CAPABILITY,
  STORAGE_CHANNEL_ROUTES,
} from "@openbot/contracts/team-protocol/storage-channel-v1";
import { createFormat, translateFor } from "@openbot/i18n";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import type { ChannelAssignment } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { StorageUsageScanner, StorageUsageService } from "../src/backend/storage-usage";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-notifications-e2e");
const APP_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 30_000;
const OWNER = { username: "owner-user", password: "owner-password-123" };
const english = translateFor("en");

interface RecordedNotification {
  title: string;
  body: string;
  click: () => void;
}

const shown: RecordedNotification[] = [];
const shownWaiters: (() => void)[] = [];
const opened: NotificationOpenedEvent[] = [];

function isOpenedEvent(value: unknown): value is NotificationOpenedEvent {
  return (
    isDynamicRecord(value) &&
    typeof value.serverId === "string" &&
    typeof value.agentId === "string" &&
    (value.threadId === null || typeof value.threadId === "string") &&
    (value.channelId === undefined || typeof value.channelId === "string")
  );
}

plugin({
  name: "channel-notifications-electron-boundary",
  setup(build) {
    class Inert {}
    class RecordingNotification {
      readonly #options: { title: string; body: string };
      readonly #listeners = new Map<string, (() => void)[]>();
      constructor(options: { title: string; body: string }) {
        this.#options = options;
      }
      static isSupported() {
        return true;
      }
      on(event: string, listener: () => void) {
        this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
        return this;
      }
      show() {
        shown.push({
          ...this.#options,
          click: () => {
            for (const listener of this.#listeners.get("click") ?? []) listener();
          },
        });
        for (const wake of shownWaiters.splice(0)) wake();
      }
      close() {
        for (const listener of this.#listeners.get("close") ?? []) listener();
      }
    }
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => APP_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: class UnfocusedWindow {
          static getAllWindows() {
            return [];
          }
          readonly webContents = {
            isDestroyed: () => false,
            isLoadingMainFrame: () => false,
            mainFrame: { isDestroyed: () => false, detached: false },
            send: (channel: string, payload: unknown) => {
              if (channel !== IPC_ENDPOINTS.notifications.opened.channel) return;
              assert.ok(isOpenedEvent(payload), "The opened event has an invalid payload.");
              opened.push(payload);
            },
          };
          isDestroyed() {
            return false;
          }
          isFocused() {
            return false;
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: RecordingNotification,
        clipboard: {},
        desktopCapturer: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: { getAllDisplays: () => [] },
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});
const { RemoteServerManager } = await import("../src/main/remote-server-manager");
const { createRendererForwarders } = await import("../src/main/renderer-forwarders");
const { HostService } = await import("../src/main/host-service");
const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");
const { BrowserWindow } = await import("electron");
const mainWindow = new BrowserWindow();

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "A remote host's channel list. This check reads the local host; the forwarder reads a remote list through the same decoder that the Team API steps use.",
    "Phone push. A channel reply sends no phone notification, as before channels were deprecated.",
    "A channel file row. The fixture channel has no file; the scanner reads channel files as it reads chat files.",
    "The channel files of a member who cannot see the channel. The owner sees every channel here.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>, summarize: (value: T) => unknown = (value) => value) {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: summarize(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

function nextNotification(): Promise<RecordedNotification> {
  const from = shown.length;
  return new Promise((resolveShown) => {
    const check = () => {
      const notification = shown[from];
      if (notification) resolveShown(notification);
      else shownWaiters.push(check);
    };
    check();
  });
}

function lastOpened(): NotificationOpenedEvent {
  const event = opened.at(-1);
  assert.ok(event, "The click sent no opened event.");
  return event;
}

const root = await mkdtemp(join(tmpdir(), "openbot-channel-notifications-"));
const userData = join(root, "user-data");
const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
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
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  answerPermission: unused,
  takeUserControl: unused,
  startTeach: unused,
  stopTeach: () => [],
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  releaseUserControlRefused: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  answerViewDialog: unused,
  importSignIn: unused,
  answerHttpSignIn: unused,
};
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};
const centralAccount = { createTeamAuthTicket: unused, getEmail: () => "e2e@example.invalid" };

const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
const manager = new RemoteServerManager(join(userData, "remote-servers.json"), cipher, centralAccount, {
  appVersion: APP_VERSION,
});
let agents: AgentService | undefined;
let server: InstanceType<typeof TeamApiServer> | undefined;
const storageSources = {
  roots: {
    database: join(userData, "openbot.db"),
    downloads: join(root, "downloads"),
    caches: [join(userData, "remote-attachments")],
    logs: [join(userData, "logs")],
    runtimes: join(root, "runtimes"),
    data: userData,
  },
  database: () => database.connection,
  mailbox,
  agents: () => agents?.listAgents() ?? [],
  channelFiles: (channelId: string) => {
    const store = agents?.channels.store;
    if (!store?.exists(channelId)) return null;
    return store
      .messages(channelId)
      .flatMap((entry) =>
        (entry.message.attachments ?? []).map((attachment) => ({ attachmentId: attachment.id, messageId: entry.id })),
      );
  },
};
const storage = new StorageUsageService(new StorageUsageScanner(storageSources), storageSources);

function agentMessage(
  channelId: string,
  agent: { id: string; name: string },
  text: string,
  extra: Partial<ChannelMessage["message"]> = {},
): ChannelMessage {
  const id = randomUUID();
  return {
    id,
    channelId,
    sequence: 0,
    author: { kind: "agent", id: agent.id, name: agent.name },
    taskId: null,
    superseded: false,
    message: {
      id,
      author: "agent",
      text,
      createdAt: new Date().toISOString(),
      status: "completed",
      senderAgentId: agent.id,
      ...extra,
    },
  };
}

const V8_PEER_CAPABILITIES = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V8);

const V9_PEER_CAPABILITIES = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9);

async function wire(
  port: number,
  input: {
    method: string;
    path: string;
    capabilities: readonly string[];
    body?: unknown;
    token?: string;
    protocol?: number;
  },
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers({
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(input.protocol ?? TEAM_PROTOCOL_V8),
    [TEAM_APP_VERSION_HEADER]: APP_VERSION,
    [TEAM_CAPABILITIES_HEADER]: input.capabilities.join(","),
  });
  if (input.body !== undefined) headers.set("Content-Type", "application/json");
  if (input.token) headers.set("Authorization", `Bearer ${input.token}`);
  const response = await fetch(`http://127.0.0.1:${port}${input.path}`, {
    method: input.method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function attentionKeys(list: unknown, page: unknown) {
  const summaries = Array.isArray(list) ? list.filter(isDynamicRecord) : [];
  const messages = isDynamicRecord(page) && Array.isArray(page.messages) ? page.messages.filter(isDynamicRecord) : [];
  return {
    threads: summaries.some((summary) => Object.hasOwn(summary, "threads")),
    openTasks: summaries.some((summary) => Object.hasOwn(summary, "openTasks")),
    previewAuthor: summaries.some(
      (summary) => isDynamicRecord(summary.lastMessage) && Object.hasOwn(summary.lastMessage, "author"),
    ),
    previewStatus: summaries.some(
      (summary) => isDynamicRecord(summary.lastMessage) && Object.hasOwn(summary.lastMessage, "status"),
    ),
    uiBlock: messages.some((message) => isDynamicRecord(message.message) && Object.hasOwn(message.message, "uiBlock")),
  };
}

try {
  const setup = await step(
    "Start the host, an agent, a channel and the forwarder",
    async () => {
      await runCauseEffect(sidebar.initialize());
      await runCauseEffect(agentStore.initialize());
      await runCauseEffect(mailbox.initialize());
      await runCauseEffect(team.initialize());
      const agent = await runCauseEffect(
        agentStore.createAgent({
          name: "Channel fixture",
          description: "Synthetic agent for the channel notification check",
          avatarSeed: "channel-notifications",
          avatarHue: null,
        }),
      );
      agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
      await runCauseEffect(manager.initialize());
      await runCauseEffect(manager.setNotificationLevel(LOCAL_SERVER_ID, "all"));
      const host = new HostService({
        appVersion: APP_VERSION,
        store: team,
        agents,
        agentsReady: () => Effect.void,
        skills: { listInstalledForChatTags: () => Effect.succeed([]) },
        sidebarLayout: sidebar,
        mailbox,
        browser: teamBrowser,
        channels: agents.channels,
        getSignedInUser: () => {
          throw new Error("Signed out.");
        },
        redeemCentralTicket: () => Effect.succeed(null),
        sendTeamInviteEmail: unused,
      });
      const channel = await runCauseEffect(
        agents.channels.command(
          {
            type: "save",
            operationId: randomUUID(),
            channelId: randomUUID(),
            draft: {
              name: "Launch room",
              title: "",
              instructions: "",
              members: [{ agentId: agent.id }],
              leadAgentId: agent.id,
            },
          },
          host.channelActor(),
        ),
      );
      const { threadId } = agents.channels.store.context(channel.id, agent.id);
      return { agent: { id: agent.id, name: agent.name, threadId: agent.threadId }, channel, threadId, host };
    },
    ({ agent, channel, threadId }) => ({ agent, channel, threadId }),
  );
  const { agent, channel, threadId, host } = setup;
  const channels = agents?.channels;
  assert.ok(channels);
  const forwarders = createRendererForwarders({
    getMainWindow: () => mainWindow,
    getChatWindows: () => [],
    chatWindowTarget: () => null,
    getAgentService: () => agents ?? null,
    getHostService: () => host,
    getHostAnalytics: () => null,
    getRemoteServerManager: () => manager,
    showMainWindow: () => undefined,
    getTranslate: () => english,
    getFormat: () => createFormat("en"),
    desktopNotificationsEnabled: () => true,
    notificationPreviewEnabled: () => false,
    ownAgentNotificationLevels: () => new Map(),
  });
  const changed = () =>
    forwarders.forwardAgentEvent(LOCAL_SERVER_ID, {
      type: "channels-changed",
      channelId: channel.id,
      revision: channels.store.get(channel.id).revision,
    });
  const channelTitle = english("notification.channelTitle", { agent: agent.name, channel: channel.name });

  await step("A finished agent reply in a closed channel notifies, and the click opens the channel", async () => {
    changed();
    const notified = nextNotification();
    channels.store.update(channels.store.get(channel.id), {
      messages: [agentMessage(channel.id, agent, "The launch plan is ready.")],
    });
    changed();
    const notification = await notified;
    assert.equal(notification.title, channelTitle);
    assert.equal(notification.body, english("notification.channelMessage"));
    notification.click();
    assert.deepEqual(lastOpened(), {
      serverId: LOCAL_SERVER_ID,
      agentId: agent.id,
      threadId: null,
      channelId: channel.id,
    });
    return { title: notification.title, body: notification.body, opened: lastOpened() };
  });

  await step("Work that writes many messages and waits for a task notifies once, when it ends", async () => {
    const from = shown.length;
    const task: ChannelTask = {
      id: randomUUID(),
      channelId: channel.id,
      parentTaskId: null,
      rootTaskId: "",
      ownerAgentId: agent.id,
      requestMessageId: randomUUID(),
      instruction: "Write the plan.",
      attachmentDraftIds: [],
      expectedResult: "",
      sourceMessageIds: [],
      dependencies: [],
      resources: [],
      state: "running",
      revision: 1,
      assignmentCount: 1,
      error: null,
    };
    task.rootTaskId = task.id;
    const at = (seconds: number) => ({ createdAt: new Date(Date.now() + seconds * 1000).toISOString() });
    channels.store.update(channels.store.get(channel.id), {
      messages: [agentMessage(channel.id, agent, "I am on it.", at(1))],
      tasks: [task],
    });
    changed();
    await new Promise((settled) => setImmediate(settled));
    const whileRunning = shown.length - from;
    const child: ChannelTask = {
      ...task,
      id: randomUUID(),
      parentTaskId: task.id,
      instruction: "Check the plan.",
      state: "queued",
      assignmentCount: 0,
    };
    channels.store.update(channels.store.get(channel.id), {
      messages: [agentMessage(channel.id, agent, "I asked for a check.", at(2))],
      tasks: [{ ...task, state: "waiting", dependencies: [child.id] }, child],
    });
    const waiting = host.listChannels().find((summary) => summary.id === channel.id);
    assert.equal(waiting?.activeTasks, 0, "A waiting channel shows a running task.");
    assert.equal(waiting?.openTasks, 2, "A waiting channel does not count its open tasks.");
    changed();
    await new Promise((settled) => setImmediate(settled));
    const whileWaiting = shown.length - from;
    const notified = nextNotification();
    channels.store.update(channels.store.get(channel.id), {
      messages: [agentMessage(channel.id, agent, "The plan is done.", at(3))],
      tasks: [
        { ...task, state: "completed", revision: 2, dependencies: [child.id] },
        { ...child, state: "completed", revision: 2 },
      ],
    });
    changed();
    await notified;
    await new Promise((settled) => setImmediate(settled));
    assert.equal(whileRunning, 0, "A reply notified while its task still ran.");
    assert.equal(whileWaiting, 0, "A reply notified while its task waited for another task.");
    assert.equal(shown.length - from, 1, "One piece of work showed more than one notification.");
    return { whileRunning, whileWaiting, total: shown.length - from };
  });

  const prompt = (requestId: number, onThread: string): AgentEvent => ({
    type: "prompt",
    requestId,
    agentId: agent.id,
    threadId: onThread,
    turnId: `turn-${requestId}`,
    questions: [{ id: "q", header: "Question", question: "Which one?", options: null, isSecret: false }],
  });

  await step("A prompt on the channel thread names the channel, and the click opens the channel", async () => {
    const notified = nextNotification();
    forwarders.forwardAgentEvent(LOCAL_SERVER_ID, prompt(1, threadId));
    const notification = await notified;
    assert.equal(notification.title, channelTitle);
    assert.equal(notification.body, english("notification.needsInput"));
    notification.click();
    const event = lastOpened();
    assert.equal(event.channelId, channel.id, "The click on a channel prompt does not open the channel.");
    assert.equal(event.threadId, threadId);
    return { title: notification.title, opened: event };
  });

  await step("A prompt on the agent's own thread does not name a channel", async () => {
    const notified = nextNotification();
    forwarders.forwardAgentEvent(LOCAL_SERVER_ID, prompt(2, agent.threadId ?? "openbot-thread-own-chat"));
    const notification = await notified;
    assert.equal(notification.title, agent.name);
    notification.click();
    const event = lastOpened();
    assert.equal(event.channelId, undefined, "An own-chat prompt opens a channel.");
    return { title: notification.title, opened: event };
  });

  const port = await step("Start the Team API host with channels, and sign in", async () => {
    channels.store.update(channels.store.get(channel.id), {
      messages: [
        agentMessage(channel.id, agent, "Send the report?", {
          itemType: "question_prompt",
          uiBlock: {
            version: 1,
            blockId: "block-1",
            spec: {
              type: "confirm",
              title: "Send the report?",
              actions: [
                { id: "send", label: "Send", style: "primary" },
                { id: "cancel", label: "Cancel" },
              ],
            },
            state: { status: "pending" },
          },
        }),
      ],
    });
    await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
    assert.ok(agents);
    server = new TeamApiServer({
      store: team,
      agents,
      mailbox,
      browser: teamBrowser,
      sidebarLayout: sidebar,
      appVersion: APP_VERSION,
      channels,
      storage,
    });
    return Effect.runPromise(server.start());
  });
  const login = await wire(port, {
    method: "POST",
    path: "/v1/auth/login",
    capabilities: V8_PEER_CAPABILITIES,
    body: OWNER,
  });
  assert.equal(login.status, 200, `Login failed: ${JSON.stringify(login.body)}`);
  assert.ok(isDynamicRecord(login.body) && typeof login.body.sessionToken === "string");
  const token = login.body.sessionToken;
  const released = V8_PEER_CAPABILITIES.filter((capability) => capability !== TEAM_CHANNEL_ATTENTION_CAPABILITY);
  const readBoth = async (capabilities: readonly string[]) => {
    const list = await wire(port, { method: "GET", path: CHANNEL_ROUTES.list, capabilities, token });
    const page = await wire(port, {
      method: "POST",
      path: CHANNEL_ROUTES.read,
      capabilities,
      token,
      body: { channelId: channel.id },
    });
    assert.equal(list.status, 200, `The list failed: ${JSON.stringify(list.body)}`);
    assert.equal(page.status, 200, `The page failed: ${JSON.stringify(page.body)}`);
    return { list: list.body, page: page.body };
  };

  await step("A released-only peer gets no channel-attention-v1 field, and its codec reads the wire", async () => {
    const { list, page } = await readBoth(released);
    const keys = attentionKeys(list, page);
    assert.deepEqual(keys, {
      threads: false,
      openTasks: false,
      previewAuthor: false,
      previewStatus: false,
      uiBlock: false,
    });
    channelResponse(CHANNEL_ROUTES.list, 200, list);
    channelResponse(CHANNEL_ROUTES.read, 200, page);
    return keys;
  });

  await step(
    "A peer with channel-attention-v1 gets the threads, the open tasks, the preview author and the UI block",
    async () => {
      const { list, page } = await readBoth(V8_PEER_CAPABILITIES);
      const codec = teamSideRouteCodec(CHANNEL_ROUTES.list);
      assert.ok(codec);
      const options = { historyExtent: true, channelAttention: true };
      const summary = decodeChannelSummaries(codec.response(CHANNEL_ROUTES.list, 200, list, options)).find(
        (candidate) => candidate.id === channel.id,
      );
      const decodedPage = decodeChannelPage(codec.response(CHANNEL_ROUTES.read, 200, page, options));
      assert.ok(summary);
      assert.deepEqual(summary.threads, [{ agentId: agent.id, threadId }]);
      assert.equal(summary.openTasks, 0);
      assert.deepEqual(summary.lastMessage?.author, { kind: "agent", id: agent.id });
      assert.equal(summary.lastMessage?.status, "completed");
      assert.ok(
        decodedPage.messages.some((message) => message.message.uiBlock?.blockId === "block-1"),
        "The page has no UI block.",
      );
      return attentionKeys(list, page);
    },
  );

  const codec = teamSideRouteCodec(CHANNEL_ROUTES.command);
  assert.ok(codec);
  const withoutIsolation = V9_PEER_CAPABILITIES.filter((capability) => capability !== CHANNEL_ISOLATION_CAPABILITY);
  assert.ok(
    V9_PEER_CAPABILITIES.includes(CHANNEL_ISOLATION_CAPABILITY),
    "A protocol 9 peer does not send the capability.",
  );
  const stored = () => channels.store.get(channel.id).isolated;
  const save = (isolated?: boolean) => {
    const current = channels.store.get(channel.id);
    return {
      type: "save",
      operationId: randomUUID(),
      channelId: channel.id,
      update: true,
      draft: {
        name: current.name,
        title: current.title,
        instructions: current.instructions,
        members: current.members,
        leadAgentId: current.leadAgentId,
        ...(isolated === undefined ? {} : { isolated }),
      },
    };
  };
  const v9 = (isolation: boolean, method: string, path: string, body?: unknown) =>
    wire(port, {
      method,
      path,
      capabilities: isolation ? V9_PEER_CAPABILITIES : withoutIsolation,
      token,
      protocol: TEAM_PROTOCOL_V9,
      ...(body === undefined ? {} : { body }),
    });
  const readIsolated = async (response: { status: number; body: unknown }) => {
    assert.equal(response.status, 200, `The save failed: ${JSON.stringify(response.body)}`);
    const options = { channelAttention: true, channelIsolation: true };
    const list = await v9(true, "GET", CHANNEL_ROUTES.list);
    const page = await v9(true, "POST", CHANNEL_ROUTES.read, { channelId: channel.id });
    const summary = decodeChannelSummaries(codec.response(CHANNEL_ROUTES.list, 200, list.body, options)).find(
      (candidate) => candidate.id === channel.id,
    );
    return {
      list: summary?.isolated,
      page: decodeChannelPage(codec.response(CHANNEL_ROUTES.read, 200, page.body, options)).channel.isolated,
      command: decodeChannel(codec.response(CHANNEL_ROUTES.command, 200, response.body, options)).isolated,
      stored: stored(),
    };
  };

  await step("A peer without channel-isolation-v1 cannot turn the setting on, and gets no isolated field", async () => {
    assert.notEqual(stored(), true, "The channel starts with the setting on.");
    const response = await v9(false, "POST", CHANNEL_ROUTES.command, save(true));
    assert.equal(response.status, 200, `The save failed: ${JSON.stringify(response.body)}`);
    assert.notEqual(stored(), true, "The host stored isolated from a peer without the capability.");
    const list = await v9(false, "GET", CHANNEL_ROUTES.list);
    const page = await v9(false, "POST", CHANNEL_ROUTES.read, { channelId: channel.id });
    const sent = {
      list:
        Array.isArray(list.body) && list.body.some((item) => isDynamicRecord(item) && Object.hasOwn(item, "isolated")),
      page:
        isDynamicRecord(page.body) &&
        isDynamicRecord(page.body.channel) &&
        Object.hasOwn(page.body.channel, "isolated"),
      command: isDynamicRecord(response.body) && Object.hasOwn(response.body, "isolated"),
    };
    assert.deepEqual(sent, { list: false, page: false, command: false });
    channelResponse(CHANNEL_ROUTES.list, 200, list.body);
    channelResponse(CHANNEL_ROUTES.read, 200, page.body);
    return { sent, stored: stored() ?? null };
  });

  await step(
    "A peer with channel-isolation-v1 turns the setting on and reads it in the list, the page and the answer",
    async () => {
      const body = codec.request(CHANNEL_ROUTES.command, save(true), { channelIsolation: true });
      const read = await readIsolated(await v9(true, "POST", CHANNEL_ROUTES.command, body));
      assert.deepEqual(read, { list: true, page: true, command: true, stored: true });
      return read;
    },
  );

  await step(
    "A save of a peer without channel-isolation-v1 keeps the setting on, even with isolated false",
    async () => {
      const response = await v9(false, "POST", CHANNEL_ROUTES.command, save(false));
      assert.equal(response.status, 200, `The save failed: ${JSON.stringify(response.body)}`);
      assert.equal(stored(), true, "A save of a peer without the capability turned the setting off.");
      return { stored: stored() ?? null };
    },
  );

  await step("A save without isolated keeps the setting on, as the editor sends a rename", async () => {
    const body = codec.request(CHANNEL_ROUTES.command, save(), { channelIsolation: true });
    const read = await readIsolated(await v9(true, "POST", CHANNEL_ROUTES.command, body));
    assert.deepEqual(read, { list: true, page: true, command: true, stored: true });
    return read;
  });

  await step("A peer with channel-isolation-v1 turns the setting off again", async () => {
    const body = codec.request(CHANNEL_ROUTES.command, save(false), { channelIsolation: true });
    const read = await readIsolated(await v9(true, "POST", CHANNEL_ROUTES.command, body));
    assert.deepEqual(read, { list: false, page: false, command: false, stored: false });
    return read;
  });

  const withoutBrowser = V9_PEER_CAPABILITIES.filter((capability) => capability !== CHANNEL_BROWSER_CAPABILITY);
  assert.ok(
    V9_PEER_CAPABILITIES.includes(CHANNEL_BROWSER_CAPABILITY),
    "A protocol 9 peer does not send the capability.",
  );
  const storedBrowser = () => channels.store.get(channel.id).browser ?? null;
  const browserSave = (browser?: ChannelBrowser, members?: readonly { agentId: string }[]) => {
    const saved = save();
    return {
      ...saved,
      draft: {
        ...saved.draft,
        ...(members === undefined ? {} : { members }),
        ...(browser === undefined ? {} : { browser }),
      },
    };
  };
  const withBrowser = (browser: boolean, method: string, path: string, body?: unknown) =>
    wire(port, {
      method,
      path,
      capabilities: browser ? V9_PEER_CAPABILITIES : withoutBrowser,
      token,
      protocol: TEAM_PROTOCOL_V9,
      ...(body === undefined ? {} : { body }),
    });
  const readBrowser = async (response: { status: number; body: unknown }) => {
    assert.equal(response.status, 200, `The save failed: ${JSON.stringify(response.body)}`);
    const options = { channelAttention: true, channelBrowser: true };
    const list = await withBrowser(true, "GET", CHANNEL_ROUTES.list);
    const page = await withBrowser(true, "POST", CHANNEL_ROUTES.read, { channelId: channel.id });
    const summary = decodeChannelSummaries(codec.response(CHANNEL_ROUTES.list, 200, list.body, options)).find(
      (candidate) => candidate.id === channel.id,
    );
    return {
      list: summary?.browser ?? null,
      page: decodeChannelPage(codec.response(CHANNEL_ROUTES.read, 200, page.body, options)).channel.browser ?? null,
      command: decodeChannel(codec.response(CHANNEL_ROUTES.command, 200, response.body, options)).browser ?? null,
      stored: storedBrowser(),
    };
  };
  const everywhere = (browser: ChannelBrowser) => ({ list: browser, page: browser, command: browser, stored: browser });
  const onlyAgent: ChannelBrowser = { kind: "member", agentId: agent.id };

  await step(
    "A peer without channel-browser-v1 cannot change the Browser setting, and gets no browser field",
    async () => {
      assert.equal(storedBrowser(), null, "The channel starts with a Browser setting.");
      const response = await withBrowser(false, "POST", CHANNEL_ROUTES.command, browserSave({ kind: "none" }));
      assert.equal(response.status, 200, `The save failed: ${JSON.stringify(response.body)}`);
      assert.equal(storedBrowser(), null, "The host stored browser from a peer without the capability.");
      const list = await withBrowser(false, "GET", CHANNEL_ROUTES.list);
      const page = await withBrowser(false, "POST", CHANNEL_ROUTES.read, { channelId: channel.id });
      const sent = {
        list:
          Array.isArray(list.body) && list.body.some((item) => isDynamicRecord(item) && Object.hasOwn(item, "browser")),
        page:
          isDynamicRecord(page.body) &&
          isDynamicRecord(page.body.channel) &&
          Object.hasOwn(page.body.channel, "browser"),
        command: isDynamicRecord(response.body) && Object.hasOwn(response.body, "browser"),
      };
      assert.deepEqual(sent, { list: false, page: false, command: false });
      return { sent, stored: storedBrowser() };
    },
  );

  await step(
    "A peer with channel-browser-v1 gives the browser to one member and reads it in the list, the page and the answer",
    async () => {
      const body = codec.request(CHANNEL_ROUTES.command, browserSave(onlyAgent), { channelBrowser: true });
      const read = await readBrowser(await withBrowser(true, "POST", CHANNEL_ROUTES.command, body));
      assert.deepEqual(read, everywhere(onlyAgent));
      return read;
    },
  );

  await step("A save without browser keeps the browser member, as the editor sends a rename", async () => {
    const body = codec.request(CHANNEL_ROUTES.command, browserSave(), { channelBrowser: true });
    const read = await readBrowser(await withBrowser(true, "POST", CHANNEL_ROUTES.command, body));
    assert.deepEqual(read, everywhere(onlyAgent));
    return read;
  });

  await step("A save that gives the browser to an agent who is not a member is refused", async () => {
    const stranger: ChannelBrowser = { kind: "member", agentId: randomUUID() };
    const body = codec.request(CHANNEL_ROUTES.command, browserSave(stranger), { channelBrowser: true });
    const response = await withBrowser(true, "POST", CHANNEL_ROUTES.command, body);
    assert.notEqual(response.status, 200, `The host saved a browser member who is not a member.`);
    assert.deepEqual(storedBrowser(), onlyAgent, "A refused save changed the setting.");
    return { status: response.status, stored: storedBrowser() };
  });

  await step("Removing the browser member from the channel turns the setting to no member", async () => {
    const helper = await runCauseEffect(
      agentStore.createAgent({
        name: "Browser fixture",
        description: "Synthetic second member for the channel browser check",
        avatarSeed: "channel-browser",
        avatarHue: null,
      }),
    );
    const both = [{ agentId: agent.id }, { agentId: helper.id }];
    const helperOnly: ChannelBrowser = { kind: "member", agentId: helper.id };
    const add = codec.request(CHANNEL_ROUTES.command, browserSave(helperOnly, both), { channelBrowser: true });
    assert.deepEqual(
      await readBrowser(await withBrowser(true, "POST", CHANNEL_ROUTES.command, add)),
      everywhere(helperOnly),
    );
    const remove = codec.request(CHANNEL_ROUTES.command, browserSave(undefined, [{ agentId: agent.id }]), {
      channelBrowser: true,
    });
    const read = await readBrowser(await withBrowser(true, "POST", CHANNEL_ROUTES.command, remove));
    assert.deepEqual(read, everywhere({ kind: "none" }));
    return read;
  });

  await step("A peer with channel-browser-v1 gives the browser to every member again", async () => {
    const body = codec.request(CHANNEL_ROUTES.command, browserSave({ kind: "members" }), { channelBrowser: true });
    const read = await readBrowser(await withBrowser(true, "POST", CHANNEL_ROUTES.command, body));
    assert.deepEqual(read, everywhere({ kind: "members" }));
    return read;
  });

  await step(
    "A lead that waits for a second round names the first round as seen, only to a peer with channel-seen-subtasks-v1",
    async () => {
      assert.ok(V9_PEER_CAPABILITIES.includes(CHANNEL_SEEN_SUBTASKS_CAPABILITY), "A protocol 9 peer lacks it.");
      const task = (id: string, parentTaskId: string | null, rootTaskId: string, state: ChannelTask["state"]) => ({
        id,
        channelId: channel.id,
        parentTaskId,
        rootTaskId,
        ownerAgentId: agent.id,
        requestMessageId: randomUUID(),
        instruction: `Task ${id}`,
        attachmentDraftIds: [],
        expectedResult: "",
        sourceMessageIds: [],
        dependencies: [],
        resources: [],
        state,
        revision: 1,
        assignmentCount: 1,
        error: null,
      });
      const leadId = randomUUID();
      const firstRound = task(randomUUID(), leadId, leadId, "completed");
      const secondRound = task(randomUUID(), leadId, leadId, "running");
      const lead: ChannelTask = {
        ...task(leadId, null, leadId, "waiting"),
        dependencies: [firstRound.id, secondRound.id],
      };
      const secondTurn: ChannelAssignment = {
        id: randomUUID(),
        channelId: channel.id,
        taskId: lead.id,
        agentId: agent.id,
        taskRevision: 2,
        requestMessageId: lead.requestMessageId,
        resources: [],
        deliveryId: null,
        turnId: null,
        state: "completed",
        throughSequence: 0,
        summaryVersion: 0,
        awaitedTaskIds: [firstRound.id],
        pendingRevision: null,
        pendingOutcome: null,
      };
      channels.store.update(channels.store.get(channel.id), {
        tasks: [lead, firstRound, secondRound],
        assignments: [secondTurn],
      });
      const read = (capabilities: readonly string[]) =>
        wire(port, {
          method: "POST",
          path: CHANNEL_ROUTES.read,
          capabilities,
          token,
          protocol: TEAM_PROTOCOL_V9,
          body: { channelId: channel.id },
        });
      const released = await read(V9_PEER_CAPABILITIES.filter((item) => item !== CHANNEL_SEEN_SUBTASKS_CAPABILITY));
      const current = await read(V9_PEER_CAPABILITIES);
      assert.equal(released.status, 200, `The page failed: ${JSON.stringify(released.body)}`);
      assert.equal(current.status, 200, `The page failed: ${JSON.stringify(current.body)}`);
      const options = { channelAttention: true, channelSeenSubtasks: true };
      const releasedPage = decodeChannelPage(codec.response(CHANNEL_ROUTES.read, 200, released.body, options));
      const currentPage = decodeChannelPage(codec.response(CHANNEL_ROUTES.read, 200, current.body, options));
      const leadOf = (tasks: readonly ChannelTask[]) => tasks.find((item) => item.id === lead.id);
      channelResponse(CHANNEL_ROUTES.read, 200, released.body);
      const local = channels.store.withSeenDependencies(channel.id, channels.store.tasks(channel.id));
      channels.store.update(channels.store.get(channel.id), {
        assignments: [{ ...secondTurn, id: randomUUID(), taskId: firstRound.id, awaitedTaskIds: [] }],
      });
      const reassigned = await read(V9_PEER_CAPABILITIES);
      const result = {
        released: leadOf(releasedPage.tasks)?.seenDependencies ?? null,
        current: leadOf(currentPage.tasks)?.seenDependencies ?? null,
        local: leadOf(local)?.seenDependencies ?? null,
        subtasks: currentPage.tasks.filter((item) => item.parentTaskId === lead.id && item.seenDependencies).length,
        reassigned:
          leadOf(decodeChannelPage(codec.response(CHANNEL_ROUTES.read, 200, reassigned.body, options)).tasks)
            ?.seenDependencies ?? null,
      };
      assert.deepEqual(result, {
        released: null,
        current: [firstRound.id],
        local: [firstRound.id],
        subtasks: 0,
        reassigned: null,
      });
      channels.store.update(channels.store.get(channel.id), {
        tasks: [lead, firstRound, secondRound].map((item) => ({ ...item, state: "completed" as const })),
      });
      return result;
    },
  );

  await step("A queued request names why it waits, only to a peer with channel-task-waits-v1 (#6067)", async () => {
    assert.ok(V9_PEER_CAPABILITIES.includes(CHANNEL_TASK_WAITS_CAPABILITY), "A protocol 9 peer lacks it.");
    const other = await runCauseEffect(
      channels.command(
        {
          type: "save",
          operationId: randomUUID(),
          channelId: randomUUID(),
          draft: {
            name: "Release check",
            title: "Verify the release build",
            instructions: "",
            members: [{ agentId: agent.id }],
            leadAgentId: agent.id,
          },
        },
        host.channelActor(),
      ),
    );
    const helper = await runCauseEffect(
      agentStore.createAgent({
        name: "Wait fixture",
        description: "Synthetic agent for the channel wait check",
        avatarSeed: "channel-wait",
        avatarHue: null,
      }),
    );
    const queued = (ownerAgentId: string, channelId = channel.id): ChannelTask => {
      const id = randomUUID();
      return {
        id,
        channelId,
        parentTaskId: null,
        rootTaskId: id,
        ownerAgentId,
        requestMessageId: randomUUID(),
        instruction: "Check the launch notes",
        attachmentDraftIds: [],
        expectedResult: "",
        sourceMessageIds: [],
        dependencies: [],
        resources: [],
        state: "queued",
        revision: 1,
        assignmentCount: 0,
        error: null,
      };
    };
    const running = (task: ChannelTask): ChannelAssignment => ({
      id: randomUUID(),
      channelId: task.channelId,
      taskId: task.id,
      agentId: task.ownerAgentId ?? "",
      taskRevision: 1,
      requestMessageId: randomUUID(),
      resources: [],
      deliveryId: null,
      turnId: null,
      state: "running",
      throughSequence: 0,
      summaryVersion: 0,
      awaitedTaskIds: [],
      pendingRevision: null,
      pendingOutcome: null,
    });
    const read = async (capabilities: readonly string[]) => {
      const response = await wire(port, {
        method: "POST",
        path: CHANNEL_ROUTES.read,
        capabilities,
        token,
        protocol: TEAM_PROTOCOL_V9,
        body: { channelId: channel.id },
      });
      assert.equal(response.status, 200, `The page failed: ${JSON.stringify(response.body)}`);
      return response.body;
    };
    const options = { channelAttention: true, channelTaskWaits: true };
    const waitsOf = (body: unknown) =>
      decodeChannelPage(codec.response(CHANNEL_ROUTES.read, 200, body, options)).waits ?? null;
    const released = V9_PEER_CAPABILITIES.filter((item) => item !== CHANNEL_TASK_WAITS_CAPABILITY);

    await runCauseEffect(agentStore.updateAgent({ agentId: agent.id, taskLimit: 1 }));
    const busyTask = queued(agent.id);
    const otherTask: ChannelTask = { ...queued(agent.id, other.id), state: "running", assignmentCount: 1 };
    const otherWork = running(otherTask);
    channels.store.update(channels.store.get(channel.id), { tasks: [busyTask] });
    channels.store.update(channels.store.get(other.id), { tasks: [otherTask], assignments: [otherWork] });
    const releasedBody = await read(released);
    channelResponse(CHANNEL_ROUTES.read, 200, releasedBody);
    const busy = { released: waitsOf(releasedBody), current: waitsOf(await read(V9_PEER_CAPABILITIES)) };
    const local = channels.page(channel.id).waits ?? null;
    await runCauseEffect(agentStore.updateAgent({ agentId: agent.id, taskLimit: null }));
    channels.store.update(channels.store.get(other.id), {
      tasks: [{ ...otherTask, state: "completed" }],
      assignments: [{ ...otherWork, state: "completed" }],
    });
    channels.store.update(channels.store.get(channel.id), { tasks: [{ ...busyTask, state: "cancelled" }] });

    const fullTask = queued(helper.id);
    const runningTasks = [1, 2].map((): ChannelTask => ({ ...queued(agent.id), state: "running", assignmentCount: 1 }));
    const work = runningTasks.map(running);
    channels.store.update(channels.store.get(channel.id), { tasks: [fullTask, ...runningTasks], assignments: work });
    const full = waitsOf(await read(V9_PEER_CAPABILITIES));
    channels.store.update(channels.store.get(channel.id), {
      tasks: [
        { ...fullTask, state: "cancelled" },
        ...runningTasks.map((item) => ({ ...item, state: "completed" as const })),
      ],
      assignments: work.map((item) => ({ ...item, state: "completed" as const })),
    });
    const after = waitsOf(await read(V9_PEER_CAPABILITIES));

    const busyWait = {
      taskId: busyTask.id,
      agentId: agent.id,
      reason: "agent-busy",
      channelId: other.id,
      channelName: "Release check",
    };
    assert.deepEqual(
      { ...busy, local, full, after },
      {
        released: null,
        current: [busyWait],
        local: [busyWait],
        full: [{ taskId: fullTask.id, agentId: helper.id, reason: "channel-full" }],
        after: null,
      },
    );
    return { ...busy, full, after };
  });

  const withoutChannelFiles = V9_PEER_CAPABILITIES.filter((capability) => capability !== STORAGE_CHANNEL_CAPABILITY);
  const channelFiles = (channelId: string, capabilities: readonly string[] = V9_PEER_CAPABILITIES) =>
    wire(port, {
      method: "POST",
      path: STORAGE_CHANNEL_ROUTES.files,
      capabilities,
      token,
      protocol: TEAM_PROTOCOL_V9,
      body: { channelId, force: true },
    });

  await step("A peer without storage-channel-v1 gets 400 for the files of a channel", async () => {
    const response = await channelFiles(channel.id, withoutChannelFiles);
    assert.equal(response.status, 400, `The host answered: ${JSON.stringify(response.body)}`);
    return { status: response.status, body: response.body };
  });

  await step("A peer with storage-channel-v1 reads the files of the channel from the host's storage", async () => {
    const response = await channelFiles(channel.id);
    assert.equal(response.status, 200, `The files failed: ${JSON.stringify(response.body)}`);
    assert.ok(isDynamicRecord(response.body), "The answer is not an object.");
    assert.equal(response.body.channelId, channel.id);
    assert.ok(Array.isArray(response.body.files), "The answer has no file list.");
    assert.equal(response.body.truncated, false);
    assert.deepEqual(response.body.files, []);
    return { status: response.status, files: response.body.files.length };
  });

  await step("The files of an unknown channel get 404", async () => {
    const response = await channelFiles(randomUUID());
    assert.equal(response.status, 404, `The host answered: ${JSON.stringify(response.body)}`);
    return { status: response.status, body: response.body };
  });

  const withoutHistory = V9_PEER_CAPABILITIES.filter((capability) => capability !== CHAT_HISTORY_CAPABILITY);
  const historyRequest = (path: string, capabilities: readonly string[] = V9_PEER_CAPABILITIES) =>
    wire(port, {
      method: "POST",
      path,
      capabilities,
      token,
      protocol: TEAM_PROTOCOL_V9,
      body: { channelId: channel.id },
    });
  const readPage = async () => {
    const page = await v9(true, "POST", CHANNEL_ROUTES.read, { channelId: channel.id });
    assert.equal(page.status, 200, `The page failed: ${JSON.stringify(page.body)}`);
    return decodeChannelPage(codec.response(CHANNEL_ROUTES.read, 200, page.body, { channelAttention: true }));
  };

  await step("A peer without chat-history-v1 cannot start a new conversation in the channel", async () => {
    const before = (await readPage()).messages.length;
    const response = await historyRequest(CHAT_HISTORY_ROUTES.channelClear, withoutHistory);
    assert.equal(response.status, 400, `The host accepted the request: ${JSON.stringify(response.body)}`);
    assert.equal((await readPage()).messages.length, before, "The host changed the channel.");
    return { status: response.status, body: response.body };
  });

  await step("An owner starts a new conversation in the channel over the Team API", async () => {
    const response = await historyRequest(CHAT_HISTORY_ROUTES.channelClear);
    assert.equal(response.status, 200, `The new conversation failed: ${JSON.stringify(response.body)}`);
    const last = (await readPage()).messages.at(-1);
    assert.equal(last?.message.itemType, "context-reset", "The channel has no new conversation marker.");
    return { status: response.status, marker: last?.message.itemType ?? null };
  });

  await step("A compaction with no member session gets 409 with a sentence", async () => {
    const response = await historyRequest(CHAT_HISTORY_ROUTES.channelCompact);
    assert.equal(response.status, 409, `The host did not refuse: ${JSON.stringify(response.body)}`);
    return { status: response.status, body: response.body };
  });

  await step("A member who is not an admin gets 403 for a channel history delete, and the messages stay", async () => {
    const invite = await runCauseEffect(team.createInvite("member"));
    const memberCredentials = { username: "member-user", password: "member-password-123" };
    await runCauseEffect(team.acceptInvite(invite.token, memberCredentials.username, memberCredentials.password));
    const memberLogin = await wire(port, {
      method: "POST",
      path: "/v1/auth/login",
      capabilities: V8_PEER_CAPABILITIES,
      body: memberCredentials,
    });
    assert.ok(isDynamicRecord(memberLogin.body) && typeof memberLogin.body.sessionToken === "string");
    const before = (await readPage()).messages.length;
    const response = await wire(port, {
      method: "POST",
      path: CHAT_HISTORY_ROUTES.channelDelete,
      capabilities: V9_PEER_CAPABILITIES,
      token: memberLogin.body.sessionToken,
      protocol: TEAM_PROTOCOL_V9,
      body: { channelId: channel.id },
    });
    assert.equal(response.status, 403, `The host did not refuse the member: ${JSON.stringify(response.body)}`);
    assert.equal((await readPage()).messages.length, before, "The host changed the channel.");
    return { status: response.status, body: response.body };
  });

  await step("An owner deletes the channel history over the Team API", async () => {
    assert.ok((await readPage()).messages.length > 0, "The channel starts without messages.");
    const response = await historyRequest(CHAT_HISTORY_ROUTES.channelDelete);
    assert.equal(response.status, 200, `The delete failed: ${JSON.stringify(response.body)}`);
    const shown = (await readPage()).messages.filter((message) => message.message.text !== "");
    assert.equal(shown.length, 0, `The channel still shows messages: ${JSON.stringify(shown)}`);
    return { status: response.status, shown: shown.length };
  });

  await step("A new conversation in an archived channel gets 409 with a sentence", async () => {
    const command = (type: "archive" | "restore") =>
      v9(true, "POST", CHANNEL_ROUTES.command, { type, operationId: randomUUID(), channelId: channel.id });
    assert.equal((await command("archive")).status, 200, "The archive failed.");
    const response = await historyRequest(CHAT_HISTORY_ROUTES.channelClear);
    assert.equal((await command("restore")).status, 200, "The restore failed.");
    assert.equal(response.status, 409, `The host did not refuse: ${JSON.stringify(response.body)}`);
    return { status: response.status, body: response.body };
  });

  report.passed = true;
} finally {
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  await Effect.runPromise(storage.dispose()).catch(() => undefined);
  await runCauseEffect(manager.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}

if (!report.passed) process.exitCode = 1;
