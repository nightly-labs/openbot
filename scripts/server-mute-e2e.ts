// Checks mute and unmute of a server's desktop notifications on the real main-process path. The
// renderer's request goes through the real `servers:set-muted` IPC handler, with its sender check
// and its decoder, into a real `RemoteServerManager` on a temporary profile. A finished agent turn
// then goes through the real notification forwarder, with an Electron `Notification` that records
// what it shows. The manager restarts on the same file, and the clock moves past a timed mute.
// Only the local server is used, so no remote host or account is needed.
// Run: `bun scripts/server-mute-e2e.ts`.
// Writes .openbot-build/server-mute-e2e/report.json.

import { setSystemTime } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IPC_ENDPOINTS, LOCAL_SERVER_ID, SERVER_MUTE_DURATIONS_MS, type ServerSummary } from "@openbot/contracts/ipc";
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/server-mute-e2e");
const APP_VERSION = "0.0.0-e2e";
const TRUSTED_SENDER = { senderFrame: { url: "openbot-app://app/index.html" } };
const UNTRUSTED_SENDER = { senderFrame: { url: "https://example.com/" } };
const STEP_DEADLINE_MS = 30_000;
const FIFTEEN_MINUTES = 15 * 60_000;

// The sender check reads this variable in development. The packaged origin is the one checked here.
delete process.env.ELECTRON_RENDERER_URL;

/** The notifications that the forwarder showed, and the waiters for the next one. */
const shown: { title: string; body: string }[] = [];
const shownWaiters: (() => void)[] = [];
/** The IPC listeners that the handlers registered, by channel. */
const ipcListeners = new Map<string, (event: unknown, payload: unknown) => unknown>();

