// Checks pause and resume of a Slack workspace and a Discord server: pause stops the transport, the
// relay answers 200 for a paused workspace and passes nothing on, the other workspace keeps running,
// the pause stays after a restart, and resume identifies again and starts a new transport. Runs the
// real agent and messaging services on a temporary profile with fake platform drivers:
// `bun scripts/messaging-pause-resume-e2e.ts`.
// Writes .openbot-build/messaging-pause-resume-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MessagingConnection, MessagingPlatform, SetMessagingEnabledInput } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import type {
  IngressAnswer,
  IngressDelivery,
  IngressHandler,
  MessagingDriver,
  MessagingIngress,
} from "../src/backend/messaging/messaging-types";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { parseSetMessagingEnabledInput } from "../src/main/ipc/messaging-inputs";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-pause-resume-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-pause-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const SLACK = "T-pause-e2e";
const DISCORD = "guild-pause-e2e";
// A fake value. The report must never contain it.
const BOT_TOKEN = "fake-bot-token-for-pause-e2e";

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { steps: Step[]; passed: boolean; unverified: string[] } = {
  steps: [],
  passed: false,
  unverified: [
    "The real Slack and Discord drivers and the Signal relay socket: fake drivers and a captured ingress handler stand in for them.",
    "Telegram pause: a Telegram update goes through #deliverTelegram, which needs the Signal Telegram gateway.",
  ],
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  const entry: Step = { name, passed: false };
  report.steps.push(entry);
  try {
    entry.detail = await run();
    entry.passed = true;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/** No step needs the browser or a platform API call: a call to one of them is a failure. */
const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
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

/** The relay as Signal drives it: the service sets one handler, and each event goes through it. */
function fakeIngress(): { ingress: MessagingIngress; handler: () => IngressHandler | null } {
  let current: IngressHandler | null = null;
  return {
    handler: () => current,
    ingress: {
      acquire: () => () => {},
      state: () => "online",
      onState: () => () => {},
      handle: (handler) => {
        current = handler;
      },
      telegram: { available: () => false, call: unused, download: unused, upload: unused },
      reconnect: () => {},
      discord: unused,
      onDiscordRoutes: () => () => {},
    },
  };
}

/** What each platform's fake driver saw. */
interface DriverLog {
  identified: number;
  started: number;
  stopped: number;
  delivered: number;
  /** The transports that are started and not stopped. */
  live: number;
}

function fakeDriver(platform: MessagingPlatform, log: DriverLog): MessagingDriver {
  return {
    platform,
    requiredCredential: "botToken",
    createAdapter: () => ({
      platform,
      identify: () =>
        Effect.sync(() => {
          log.identified += 1;
          return {
            workspaceId: platform === "slack" ? SLACK : DISCORD,
            workspaceName: `${platform} workspace`,
            botUserId: `${platform}-bot`,
            appId: `${platform}-app`,
            missingScopes: [],
          };
        }),
      post: unused,
      edit: unused,
      postPrivate: unused,
      react: unused,
      postAnswer: unused,
      upload: unused,
      history: unused,
      recent: unused,
      download: unused,
      authorName: unused,
      placeName: unused,
      places: unused,
      mention: (userId) => `@${userId}`,
    }),
    createTransport: () => {
      let open = false;
      return {
        start: (sink) => {
          open = true;
          log.started += 1;
          log.live += 1;
          sink.state("connected");
        },
        reconnect: () => {},
        stop: () =>
          Effect.sync(() => {
            if (!open) return;
            open = false;
            log.stopped += 1;
            log.live -= 1;
          }),
        deliver: () =>
          Effect.sync((): IngressAnswer => {
            assert.ok(open, "A stopped transport took a delivery.");
            log.delivered += 1;
            return { status: 200, contentType: "text/plain", body: "taken" };
          }),
      };
    },
  };
}

/** The tokens of each connection, in memory. */
function memoryCredentials(): MessagingCredentials {
  const values = new Map<string, Record<string, string>>();
  return {
    keys: () => [...values.keys()],
    status: (connectionId) => (values.has(connectionId) ? "saved" : "missing"),
    get: (connectionId) => values.get(connectionId) ?? null,
    set: (connectionId, value) => Effect.sync(() => void values.set(connectionId, value)),
    clear: (connectionId) => Effect.sync(() => void values.delete(connectionId)),
    retain: (connectionIds) =>
      Effect.sync(() => {
        for (const key of values.keys()) if (!connectionIds.has(key)) values.delete(key);
      }),
  };
}

// The credential store outlives one boot, as the keychain does.
const credentials = memoryCredentials();

interface Booted {
  agents: AgentService;
  messaging: MessagingService;
  logs: Record<"slack" | "discord", DriverLog>;
  relay: () => IngressHandler | null;
}

async function boot<T>(use: (services: Booted) => Promise<T>): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
  const logs = {
    slack: { identified: 0, started: 0, stopped: 0, delivered: 0, live: 0 },
    discord: { identified: 0, started: 0, stopped: 0, delivered: 0, live: 0 },
  };
  const { ingress, handler } = fakeIngress();
  const messaging = new MessagingService({
    threads: agents.messaging,
    agents: {
      listAgents: () => agents.listAgents(),
      respondToApproval: (input) => agents.respondToApproval(input),
      onEvent: () => () => {},
      createAgentProfile: (input) => agents.createAgentProfile(input),
      createMemory: (input) => agents.createMemory(input),
      ensureDeletable: (agentId) => agents.ensureAgentDeletable(agentId),
      deleteAgent: (agentId) => agents.deleteAgent(agentId),
      sidebarChatIds: () => agents.sidebarChatIds(),
    },
    credentials,
    drivers: [fakeDriver("slack", logs.slack), fakeDriver("discord", logs.discord)],
    downloadsRoot: join(userData, "messaging-downloads"),
    ingress,
    sidebar,
  });
  await runCauseEffect(messaging.start());
  try {
    return await use({ agents, messaging, logs, relay: handler });
  } finally {
    await runCauseEffect(messaging.stop());
    await runCauseEffect(agents.stop());
    database.close();
  }
}

function connection(messaging: MessagingService, platform: "slack" | "discord"): MessagingConnection {
  const overview = platform === "slack" ? messaging.slackOverview() : messaging.discordOverview();
  const found = overview.connections.find(
    (candidate) => candidate.workspaceId === (platform === "slack" ? SLACK : DISCORD),
  );
  assert.ok(found, `The ${platform} connection is not in the overview.`);
  return found;
}

/** One Slack Events API request, as Signal passes it on after it checked the signature. */
function slackEvent(): IngressDelivery {
  return {
    platform: "slack",
    kind: "events",
    retryNum: null,
    body: new TextEncoder().encode(JSON.stringify({ type: "event_callback", team_id: SLACK })),
  };
}

async function relay(services: Booted, workspaceId: string): Promise<IngressAnswer> {
  const handler = services.relay();
  assert.ok(handler, "The messaging service has no relay handler.");
  return runCauseEffect(handler(workspaceId, slackEvent()));
}

/** The request that the Slack and Discord IPC handlers decode, then `setEnabled`. */
async function setEnabled(
  messaging: MessagingService,
  platform: "slack" | "discord",
  payload: SetMessagingEnabledInput,
): Promise<void> {
  const input = parseSetMessagingEnabledInput(payload);
  await runCauseEffect(messaging.setEnabled(platform, input.workspaceId, input.enabled));
}

function summary(services: Booted) {
  return {
    slack: { state: connection(services.messaging, "slack").state, ...services.logs.slack },
    discord: { state: connection(services.messaging, "discord").state, ...services.logs.discord },
  };
}

try {
  // The connections exist before the first boot, as after the OAuth callback of each platform.
  await boot(async ({ agents }) => {
    for (const [platform, workspaceId] of [
      ["slack", SLACK],
      ["discord", DISCORD],
    ] as const) {
      const record = agents.messaging.store.ensureConnection(platform, workspaceId, workspaceId);
      agents.messaging.store.updateConnection(record.connectionId, { enabled: true });
      await runCauseEffect(credentials.set(record.connectionId, { botToken: BOT_TOKEN }));
    }
  });

  await boot(async (services) => {
    const { messaging, logs } = services;

    await step("start: both connections identify and connect, and the relay passes Slack events on", async () => {
      assert.equal(connection(messaging, "slack").state, "connected");
      assert.equal(connection(messaging, "discord").state, "connected");
      assert.equal(logs.slack.live, 1, "Slack has no live transport.");
      assert.equal(logs.discord.live, 1, "Discord has no live transport.");
      const answer = await relay(services, SLACK);
      assert.equal(answer.body, "taken", "The Slack transport did not take the event.");
      assert.equal(logs.slack.delivered, 1);
      const unknown = await relay(services, "T-unknown");
      assert.equal(unknown.status, 404, "An unknown workspace did not answer 404.");
      return summary(services);
    });

    await step("pause: the decoder refuses an enabled value that is not a boolean", async () => {
      assert.throws(() => parseSetMessagingEnabledInput({ workspaceId: SLACK, enabled: "false" }));
      assert.equal(connection(messaging, "slack").enabled, true, "A refused request changed the connection.");
      return { slackEnabled: connection(messaging, "slack").enabled };
    });

    await step("pause Slack: the transport stops, and Discord keeps its transport", async () => {
      await setEnabled(messaging, "slack", { workspaceId: SLACK, enabled: false });
      const slack = connection(messaging, "slack");
      assert.equal(slack.enabled, false);
      assert.equal(slack.state, "paused");
      assert.equal(logs.slack.live, 0, "The paused Slack transport still runs.");
      assert.equal(logs.slack.stopped, 1);
      assert.equal(connection(messaging, "discord").state, "connected", "Pausing Slack changed Discord.");
      assert.equal(logs.discord.live, 1);
      return summary(services);
    });

    await step("paused: the relay answers 200 and passes no event on", async () => {
      const answer = await relay(services, SLACK);
      // 200 so that Slack does not send the event again.
      assert.equal(answer.status, 200);
      assert.equal(answer.body, undefined, "A paused workspace answered with the transport's body.");
      assert.equal(logs.slack.delivered, 1, "A paused workspace passed an event on.");
      return { status: answer.status, delivered: logs.slack.delivered };
    });

    await step("pause again: no transport starts or stops", async () => {
      const before = { ...logs.slack };
      await setEnabled(messaging, "slack", { workspaceId: SLACK, enabled: false });
      assert.deepEqual(logs.slack, before, "A second pause changed the transport.");
      assert.equal(connection(messaging, "slack").state, "paused");
      return summary(services);
    });

    await step("pause Discord: both connections are paused", async () => {
      await setEnabled(messaging, "discord", { workspaceId: DISCORD, enabled: false });
      assert.equal(connection(messaging, "discord").state, "paused");
      assert.equal(logs.discord.live, 0, "The paused Discord transport still runs.");
      assert.equal(messaging.hasLiveConnection(), false, "A paused connection counts as live.");
      return summary(services);
    });
  });

  await boot(async (services) => {
    const { messaging, logs } = services;

    await step("restart: the pause stays, and no transport starts", async () => {
      assert.equal(connection(messaging, "slack").state, "paused");
      assert.equal(connection(messaging, "discord").state, "paused");
      assert.equal(logs.slack.identified + logs.discord.identified, 0, "A paused connection identified on start.");
      assert.equal(logs.slack.started + logs.discord.started, 0, "A paused connection started a transport.");
      const answer = await relay(services, SLACK);
      assert.equal(answer.status, 200);
      assert.equal(logs.slack.delivered, 0);
      return summary(services);
    });

    await step("resume Slack: it identifies again and a new transport takes events", async () => {
      await setEnabled(messaging, "slack", { workspaceId: SLACK, enabled: true });
      const slack = connection(messaging, "slack");
      assert.equal(slack.enabled, true);
      assert.equal(slack.state, "connected");
      assert.equal(logs.slack.identified, 1);
      assert.equal(logs.slack.live, 1);
      const answer = await relay(services, SLACK);
      assert.equal(answer.body, "taken", "The resumed transport did not take the event.");
      assert.equal(logs.slack.delivered, 1);
      assert.equal(connection(messaging, "discord").state, "paused", "Resuming Slack changed Discord.");
      return summary(services);
    });

    await step("resume Discord: it identifies again and connects", async () => {
      await setEnabled(messaging, "discord", { workspaceId: DISCORD, enabled: true });
      assert.equal(connection(messaging, "discord").state, "connected");
      assert.equal(logs.discord.identified, 1);
      assert.equal(logs.discord.live, 1);
      return summary(services);
    });
  });

  await boot(async (services) => {
    await step("restart: the resume stays, and each connection starts once", async () => {
      assert.equal(connection(services.messaging, "slack").state, "connected");
      assert.equal(connection(services.messaging, "discord").state, "connected");
      assert.equal(services.logs.slack.started, 1);
      assert.equal(services.logs.discord.started, 1);
      return summary(services);
    });
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
assert.ok(!readFileSync(REPORT, "utf8").includes(BOT_TOKEN), "The report contains the bot token.");
process.stdout.write(`Messaging pause and resume check passed. Report: ${REPORT}\n`);
