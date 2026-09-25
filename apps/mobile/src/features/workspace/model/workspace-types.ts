import type { AttachmentSupport } from "@openbot/contracts/attachment-files";
import type {
  AgentAnalytics,
  AgentAnalyticsInput,
  AgentMemory,
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentReasoningEffort,
  AvatarHue,
  ConversationSnapshot,
  CreateAgentInput,
  CreateRoutineInput,
  DraftAttachment,
  InstalledSkill,
  QueueSnapshot,
  RespondToBrowserSecretInput,
  RespondToPromptInput,
  Routine,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  StorageUsage,
  UpdateAgentInput,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { RemoteRecoveryStatus, RemoteTeamDirectoryClient } from "@openbot/team-client";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type { MobileChannelStore } from "@/features/channels/model/channel-store";
import type { MobileConversationStore } from "./conversation-store";
import type { LiveWorkspaceStore } from "./live-workspace-store";

export type MobileServerKind = "local" | "remote";
export type MobileServerState = "unknown" | "connecting" | "online" | "offline" | "error";
export type MobileServerDirectoryState = "loading" | "ready" | "error";

export interface MobileServer {
  id: string;
  name: string;
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

export type ToggleAgentPinResult = "pinned" | "unpinned" | "error";

interface AddRemoteServerInput {
  inviteUrl: string;
}

export interface MobileWorkspaceContextValue {
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
  servers: MobileServer[];
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
  loadAgentModels: (serverId: string) => Promise<AgentModelOption[]>;
  loadAgentMemories: (agentId: string, serverId: string) => Promise<AgentMemory[]>;
  loadAgentRoutines: (agentId: string, serverId: string) => Promise<Routine[]>;
  loadAgentAnalytics: (input: AgentAnalyticsInput, serverId: string) => Promise<AgentAnalytics | null>;
  /** Null when the host does not advertise `installed-skills`. */
  loadAgentSkills: (agentId: string, serverId: string) => Promise<InstalledSkill[] | null>;
  /** Null when the host does not advertise `storage-v1`. */
  loadAgentStorage: (agentId: string, serverId: string, force?: boolean) => Promise<StorageUsage | null>;
  /** Owners and admins only; the host refuses a member. */
  deleteStoredFile: (fileId: string, serverId: string) => Promise<void>;
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
