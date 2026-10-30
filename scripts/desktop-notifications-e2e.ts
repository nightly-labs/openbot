// Checks which agent events raise a desktop notification, that an answer withdraws it, and that the
// owner's phone tells the owner when mute or the level keeps the desktop quiet. Events go through the
// real notification forwarder, with an Electron `Notification` that records what it shows and closes,
// and through the real phone notification service, with a send that records what it sends. The
// level and the mute are set on a real `RemoteServerManager` on a temporary profile. Only the local
// server is used, so no remote host or account is needed.
// Run: `bun scripts/desktop-notifications-e2e.ts`.
// Writes .openbot-build/desktop-notifications-e2e/report.json.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentEvent,
  LOCAL_SERVER_ID,
  type ServerNotificationLevel,
  type ServerSummary,
} from "@openbot/contracts/ipc";
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
import type { NotificationRelayRequest } from "../src/main/push-notifications";

const OUT = resolve(import.meta.dirname, "../.openbot-build/desktop-notifications-e2e");
const APP_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 30_000;
const OWNER_ID = "owner";
const english = translateFor("en");

interface RecordedNotification {
  title: string;
  body: string;
  closed: boolean;
}

/** The notifications that the forwarder showed, in order. */
const shown: RecordedNotification[] = [];

// The main process imports Electron. No check here opens a window or a real notification.
plugin({
  name: "desktop-notifications-electron-boundary",
  setup(build) {
    class Inert {}
    class RecordingNotification {
      readonly #record: RecordedNotification;
      readonly #listeners = new Map<string, (() => void)[]>();
      constructor(options: { title: string; body: string }) {
        this.#record = { ...options, closed: false };
      }
      static isSupported() {
        return true;
      }
      on(event: string, listener: () => void) {
        this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
        return this;
      }
      show() {
        shown.push(this.#record);
      }
      close() {
        this.#record.closed = true;
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
            send: () => undefined,
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
const { desktopShowsAgentEvent } = await import("../src/main/desktop-notifications");
const { PushNotificationService } = await import("../src/main/push-notifications");
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
    "An answer that arrives while a remote server's agent list is read. For the local server the notification shows before the forwarder returns, so no answer can come between.",
    "The `hostComputerInUse` closure in `application-services.ts`. The phone steps use the same expression with an unfocused window and recent input.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
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
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-desktop-notifications-"));
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
const manager = new RemoteServerManager(join(userData, "remote-servers.json"), cipher, centralAccount, {
  appVersion: APP_VERSION,
});
let agents: AgentService | undefined;
/** The agent events that the phone service reads, as the host's agent service sends them. */
const hostEvents = new EventEmitter<{ event: [AgentEvent] }>();
const sent: NotificationRelayRequest[] = [];
/** The levels that the owner chose for each agent, which the desktop and the owner's phone read. */
const ownLevels = new Map<string, ServerNotificationLevel>();
/** The owner's level of the whole server, for all of their devices, or `null` for the level of each device. */
let ownServerLevel: ServerNotificationLevel | null = null;
const sentWaiters: (() => void)[] = [];
const phone = new PushNotificationService({
  agents: {
    on: (_name, listener) => hostEvents.on("event", listener),
    off: (_name, listener) => hostEvents.off("event", listener),
    listAgents: () => agents?.listAgents() ?? [],
    readConversationPageFor: unused,
    // The phone is away from the start, so it keeps no event to read the state for.
    getRuntimeSnapshot: () => {
      throw new Error("Not used by this check.");
    },
    listConversationReads: () => {
      throw new Error("Not used by this check.");
    },
  },
  store: { list: () => [], replace: () => Effect.void },
  send: (request) =>
    Effect.sync(() => {
      sent.push(request);
      for (const resolve of sentWaiters.splice(0)) resolve();
      return "sent" as const;
    }),
  hiddenAgentIds: () => new Set(),
  memberActive: () => true,
  lastUseElsewhere: () => null,
  // As `hostComputerInUse` decides for the owner with recent input and the window not focused.
  atHostComputer: (memberId, event) =>
    memberId === OWNER_ID && desktopShowsAgentEvent(event, localServer(), true, ownLevels),
  // The host reads the owner's levels from the same store as the desktop app of its computer.
  memberLevels: (memberId) =>
    memberId === OWNER_ID ? { server: ownServerLevel, agents: ownLevels } : { server: null, agents: new Map() },
  liveActivityShows: () => false,
  randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
});

function localServer(): ServerSummary {
  const server = manager.list().find((candidate) => candidate.id === LOCAL_SERVER_ID);
  assert.ok(server, "The server list has no local server.");
  return server;
}

async function setLevel(level: ServerNotificationLevel, muted = false): Promise<void> {
  await runCauseEffect(manager.setNotificationLevel(LOCAL_SERVER_ID, level));
  await runCauseEffect(manager.setMuted(LOCAL_SERVER_ID, muted));
  assert.equal(localServer().notificationLevel, level);
  assert.equal(localServer().notificationsMuted, muted);
}

/** The bodies of the notifications shown since `from`. */
function shownSince(from: number): string[] {
  return shown.slice(from).map((notification) => notification.body);
}

try {
  const agentId = await step("Start the manager, an agent, the forwarder and the phone service", async () => {
    await runCauseEffect(sidebar.initialize());
    // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
    await runCauseEffect(agentStore.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(
      agentStore.createAgent({
        name: "Notification fixture",
        description: "Synthetic agent for the notification check",
        avatarSeed: "desktop-notifications",
        avatarHue: null,
      }),
    );
    agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
    await runCauseEffect(manager.initialize());
    phone.start();
    // The phone of the owner, away from the app.
    phone.register(
      "phone-session",
      { memberId: OWNER_ID, protocol: 7, capabilities: new Set() },
      {
        platform: "android",
        value: {
          serverId: "phone-server-id",
          token: "e2e-token-".padEnd(40, "x"),
          secret: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
          locale: "en",
          away: true,
          level: "all",
          mutedUntil: null,
          preview: false,
          sound: "default",
        },
      },
    );
    return agent.id;
  });
  const forwarders = createRendererForwarders({
    getMainWindow: () => mainWindow,
    getChatWindows: () => [],
    getAgentService: () => agents ?? null,
    getHostService: () => null,
    getHostAnalytics: () => null,
    getRemoteServerManager: () => manager,
    showMainWindow: () => undefined,
    getTranslate: () => english,
    getFormat: () => createFormat("en"),
    desktopNotificationsEnabled: () => true,
    notificationPreviewEnabled: () => false,
    ownAgentNotificationLevels: () => ownLevels,
  });
  // For the local server the decision and the notification finish before `forwardAgentEvent` returns.
  const desktop = (event: AgentEvent) => forwarders.forwardAgentEvent(LOCAL_SERVER_ID, event);
  const ids = { threadId: "thread-1", turnId: "turn-1" };
  const browserStep = (requestId: number): AgentEvent => ({
    type: "browser-takeover-requested",
    request: { requestId, agentId, ...ids, tabId: "tab-1" },
  });
  const prompt = (requestId: number): AgentEvent => ({
    type: "prompt",
    requestId,
    agentId,
    ...ids,
    questions: [{ id: "q", header: "Question", question: "Which one?", options: null, isSecret: false }],
  });
  const startFailure: AgentEvent = { type: "error", agentId, code: "delivery_start_failed", message: "Refused." };
  const finished: AgentEvent = { type: "turn-completed", agentId, ...ids, status: "completed" };

  await step("A browser step notifies, and its end withdraws the notification", async () => {
    await setLevel("all");
    const from = shown.length;
    desktop(browserStep(1));
    assert.deepEqual(shownSince(from), [english("notification.needsBrowserStep")]);
    const notification = shown[from];
    assert.equal(notification?.closed, false);
    desktop({ type: "browser-takeover-resolved", requestId: 1, agentId });
    assert.equal(notification?.closed, true, "The finished browser step left its notification.");
    return { body: notification?.body };
  });

  await step("A message that did not start notifies at the level All only", async () => {
    const from = shown.length;
    desktop(startFailure);
    assert.deepEqual(shownSince(from), [english("notification.failed")]);
    await setLevel("needs-me");
    desktop(startFailure);
    assert.equal(shown.length, from + 1, "The level Only when it needs me showed a start failure.");
    return { shown: shownSince(from) };
  });

  await step("Only when it needs me: requests notify, a finished turn does not", async () => {
    const from = shown.length;
    desktop(finished);
    desktop(prompt(2));
    desktop(browserStep(3));
    assert.deepEqual(shownSince(from), [english("notification.needsInput"), english("notification.needsBrowserStep")]);
    return { shown: shownSince(from) };
  });

  await step("An answer on another device withdraws the question", async () => {
    const question = shown.find((notification) => notification.body === english("notification.needsInput"));
    assert.ok(question);
    desktop({ type: "agent-input-resolved", kind: "approval", requestId: 2, agentId });
    assert.equal(question.closed, false, "An approval answer withdrew a question with the same id.");
    desktop({ type: "agent-input-resolved", kind: "prompt", requestId: 2, agentId });
    assert.equal(question.closed, true, "The answered question left its notification.");
    return { closed: question.closed };
  });

  await step("A request id that comes again replaces the notification before it", async () => {
    const from = shown.length;
    desktop(prompt(4));
    desktop(prompt(4));
    assert.equal(shown.length, from + 2);
    assert.equal(shown[from]?.closed, true, "The earlier notification of the same request stayed.");
    assert.equal(shown[from + 1]?.closed, false);
    return { replaced: shown[from]?.closed };
  });

  await step("Muted or Nothing: no desktop notification", async () => {
    const from = shown.length;
    await setLevel("all", true);
    desktop(browserStep(5));
    desktop(finished);
    await setLevel("nothing");
    desktop(browserStep(6));
    desktop(startFailure);
    assert.deepEqual(shownSince(from), []);
    return { shown: shownSince(from).length };
  });

  /** Sends one event to the phone service and waits for the send that it causes. */
  const phoneSends = async (event: AgentEvent): Promise<void> => {
    const delivered = new Promise<void>((resolve) => sentWaiters.push(resolve));
    hostEvents.emit("event", event);
    await delivered;
  };
  /** Sends the events to the phone service, then one that always reaches the phone, as a barrier. */
  const phoneCount = async (events: AgentEvent[]): Promise<number> => {
    const from = sent.length;
    for (const event of events) hostEvents.emit("event", event);
    await setLevel("all", true);
    await phoneSends(browserStep(99));
    return sent.length - from - 1;
  };

  await step("The phone stays quiet for the events that the desktop shows", async () => {
    await setLevel("all");
    assert.equal(await phoneCount([browserStep(7), finished, startFailure]), 0);
    await setLevel("needs-me");
    assert.equal(await phoneCount([prompt(8)]), 0);
    return { sent: 0 };
  });

  await step("The phone tells the owner when the desktop does not", async () => {
    await setLevel("all", true);
    assert.equal(await phoneCount([browserStep(9), finished]), 2, "A muted desktop kept the phone quiet.");
    await setLevel("nothing");
    assert.equal(await phoneCount([prompt(10), startFailure]), 2, "The level Nothing kept the phone quiet.");
    await setLevel("needs-me");
    assert.equal(await phoneCount([finished, startFailure]), 2, "Only when it needs me kept a finished turn off both.");
    return { sent: sent.length };
  });

  await step("The level of an agent replaces the server level on the desktop", async () => {
    const from = shown.length;
    await setLevel("needs-me");
    ownLevels.set(agentId, "all");
    desktop(finished);
    ownLevels.set(agentId, "nothing");
    desktop(prompt(11));
    // The server level Nothing keeps every agent quiet, also one with its own level.
    await setLevel("nothing");
    ownLevels.set(agentId, "all");
    desktop(prompt(12));
    ownLevels.clear();
    assert.deepEqual(shownSince(from), [english("notification.finished")]);
    return { shown: shownSince(from) };
  });

  await step("The owner's phone follows the level of the agent", async () => {
    // The desktop is muted, so only the level of the agent can keep the phone quiet.
    await setLevel("all", true);
    const count = async (level: ServerNotificationLevel, events: AgentEvent[]): Promise<number> => {
      const from = sent.length;
      ownLevels.set(agentId, level);
      for (const event of events) hostEvents.emit("event", event);
      // The barrier always reaches the phone, so each event before it was decided.
      ownLevels.clear();
      await phoneSends(browserStep(98));
      return sent.length - from - 1;
    };
    assert.equal(await count("nothing", [browserStep(13), finished]), 0, "Nothing for the agent reached the phone.");
    assert.equal(await count("needs-me", [finished, prompt(14)]), 1, "Only when it needs me sent a finished turn.");
    return { sent: sent.length };
  });

  await step("The owner's phone follows the server level that the owner chose for all devices", async () => {
    // The phone registered "All activity". The level for all devices replaces it.
    await setLevel("all", true);
    const count = async (level: ServerNotificationLevel, events: AgentEvent[]): Promise<number> => {
      const from = sent.length;
      ownServerLevel = level;
      for (const event of events) hostEvents.emit("event", event);
      ownServerLevel = null;
      await phoneSends(browserStep(97));
      return sent.length - from - 1;
    };
    assert.equal(await count("needs-me", [finished, prompt(15)]), 1, "The server level of all devices was not used.");
    assert.equal(await count("nothing", [prompt(16), browserStep(17)]), 0, "The server level Nothing sent a request.");
    // The level of an agent still replaces the server level, but not a server level of Nothing.
    ownLevels.set(agentId, "all");
    assert.equal(await count("needs-me", [finished]), 1, "The agent level did not replace the server level.");
    assert.equal(await count("nothing", [finished]), 0, "The agent level opened a server set to Nothing.");
    ownLevels.clear();
    return { sent: sent.length };
  });

  report.passed = true;
} finally {
  await runCauseEffect(phone.dispose()).catch(() => undefined);
  await runCauseEffect(manager.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
