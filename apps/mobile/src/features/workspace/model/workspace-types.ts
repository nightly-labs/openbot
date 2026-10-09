import type { AttachmentSupport } from "@openbot/contracts/attachment-files";
import type {
  AddedAgent,
  AgentAdminSettings,
  AgentAnalytics,
  AgentAnalyticsInput,
  AgentMemory,
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentReasoningEffort,
  AvatarHue,
  AvatarImageInput,
  ConversationSearchPage,
  ConversationSnapshot,
  CreateAgentInput,
  CreateRoutineInput,
  DraftAttachment,
  HostAnalytics,
  HostAnalyticsInput,
  InstallAgentTemplateInput,
  InstalledSkill,
  QueueSnapshot,
  RespondToBrowserSecretInput,
  RespondToPromptInput,
  Routine,
  RoutineCalendar,
  RoutineCalendarInput,
  SetEnabledSkillInput,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  StorageUsage,
  UninstallSkillInput,
  UpdateAgentAdminSettingsInput,
  UpdateAgentInput,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import type {
  EventActivity,
  EventRoutine,
  EventRoutineOwner,
  EventRoutineRef,
  ListEventActivityInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  WebhookSecret,
} from "@openbot/contracts/ipc-events";
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { RemoteRecoveryStatus, RemoteTeamDirectoryClient } from "@openbot/team-client";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type { MobileBrowserTab } from "@/features/browser/model/browser-tabs";
import type { BrowserViewBridgeEvent, RemoteBrowserViewSession } from "@/features/browser/model/browser-view-bridge";
import type { MobileChannelStore } from "@/features/channels/model/channel-store";
import type { MobileConversationStore } from "./conversation-store";
import type { LiveWorkspaceStore } from "./live-workspace-store";

type MobileServerKind = "local" | "remote";
export type MobileServerState = "unknown" | "connecting" | "online" | "offline" | "error";
export type MobileServerDirectoryState = "loading" | "ready" | "error";

export interface MobileServer {
  id: string;
  name: string;
  /** The logo version in the account directory, or null when the server has no logo. */
  logoKey: string | null;
  kind: MobileServerKind;
  state: MobileServerState;
  initialConnectionPending: boolean;
  connectionMessage: string | null;
  recoveryStatus?: RemoteRecoveryStatus;
  address: string | null;
  accent: string;
  publicKey: string;
  membershipId: string;
  role: "owner" | "admin" | "member";
  /** The active members that the host's plan allows. Absent when the account server gave none. */
  memberLimit?: number;
}

export interface MobileAgent {
  provider?: AgentProviderId;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  id: string;
  serverId: string;
  name: string;
  title: string;
  description: string;
  preview: string;
  updatedLabel: string;
  avatarUrl?: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
}

type ToggleAgentPinResult = "pinned" | "unpinned" | "error";

interface AddRemoteServerInput {
  inviteUrl: string;
}

/** What a host serves of the live browser view. */
export interface MobileBrowserViewSupport {
  /** `browser-control` and `browser-view`: the phone can show the agent's tab and use it. */
  view: boolean;
  /** `browser-view-clipboard`: the host pastes text and answers the selected text. */
  clipboard: boolean;
  /** `browser-view-context-menu`: the host sends the phone the menu of its right-clicks. */
  contextMenu: boolean;
  /** `browser-view-viewport`: the host holds the page at the size the phone asks for. */
  viewport: boolean;
}

/** What the phone does to a host browser tab, through the released `browser-control` routes. */
type MobileBrowserTabAction =
  | { type: "navigate"; tabId: string; direction: "back" | "forward" }
  | { type: "reload"; tabId: string }
  | { type: "open"; url: string; ownerAgentId: string; ownerThreadId: string | null }
  | { type: "close"; tabId: string };

export interface MobileWorkspaceContextValue {
  browserViewSupport: (serverId: string) => MobileBrowserViewSupport;
  /** Null when the server is not connected, or its peer page is not ready yet. */
  openBrowserView: (
    serverId: string,
    tabId: string,
    listener: (event: BrowserViewBridgeEvent) => void,
  ) => RemoteBrowserViewSession | null;
  /** The new tab for `open`, and null for the other actions. */
  controlBrowserTab: (serverId: string, action: MobileBrowserTabAction) => Promise<MobileBrowserTab | null>;
  respondToBrowserTakeover: (
    serverId: string,
    input: { requestId: string | number; decision: "complete" | "cancel" },
  ) => Promise<void>;
  respondToBrowserSecret: (serverId: string, input: RespondToBrowserSecretInput) => Promise<void>;
  sidebarByServer: Record<string, { layout: SidebarLayoutSnapshot | null; error: string | null }>;
  mutateSidebarLayout: (serverId: string, action: SidebarLayoutAction) => Promise<void>;
  loadQueue: (agentId: string, serverId: string) => Promise<QueueSnapshot>;
  canEditQueue: (serverId: string) => boolean;
  /** The files this host accepts beyond the base list, as the desktop picker reads them. */
  attachmentSupport: (serverId: string) => AttachmentSupport;
  changeQueue: (
    agentId: string,
    serverId: string,
    action: "cancel" | "steer" | "reorder",
    input: { deliveryId?: string; expectedTurnId?: string; deliveryIds?: string[] },
  ) => Promise<void>;
  editQueue: (agentId: string, serverId: string, input: QueueEditRequest) => Promise<QueueSnapshot>;
  interruptTurn: (agentId: string, turnId: string, serverId?: string) => Promise<void>;
  channelStore: MobileChannelStore;
  /** Local host first, then remote servers in the order saved on this device. */
  servers: MobileServer[];
  /** Saves the order of remote server IDs on this device. Returns false and keeps the old order on failure. */
  reorderServers: (serverIds: string[]) => boolean;
  teamDirectory: RemoteTeamDirectoryClient;
  serverDirectoryState: MobileServerDirectoryState;
  serverDirectoryError: string | null;
  agents: MobileAgent[];
  activeServer: MobileServer;
  activeAgents: MobileAgent[];
  hiddenAgents: MobileAgent[];
  pinnedAgentIds: string[];
  pinnedChannelIds: string[];
  hiddenChannelIds: string[];
  hideChannel: (channelId: string, serverId: string) => boolean;
  unhideChannel: (channelId: string, serverId: string) => boolean;
  toggleChannelPin: (channelId: string, serverId: string) => ToggleAgentPinResult;
  conversationStore: MobileConversationStore;
  /** Activity, unread agents, and browser requests. Read them with a selector hook, not from the context. */
  liveState: LiveWorkspaceStore;
  selectServer: (serverId: string) => void;
  leaveServer: (serverId: string) => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshServer: (serverId: string) => Promise<void>;
  /** An owner or admin of an online host that serves `host-admin-v1`. The host checks the role again. */
  canEditServerIdentity: (serverId: string) => boolean;
  /** An absent field stays unchanged; a `null` logo removes it. */
  updateServerIdentity: (
    serverId: string,
    input: { serverName?: string; logo?: AvatarImageInput | null },
  ) => Promise<void>;
  addRemoteServer: (input: AddRemoteServerInput) => Promise<string>;
  createAgent: (input: CreateAgentInput) => Promise<void>;
  updateAgent: (input: UpdateAgentInput, serverId?: string) => Promise<void>;
  setAgentAvatar: (agentId: string, image: RemoteFileUpload | null, serverId: string) => Promise<void>;
  loadAgentAvatar: (agentId: string, avatarUrl: string, serverId: string) => Promise<string>;
  deleteAgent: (agentId: string) => Promise<void>;
  duplicateAgent: (agentId: string) => Promise<void>;
  saveAgentMemory: (agentId: string, text: string, serverId: string, memoryId?: string) => Promise<void>;
  deleteAgentMemory: (agentId: string, memoryId: string, serverId: string) => Promise<void>;
  createAgentRoutine: (input: CreateRoutineInput, serverId: string) => Promise<void>;
  updateAgentRoutine: (input: UpdateRoutineInput, serverId: string) => Promise<void>;
  deleteAgentRoutine: (agentId: string, routineId: string, serverId: string) => Promise<void>;
  testAgentRoutine: (agentId: string, routineId: string, serverId: string) => Promise<void>;
  /** Event administration is available only to owners and admins on hosts with events-v1. */
  canManageEvents: (serverId: string) => boolean;
  listEventRoutines: (owner: EventRoutineOwner, serverId: string) => Promise<EventRoutine[]>;
  /** The result has the signing secret only when the save made a new webhook trigger. */
  saveEventRoutine: (input: SaveEventRoutineInput, serverId: string) => Promise<SaveEventRoutineResult>;
  deleteEventRoutine: (input: EventRoutineRef, serverId: string) => Promise<void>;
  testEventRoutine: (input: EventRoutineRef, serverId: string) => Promise<void>;
  rotateEventRoutineSecret: (input: EventRoutineRef, serverId: string) => Promise<WebhookSecret>;
  listEventActivity: (input: ListEventActivityInput, serverId: string) => Promise<EventActivity[]>;
  loadAgentModels: (serverId: string) => Promise<AgentModelOption[]>;
  loadAgentMemories: (agentId: string, serverId: string) => Promise<AgentMemory[]>;
  loadAgentRoutines: (agentId: string, serverId: string) => Promise<Routine[]>;
  /** Every routine of the server, of agents and channels, with its runs in the range. */
  loadRoutineCalendar: (input: RoutineCalendarInput, serverId: string) => Promise<RoutineCalendar>;
  loadAgentAnalytics: (input: AgentAnalyticsInput, serverId: string) => Promise<AgentAnalytics | null>;
  /** Null when the host does not advertise `host-analytics`. Without an agent ID, the report covers every agent. */
  loadHostAnalytics: (input: HostAnalyticsInput, serverId: string) => Promise<HostAnalytics | null>;
  /**
   * Null when the host does not advertise `installed-skills`. With `manage`, reads the
   * `skills-admin-v1` list, which has the enabled state and origin; the host refuses a member.
   */
  loadAgentSkills: (agentId: string, serverId: string, manage?: boolean) => Promise<InstalledSkill[] | null>;
  /** An owner or admin of an online host that serves `skills-admin-v1`. The host checks the role again. */
  canManageAgentSkills: (serverId: string) => boolean;
  /** Owners and admins only; the host refuses a member. Resolves with the skill the host saved. */
  setAgentSkillEnabled: (input: SetEnabledSkillInput, serverId: string) => Promise<InstalledSkill>;
  /** Owners and admins only; the host refuses a member. */
  uninstallAgentSkill: (input: UninstallSkillInput, serverId: string) => Promise<void>;
  /** Null when the host does not advertise `storage-v1`. */
  loadAgentStorage: (agentId: string, serverId: string, force?: boolean) => Promise<StorageUsage | null>;
  /** Null when the host does not advertise `agent-admin-v1`. Owners and admins only; the host refuses a member. */
  loadAgentAdminSettings: (agentId: string, serverId: string) => Promise<AgentAdminSettings | null>;
  /** Owners and admins only; the host refuses a member. Resolves with the settings the host saved. */
  updateAgentAdminSettings: (input: UpdateAgentAdminSettingsInput, serverId: string) => Promise<AgentAdminSettings>;
  /** True when the host advertises `agent-install-v1`. The host still refuses a member. */
  canInstallAgentTemplate: (serverId: string) => boolean;
  /** Owners and admins only. The host downloads the template with its own account. */
  installAgentTemplate: (input: InstallAgentTemplateInput, serverId: string) => Promise<AddedAgent>;
  /** Owners and admins only; the host refuses a member. */
  deleteStoredFile: (fileId: string, serverId: string) => Promise<void>;
  /** Searches message text in the server's agent chats, one page from `cursor` or from the newest match. */
  searchMessages: (query: string, serverId: string, cursor?: string) => Promise<ConversationSearchPage>;
  loadConversation: (agentId: string) => Promise<ConversationSnapshot>;
  loadOlderMessages: (agentId: string) => Promise<void>;
  respondToPrompt: (agentId: string, input: RespondToPromptInput) => Promise<void>;
  sendMessage: (
    agentId: string,
    text: string,
    attachmentDraftIds?: string[],
    replyToMessageId?: string | null,
    serverId?: string,
  ) => Promise<string>;
  uploadAttachment: (
    agentId: string,
    input: RemoteFileUpload,
    serverId?: string,
    /** Hears the fraction of the file sent so far, from 0 to 1. */
    onProgress?: (fraction: number) => void,
  ) => Promise<DraftAttachment>;
  downloadAttachment: (serverId: string, attachmentId: string) => Promise<RemoteFileUpload>;
  discardAttachment: (agentId: string, attachmentId: string, serverId?: string) => Promise<void>;
  hideAgent: (agentId: string) => void;
  unhideAgent: (agentId: string) => void;
  markAgentRead: (agentId: string, throughMessageId?: string) => void;
  markAgentUnread: (agentId: string) => void;
  toggleAgentPin: (agentId: string) => ToggleAgentPinResult;
}
