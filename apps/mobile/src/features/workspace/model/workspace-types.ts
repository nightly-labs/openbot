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
  RespondToPromptInput,
  Routine,
  UpdateAgentInput,
  UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import type { RemoteRecoveryStatus, RemoteTeamDirectoryClient } from "@openbot/team-client";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type { MobileAgentActivities } from "./agent-activity";

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
  avatarSeed: string;
  avatarHue: AvatarHue | null;
}

export type ToggleAgentPinResult = "pinned" | "unpinned" | "error";

interface AddRemoteServerInput {
  inviteUrl: string;
}

export interface MobileWorkspaceContextValue {
  servers: MobileServer[];
  teamDirectory: RemoteTeamDirectoryClient;
  serverDirectoryState: MobileServerDirectoryState;
  serverDirectoryError: string | null;
  agents: MobileAgent[];
  activeServer: MobileServer;
  activeAgents: MobileAgent[];
  hiddenAgents: MobileAgent[];
  pinnedAgentIds: string[];
  unreadAgentIds: string[];
  conversations: Record<string, ConversationSnapshot>;
  activityByServer: Record<string, MobileAgentActivities>;
  selectServer: (serverId: string) => void;
  leaveServer: (serverId: string) => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshServer: (serverId: string) => Promise<void>;
  addRemoteServer: (input: AddRemoteServerInput) => Promise<string>;
  createAgent: (input: CreateAgentInput) => Promise<void>;
  updateAgent: (input: UpdateAgentInput, serverId?: string) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  duplicateAgent: (agentId: string) => Promise<void>;
  saveAgentMemory: (agentId: string, text: string, serverId: string, memoryId?: string) => Promise<void>;
  deleteAgentMemory: (agentId: string, memoryId: string, serverId: string) => Promise<void>;
  createAgentRoutine: (input: CreateRoutineInput, serverId: string) => Promise<void>;
  updateAgentRoutine: (input: UpdateRoutineInput, serverId: string) => Promise<void>;
  deleteAgentRoutine: (agentId: string, routineId: string, serverId: string) => Promise<void>;
  loadAgentModels: (serverId: string) => Promise<AgentModelOption[]>;
  loadAgentMemories: (agentId: string, serverId: string) => Promise<AgentMemory[]>;
  loadAgentRoutines: (agentId: string, serverId: string) => Promise<Routine[]>;
  loadAgentAnalytics: (input: AgentAnalyticsInput, serverId: string) => Promise<AgentAnalytics | null>;
  loadConversation: (agentId: string) => Promise<ConversationSnapshot>;
  respondToPrompt: (agentId: string, input: RespondToPromptInput) => Promise<void>;
  sendMessage: (
    agentId: string,
    text: string,
    attachmentDraftIds?: string[],
    replyToMessageId?: string | null,
  ) => Promise<string>;
  uploadAttachment: (agentId: string, input: RemoteFileUpload) => Promise<DraftAttachment>;
  discardAttachment: (agentId: string, attachmentId: string) => Promise<void>;
  hideAgent: (agentId: string) => void;
  unhideAgent: (agentId: string) => void;
  markAgentRead: (agentId: string, throughMessageId?: string) => void;
  markAgentUnread: (agentId: string) => void;
  toggleAgentPin: (agentId: string) => ToggleAgentPinResult;
}
