import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentEvent, ChannelSummary, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import {
  type ChatListItem,
  type ChatListRow,
  channelAgentLookup,
  chatListRows,
  chatListSectionIds,
} from "../apps/mobile/src/features/agents/model/chat-list-rows";
import { reduceAgentActivity } from "../apps/mobile/src/features/workspace/model/agent-activity";
import { NO_CONTEXT_STATES, reduceContextStates } from "../apps/mobile/src/features/workspace/model/context-states";
import { LiveWorkspaceStore } from "../apps/mobile/src/features/workspace/model/live-workspace-store";
import { agentThreadWaitReason, reduceThreadWaits } from "../apps/mobile/src/features/workspace/model/thread-waits";
import { appendTurnStepLine } from "../apps/mobile/src/features/workspace/model/turn-step-lines";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "mobile-agent-list-e2e");
const SERVER_ID = "server-1";
const AGENT_COUNT = 200;
const SECTION_COUNT = 8;
const CHANNEL_COUNT = 6;
const EVENT_COUNT = 500;
const PRESENCE_EVERY = 5;
const PREVIEW_EVERY = 10;
const ROW_SELECTORS = 4;

interface Agent {
  id: string;
  serverId: string;
  name: string;
  title: string;
  preview: string;
  avatarSeed: string;
  avatarHue: null;
  avatarColor: null;
}

type Item =
  | Extract<ChatListItem, { kind: "section" }>
  | { kind: "agent"; id: string; agent: Agent }
  | { kind: "channel"; id: string; channel: ChannelSummary };
type Row = ChatListRow<Item>;
type Store = LiveWorkspaceStore;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function makeAgent(index: number, preview = `Hello ${index}`): Agent {
  return {
    id: `agent-${String(index).padStart(3, "0")}`,
    serverId: SERVER_ID,
    name: `Agent ${index}`,
    title: "",
    preview,
    avatarSeed: `seed-${index}`,
    avatarHue: null,
    avatarColor: null,
  };
}

function makeChannel(index: number): ChannelSummary {
  return {
    id: `channel-${index}`,
    name: `Channel ${index}`,
    title: "",
    instructions: "",
    members: [{ agentId: makeAgent(index).id }, { agentId: makeAgent(index + 1).id }],
    leadAgentId: null,
    archived: false,
    revision: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    unreadCount: 0,
    activeTasks: 0,
    lastMessage: null,
  };
}

function sidebarItems(agents: readonly Agent[], channels: readonly ChannelSummary[]): Item[] {
  const sections = Array.from({ length: SECTION_COUNT }, (_, index) => `section-${index}`);
  return [
    ...sections.flatMap((sectionId, sectionIndex): Item[] => [
      {
        kind: "section",
        id: sectionId,
        name: `Folder ${sectionIndex}`,
        title: `Folder ${sectionIndex}`,
        parentName: null,
        ancestorIds: [],
        custom: true,
        empty: false,
      },
      ...agents
        .filter((_, index) => index % SECTION_COUNT === sectionIndex)
        .map((agent): Item => ({ kind: "agent", id: agent.id, agent })),
    ]),
    {
      kind: "section",
      id: SIDEBAR_UNASSIGNED_SECTION_ID,
      name: "Agents",
      title: "Agents",
      parentName: null,
      ancestorIds: [],
      custom: false,
      empty: false,
    },
    ...channels.map((channel): Item => ({ kind: "channel", id: channel.id, channel })),
  ];
}

const AGENT_ID = makeAgent(42).id;
const THREAD_ID = "thread-42";
const TURN_ID = "turn-42";

function event(index: number): AgentEvent | TeamRealtimeEvent {
  if (index % PRESENCE_EVERY === 0)
    return {
      type: "team-presence",
      snapshot: {
        serverId: SERVER_ID,
        members: [],
        updatedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString(),
      },
    };
  if (index % 2 === 0)
    return {
      type: "conversation-delta",
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      turnId: TURN_ID,
      messageId: "message-42",
      delta: `word ${index} `,
      createdAt: "2026-11-01T00:00:00.000Z",
      revision: index,
    };
  return { type: "turn-progress", agentId: AGENT_ID, threadId: THREAD_ID, turnId: TURN_ID, detail: `Step ${index}` };
}

