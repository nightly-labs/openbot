import type {
  AvatarHue,
  ChannelSummary,
  DirectThreadSummary,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  TeamPresenceMember,
} from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import type { AvatarMood } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import type { ServerMenuProps } from "../servers/ServerMenu";
import type { SidebarPinnedItem } from "./sidebar-pins";

/**
 * What the sidebar is, as data. These live apart from `Sidebar.tsx` because
 * nine of this feature's modules - the drag engine, the filtering, the scope
 * and every store - name one of these types and none of them render anything.
 * Reading them from the entry component made the pure logic depend on the whole
 * view to borrow a name.
 */
/**
 * What the main area shows for the chat picked in the list: its conversation, or its routines. The
 * list itself is the same in both.
 */
export type SidebarView = "agents" | "routines";

export interface SidebarProps {
  /** The switch over the list is shown only when the caller handles `onViewChange`. */
  view?: SidebarView;
  onViewChange?: ((view: SidebarView) => void) | undefined;
  deleteSupported?: boolean;
  marketplaceSupported?: boolean;
  channels?: ChannelSummary[];
  deletedChannels?: ChannelSummary[];
  activeChannelId?: string | null;
  onSelectChannel?: (channelId: string) => void;
  showingArchivedChannels?: boolean;
  onToggleArchivedChannels?: (() => void) | undefined;
  onCreateChannel?: (() => void) | undefined;
  /** Marks every agent chat and channel read. The free-area menu offers it while `hasUnread` is set. */
  onMarkAllRead?: (() => void) | undefined;
  hasUnread?: boolean;
  onEditChannel?: (channelId: string) => void;
  onDeleteChannel?: ((channelId: string) => Promise<void>) | undefined;
  serverName: string;
  onOpenServerSettings?: (trigger: HTMLElement) => void;
  /** The desktop server menu. Without it, the server name opens the server settings. */
  serverMenu?: Omit<ServerMenuProps, "serverName" | "compact">;
  agents: AgentProfile[];
  activeAgentId: string;
  showPeople?: boolean;
  people: TeamPresenceMember[];
  directThreads: DirectThreadSummary[];
  activeDirectMemberId: string | null;
  agentStates: Record<string, SidebarAgentState>;
  /** The face each agent wears, from `computeAgentAvatarMoods`. A missing entry rests. */
  agentMoods: Record<string, AvatarMood>;
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
  /** Whether this server currently accepts new agents. Desktop keeps the default enabled. */
  createSupported?: boolean;
  onCreateAgent: () => void;
  onEditAgent: (agentId: string) => void;
  duplicateSupported?: boolean;
  duplicatingAgentIds?: ReadonlySet<string>;
  onDuplicateAgent?: (agentId: string) => Promise<void>;
  onDeleteAgent: (agentId: string) => Promise<void>;
  compact: boolean;
  /** A card under the chat list, such as an announcement. The compact sidebar has no room for it. */
  footer?: JSX.Element;
  onExpand: () => void;
  onOpenMarketplace: () => void;
  /** The agents are still on their way, so an empty list says that it connects rather than that it is empty. */
  agentsConnecting?: boolean;
  emptyAction?:
    | {
        label: string;
        avatarSeed: string;
        avatarHue: AvatarHue | null;
        onSelect: () => void;
      }
    | undefined;
}

export type SidebarRoutinePhase = "running" | "queued" | "failed";

/** What an agent waits for: an answer to its question, an approval, or the user in the browser. */
export type SidebarWaitReason = "question" | "approval" | "takeover";

export type SidebarAgentState =
  /** `detail` is the question or the command, for the row tooltip. `null` when there is none. */
  | { kind: "waiting"; reason: SidebarWaitReason; detail: string | null }
  | { kind: "working" }
  | { kind: "responded" }
  | { kind: "unread"; count: number }
  | { kind: "routine"; phase: SidebarRoutinePhase; count: number }
  /** The provider plan is spent, so the queue waits. `resetsAt` is in epoch seconds, `null` when unknown. */
  | { kind: "limited"; resetsAt: number | null };

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
