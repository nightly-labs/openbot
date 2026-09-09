import type {
  AvatarHue,
  ChannelSummary,
  DirectThreadSummary,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  TeamPresenceMember,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "../../data";
import type { SidebarPinnedItem } from "./sidebar-pins";

/**
 * What the sidebar is, as data. These live apart from `Sidebar.tsx` because
 * nine of this feature's modules - the drag engine, the filtering, the scope
 * and every store - name one of these types and none of them render anything.
 * Reading them from the entry component made the pure logic depend on the whole
 * view to borrow a name.
 */
export interface SidebarProps {
  channels?: ChannelSummary[];
  activeChannelId?: string | null;
  onSelectChannel?: (channelId: string) => void;
  showingArchivedChannels?: boolean;
  onToggleArchivedChannels?: () => void;
  onCreateChannel?: () => void;
  onEditChannel?: (channelId: string) => void;
  onRestoreChannel?: (channelId: string) => Promise<void>;
  onDeleteChannel?: (channelId: string) => Promise<void>;
  serverName: string;
  onOpenServerSettings: (trigger: HTMLElement) => void;
  agents: AgentProfile[];
  activeAgentId: string;
  showPeople?: boolean;
  people: TeamPresenceMember[];
  directThreads: DirectThreadSummary[];
  activeDirectMemberId: string | null;
  agentStates: Record<string, SidebarAgentState>;
  layout: SidebarLayoutSnapshot;
  layoutMutable?: boolean;
  collapsedSectionIds: string[];
  onMutateLayout: (action: SidebarLayoutAction) => Promise<void>;
  onToggleSection: (sectionId: string) => void;
  pinnedItems: SidebarPinnedItem[];
  peopleOrder: string[];
  onPin: (item: SidebarPinnedItem) => void;
  onUnpin: (item: SidebarPinnedItem) => void;
  onReorderPinned: (items: SidebarPinnedItem[]) => void;
  onReorderPeople: (memberIds: string[]) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPerson: (memberId: string) => void;
  onPreloadDirectConversation?: () => void;
  onCreateAgent: () => void;
  onEditAgent: (agentId: string) => void;
  duplicateSupported?: boolean;
  duplicatingAgentIds?: ReadonlySet<string>;
  onDuplicateAgent?: (agentId: string) => Promise<void>;
  onDeleteAgent: (agentId: string) => Promise<void>;
  compact: boolean;
  onExpand: () => void;
  onOpenMarketplace: () => void;
  emptyAction?: {
    label: string;
    avatarSeed: string;
    avatarHue: AvatarHue | null;
    onSelect: () => void;
  };
}

export type SidebarAgentState = { kind: "working" } | { kind: "responded" } | { kind: "unread"; count: number };

/** A pin paired with the chat it names, so the pinned strip renders the same two kinds the list does. */
export type ResolvedPinnedItem = { ref: SidebarPinnedItem; chat: SidebarChatItem };

/**
 * A row inside a section. Agents and channels share the sidebar layout - one order, one set of
 * section assignments - so the list, the grouping and the drag pipeline carry them as one type and
 * only the row component asks which kind it has.
 */
export type SidebarChatItem =
  | { kind: "agent"; id: string; agent: AgentProfile }
  | { kind: "channel"; id: string; channel: ChannelSummary };
