import type {
  AvatarHue,
  ChannelSummary,
  DirectThreadSummary,
  HiddenAgent,
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

/**
 * The "Hidden" group is not a section of the layout, and it is collapsed by default. Its id in
 * `collapsedSectionIds` therefore records that the user opened it, not that the user collapsed it.
 * The colon keeps it apart from the section ids that the layout makes.
 */
export const SIDEBAR_HIDDEN_GROUP_OPEN_ID = "hidden-agents:open";

export interface SidebarProps {
  /** The switch over the list is shown only when the caller handles `onViewChange`. */
  view?: SidebarView | undefined;
  onViewChange?: ((view: SidebarView) => void) | undefined;
  deleteSupported?: boolean | undefined;
  marketplaceSupported?: boolean | undefined;
  channels?: ChannelSummary[] | undefined;
  deletedChannels?: ChannelSummary[] | undefined;
  activeChannelId?: string | null | undefined;
  onSelectChannel?: ((channelId: string) => void) | undefined;
  showingArchivedChannels?: boolean | undefined;
  onToggleArchivedChannels?: (() => void) | undefined;
  onCreateChannel?: (() => void) | undefined;
  /** Marks every agent chat and channel read. The free-area menu offers it while `hasUnread` is set. */
  onMarkAllRead?: (() => void) | undefined;
  hasUnread?: boolean | undefined;
  onEditChannel?: ((channelId: string) => void) | undefined;
  onDeleteChannel?: ((channelId: string) => Promise<void>) | undefined;
  /** Brings a deleted channel back to the list. Without it, a row in Deleted channels has no menu. */
  onRestoreChannel?: ((channelId: string) => void) | undefined;
  serverName: string;
  onOpenServerSettings?: ((trigger: HTMLElement) => void) | undefined;
  /** The desktop server menu. Without it, the server name opens the server settings. */
  serverMenu?: Omit<ServerMenuProps, "serverName" | "compact"> | undefined;
  /**
   * Back and Forward between the chats this window opened. The top bar shows the two arrows only when
   * it is set. `back` and `forward` name the chat that each arrow opens, or are null when there is none.
   */
  chatHistory?: SidebarChatHistory | undefined;
  /** A new OpenBot version of the server. The header shows a button that opens its update. */
  serverUpdate?: { version: string; running: boolean; onOpen: () => void } | undefined;
  agents: AgentProfile[];
  activeAgentId: string;
  showPeople?: boolean | undefined;
  people: TeamPresenceMember[];
  directThreads: DirectThreadSummary[];
  activeDirectMemberId: string | null;
  agentStates: Record<string, SidebarAgentState>;
  /** The wait of each channel that waits for the user, from `sidebarChannelWaits`. A missing entry does not wait. */
  channelWaits?: Record<string, SidebarChannelWait> | undefined;
  /** The channel rows come from a saved frame, which holds no last message. A row with none shows no preview and no time. */
  channelPreviewsPending?: boolean | undefined;
  /** The face each agent wears, from `computeAgentAvatarMoods`. A missing entry rests. */
  agentMoods: Record<string, AvatarMood>;
  layout: SidebarLayoutSnapshot;
  layoutMutable?: boolean | undefined;
  collapsedSectionIds: string[];
  onMutateLayout: (action: SidebarLayoutAction) => Promise<void>;
  /** Whether this server can copy a section with its agents. Without it, the section menu has no duplicate item. */
  sectionDuplicateSupported?: boolean | undefined;
  duplicatingSectionIds?: ReadonlySet<string> | undefined;
  onDuplicateSection?: ((sectionId: string) => Promise<void>) | undefined;
  onToggleSection: (sectionId: string) => void;
  pinnedItems: SidebarPinnedItem[];
  peopleOrder: string[];
  onPin: (item: SidebarPinnedItem) => void;
  onUnpin: (item: SidebarPinnedItem) => void;
  onReorderPinned: (items: SidebarPinnedItem[]) => void;
  onReorderPeople: (memberIds: string[]) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPerson: (memberId: string) => void;
  onPreloadDirectConversation?: (() => void) | undefined;
  /** Whether this server currently accepts new agents. Desktop keeps the default enabled. */
  createSupported?: boolean | undefined;
  onCreateAgent: () => void;
  onEditAgent: (agentId: string) => void;
  duplicateSupported?: boolean | undefined;
  duplicatingAgentIds?: ReadonlySet<string> | undefined;
  onDuplicateAgent?: ((agentId: string) => Promise<void>) | undefined;
  onDeleteAgent: (agentId: string) => Promise<void>;
  /**
   * The agents that a user hid on this server (`agent-hidden-v1`). They leave their sections, the
   * pinned strip and "Needs you", and show only in the "Hidden" group at the end of the list. Each
   * one keeps its section and its pin for a restore.
   */
  userHiddenAgents?: HiddenAgent[] | undefined;
  /** Hides an agent. Without it, the agent menu shows no hide item. */
  onHideAgent?: ((agentId: string) => void) | undefined;
  /** Puts a hidden agent back in its section. Without it, a hidden agent's menu shows no restore item. */
  onRestoreAgent?: ((agentId: string) => void) | undefined;
  /** Opens the agent's chat with a new thread. Without it, such as on a host without threads, the agent menu shows no new thread item. */
  onNewAgentThread?: ((agentId: string) => void) | undefined;
  /** Opens the agent's chat in a window of its own. Without it, the agent menu shows no window item. */
  onOpenAgentWindow?: ((agentId: string) => void) | undefined;
  /** The agents whose chat is open in a window of its own. Their rows show a window mark. */
  windowAgentIds?: ReadonlySet<string> | undefined;
  compact: boolean;
  /** A card under the chat list, such as an announcement. The compact sidebar has no room for it. */
  footer?: JSX.Element;
  onExpand: () => void;
  /** Opens the global search. The search field and the compact search button both call it. */
  onOpenSearch: () => void;
  onOpenMarketplace: () => void;
  /** The agents are still on their way, so an empty list says that it connects rather than that it is empty. */
  agentsConnecting?: boolean | undefined;
  emptyAction?:
    | {
        label: string;
        avatarSeed: string;
        avatarHue: AvatarHue | null;
        onSelect: () => void;
      }
    | undefined;
}

export interface SidebarChatHistory {
  back: { name: string } | null;
  forward: { name: string } | null;
  /** The keys of each arrow, as the tooltip shows them, such as "⌘[". */
  keys: { back: string; forward: string };
  onBack: () => void;
  onForward: () => void;
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

/** What a channel waits for. Its row shows it in "Needs you" the same way an agent row does. */
export type SidebarChannelWait = Extract<SidebarAgentState, { kind: "waiting" }>;

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
