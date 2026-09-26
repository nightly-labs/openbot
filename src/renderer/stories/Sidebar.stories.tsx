import type { ChannelSummary, SidebarLayoutAction, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { normalizeSidebarPinnedItems, type SidebarPinnedItem } from "@openbot/ui/features/sidebar/sidebar-pins";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { createSignal, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import { requireFixture, STORY_AGENTS, STORY_DIRECT_THREADS, STORY_PRESENCE, STORY_SERVERS } from "./fixtures";

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
 * the full quad, and the count that takes the last cell when the members outnumber it. */
const channelSizes = [
  { name: "Solo", size: 1 },
  { name: "Pair", size: 2 },
  { name: "Trio", size: 3 },
  { name: "Quad", size: 4 },
  { name: "All hands", size: 6 },
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
  onOpenMarketplace: fn(),
};

function InteractiveSidebar(props: Parameters<typeof Sidebar>[0]) {
  const [pinnedItems, setPinnedItems] = createSignal(untrack(() => props.pinnedItems));
  const [peopleOrder, setPeopleOrder] = createSignal(untrack(() => props.peopleOrder));
  const [layout, setLayout] = createSignal(untrack(() => props.layout));
  const [collapsedSectionIds, setCollapsedSectionIds] = createSignal(untrack(() => props.collapsedSectionIds));
  return (
    <Sidebar
      {...props}
      layout={layout()}
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
        setLayout((current) => applyStoryLayoutAction(current, action));
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

function applyStoryLayoutAction(layout: SidebarLayoutSnapshot, action: SidebarLayoutAction): SidebarLayoutSnapshot {
  const revision = layout.revision + 1;
  if (action.type === "create") {
    const id = crypto.randomUUID();
    return {
      ...layout,
      revision,
      sections: [...layout.sections, { id, name: action.name.trim() }],
      order: [...layout.order, id],
      agentAssignments: action.agentId
        ? { ...layout.agentAssignments, [action.agentId]: id }
        : { ...layout.agentAssignments },
      agentOrder: [...layout.agentOrder],
    };
  }
  if (action.type === "rename") {
    return {
      ...layout,
      revision,
      sections: layout.sections.map((section) =>
        section.id === action.sectionId ? { ...section, name: action.name.trim() } : section,
      ),
    };
  }
  if (action.type === "delete") {
    return {
      ...layout,
      revision,
      sections: layout.sections.filter((section) => section.id !== action.sectionId),
      order: layout.order.filter((sectionId) => sectionId !== action.sectionId),
      agentAssignments: Object.fromEntries(
        Object.entries(layout.agentAssignments).filter(([, sectionId]) => sectionId !== action.sectionId),
      ),
      agentOrder: [...layout.agentOrder],
    };
  }
  if (action.type === "move") {
    const order = [...layout.order];
    const index = order.indexOf(action.sectionId);
    const target = index + (action.direction === "up" ? -1 : 1) * (action.steps ?? 1);
    if (index >= 0 && target >= 0 && target < order.length) {
      const [movedSectionId] = order.splice(index, 1);
      if (movedSectionId) order.splice(target, 0, movedSectionId);
    }
    return { ...layout, revision, order };
  }
  if (action.type === "move-agent") {
    const agentOrder = layout.agentOrder.filter((agentId) => agentId !== action.agentId);
    const insertionIndex = action.beforeAgentId === null ? agentOrder.length : agentOrder.indexOf(action.beforeAgentId);
    agentOrder.splice(insertionIndex < 0 ? agentOrder.length : insertionIndex, 0, action.agentId);
    const agentAssignments = { ...layout.agentAssignments };
    if (action.sectionId === null) delete agentAssignments[action.agentId];
    else agentAssignments[action.agentId] = action.sectionId;
    return { ...layout, revision, agentAssignments, agentOrder };
  }
  const agentAssignments = { ...layout.agentAssignments };
  if (action.sectionId === null) delete agentAssignments[action.agentId];
  else agentAssignments[action.agentId] = action.sectionId;
  return { ...layout, revision, agentAssignments };
}

const meta = {
  title: "Navigation/Sidebar",
  component: Sidebar,
  render: (storyArgs) => <InteractiveSidebar {...storyArgs} />,
  args,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
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

export const Sections: Story = {
  args: { layout: sectionedLayout, pinnedItems: pinnedOne },
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
  onSetNotificationLevel: fn(),
  onOpenUsage: fn(),
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
  decorators: FirstAgent.decorators,
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
