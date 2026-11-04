// Checks that a member's phone stays quiet while the computer of the member's desktop app has input,
// also in another app, and notifies again when the computer has had no input for the away time.
// Before computer-activity-v1, only a send, an answer or typing in the desktop app kept the phone
// quiet, so a member who worked in another app on the same computer got each event on the phone too.
//
// A real `TeamApiServer` on loopback serves `computer-activity-v1` with a real phone notification
// service, wired as `HostService` wires it, with an away time of 2 seconds as `OPENBOT_DEV_AWAY_SECONDS`
// sets it. A real `ComputerActivityReport` reads a synthetic idle time and sends over HTTP through the
// frozen wire codec. The host clock and the idle time are synthetic, so no step waits for time. Two
// phones are registered: the owner's, and one of another member as the witness that an event was
// handled. Phone sends are recorded; nothing leaves the computer.
// Run it with `bun scripts/computer-activity-e2e.ts`.
// Writes .openbot-build/computer-activity-e2e/report.json.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V9,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol";
import {
  COMPUTER_ACTIVITY_CAPABILITY,
  COMPUTER_ACTIVITY_CODECS,
  COMPUTER_ACTIVITY_ROUTES,
} from "@openbot/contracts/team-protocol/computer-activity-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { encodeLiveActivityBytes, LIVE_ACTIVITY_SECRET_BYTES } from "@openbot/team-client/live-activity-seal";
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
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/computer-activity-e2e");
const APP_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 30_000;
const AWAY_AFTER_MS = 2_000;
const OWNER = { username: "owner-user", password: "owner-password-123" };
const OWNER_PHONE = "owner-phone-session";
const WITNESS = "witness-member";
const WITNESS_PHONE = "witness-phone-session";
const logger = createOpenBotLogger("computer-activity-e2e");

