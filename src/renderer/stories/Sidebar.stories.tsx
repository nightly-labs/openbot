import type { ChannelSummary, HiddenAgent, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { SidebarCommunityCard } from "@openbot/ui/features/sidebar/SidebarCommunityCard";
import { SidebarMachineCard } from "@openbot/ui/features/sidebar/SidebarMachineCard";
import { SidebarMobileAppCard } from "@openbot/ui/features/sidebar/SidebarMobileAppCard";
import { SidebarStorageCard } from "@openbot/ui/features/sidebar/SidebarStorageCard";
import { normalizeSidebarPinnedItems, type SidebarPinnedItem } from "@openbot/ui/features/sidebar/sidebar-pins";
import { SIDEBAR_HIDDEN_GROUP_OPEN_ID, type SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { createSignal, For, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import { applySidebarLayoutAction } from "../src/preview/mock-sidebar-layout";
import { requireFixture, STORY_AGENTS, STORY_DIRECT_THREADS, STORY_PRESENCE, STORY_SERVERS } from "./fixtures";
import { SettledArgs } from "./settled-args";

const agentStates: Record<string, SidebarAgentState> = {
  chief: { kind: "working" },
  research: { kind: "unread", count: 3 },
  sales: { kind: "routine", phase: "running", count: 1 },
};

const agentMoods: Record<string, AvatarMood> = {
  chief: "working",
  research: "waiting",
  sales: "working",
};

const sidebarAgents = STORY_AGENTS.map((agent) => {
  if (agent.id === "chief") return { ...agent, title: "CEO" };
  if (agent.id === "research") return { ...agent, title: "Analyst" };
  if (agent.id === "sales") return { ...agent, name: "Sales", title: "Growth" };
  return agent;
});

const pinnedOne: SidebarPinnedItem[] = [{ kind: "agent", id: "chief" }];
const pinnedTwo: SidebarPinnedItem[] = [...pinnedOne, { kind: "agent", id: "research" }];
const pinnedThree: SidebarPinnedItem[] = [...pinnedTwo, { kind: "agent", id: "sales" }];
const pinnedFour: SidebarPinnedItem[] = [...pinnedThree, { kind: "agent", id: "stress-agent-1" }];
const pinnedFive: SidebarPinnedItem[] = [...pinnedFour, { kind: "agent", id: "stress-agent-2" }];
const pinnedSix: SidebarPinnedItem[] = [...pinnedFive, { kind: "agent", id: "stress-agent-3" }];
const longLabelAgents = sidebarAgents.map((agent) =>
  agent.id === "chief"
    ? {
        ...agent,
        name: "Strategic Operations Coordinator",
        title: "Executive Planning and Delivery Partner",
      }
    : agent,
);
const demoSectionId = "11111111-1111-4111-8111-111111111111";
const emptySectionId = "22222222-2222-4222-8222-222222222222";
const sectionedLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    { id: demoSectionId, name: "Core team" },
    { id: emptySectionId, name: "Empty section" },
  ],
  order: ["people", demoSectionId, "unassigned", emptySectionId],
  agentAssignments: { chief: demoSectionId, research: demoSectionId },
  agentOrder: ["chief", "research", "sales"],
};
/** "Research" keeps its "Core team" section while it is hidden, so Restore names that section. */
const userHiddenAgents: HiddenAgent[] = [
  { agentId: "research", hiddenAt: "2026-09-28T09:00:00.000Z" },
  { agentId: "sales", hiddenAt: "2026-10-02T15:30:00.000Z" },
];
const longSectionLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    {
      id: demoSectionId,
      name: "International Research and Strategic Operations Group",
    },
  ],
  order: [demoSectionId, "people", "unassigned"],
  agentAssignments: { chief: demoSectionId },
  agentOrder: ["chief", "research", "sales"],
};
const stressSectionIds = Array.from({ length: 6 }, (_, index) => `44444444-4444-4444-8444-44444444444${index}`);
const stressAgents = [
  ...sidebarAgents,
  ...Array.from({ length: 27 }, (_, index) => {
    const source = sidebarAgents[index % sidebarAgents.length] ?? sidebarAgents[0];
    return {
      ...source,
      id: `stress-agent-${index + 1}`,
      name: `Agent ${index + 1}`,
      threadId: `stress-thread-${index + 1}`,
      avatarSeed: `stress-agent-${index + 1}`,
      preview: `Active task ${index + 1}`,
    };
  }),
];
function stressSectionId(index: number): string {
  return requireFixture(stressSectionIds[index % stressSectionIds.length], "Stress section");
}
const stressLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: stressSectionIds.map((id, index) => ({ id, name: `Team ${index + 1}` })),
  order: ["people", ...stressSectionIds, "unassigned"],
  agentAssignments: Object.fromEntries(
    stressAgents.slice(0, -3).map((agent, index) => [agent.id, stressSectionId(index)]),
  ),
  agentOrder: stressAgents.map((agent) => agent.id),
};

