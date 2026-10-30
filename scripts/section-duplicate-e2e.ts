// Checks that the sidebar "Duplicate section" chain copies a section and its agents. The chain that the
// desktop and web clients run (`duplicateSection` in `@openbot/ui/features/sidebar/duplicate-section`) runs
// here against the real agent service and the real sidebar layout store on a temporary profile. Each call
// goes through the same backend path as the `agent:duplicate` and `agent:mutate-sidebar-layout` handlers.
// The agent service is not initialized, so no provider CLI starts.
// Run: `bun scripts/section-duplicate-e2e.ts`.
// Writes .openbot-build/section-duplicate-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SidebarLayoutAction, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { duplicateSection } from "@openbot/ui/features/sidebar/duplicate-section";
import { Effect } from "effect";
import { duplicateAgentIntoLayout } from "../src/backend/agent/duplication-gate";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/section-duplicate-e2e");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The context menu item and the renderer state updates. This check runs the shared chain against the backend; it does not render the sidebar.",
    "A copy of an agent that works. A busy source agent is refused by the host; this check uses idle agents.",
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

const root = await mkdtemp(join(tmpdir(), "openbot-section-duplicate-"));
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

const mutateLayout = (action: SidebarLayoutAction) => runCauseEffect(sidebar.mutate(action, agents.sidebarChatIds()));

function sectionAgentNames(layout: SidebarLayoutSnapshot, sectionId: string): string[] {
  const names = new Map(agents.listAgents().map((agent) => [agent.id, agent.name]));
  return layout.agentOrder
    .filter((agentId) => layout.agentAssignments[agentId] === sectionId)
    .map((agentId) => names.get(agentId) ?? agentId);
}

/** The dependencies that a client builds from its host calls. */
function deps(layout: SidebarLayoutSnapshot, options: { failOnCopy?: number } = {}) {
  let copies = 0;
  return {
    layout,
    agentIds: agents.listAgents().map((agent) => agent.id),
    duplicateAgent: async (agentId: string) => {
      copies += 1;
      if (copies === options.failOnCopy) throw new Error("Injected copy failure.");
      const result = await runCauseEffect(duplicateAgentIntoLayout(agents, sidebar, agentId));
      return { agentId: result.agent.id, layout: result.layout };
    },
    mutateLayout,
  };
}

try {
  const setup = await step("setup: a section with three agents, between two sections", async () => {
    const names = ["Cosmo", "Vanda", "Timmy"];
    const created = [];
    for (const name of names) {
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
    await mutateLayout({ type: "create", name: "Break it Up!" });
    await mutateLayout({ type: "create", name: "Later" });
    let layout = sidebar.getSnapshot();
    const source = layout.sections.find((section) => section.name === "Break it Up!");
    assert.ok(source);
    for (const agent of created) {
      layout = await mutateLayout({ type: "move-agent", agentId: agent.id, sectionId: source.id, beforeAgentId: null });
    }
    assert.deepEqual(sectionAgentNames(layout, source.id), names);
    return { sectionId: source.id, names, order: layout.order };
  });

  const first = await step("duplicate: a new section after the original with a copy of each agent", async () => {
    const before = sidebar.getSnapshot();
    const newId = await duplicateSection(deps(before), setup.sectionId);
    assert.ok(newId, "No section id answered.");
    const layout = sidebar.getSnapshot();
    const copy = layout.sections.find((section) => section.id === newId);
    assert.equal(copy?.name, "Break it Up! copy");
    assert.equal(
      layout.order.indexOf(newId),
      layout.order.indexOf(setup.sectionId) + 1,
      "The copy is not right after the original.",
    );
    assert.deepEqual(sectionAgentNames(layout, newId), ["Cosmo copy", "Vanda copy", "Timmy copy"]);
    assert.deepEqual(sectionAgentNames(layout, setup.sectionId), setup.names, "The original section changed.");
    const sourceIds = new Set(before.agentOrder.filter((id) => before.agentAssignments[id] === setup.sectionId));
    const copyIds = layout.agentOrder.filter((id) => layout.agentAssignments[id] === newId);
    assert.equal(copyIds.length, 3);
    assert.ok(
      copyIds.every((id) => !sourceIds.has(id)),
      "A copy reuses a source agent.",
    );
    return { sectionId: newId, order: layout.order, agents: sectionAgentNames(layout, newId) };
  });

  await step("duplicate: the copied agents start without messages", async () => {
    const layout = sidebar.getSnapshot();
    const copied = agents.listAgents().filter((agent) => layout.agentAssignments[agent.id] === first.sectionId);
    assert.equal(copied.length, 3);
    for (const agent of copied) assert.equal(agent.threadId, null, `${agent.name} has a thread.`);
    return copied.map((agent) => ({ name: agent.name, preview: agent.preview }));
  });

  const second = await step("duplicate again: the name stays unique", async () => {
    const newId = await duplicateSection(deps(sidebar.getSnapshot()), setup.sectionId);
    assert.ok(newId);
    const layout = sidebar.getSnapshot();
    assert.equal(layout.sections.find((section) => section.id === newId)?.name, "Break it Up! copy 2");
    assert.deepEqual(sectionAgentNames(layout, newId), ["Cosmo copy 2", "Vanda copy 2", "Timmy copy 2"]);
    return { sectionId: newId };
  });

  await step("failure: a failed copy stops the chain and leaves the original untouched", async () => {
    const before = sidebar.getSnapshot();
    await assert.rejects(duplicateSection(deps(before, { failOnCopy: 2 }), setup.sectionId), /Injected copy failure\./);
    const layout = sidebar.getSnapshot();
    assert.deepEqual(sectionAgentNames(layout, setup.sectionId), setup.names, "The original section changed.");
    const partial = layout.sections.find((section) => section.name === "Break it Up! copy 3");
    assert.ok(partial, "The partial section is gone.");
    assert.equal(layout.agentOrder.filter((id) => layout.agentAssignments[id] === partial.id).length, 1);
    return { partialSectionId: partial.id, kept: 1, secondCopy: second.sectionId };
  });

  await step("duplicate a copy: the name counts up instead of adding another copy", async () => {
    const newId = await duplicateSection(deps(sidebar.getSnapshot()), first.sectionId);
    assert.ok(newId);
    const layout = sidebar.getSnapshot();
    assert.equal(layout.sections.find((section) => section.id === newId)?.name, "Break it Up! copy 4");
    assert.equal(layout.order.indexOf(newId), layout.order.indexOf(first.sectionId) + 1);
    return { sectionId: newId, agents: sectionAgentNames(layout, newId) };
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
