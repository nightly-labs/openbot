// Checks that a disconnect of Slack, Discord or Telegram deletes the orchestrator that no other
// connected place uses, keeps every other agent, deletes the Integrations section when no agent is
// left in it, and changes nothing when the orchestrator cannot be deleted. Runs the real agent,
// messaging and sidebar services on a temporary profile, and boots them again to check that the
// result stays: `bun scripts/messaging-disconnect-orchestrator-e2e.ts`.
// Writes .openbot-build/messaging-disconnect-orchestrator-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MessagingPlatform, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentLifecycleFailed, AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { type MessagingCredentials, MessagingService } from "../src/backend/messaging/messaging-service";
import type { MessagingIngress } from "../src/backend/messaging/messaging-types";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/messaging-disconnect-orchestrator-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-messaging-disconnect-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const SECTION = sourceText("status.messaging.integrationsSection");

interface Step {
  name: string;
  agents: string[];
  sectionChats: string[] | null;
  passed: boolean;
}

const report: { steps: Step[]; passed: boolean } = { steps: [], passed: false };

/** No test needs the browser, Signal or a platform: a call to one of them is a failure. */
const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
};
const ingress: MessagingIngress = {
  acquire: () => () => {},
  state: () => "unavailable",
  onState: () => () => {},
  handle: () => {},
  telegram: { available: () => false, call: unused, download: unused, upload: unused },
  reconnect: () => {},
  discord: unused,
  onDiscordRoutes: () => () => {},
};

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

async function boot<T>(
  use: (services: {
    agents: AgentService;
    messaging: MessagingService;
    sidebar: SidebarLayoutStore;
    credentials: MessagingCredentials;
    busy: Set<string>;
  }) => Promise<T>,
): Promise<T> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  await runCauseEffect(sidebar.initialize());
  // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
  const credentials = memoryCredentials();
  // An agent named here is busy. A turn needs a provider, so the check gives the error of a busy agent.
  const busy = new Set<string>();
  const messaging = new MessagingService({
    threads: agents.messaging,
    agents: {
      listAgents: () => agents.listAgents(),
      respondToApproval: (input) => agents.respondToApproval(input),
      onEvent: () => () => {},
      createAgentProfile: (input) => agents.createAgentProfile(input),
      createMemory: (input) => agents.createMemory(input),
      ensureDeletable: (agentId) =>
        busy.has(agentId)
          ? Effect.fail(
              new AgentLifecycleFailed({
                operation: "deleteAgent",
                cause: new Error(sourceText("error.agent.stopBeforeDelete")),
              }),
            )
          : agents.ensureAgentDeletable(agentId),
      deleteAgent: (agentId) => agents.deleteAgent(agentId),
      sidebarChatIds: () => agents.sidebarChatIds(),
    },
    credentials,
    drivers: [],
    downloadsRoot: join(userData, "messaging-downloads"),
    ingress,
    telegramApp: { createLink: unused, unlink: () => Effect.void, openExternal: async () => {} },
    sidebar,
  });
  try {
    return await use({ agents, messaging, sidebar, credentials, busy });
  } finally {
    await runCauseEffect(agents.stop());
    database.close();
  }
}

/** The agents and group chats in the Integrations section, or null when it is gone. */
function sectionChats(layout: SidebarLayoutSnapshot, chatIds: ReadonlySet<string>): string[] | null {
  const section = layout.sections.find((candidate) => candidate.name === SECTION);
  if (!section) return null;
  return Object.entries(layout.agentAssignments)
    .filter(([chatId, sectionId]) => sectionId === section.id && chatIds.has(chatId))
    .map(([chatId]) => chatId)
    .sort();
}