/* One channel for each shape the member cluster has to draw: a single face, a pair, the triangle,
 * the full quad, the count that takes the last cell when the members outnumber it, and the count of
 * two digits that takes the bottom row. */
const channelSizes = [
  { name: "Solo", size: 1 },
  { name: "Pair", size: 2 },
  { name: "Trio", size: 3 },
  { name: "Quad", size: 4 },
  { name: "All hands", size: 6 },
  { name: "Company", size: 13 },
];
const storyChannels: ChannelSummary[] = channelSizes.map(({ name, size }, index) => ({
  id: `channel-${size}`,
  name,
  title: "",
  instructions: "",
  members: stressAgents.slice(index, index + size).map((agent) => ({ agentId: agent.id })),
  leadAgentId: null,
  archived: false,
  revision: 1,
  createdAt: "2026-01-01T09:00:00.000Z",
  unreadCount: size === 2 ? 4 : 0,
  activeTasks: size === 6 ? 1 : 0,
  lastMessage:
    size === 1 ? null : { at: "2026-01-01T10:00:00.000Z", text: `${size} members here`, authorName: "Agent 1" },
}));

const args: Parameters<typeof Sidebar>[0] = {
  serverName: "Local",
  onOpenServerSettings: fn(),
  agents: sidebarAgents,
  activeAgentId: "chief",
  people: STORY_PRESENCE.members,
  directThreads: STORY_DIRECT_THREADS,
  activeDirectMemberId: null,
  agentStates,
  agentMoods,
  layout: defaultSidebarLayout(),
  collapsedSectionIds: [],
  onMutateLayout: fn(async () => undefined),
  onToggleSection: fn(),
  pinnedItems: pinnedThree,
  peopleOrder: [],
  onPin: fn(),
  onUnpin: fn(),
  onReorderPinned: fn(),
  onReorderPeople: fn(),
  onSelectAgent: fn(),
  onSelectPerson: fn(),
  onCreateAgent: fn(),
  onEditAgent: fn(),
  onDeleteAgent: async () => undefined,
  compact: false,
  onExpand: fn(),
  onOpenSearch: fn(),
  onOpenMarketplace: fn(),
  onChatOrderChange: fn(),
};