function applyLiveEvent(store: Store, serverId: string, live: AgentEvent | TeamRealtimeEvent) {
  if (live.type === "team-presence") return;
  store.update("activityByServer", (current) => {
    const previous = current[serverId] ?? {};
    const next = reduceAgentActivity(previous, live);
    return next === previous ? current : { ...current, [serverId]: next };
  });
  store.update("contextByServer", (current) => {
    const previous = current[serverId] ?? NO_CONTEXT_STATES;
    const next = reduceContextStates(previous, live);
    return next === previous ? current : { ...current, [serverId]: next };
  });
  store.update("threadWaitsByServer", (current) => {
    const previous = current[serverId] ?? [];
    const next = reduceThreadWaits(previous, live, () => false);
    return next === previous ? current : { ...current, [serverId]: next };
  });
  if (live.type === "turn-progress")
    store.update("turnLinesByServer", (current) => {
      const previous = current[serverId] ?? {};
      const next = appendTurnStepLine(previous, live.turnId, live.detail, null);
      return next === previous ? current : { ...current, [serverId]: next };
    });
}

interface Counters {
  rowSelectorRuns: number;
  screenSelectorRuns: number;
  rowRerenders: number;
  rowItemIdentityChanges: number;
  listRenderItemChanges: number;
  channelLookupChanges: number;
}

function rowSelectors(store: Store, agentId: string) {
  return [
    () => store.get().activityByServer[SERVER_ID]?.[agentId],
    () => agentThreadWaitReason(store.get().threadWaitsByServer[SERVER_ID] ?? [], agentId),
    () => store.get().unreadAgentIds.includes(agentId),
    () => store.get().unreadCounts[agentId] ?? 0,
  ] as const;
}

function oldWaitingKey(store: Store) {
  const { activityByServer, threadWaitsByServer } = store.get();
  const activities = activityByServer[SERVER_ID] ?? {};
  const waiting = new Set(Object.keys(activities).filter((agentId) => activities[agentId]?.phase === "waiting"));
  for (const wait of threadWaitsByServer[SERVER_ID] ?? []) if (wait.task) waiting.add(wait.agentId);
  return [...waiting].sort().join("\n");
}

function subscribeRows(store: Store, mode: "before" | "after", agents: readonly Agent[], counters: Counters) {
  for (const agent of agents) {
    const keys = ["activityByServer", "threadWaitsByServer", "unreadAgentIds", "unreadCounts"] as const;
    rowSelectors(store, agent.id).forEach((select, index) => {
      const run = () => {
        counters.rowSelectorRuns += 1;
        select();
      };
      const key = keys[index];
      if (mode === "before" || key === undefined) store.subscribe(run);
      else store.subscribeAgent(key, agent.id, run);
    });
  }
  const screen = () => {
    counters.screenSelectorRuns += 1;
    oldWaitingKey(store);
  };
  if (mode === "before") store.subscribe(screen);
  else {
    store.subscribeKey("activityByServer", screen);
    store.subscribeKey("threadWaitsByServer", screen);
  }
}

function oldListDeps(items: readonly Item[], agents: readonly Agent[], collapsed: ReadonlySet<string>) {
  const channelAgents = new Map(
    agents.filter((agent) => agent.serverId === SERVER_ID).map((agent) => [agent.id, agent]),
  );
  const visibleSectionIds = items.filter((item) => item.kind === "section").map((item) => item.id);
  const collapsedRowIds = new Set<string>();
  return [SERVER_ID, channelAgents, collapsedRowIds, collapsed, "[]", visibleSectionIds] as const;
}

function noCounts(): Counters {
  return {
    rowSelectorRuns: 0,
    screenSelectorRuns: 0,
    rowRerenders: 0,
    rowItemIdentityChanges: 0,
    listRenderItemChanges: 0,
    channelLookupChanges: 0,
  };
}