// The main process imports Electron. No check here opens a window.
plugin({
  name: "computer-activity-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => APP_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: class extends Inert {
          static getAllWindows() {
            return [];
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: class extends Inert {
          static isSupported() {
            return false;
          }
        },
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
const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");
const { PushNotificationService } = await import("../src/main/push-notifications");
const { ComputerActivityReport } = await import("../src/main/computer-activity-report");
const { decodeComputerActivityReply } = await import("../src/main/remote-host-decoding");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The Electron idle time (`powerMonitor.getSystemIdleTime`). The check gives the report a synthetic idle time.",
    "Which joined servers `RemoteServerManager` tells: online, with the capability, and shown on this desktop. That needs a remote connection.",
    "A request over WebRTC. The check sends over HTTP; both paths run the same route codec.",
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

const root = await mkdtemp(join(tmpdir(), "openbot-computer-activity-"));
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

const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
let agents: AgentService | undefined;
let server: InstanceType<typeof TeamApiServer> | undefined;
let phones: InstanceType<typeof PushNotificationService> | undefined;

/** The clock of the host's phone service, and the clock and idle time of the desktop. */
let hostNow = Date.now();
let desktopNow = hostNow;
let idleSeconds = 0;
/** Phone sends, by session, in order. */
const sent: string[] = [];
const sentWaiters = new Set<() => void>();
/** The activity requests of the desktop that have not answered yet. */
const pending = new Set<Promise<void>>();
const answers: boolean[] = [];

function nextSendTo(sessionId: string): Promise<number> {
  const from = sent.length;
  return new Promise((resolveSent) => {
    const check = () => {
      const index = sent.indexOf(sessionId, from);
      if (index < 0) return;
      sentWaiters.delete(check);
      resolveSent(index);
    };
    sentWaiters.add(check);
    check();
  });
}

/** One HTTP request of a protocol 9 peer that advertises the current capabilities. */
async function wire(
  port: number,
  input: { method: string; path: string; body?: unknown; token?: string },
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers({
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
    [TEAM_APP_VERSION_HEADER]: APP_VERSION,
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
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

function registerPhone(sessionId: string, memberId: string): void {
  assert.ok(phones);
  phones.register(
    sessionId,
    { memberId, protocol: TEAM_PROTOCOL_V9, capabilities: new Set() },
    {
      platform: "android",
      value: {
        serverId: "fixture-server",
        token: `${sessionId}-token-`.padEnd(40, "x"),
        secret: encodeLiveActivityBytes(randomBytes(LIVE_ACTIVITY_SECRET_BYTES)),
        locale: "en",
        away: true,
        level: "all",
        mutedUntil: null,
        preview: false,
        sound: "default",
      },
    },
  );
}

/** A turn that failed: an event that notifies at each level, with no answer to read. */
function failedTurn(agentId: string, threadId: string, turnId: string): AgentEvent {
  return { type: "turn-completed", agentId, threadId, turnId, status: "failed" };
}

try {
  const setup = await step("Start the host with phone notifications, and sign in the desktop", async () => {
    await runCauseEffect(sidebar.initialize());
    // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
    await runCauseEffect(agentStore.initialize());
    await runCauseEffect(mailbox.initialize());
    await runCauseEffect(team.initialize());
    const agent = await runCauseEffect(
      agentStore.createAgent({
        name: "Activity fixture",
        description: "Synthetic agent for the computer activity check",
        avatarSeed: "computer-activity",
        avatarHue: null,
      }),
    );
    agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
    await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
    const ownerId = team.getOwnerMemberId();
    assert.ok(ownerId, "The host has no owner.");
    const service = agents;
    // As `HostService` wires it, with the away time of `OPENBOT_DEV_AWAY_SECONDS=2`.
    phones = new PushNotificationService({
      agents: service,
      store: { list: () => [], replace: () => Effect.void },
      send: (request: NotificationRelayRequest) =>
        Effect.sync(() => {
          sent.push(request.push.sessionId);
          for (const wake of [...sentWaiters]) wake();
          return "sent" as const;
        }),
      hiddenAgentIds: () => new Set(),
      memberActive: () => true,
      lastUseElsewhere: (memberId, sessionId) => server?.lastMemberUseElsewhere(memberId, sessionId) ?? null,
      awayAfterMs: AWAY_AFTER_MS,
      atHostComputer: () => false,
      liveActivityShows: () => false,
      randomBytes: (size) => new Uint8Array(randomBytes(size)),
      now: () => hostNow,
      logger,
    });
    server = new TeamApiServer({
      store: team,
      agents: service,
      mailbox,
      browser: teamBrowser,
      sidebarLayout: sidebar,
      appVersion: APP_VERSION,
      pushNotifications: phones,
    });
    const port = await Effect.runPromise(server.start());
    phones.start();
    registerPhone(OWNER_PHONE, ownerId);
    registerPhone(WITNESS_PHONE, WITNESS);
    const login = await wire(port, { method: "POST", path: "/v1/auth/login", body: OWNER });
    assert.equal(login.status, 200, `Login failed: ${JSON.stringify(login.body)}`);
    assert.ok(isDynamicRecord(login.body) && typeof login.body.sessionToken === "string");
    // A new agent has no thread yet; a failed turn notifies the same in any thread.
    return { port, token: login.body.sessionToken, agentId: agent.id, threadId: agent.threadId ?? "activity-thread" };
  });
  const { port, token, agentId, threadId } = setup;
  const event = (turnId: string) => failedTurn(agentId, threadId, turnId);
  assert.ok(agents && phones && server);
  const service = agents;

  // Sends the owner's phone and the witness phone the next event, and tells which got it. The
  // phone service handles the phones of one event in one pass, so a send to the witness after the
  // owner's phone means that the owner's phone got no send for that event.
  async function phonesFor(turnId: string): Promise<{ owner: boolean }> {
    const from = sent.length;
    const witness = nextSendTo(WITNESS_PHONE);
    service.emit("event", event(turnId));
    const index = await witness;
    return { owner: sent.slice(from, index).includes(OWNER_PHONE) };
  }

  // A server stops being a target, as when the window loses focus with desktop notifications off.
  let targets = ["fixture-server"];
  const activity = new ComputerActivityReport({
    awayAfterMs: AWAY_AFTER_MS,
    idleSeconds: () => idleSeconds,
    targets: () => targets,
    send: (_serverId, idle) =>
      Effect.tryPromise(async () => {
        const body = { idleSeconds: idle };
        const codec = COMPUTER_ACTIVITY_CODECS.get(COMPUTER_ACTIVITY_ROUTES.report);
        assert.ok(codec, "The route has no codec.");
        // The client encodes through the frozen codec, as the remote transport does.
        codec.request(body);
        const response = await wire(port, { method: "POST", path: COMPUTER_ACTIVITY_ROUTES.report, body, token });
        assert.equal(response.status, 200, `Activity failed: ${JSON.stringify(response.body)}`);
        const phonesKnown = decodeComputerActivityReply(codec.response(response.status, response.body));
        answers.push(phonesKnown);
        return phonesKnown;
      }),
    run: (operation) => {
      const done = Effect.runPromise(operation);
      pending.add(done);
      void done.finally(() => pending.delete(done));
    },
    now: () => desktopNow,
  });
  /** Reads the idle time once, as the timer does, and waits for the sends that it started. */
  async function checkActivity(): Promise<number> {
    const before = answers.length;
    activity.check();
    await Promise.all([...pending]);
    return answers.length - before;
  }

  await step("The host advertises computer-activity-v1 to a protocol 9 peer", async () => {
    const compatibility = await wire(port, { method: "GET", path: TEAM_API_ROUTES.compatibility });
    assert.ok(isDynamicRecord(compatibility.body) && Array.isArray(compatibility.body.capabilities));
    assert.ok(compatibility.body.capabilities.includes(COMPUTER_ACTIVITY_CAPABILITY), "The capability is missing.");
    return { advertised: true };
  });

  await step("Without input, the owner's phone gets the event", async () => {
    const result = await phonesFor("turn-before-input");
    assert.equal(result.owner, true, "The owner's phone got no notification.");
    return result;
  });

  await step("Input on the computer keeps the owner's phone quiet, and the host knows the phone", async () => {
    idleSeconds = 0;
    const sends = await checkActivity();
    assert.equal(sends, 1, "The desktop did not tell the host.");
    assert.equal(answers.at(-1), true, "The host did not say that it notifies a phone of the member.");
    const result = await phonesFor("turn-during-input");
    assert.equal(result.owner, false, "The owner's phone got a notification while the computer had input.");
    return { sends, ...result };
  });

  await step("The desktop sends again only after new input", async () => {
    desktopNow += 1_000;
    idleSeconds = 1;
    const quiet = await checkActivity();
    assert.equal(quiet, 0, "The desktop sent with no input since its last send.");
    desktopNow += 500;
    idleSeconds = 0;
    const again = await checkActivity();
    assert.equal(again, 1, "The desktop did not send after new input.");
    return { withoutInput: quiet, afterInput: again };
  });

  await step("Activity is not use of a hosted server", async () => {
    assert.equal(server?.lastClientUseAt() ?? null, null, "An activity report moved the client use time.");
    return { lastClientUseAt: null };
  });

  await step("After the away time without input, the owner's phone gets the event again", async () => {
    desktopNow += AWAY_AFTER_MS;
    idleSeconds = AWAY_AFTER_MS / 1_000;
    const sends = await checkActivity();
    assert.equal(sends, 0, "The desktop sent while the computer had no input for the away time.");
    hostNow += AWAY_AFTER_MS;
    const result = await phonesFor("turn-after-away");
    assert.equal(result.owner, true, "The owner's phone stayed quiet after the away time.");
    return { sends, ...result };
  });

  await step("A host with no phone of the member is not told again for a while", async () => {
    phones?.remove(OWNER_PHONE);
    desktopNow += 1_000;
    idleSeconds = 0;
    const first = await checkActivity();
    assert.equal(first, 1, "The desktop did not tell the host.");
    assert.equal(answers.at(-1), false, "The host said that it notifies a phone of the member, which has none.");
    desktopNow += 1_000;
    const next = await checkActivity();
    assert.equal(next, 0, "The desktop told a host with no phone of the member again at once.");
    targets = [];
    desktopNow += 1_000;
    await checkActivity();
    targets = ["fixture-server"];
    desktopNow += 1_000;
    const afterTargetChange = await checkActivity();
    assert.equal(afterTargetChange, 0, "A target change ended the pause of a host with no phone of the member.");
    return { first, next, afterTargetChange };
  });

  report.passed = true;
} finally {
  if (phones) await Effect.runPromise(phones.dispose()).catch(() => undefined);
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}

if (!report.passed) process.exitCode = 1;