try {
  const ids = await boot(async ({ agents, messaging, sidebar, credentials, busy }) => {
    async function connect(platform: MessagingPlatform, workspaceId: string): Promise<void> {
      const record = agents.messaging.store.ensureConnection(platform, workspaceId, workspaceId);
      agents.messaging.store.updateConnection(record.connectionId, { enabled: true });
      await runCauseEffect(credentials.set(record.connectionId, { workspaceId }));
    }
    function check(name: string, expected: { agents: string[]; sectionChats: string[] | null }): void {
      const step: Step = {
        name,
        agents: agents
          .listAgents()
          .map((agent) => agent.id)
          .sort(),
        sectionChats: sectionChats(sidebar.getSnapshot(), agents.sidebarChatIds()),
        passed: false,
      };
      report.steps.push(step);
      assert.deepEqual(step.agents, [...expected.agents].sort(), `${name}: agents`);
      assert.deepEqual(step.sectionChats, expected.sectionChats?.slice().sort() ?? null, `${name}: section`);
      step.passed = true;
    }

    const user = await runCauseEffect(
      agents.createAgentProfile({ name: "Own agent", description: "", avatarSeed: "own", avatarHue: null }),
    );

    // Zero bound agents: a Discord server with no orchestrator.
    await connect("discord", "guild-empty");
    await runCauseEffect(messaging.disconnectDiscordGuild("guild-empty"));
    check("disconnect with no orchestrator", { agents: [user.id], sectionChats: null });

    // Several connectors, with the user's own agent filed in the Integrations section too.
    await connect("slack", "workspace-1");
    await connect("discord", "guild-1");
    await connect("telegram", "chat-1");
    await connect("telegram", "chat-2");
    const slack = await runCauseEffect(messaging.addOrchestrator("slack", { workspaceId: "workspace-1" }));
    const discord = await runCauseEffect(messaging.addOrchestrator("discord", { workspaceId: "guild-1" }));
    const telegram = await runCauseEffect(messaging.addTelegramOrchestrator({}));
    assert.ok(slack.sectionId, "The Slack Orchestrator has no section.");
    await runCauseEffect(
      sidebar.mutate(
        { type: "assign", agentId: user.id, sectionId: slack.sectionId },
        new Set(agents.listAgents().map((agent) => agent.id)),
      ),
    );
    const all = [user.id, slack.agentId, discord.agentId, telegram.agentId];
    check("set up", { agents: all, sectionChats: all });

    await runCauseEffect(messaging.disconnectSlackWorkspace("workspace-1"));
    const afterSlack = [user.id, discord.agentId, telegram.agentId];
    check("disconnect Slack deletes only its orchestrator", { agents: afterSlack, sectionChats: afterSlack });

    // A busy orchestrator stops the disconnect before it changes anything.
    busy.add(discord.agentId);
    const refused = await runCauseEffect(Effect.result(messaging.disconnectDiscordGuild("guild-1")));
    assert.equal(refused._tag, "Failure", "A busy orchestrator did not stop the disconnect.");
    const guild = agents.messaging.store.connectionForWorkspace("discord", "guild-1");
    assert.ok(guild?.enabled, "A refused disconnect disabled the Discord server.");
    assert.equal(credentials.status(guild.connectionId), "saved", "A refused disconnect removed the token.");
    check("busy orchestrator refuses the disconnect", { agents: afterSlack, sectionChats: afterSlack });
    busy.delete(discord.agentId);

    await runCauseEffect(messaging.disconnectDiscordGuild("guild-1"));
    check("disconnect Discord", { agents: [user.id, telegram.agentId], sectionChats: [user.id, telegram.agentId] });

    // The Telegram Orchestrator answers every chat: it goes with the last one.
    await runCauseEffect(messaging.disconnectTelegramChat("chat-1"));
    check("disconnect one of two Telegram chats", {
      agents: [user.id, telegram.agentId],
      sectionChats: [user.id, telegram.agentId],
    });
    await runCauseEffect(messaging.disconnectTelegramChat("chat-2"));
    check("disconnect the last Telegram chat keeps the section of the user's agent", {
      agents: [user.id],
      sectionChats: [user.id],
    });

    // A group chat that the user filed in the section keeps it too.
    const section = sidebar.getSnapshot().agentAssignments[user.id];
    assert.ok(section, "The user's agent left the section.");
    const group = await runCauseEffect(
      agents.channels.command(
        {
          type: "save",
          operationId: "messaging-disconnect-e2e:group",
          channelId: "group-1",
          draft: { name: "Group", title: "", instructions: "", members: [{ agentId: user.id }], leadAgentId: null },
        },
        { id: "openbot", name: "OpenBot" },
      ),
    );
    await runCauseEffect(
      sidebar.mutate({ type: "assign", agentId: user.id, sectionId: null }, agents.sidebarChatIds()),
    );
    await runCauseEffect(
      sidebar.mutate({ type: "assign", agentId: group.id, sectionId: section }, agents.sidebarChatIds()),
    );
    await connect("slack", "workspace-2");
    const second = await runCauseEffect(messaging.addOrchestrator("slack", { workspaceId: "workspace-2" }));
    check("set up an orchestrator next to a group chat", {
      agents: [user.id, second.agentId],
      sectionChats: [group.id, second.agentId],
    });
    await runCauseEffect(messaging.disconnectSlackWorkspace("workspace-2"));
    check("disconnect keeps the section of a group chat", { agents: [user.id], sectionChats: [group.id] });

    // With the group chat moved out, the last orchestrator takes the section with it.
    await runCauseEffect(
      sidebar.mutate({ type: "assign", agentId: group.id, sectionId: null }, agents.sidebarChatIds()),
    );
    await connect("slack", "workspace-3");
    const last = await runCauseEffect(messaging.addOrchestrator("slack", { workspaceId: "workspace-3" }));
    check("set up the last orchestrator", { agents: [user.id, last.agentId], sectionChats: [last.agentId] });
    await runCauseEffect(messaging.disconnectSlackWorkspace("workspace-3"));
    check("disconnect the last orchestrator deletes the section", { agents: [user.id], sectionChats: null });
    return { user: user.id };
  });

  // The outcome stays after a restart.
  await boot(async ({ agents, sidebar }) => {
    const agentIds = new Set(agents.listAgents().map((agent) => agent.id));
    const step: Step = {
      name: "after restart",
      agents: [...agentIds].sort(),
      sectionChats: sectionChats(sidebar.getSnapshot(), agents.sidebarChatIds()),
      passed: false,
    };
    report.steps.push(step);
    assert.deepEqual(step.agents, [ids.user], "after restart: agents");
    assert.equal(step.sectionChats, null, "after restart: section");
    const orchestrators = agents.messaging.store
      .connections()
      .map((record) => record.orchestratorAgentId)
      .filter((agentId) => agentId !== null);
    assert.deepEqual(orchestrators, [], "after restart: a connection still names a deleted orchestrator");
    step.passed = true;
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`Messaging disconnect check passed. Report: ${join(OUT, "report.json")}\n`);