function InteractiveSidebar(props: Parameters<typeof Sidebar>[0]) {
  const [pinnedItems, setPinnedItems] = createSignal(untrack(() => props.pinnedItems));
  const [peopleOrder, setPeopleOrder] = createSignal(untrack(() => props.peopleOrder));
  const [layout, setLayout] = createSignal(untrack(() => props.layout));
  const [collapsedSectionIds, setCollapsedSectionIds] = createSignal(untrack(() => props.collapsedSectionIds));
  const [hiddenAgents, setHiddenAgents] = createSignal(untrack(() => props.userHiddenAgents ?? []));
  const [chatOrder, setChatOrder] = createSignal(untrack(() => props.chatOrder));
  // Opening a chat reads it, as in the app, so the unread orders can be tried here.
  const [activeAgentId, setActiveAgentId] = createSignal(untrack(() => props.activeAgentId));
  const [readAgentIds, setReadAgentIds] = createSignal<ReadonlySet<string>>(new Set());
  const onHideAgent = untrack(() => props.onHideAgent);
  const onRestoreAgent = untrack(() => props.onRestoreAgent);
  return (
    <Sidebar
      {...props}
      activeAgentId={activeAgentId()}
      agentStates={Object.fromEntries(
        Object.entries(props.agentStates).filter(
          ([agentId, state]) => state.kind !== "unread" || !readAgentIds().has(agentId),
        ),
      )}
      onSelectAgent={(agentId) => {
        setActiveAgentId(agentId);
        setReadAgentIds((current) => new Set(current).add(agentId));
        props.onSelectAgent(agentId);
      }}
      userHiddenAgents={hiddenAgents()}
      onHideAgent={
        onHideAgent &&
        ((agentId) => {
          setHiddenAgents((current) => [...current, { agentId, hiddenAt: new Date().toISOString() }]);
          onHideAgent(agentId);
        })
      }
      onRestoreAgent={
        onRestoreAgent &&
        ((agentId) => {
          setHiddenAgents((current) => current.filter((entry) => entry.agentId !== agentId));
          onRestoreAgent(agentId);
        })
      }
      layout={layout()}
      chatOrder={chatOrder()}
      onChatOrderChange={(order) => {
        setChatOrder(order);
        props.onChatOrderChange?.(order);
      }}
      collapsedSectionIds={collapsedSectionIds()}
      pinnedItems={pinnedItems()}
      peopleOrder={peopleOrder()}
      onPin={(item) => {
        setPinnedItems((current) =>
          current.some((candidate) => candidate.kind === item.kind && candidate.id === item.id)
            ? current
            : normalizeSidebarPinnedItems([...current, item]),
        );
        props.onPin(item);
      }}
      onUnpin={(item) => {
        setPinnedItems((current) =>
          current.filter((candidate) => candidate.kind !== item.kind || candidate.id !== item.id),
        );
        props.onUnpin(item);
      }}
      onReorderPinned={(items) => {
        setPinnedItems(items);
        props.onReorderPinned(items);
      }}
      onReorderPeople={(memberIds) => {
        setPeopleOrder(memberIds);
        props.onReorderPeople(memberIds);
      }}
      onMutateLayout={async (action) => {
        setLayout((current) => applySidebarLayoutAction(current, action));
        await props.onMutateLayout(action);
      }}
      onToggleSection={(sectionId) => {
        setCollapsedSectionIds((current) =>
          current.includes(sectionId)
            ? current.filter((candidate) => candidate !== sectionId)
            : [...current, sectionId],
        );
        props.onToggleSection(sectionId);
      }}
    />
  );
}