// The main process imports Electron. No check here opens a window or a real notification.
plugin({
  name: "server-mute-electron-boundary",
  setup(build) {
    class Inert {}
    class RecordingNotification {
      readonly #options: { title: string; body: string };
      constructor(options: { title: string; body: string }) {
        this.#options = options;
      }
      static isSupported() {
        return true;
      }
      on() {
        return this;
      }
      show() {
        shown.push(this.#options);
        for (const resolve of shownWaiters.splice(0)) resolve();
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
        ipcMain: {
          handle: (channel: string, listener: (event: unknown, payload: unknown) => unknown) =>
            ipcListeners.set(channel, listener),
          removeHandler: () => undefined,
          on: () => undefined,
        },
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
const { RemoteDesktopManager } = await import("../src/main/remote-desktop-manager");
const { HostService } = await import("../src/main/host-service");
const { TeamStore } = await import("../src/main/team-store");
const { teamIpcHandlers } = await import("../src/main/ipc/team-handlers");
const { createRendererForwarders } = await import("../src/main/renderer-forwarders");
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
    "The manager's own timer that reports the end of a timed mute as a change. It runs on real time, and the shortest mute is 15 minutes.",
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

const root = await mkdtemp(join(tmpdir(), "openbot-server-mute-"));
const userData = join(root, "user-data");
const serversPath = join(userData, "remote-servers.json");
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
let manager = new RemoteServerManager(serversPath, cipher, centralAccount, { appVersion: APP_VERSION });
let agents: AgentService | undefined;
/** Registers the IPC handler again after a restart. */
let restarted = () => {};

function isServerSummary(value: unknown): value is ServerSummary {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "notificationsMuted" in value &&
    typeof value.notificationsMuted === "boolean" &&
    "notificationsMutedUntil" in value &&
    (value.notificationsMutedUntil === null || typeof value.notificationsMutedUntil === "number")
  );
}

function localServer(servers: ServerSummary[]): ServerSummary {
  const server = servers.find((candidate) => candidate.id === LOCAL_SERVER_ID);
  assert.ok(server, "The server list has no local server.");
  return server;
}

/** Resolves with the next list that the manager reports as changed. */
function nextChange(): Promise<ServerSummary[]> {
  return new Promise((resolve) => manager.once("changed", resolve));
}

function nextNotification(): Promise<void> {
  return new Promise((resolve) => shownWaiters.push(resolve));
}

async function restartManager(): Promise<void> {
  await runCauseEffect(manager.stop());
  manager = new RemoteServerManager(serversPath, cipher, centralAccount, { appVersion: APP_VERSION });
  await runCauseEffect(manager.initialize());
  restarted();
}

try {
  const setup = await step("Start the manager, an agent and the forwarder", async () => {
    await runCauseEffect(sidebar.initialize());
    // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
    await runCauseEffect(agentStore.initialize());
    await runCauseEffect(mailbox.initialize());
    await runCauseEffect(team.initialize());
    const agent = await runCauseEffect(
      agentStore.createAgent({
        name: "Mute fixture",
        description: "Synthetic agent for the mute check",
        avatarSeed: "server-mute",
        avatarHue: null,
      }),
    );
    agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
    await runCauseEffect(manager.initialize());
    return { agentId: agent.id, agentName: agent.name, local: localServer(manager.list()).notificationsMuted };
  });
  assert.equal(setup.local, false, "A new profile starts muted.");
  const serviceForHost = agents;
  assert.ok(serviceForHost);
  const host = new HostService({
    appVersion: APP_VERSION,
    store: team,
    agents: serviceForHost,
    agentsReady: () => Effect.void,
    skills: { listInstalledForChatTags: () => Effect.succeed([]) },
    sidebarLayout: sidebar,
    mailbox,
    browser: teamBrowser,
    getSignedInUser: () => ({ id: "e2e-user", email: "e2e@example.invalid", name: null, avatarUrl: null }),
    redeemCentralTicket: () => Effect.succeed(null),
    sendTeamInviteEmail: unused,
  });
  const channel = IPC_ENDPOINTS.servers.setMuted.channel;
  /** Registers the real handler for the current manager, as the app does at each launch. */
  const bindHandler = () => {
    teamIpcHandlers({
      host,
      remoteDesktop: new RemoteDesktopManager(manager),
      remoteServers: manager,
      takePendingInvite: () => null,
    }).servers.setMuted(channel);
  };
  bindHandler();
  restarted = bindHandler;
  const invoke = async (payload: unknown, sender: unknown = TRUSTED_SENDER): Promise<ServerSummary[]> => {
    const listener = ipcListeners.get(channel);
    assert.ok(listener, `No IPC handler is registered for ${channel}.`);
    const result = await listener(sender, payload);
    assert.ok(Array.isArray(result) && result.every(isServerSummary), "The handler did not return the server list.");
    return result;
  };

  let turn = 0;
  /** A finished turn of the agent, as the agent service reports it. */
  const finishTurn = () => {
    turn += 1;
    createRendererForwarders({
      getMainWindow: () => mainWindow,
      getChatWindows: () => [],
      getAgentService: () => agents ?? null,
      getHostService: () => null,
      getHostAnalytics: () => null,
      getRemoteServerManager: () => manager,
      showMainWindow: () => undefined,
      getTranslate: () => translateFor("en"),
      getFormat: () => createFormat("en"),
      desktopNotificationsEnabled: () => true,
      notificationPreviewEnabled: () => false,
      ownAgentNotificationLevels: () => new Map(),
    }).forwardAgentEvent(LOCAL_SERVER_ID, {
      type: "turn-completed",
      agentId: setup.agentId,
      threadId: `thread-${turn}`,
      turnId: `turn-${turn}`,
      status: "completed",
    });
  };

  await step("A notification shows while the server is not muted", async () => {
    const notified = nextNotification();
    finishTurn();
    await notified;
    assert.equal(shown.length, 1);
    assert.equal(shown[0]?.title, setup.agentName);
    return { shown: shown.length, title: shown[0]?.title };
  });

  await step("The IPC handler refuses a request that is not valid", async () => {
    const refusals: Record<string, string> = {};
    const attempts: [string, unknown, unknown][] = [
      ["untrusted sender", { serverId: LOCAL_SERVER_ID, muted: true }, UNTRUSTED_SENDER],
      ["duration not in the menu", { serverId: LOCAL_SERVER_ID, muted: true, durationMs: 5_000 }, TRUSTED_SENDER],
      [
        "duration on an unmute",
        { serverId: LOCAL_SERVER_ID, muted: false, durationMs: FIFTEEN_MINUTES },
        TRUSTED_SENDER,
      ],
      ["muted is not a boolean", { serverId: LOCAL_SERVER_ID, muted: "yes" }, TRUSTED_SENDER],
    ];
    for (const [label, payload, sender] of attempts) {
      const error = await invoke(payload, sender).then(
        () => null,
        (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
      );
      assert.ok(error, `The handler accepted a request with ${label}.`);
      refusals[label] = error;
    }
    assert.equal(localServer(manager.list()).notificationsMuted, false, "A refused request changed the mute.");
    return refusals;
  });

  await step("Mute until unmuted: no notification, and the mute survives a restart", async () => {
    const changed = nextChange();
    const returned = localServer(await invoke({ serverId: LOCAL_SERVER_ID, muted: true }));
    const emitted = localServer(await changed);
    for (const server of [returned, emitted]) {
      assert.equal(server.notificationsMuted, true);
      assert.equal(server.notificationsMutedUntil, null);
    }
    // For the local server the gate and the notification finish before `forwardAgentEvent` returns.
    finishTurn();
    await restartManager();
    const restarted = localServer(manager.list());
    assert.equal(restarted.notificationsMuted, true, "The mute did not survive a restart.");
    finishTurn();
    assert.equal(shown.length, 1, "A muted server showed a notification.");
    return { returned: returned.notificationsMuted, emitted: emitted.notificationsMuted, afterRestart: true };
  });

  await step("Unmute: the next finished turn shows a notification", async () => {
    const changed = nextChange();
    const returned = localServer(await invoke({ serverId: LOCAL_SERVER_ID, muted: false }));
    assert.equal(returned.notificationsMuted, false);
    assert.equal(localServer(await changed).notificationsMuted, false);
    const notified = nextNotification();
    finishTurn();
    await notified;
    assert.equal(shown.length, 2);
    return { shown: shown.length };
  });

  const mutedUntil = await step("Timed mute: it records its end, and it survives a restart", async () => {
    assert.ok(SERVER_MUTE_DURATIONS_MS.includes(FIFTEEN_MINUTES));
    const before = Date.now();
    const returned = localServer(await invoke({ serverId: LOCAL_SERVER_ID, muted: true, durationMs: FIFTEEN_MINUTES }));
    const after = Date.now();
    const until = returned.notificationsMutedUntil;
    assert.equal(returned.notificationsMuted, true);
    assert.ok(until !== null && until >= before + FIFTEEN_MINUTES && until <= after + FIFTEEN_MINUTES);
    finishTurn();
    await restartManager();
    const restarted = localServer(manager.list());
    assert.equal(restarted.notificationsMuted, true);
    assert.equal(restarted.notificationsMutedUntil, until, "The restart changed the end of the mute.");
    finishTurn();
    assert.equal(shown.length, 2, "A server with a timed mute showed a notification.");
    return until;
  });

  await step("Timed mute ends: notifications show again, also after a restart", async () => {
    setSystemTime(new Date(mutedUntil + 1_000));
    const ended = localServer(manager.list());
    assert.equal(ended.notificationsMuted, false);
    assert.equal(ended.notificationsMutedUntil, null);
    const notified = nextNotification();
    finishTurn();
    await notified;
    await restartManager();
    assert.equal(localServer(manager.list()).notificationsMuted, false);
    assert.equal(shown.length, 3);
    return { shown: shown.length };
  });

  await step("A permanent mute does not end with time", async () => {
    await invoke({ serverId: LOCAL_SERVER_ID, muted: true });
    setSystemTime(new Date(mutedUntil + 365 * 24 * 60 * 60_000));
    await restartManager();
    const server = localServer(manager.list());
    assert.equal(server.notificationsMuted, true);
    finishTurn();
    assert.equal(shown.length, 3);
    const changed = nextChange();
    await invoke({ serverId: LOCAL_SERVER_ID, muted: false });
    assert.equal(localServer(await changed).notificationsMuted, false);
    return { mutedAfterAYear: server.notificationsMuted };
  });

  report.passed = true;
} finally {
  setSystemTime();
  await runCauseEffect(manager.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