function run(mode: "before" | "after") {
  const store = new LiveWorkspaceStore();
  const counters = noCounts();
  let agents = Array.from({ length: AGENT_COUNT }, (_, index) => makeAgent(index));
  const channels = Array.from({ length: CHANNEL_COUNT }, (_, index) => makeChannel(index));
  const collapsed: ReadonlySet<string> = new Set();
  subscribeRows(store, mode, agents, counters);

  let keptRows: readonly Row[] = [];
  let keptSectionIds: readonly string[] = [];
  let keptLookup: ReadonlyMap<string, Agent> | null = null;
  let previousItems: readonly Item[] = [];
  let previousDeps: readonly unknown[] = [];
  let previousRows: readonly Row[] = [];
  const derive = () => {
    const items = sidebarItems(agents, channels);
    if (mode === "before") {
      const deps = oldListDeps(items, agents, collapsed);
      const depsChanged = deps.some((dep, index) => !Object.is(dep, previousDeps[index]));
      if (depsChanged) counters.listRenderItemChanges += 1;
      const changedItems = items.filter((item, index) => item !== previousItems[index]).length;
      counters.rowItemIdentityChanges += changedItems;
      counters.rowRerenders += depsChanged ? items.length : changedItems;
      if (deps[1] !== previousDeps[1]) counters.channelLookupChanges += 1;
      previousDeps = deps;
      previousItems = items;
      return;
    }
    const lookup = channelAgentLookup(keptLookup, agents, SERVER_ID);
    if (lookup !== keptLookup) counters.channelLookupChanges += 1;
    keptLookup = lookup;
    keptRows = chatListRows({ items, collapsedSectionIds: collapsed, unreadAgentIds: [], unreadCounts: {} }, keptRows);
    keptSectionIds = chatListSectionIds(keptRows, keptSectionIds);
    const deps = [SERVER_ID, lookup, keptSectionIds];
    const depsChanged = deps.some((dep, index) => !Object.is(dep, previousDeps[index]));
    if (depsChanged) counters.listRenderItemChanges += 1;
    const changedRows = keptRows.filter((row, index) => row !== previousRows[index]).length;
    counters.rowItemIdentityChanges += changedRows;
    counters.rowRerenders += depsChanged ? keptRows.length : changedRows;
    previousDeps = deps;
    previousRows = keptRows;
  };
  derive();
  const baseline = { ...counters };
  Object.assign(counters, noCounts());

  for (let index = 1; index <= EVENT_COUNT; index += 1) {
    applyLiveEvent(store, SERVER_ID, event(index));
    if (index % PREVIEW_EVERY === 0) {
      agents = agents.map((agent) => (agent.id === AGENT_ID ? { ...agent, preview: `Reply part ${index}` } : agent));
      derive();
    }
  }
  return {
    mode,
    initialRender: baseline,
    events: counters,
    rows: mode === "after" ? keptRows.length : previousItems.length,
  };
}

const before = run("before");
const after = run("after");
const subscribedSelectors = AGENT_COUNT * ROW_SELECTORS;

check("both runs list the same rows", before.rows === after.rows, { before: before.rows, after: after.rows });
check("row selectors run fewer times", after.events.rowSelectorRuns < before.events.rowSelectorRuns, {
  before: before.events.rowSelectorRuns,
  after: after.events.rowSelectorRuns,
});
check(
  "an event for one agent runs only that agent's selectors",
  after.events.rowSelectorRuns <= EVENT_COUNT * ROW_SELECTORS,
  { after: after.events.rowSelectorRuns, limit: EVENT_COUNT * ROW_SELECTORS, subscribedSelectors },
);
check(
  "only the changed agent row changes identity",
  after.events.rowItemIdentityChanges === EVENT_COUNT / PREVIEW_EVERY,
  {
    after: after.events.rowItemIdentityChanges,
    previewChanges: EVENT_COUNT / PREVIEW_EVERY,
  },
);
check("renderItem stays stable while one agent changes", after.events.listRenderItemChanges === 0, {
  before: before.events.listRenderItemChanges,
  after: after.events.listRenderItemChanges,
});
check("the channel agent lookup keeps its identity", after.events.channelLookupChanges === 0, {
  before: before.events.channelLookupChanges,
  after: after.events.channelLookupChanges,
});
check("fewer list rows re-render", after.events.rowRerenders < before.events.rowRerenders, {
  before: before.events.rowRerenders,
  after: after.events.rowRerenders,
});

const report = {
  scenario: {
    agents: AGENT_COUNT,
    sections: SECTION_COUNT,
    channels: CHANNEL_COUNT,
    events: EVENT_COUNT,
    presenceEvents: EVENT_COUNT / PRESENCE_EVERY,
    streamEvents: EVENT_COUNT - EVENT_COUNT / PRESENCE_EVERY,
    agentRecordChanges: EVENT_COUNT / PREVIEW_EVERY,
    eventAgent: AGENT_ID,
    subscribedRowSelectors: subscribedSelectors,
  },
  before,
  after,
  checks,
};
await mkdir(OUT, { recursive: true });
const path = join(OUT, "report.json");
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
const failed = checks.filter((item) => !item.passed);
const logger = createOpenBotLogger("mobile-agent-list-e2e");
for (const item of checks) {
  if (item.passed) logger.info(`ok ${item.name}`);
  else logger.error(`FAIL ${item.name}`);
}
logger.info(`Before: ${JSON.stringify(before.events)}`);
logger.info(`After: ${JSON.stringify(after.events)}`);
logger.info(`Report: ${path}`);
if (failed.length > 0) process.exit(1);
