// Checks the channel notifications of the desktop and the channel-attention-v1 fields of the Team API.
// Events go through the real notification forwarder, with an Electron `Notification` that records
// what it shows and a window that records what it sends to the renderer. The channel list comes
// from a real `HostService` over the real channel service, on a temporary profile. A real
// `TeamApiServer` on loopback serves the same channel to two peers: one that advertises only the
// released capabilities, and one that also advertises channel-attention-v1.
// It checks that a finished agent reply in a channel notifies and that the click opens the channel,
// that a prompt on a channel thread names the channel and a prompt on the agent's own thread does
// not, and that only the peer with the capability gets `threads`, the preview author and status and
// the UI blocks, while the released peer reads its wire with the frozen channels-v1 codec.
// Run: `bun scripts/channel-notifications-e2e.ts`.
// Writes .openbot-build/channel-notifications-e2e/report.json.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentEvent,
  type ChannelMessage,
  type ChannelTask,
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
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol";
import { CHANNEL_ROUTES, channelResponse } from "@openbot/contracts/team-protocol/channels-v1";
import { TEAM_CHANNEL_ATTENTION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { createFormat, translateFor } from "@openbot/i18n";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
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

/** The notifications that the forwarder showed, in order. */
const shown: RecordedNotification[] = [];
const shownWaiters: (() => void)[] = [];
/** The `notifications:opened-event` payloads that the main process sent to the renderer, in order. */
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

// The main process imports Electron. No check here opens a window or a real notification.
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
        // The window is open and not focused: the case in which a notification is due.
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
  ],
  steps: [],
};

/** Runs one check. `summarize` keeps live objects out of the report. */
async function step<T>(name: string, run: () => Promise<T>, summarize: (value: T) => unknown = (value) => value) {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // A bound on failure only: each check waits for its event, and a missing event must fail.
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

/** Resolves with the next notification that the forwarder shows. */
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

/** The newest `notifications:opened-event` payload sent to the renderer. */
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
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  takeUserControl: unused,
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  importSignIn: unused,
};
/** Stored tokens are not read here: the local server has none. */
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

/** An agent message in the channel, as a finished channel turn stores it. */
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

/** The capabilities that a protocol 8 peer sends. */
const V8_PEER_CAPABILITIES = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V8);

/** One HTTP request of a v8 peer that advertises `capabilities`. */
async function wire(
  port: number,
  input: { method: string; path: string; capabilities: readonly string[]; body?: unknown; token?: string },
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers({
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V8),
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

/** The keys that a list or page body has at the places where channel-attention-v1 adds fields. */
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
      // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
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
        // Signed out: the host user reads the channel as the signed-out member.
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
      // The member's execution thread, as the first channel turn makes it.
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
    // The first list only sets the baseline. The forwarder reads it before this call returns.
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
    // The local list and agents are read with no I/O, so the read ends when the queued callbacks run.
    await new Promise((settled) => setImmediate(settled));
    const whileRunning = shown.length - from;
    // The agent passes a part on: its task waits and the new task is queued, so no task runs.
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
    // A block that the channel shows, as ask_ui stores it.
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
    // The frozen channels-v1 projection is what a released client reads with. It must accept the body.
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

  report.passed = true;
} finally {
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  await runCauseEffect(manager.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}

if (!report.passed) process.exitCode = 1;
