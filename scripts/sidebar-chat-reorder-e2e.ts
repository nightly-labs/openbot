// Checks that a drag inside a section puts the chat where the sidebar showed it would go (#3229). The drop
// action runs against the real agent service, channel store and sidebar layout store on a temporary profile,
// through the same backend path as the `agent:mutate-sidebar-layout` handler. The chats are filed with
// `assign`, as "Move to" and agent creation do, so the layout has no order for them yet.
// The agent service is not initialized, so no provider CLI starts.
// Run: `bun scripts/sidebar-chat-reorder-e2e.ts`.
// Writes .openbot-build/sidebar-chat-reorder-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SidebarLayoutAction } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/sidebar-chat-reorder-e2e");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The pointer and the drop preview. This check sends the drop action to the backend; it does not render the sidebar or drag a row.",
    "The sidebar order and the drop action are copied here from the shared sidebar stores, which `typecheck:node` cannot follow into their .tsx imports.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

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

const root = await mkdtemp(join(tmpdir(), "openbot-sidebar-chat-reorder-"));
const userData = join(root, "user-data");
const home = join(root, "home");

const database = new OpenBotDatabase(userData);
const agentStore = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
await runCauseEffect(sidebar.initialize());
await runCauseEffect(agentStore.initialize());
await runCauseEffect(mailbox.initialize());
const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
const actor = { id: "sidebar-chat-reorder-e2e", name: "Reorder check" };

const mutateLayout = (action: SidebarLayoutAction) => runCauseEffect(sidebar.mutate(action, agents.sidebarChatIds()));

const names = new Map<string, string>();

/**
 * The names the sidebar shows in a section, top to bottom, by the rule of `sortByLayoutOrder` over
 * `[...channels, ...agents]` in `packages/ui/src/features/sidebar/stores/data-store.ts`: the ids in
 * `agentOrder` first, in that order, then the rest with the channels above the agents.
 */
function shown(sectionId: string): string[] {
  const layout = sidebar.getSnapshot();
  const chatIds = [
    ...agents.channels.store.list(actor.id, true).map((channel) => channel.id),
    ...agents.listAgents().map((agent) => agent.id),
  ];
  const orderIndex = new Map(layout.agentOrder.map((chatId, index) => [chatId, index]));
  const naturalIndex = new Map(chatIds.map((chatId, index) => [chatId, index]));
  const rank = (chatId: string) => orderIndex.get(chatId) ?? layout.agentOrder.length + (naturalIndex.get(chatId) ?? 0);
  return chatIds
    .filter((chatId) => layout.agentAssignments[chatId] === sectionId)
    .sort((left, right) => rank(left) - rank(right))
    .map((chatId) => names.get(chatId) ?? chatId);
}

/**
 * The drop of `name` on `targetName` in its own section: the placement the drag engine gives a row there
 * (`placementForSwap`), and the action `moveChatAction` in `stores/layout-actions.ts` sends for it.
 */
async function drop(sectionId: string, name: string, targetName: string): Promise<string[]> {
  const idOf = (wanted: string) => [...names].find(([, value]) => value === wanted)?.[0];
  const chatId = idOf(name);
  const targetId = idOf(targetName);
  assert.ok(chatId && targetId);
  const before = shown(sectionId);
  const placement = before.indexOf(name) < before.indexOf(targetName) ? "after" : "before";
  const rest = before.filter((candidate) => candidate !== name);
  const next = rest[rest.indexOf(targetName) + 1];
  await mutateLayout({
    type: "move-agent",
    agentId: chatId,
    sectionId,
    beforeAgentId: placement === "before" ? targetId : next === undefined ? null : (idOf(next) ?? null),
  });
  const expected = [...rest];
  expected.splice(rest.indexOf(targetName) + (placement === "after" ? 1 : 0), 0, name);
  assert.deepEqual(
    shown(sectionId),
    expected,
    `Shown ${JSON.stringify(before)}, then dropped ${name} on ${targetName}.`,
  );
  return shown(sectionId);
}

try {
  const sectionId = await step("setup: a section with two agents and three channels, filed with assign", async () => {
    const created = [];
    for (const name of ["Cosmo", "Vanda"]) {
      created.push(
        await runCauseEffect(
          agents.createAgentProfile({
            name,
            description: `${name} helps.`,
            avatarSeed: name.toLowerCase(),
            avatarHue: null,
          }),
        ),
      );
    }
    for (const agent of created) names.set(agent.id, agent.name);
    const lead = created[0];
    assert.ok(lead);
    // Random ids, so the primary-key order of the channel table is not the order they were made in.
    for (const name of ["general", "design", "launch"]) {
      const channel = await runCauseEffect(
        agents.channels.command(
          {
            type: "save",
            operationId: crypto.randomUUID(),
            channelId: crypto.randomUUID(),
            draft: { name, title: "", instructions: "", members: [{ agentId: lead.id }], leadAgentId: lead.id },
          },
          actor,
        ),
      );
      names.set(channel.id, name);
    }
    await mutateLayout({ type: "create", name: "Work" });
    const section = sidebar.getSnapshot().sections.find((candidate) => candidate.name === "Work");
    assert.ok(section);
    for (const chatId of names.keys()) await mutateLayout({ type: "assign", agentId: chatId, sectionId: section.id });
    assert.equal(shown(section.id).length, 5);
    return section.id;
  });

  await step("drop a channel above another channel", async () => {
    const order = shown(sectionId);
    const last = order.findLast((name) => ["general", "design", "launch"].includes(name));
    const first = order.find((name) => ["general", "design", "launch"].includes(name));
    assert.ok(last && first && last !== first);
    return drop(sectionId, last, first);
  });

  await step("drop a channel below the last row", async () => {
    const order = shown(sectionId);
    const channel = order.find((name) => ["general", "design", "launch"].includes(name));
    const lastRow = order.at(-1);
    assert.ok(channel && lastRow && channel !== lastRow);
    return drop(sectionId, channel, lastRow);
  });

  await step("drop a channel past an agent", async () => {
    const order = shown(sectionId);
    const channel = order.findLast((name) => ["general", "design", "launch"].includes(name));
    const agent = order.find((name) => name === "Cosmo" || name === "Vanda");
    assert.ok(channel && agent);
    return drop(sectionId, channel, agent);
  });

  report.passed = true;
} finally {
  await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