const meta = {
  title: "Navigation/Sidebar",
  component: Sidebar,
  render: (storyArgs) => <SettledArgs>{() => <InteractiveSidebar {...storyArgs} />}</SettledArgs>,
  args,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** "Unread in a group": the chats with unread replies leave their sections for a group under "Needs you". */
export const UnreadGroup: Story = {
  args: { chatOrder: "unread-group", pinnedItems: pinnedOne },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** "Unread first in folders": each section shows its unread chats first, then the others by recency. */
export const UnreadFirst: Story = {
  args: { chatOrder: "unread-first", pinnedItems: pinnedOne },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** A joined server has a new OpenBot version. The header button opens its update. */
export const ServerUpdate: Story = {
  args: { serverName: "Research server", serverUpdate: { version: "0.24.0", running: false, onOpen: fn() } },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** Back opens the chat that was open before. Forward has no chat yet, so it is disabled. */
export const ChatHistory: Story = {
  args: {
    chatHistory: {
      back: { name: "Research" },
      forward: null,
      keys: { back: "⌘[", forward: "⌘]" },
      onBack: fn(),
      onForward: fn(),
    },
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const MobileAppCard: Story = {
  args: { footer: <SidebarMobileAppCard onOpenInstall={fn()} onDismiss={fn()} /> },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const CommunityCard: Story = {
  args: { footer: <SidebarCommunityCard onJoinDiscord={fn()} onFollowX={fn()} onDismiss={fn()} /> },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

const GB = 1024 ** 3;

/** A 12 GB hosted server with 1.1 GB free: the card shows, and it can be closed. */
export const StorageLow: Story = {
  args: {
    footer: (
      <SidebarStorageCard
        level="low"
        serverName="Acme HQ"
        freeBytes={1.1 * GB}
        totalBytes={12 * GB}
        onFreeUpSpace={fn()}
        onDismiss={fn()}
      />
    ),
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** At "full" the card is red and has no close button. */
export const StorageFull: Story = {
  args: {
    footer: (
      <SidebarStorageCard
        level="full"
        serverName="Acme HQ"
        freeBytes={0.14 * GB}
        totalBytes={12 * GB}
        onFreeUpSpace={fn()}
        onDismiss={fn()}
      />
    ),
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** The disk of a hosted server passed the 80% alert level that an admin set. */
export const MachineDiskAlert: Story = {
  args: {
    footer: (
      <SidebarMachineCard
        serverName="Acme HQ"
        metric="disk"
        percent={87}
        level={80}
        freeBytes={9.6 * GB}
        recipientName="Alice Chen"
        critical={false}
        onOpenDetails={fn()}
        onDismiss={fn()}
      />
    ),
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** Memory far above its level: the card is red and has no close button. */
export const MachineMemoryCritical: Story = {
  args: {
    footer: (
      <SidebarMachineCard
        serverName="Acme HQ"
        metric="memory"
        percent={97}
        level={85}
        freeBytes={0.4 * GB}
        recipientName="Alice Chen"
        critical
        onOpenDetails={fn()}
        onDismiss={fn()}
      />
    ),
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const PinnedOne: Story = {
  args: { pinnedItems: pinnedOne },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const PinnedTwo: Story = {
  args: { pinnedItems: pinnedTwo },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const PinnedFour: Story = {
  args: { agents: stressAgents, pinnedItems: pinnedFour },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const PinnedFive: Story = {
  args: { agents: stressAgents, pinnedItems: pinnedFive },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const PinnedSix: Story = {
  args: { agents: stressAgents, pinnedItems: pinnedSix },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const PinnedMany: Story = {
  args: {
    agents: stressAgents,
    pinnedItems: stressAgents.slice(0, 12).map((agent) => ({ kind: "agent", id: agent.id })),
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const PinnedLongLabels: Story = {
  args: { agents: longLabelAgents, pinnedItems: pinnedOne },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const AgentTiles: Story = {
  args: {
    people: [],
    directThreads: [],
    agentStates: {},
    agentMoods: {},
    pinnedItems: [],
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** Two agents on a spent plan: one with a reported reset, one without. */
export const UsageLimit: Story = {
  args: {
    agentStates: {
      chief: { kind: "limited", resetsAt: Math.floor(Date.now() / 1_000) + 70 * 60 },
      sales: { kind: "limited", resetsAt: null },
    },
    pinnedItems: [],
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const AgentLongLabels: Story = {
  args: {
    agents: longLabelAgents,
    people: [],
    directThreads: [],
    agentStates: {},
    agentMoods: {},
    pinnedItems: [],
  },
  decorators: [
    (Story) => (
      <div
        style={{
          width: "240px",
          "min-width": "240px",
          "max-width": "400px",
          height: "100vh",
          overflow: "hidden",
          resize: "horizontal",
        }}
      >
        {Story()}
      </div>
    ),
  ],
};

export const TimestampLabels: Story = {
  ...AgentLongLabels,
  args: {
    ...AgentLongLabels.args,
    agents: longLabelAgents.map((agent, index) => {
      const updatedAt = new Date();
      const daysAgo = [0, 1, 30][index % 3];
      if (daysAgo === undefined) throw new Error("The timestamp story has no day offset.");
      updatedAt.setDate(updatedAt.getDate() - daysAgo);
      updatedAt.setHours(13, 42, 0, 0);
      return {
        ...agent,
        updatedAt: updatedAt.toISOString(),
        time: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(updatedAt),
      };
    }),
  },
};

export const AgentContextMenu: Story = {
  args: {
    people: [],
    directThreads: [],
    agentStates: {},
    agentMoods: {},
    layout: sectionedLayout,
    pinnedItems: [],
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** A custom section's menu offers Duplicate when the server can copy agents and change the layout. */
export const Sections: Story = {
  args: {
    layout: sectionedLayout,
    pinnedItems: pinnedOne,
    sectionDuplicateSupported: true,
    onDuplicateSection: fn(),
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

const folderIds = {
  clients: "55555555-5555-4555-8555-555555555550",
  acme: "55555555-5555-4555-8555-555555555551",
  launch: "55555555-5555-4555-8555-555555555552",
  northwind: "55555555-5555-4555-8555-555555555553",
  internal: "55555555-5555-4555-8555-555555555554",
  archive: "55555555-5555-4555-8555-555555555555",
};
/** Three levels: "Clients / Acme Robotics / Launch". "Archive" is empty. */
const folderLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    { id: folderIds.clients, name: "Clients" },
    { id: folderIds.acme, name: "Acme Robotics", parentId: folderIds.clients },
    { id: folderIds.launch, name: "Launch", parentId: folderIds.acme },
    { id: folderIds.northwind, name: "Northwind", parentId: folderIds.clients },
    { id: folderIds.internal, name: "Internal" },
    { id: folderIds.archive, name: "Archive" },
  ],
  order: [
    "people",
    folderIds.clients,
    folderIds.acme,
    folderIds.launch,
    folderIds.northwind,
    folderIds.internal,
    folderIds.archive,
    "unassigned",
  ],
  agentAssignments: {
    chief: folderIds.internal,
    research: folderIds.acme,
    sales: folderIds.clients,
    "stress-agent-1": folderIds.acme,
    "stress-agent-2": folderIds.launch,
    "stress-agent-3": folderIds.launch,
    "stress-agent-4": folderIds.northwind,
    "stress-agent-5": folderIds.internal,
  },
  agentOrder: ["sales", "research", "stress-agent-1", "stress-agent-2", "stress-agent-3", "chief"],
};
const folderAgents = stressAgents.slice(0, 11);

/** Folders in folders. A folder header stays at the top while its chats scroll under it. */
export const Folders: Story = {
  args: {
    agents: folderAgents,
    layout: folderLayout,
    pinnedItems: [],
    foldersSupported: true,
    sectionDuplicateSupported: true,
    onDuplicateSection: fn(),
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** Closed folders are a list of headers. A closed folder shows its unread count. */
export const FoldersClosed: Story = {
  args: {
    agents: folderAgents,
    layout: folderLayout,
    pinnedItems: [],
    foldersSupported: true,
    collapsedSectionIds: [folderIds.acme, folderIds.internal],
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const DragStress: Story = {
  args: { agents: stressAgents, layout: stressLayout, pinnedItems: pinnedSix },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const SectionsCollapsed: Story = {
  args: { layout: sectionedLayout, collapsedSectionIds: [demoSectionId], pinnedItems: [] },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** The Hidden group is collapsed until the user opens it. Hide and Restore work in the agent menu. */
export const HiddenAgents: Story = {
  args: { layout: sectionedLayout, pinnedItems: [], userHiddenAgents, onHideAgent: fn(), onRestoreAgent: fn() },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const HiddenAgentsOpen: Story = {
  args: {
    layout: sectionedLayout,
    pinnedItems: [],
    collapsedSectionIds: [SIDEBAR_HIDDEN_GROUP_OPEN_ID],
    userHiddenAgents,
    onHideAgent: fn(),
    onRestoreAgent: fn(),
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const SectionLongLabels: Story = {
  args: { layout: longSectionLayout, people: [], directThreads: [], pinnedItems: [] },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const SectionRename: Story = {
  args: { layout: sectionedLayout, pinnedItems: [] },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const Compact: Story = {
  args: { compact: true },
};

export const LongServerName: Story = {
  args: { serverName: "Synthetify production workspace with a long name" },
  decorators: [(Story) => <div style={{ width: "240px", height: "100vh" }}>{Story()}</div>],
};

const serverMenu = {
  servers: STORY_SERVERS,
  onViewChange: fn(),
  onSelect: fn(),
  onAdd: fn(),
  onSetMuted: fn(),
  onOpenNotificationSettings: fn(),
  onOpenSettings: fn(),
};

export const ServerMenuRailView: Story = {
  args: { serverMenu: { ...serverMenu, view: "rail" } },
};

export const ServerMenuMenuView: Story = {
  args: { serverMenu: { ...serverMenu, view: "menu" } },
};

export const EmptyPinDropTarget: Story = {
  args: {
    people: [],
    directThreads: [],
    pinnedItems: [],
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** Three pinned tiles, three people and one small section of three agents, so every region has
 *  rows to shift during a drag. The pinned agents are excluded from the section list, which is
 *  why the section holds stress agents rather than the three real ones. */
const dragOffsetAgents = stressAgents.slice(0, 6);
const dragOffsetLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    { id: demoSectionId, name: "Core team" },
    { id: emptySectionId, name: "Empty section" },
  ],
  order: ["people", demoSectionId, emptySectionId, "unassigned"],
  agentAssignments: {
    "stress-agent-1": demoSectionId,
    "stress-agent-2": demoSectionId,
    "stress-agent-3": demoSectionId,
  },
  agentOrder: dragOffsetAgents.map((agent) => agent.id),
};

export const DragOffsets: Story = {
  args: { agents: dragOffsetAgents, layout: dragOffsetLayout, pinnedItems: pinnedThree },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const Empty: Story = {
  args: {
    agents: [],
    people: [],
    directThreads: [],
    agentStates: {},
    agentMoods: {},
    pinnedItems: [],
  },
};

export const FirstAgent: Story = {
  args: {
    ...Empty.args,
    emptyAction: {
      label: "Create your first agent",
      avatarSeed: "first-bot",
      onSelect: fn(),
    },
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const EmptySections: Story = {
  args: {
    ...FirstAgent.args,
    layout: {
      ...defaultSidebarLayout(),
      sections: [
        { id: demoSectionId, name: "Product" },
        { id: emptySectionId, name: "Research" },
      ],
      order: ["people", "unassigned", demoSectionId, emptySectionId],
    },
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const FirstAgentNarrow: Story = {
  ...FirstAgent,
  decorators: [(Story) => <div style={{ width: "220px", height: "100vh" }}>{Story()}</div>],
};

export const FirstAgentCompact: Story = {
  args: { ...FirstAgent.args, compact: true },
  decorators: [(Story) => <div style={{ width: "80px", height: "100vh" }}>{Story()}</div>],
};

export const Channels: Story = {
  args: {
    agents: stressAgents,
    channels: storyChannels,
    activeChannelId: "channel-3",
    onSelectChannel: fn(),
    onEditChannel: fn(),
    onDeleteChannel: fn(async () => undefined),
    pinnedItems: [
      { kind: "channel", id: "channel-4" },
      { kind: "agent", id: "chief" },
    ],
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/** Two channels whose work waits for the user: one in "Needs you" with an agent, one pinned. */
export const ChannelsWaiting: Story = {
  args: {
    ...Channels.args,
    agentStates: { ...agentStates, research: { kind: "waiting", reason: "question", detail: "Which quarter?" } },
    channelWaits: {
      "channel-2": { kind: "waiting", reason: "takeover", detail: null },
      "channel-4": { kind: "waiting", reason: "approval", detail: "git push origin main" },
    },
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const ChannelsCompact: Story = {
  args: { ...Channels.args, compact: true },
};

export const ChannelContextMenu: Story = {
  args: { ...Channels.args, pinnedItems: [] },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

export const DeletedChats: Story = {
  args: {
    ...Channels.args,
    showingArchivedChannels: true,
    deletedChannels: storyChannels.map((channel) => ({ ...channel, id: `deleted-${channel.id}`, archived: true })),
  },
};

/* The felt badges: unread counts of one, two and three digits, a failed routine, and the "+N" count
 * of the channel clusters. "Research" is pinned and active, so its badge sits on the raised row. */
const feltBadgeStates: Record<string, SidebarAgentState> = {
  chief: { kind: "unread", count: 1 },
  research: { kind: "unread", count: 10 },
  sales: { kind: "unread", count: 128 },
  "stress-agent-1": { kind: "routine", phase: "failed", count: 1 },
};

export const FeltBadges: Story = {
  args: {
    ...Channels.args,
    activeAgentId: "research",
    activeChannelId: null,
    agentStates: feltBadgeStates,
    pinnedItems: [
      { kind: "agent", id: "research" },
      { kind: "agent", id: "stress-agent-1" },
      { kind: "channel", id: "channel-13" },
      { kind: "channel", id: "channel-2" },
    ],
  },
  decorators: [(Story) => <div style={{ width: "280px", height: "100vh" }}>{Story()}</div>],
};

/* The steps of the smoke: a new unread, two counts that go up, the count read to zero, and a routine
 * that fails and then succeeds. Each button sets the state, so each transition can run again. */
const feltBadgeSteps: {
  label: string;
  chief?: SidebarAgentState | undefined;
  sales?: SidebarAgentState | undefined;
}[] = [
  { label: "1", chief: { kind: "unread", count: 1 } },
  { label: "10", chief: { kind: "unread", count: 10 } },
  { label: "128", chief: { kind: "unread", count: 128 } },
  { label: "Read", chief: undefined },
  { label: "Fail", sales: { kind: "routine", phase: "failed", count: 1 } },
  { label: "Succeed", sales: undefined },
];

function FeltBadgeTransitions(props: Parameters<typeof Sidebar>[0]) {
  const [states, setStates] = createSignal<Record<string, SidebarAgentState>>({});
  const apply = (step: (typeof feltBadgeSteps)[number]) =>
    setStates((current) => {
      const next = { ...current };
      for (const id of ["chief", "sales"] as const) {
        if (!(id in step)) continue;
        const state = step[id];
        if (state) next[id] = state;
        else delete next[id];
      }
      return next;
    });
  return (
    <div class="grid h-screen w-[280px] grid-rows-[auto_1fr]">
      <div class="flex flex-wrap gap-1 p-2">
        <For each={feltBadgeSteps}>
          {(step) => (
            <Button size="sm" variant="outline" onClick={() => apply(step)}>
              {step.label}
            </Button>
          )}
        </For>
      </div>
      <InteractiveSidebar {...props} agentStates={states()} />
    </div>
  );
}

/** Each button sets one state, so the badge lands, rolls its digits, closes, and the X lands. */
export const FeltBadgeMotion: Story = {
  args: { pinnedItems: [{ kind: "agent", id: "chief" }], activeAgentId: "research" },
  render: (storyArgs) => <SettledArgs>{() => <FeltBadgeTransitions {...storyArgs} />}</SettledArgs>,
};
