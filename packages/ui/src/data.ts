import type { AgentProviderId, AgentProviderRef } from "@openbot/contracts/agent-providers";
import type {
  AgentAccess,
  AgentExchangeSummary,
  AgentInstructionsChange,
  AgentModelId,
  AgentReasoningEffort,
  AgentTask,
  AttachmentSummary,
  AvatarColor,
  AvatarHue,
  BrowserTab,
  ChannelRoutingConversationEvent,
  ClientAgentSummary,
  ConversationMemoryChange,
  ConversationMessageSender,
  ConversationPlan,
  ConversationQuestionPrompt,
  ConversationReaction,
  ConversationSubagent,
  ConversationTurnTrace,
  HostedSiteConversationEvent,
  ImageGenerationInfo,
  InstalledSkill,
  McpServerConfig,
  MessageReaction,
  ModelSwitchReason,
  QueueDeliveryStatus,
  RoutineConversationEvent,
  RoutineRunConversationEvent,
  SettingLinkId,
  SkillConversationEvent,
  SkillSuggestionEvent,
  VideoGenerationInfo,
} from "@openbot/contracts/ipc";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";

export type MessageKind =
  | "text"
  | "thinking"
  | "exchange"
  | "question"
  | "action-marker"
  | "plan"
  | "subagents"
  | "memory-changes"
  | "error";

export interface AgentMessagePlan extends ConversationPlan {
  stopped: boolean;
}

export type ChatActionMarkerStatus =
  | "queued"
  | "in-progress"
  | "needs-attention"
  | "completed"
  | "partial"
  | "failed"
  | "interrupted"
  | "cancelled"
  | "unavailable";

export type AgentDeliveryMarkerStatus = Exclude<ChatActionMarkerStatus, "needs-attention">;

export interface RoutineRunMarkerTransition {
  status: "queued" | RoutineRunConversationEvent["status"];
  timestamp: string;
}

export interface AgentMessageMarkerModel {
  kind: "agent-message";
  direction: "incoming" | "outgoing";
  sourceAgentId: string;
  targetDeliveries: Array<{ agentId: string; status: QueueDeliveryStatus }>;
  status: AgentDeliveryMarkerStatus;
  timestamp: string;
  messageId: string;
  replyToMessageId: string | null;
  expectsReply: boolean;
  senderTaskId?: string;
  expanded?: boolean;
}

export interface RoutineRunMarkerModel {
  kind: "routine-run";
  sourceAgentId: string | null;
  routineId: string;
  runId: string;
  routineName: string;
  status: "queued" | RoutineRunConversationEvent["status"];
  timestamp: string;
  previousTransitions?: RoutineRunMarkerTransition[];
  expanded?: boolean;
}

export type ChatActionMarkerModel =
  | (SkillConversationEvent & {
      kind: "skill-lifecycle";
      timestamp: string;
      installMessageIds?: readonly string[];
    })
  | AgentMessageMarkerModel
  | {
      kind: "agent-message-group";
      messages: Array<{ id: string; marker: AgentMessageMarkerModel }>;
      timestamp: string;
    }
  | {
      kind: "routine-lifecycle";
      action: RoutineConversationEvent["action"];
      sourceAgentId: string | null;
      routineId: string;
      routineName: string;
      status: "completed";
      timestamp: string;
    }
  | RoutineRunMarkerModel
  | {
      kind: "routine-run-group";
      routineId: string;
      routineName: string;
      runs: Array<{ id: string; marker: RoutineRunMarkerModel }>;
      timestamp: string;
      expanded?: boolean;
    }
  | {
      kind: "hosted-site";
      sourceAgentId: string | null;
      action: HostedSiteConversationEvent["action"];
      status: HostedSiteConversationEvent["status"];
      operationId: string;
      siteId: string | null;
      title: string;
      hostname: string | null;
      url: string | null;
      timestamp: string;
    }
  | {
      kind: "channel-routing";
      action: ChannelRoutingConversationEvent["action"];
      agentIds: string[];
      timestamp: string;
    }
  | { kind: "marketplace-suggestion"; appId: string; timestamp: string }
  | { kind: "setting-link"; settingId: SettingLinkId; timestamp: string }
  | (SkillSuggestionEvent & { kind: "skill-suggestion"; timestamp: string })
  | { kind: "mcp-sign-in"; mcpServerId: string; timestamp: string }
  | { kind: "server-install"; name: string | null; expiresAt: number; timestamp: string }
  | {
      kind: "feedback-sent";
      messageId: string;
      title: string;
      number: number;
      url: string;
      withdrawn: boolean;
      timestamp: string;
    }
  | { kind: "context-reset"; timestamp: string }
  | { kind: "model-switch"; reason: ModelSwitchReason; text: string; timestamp: string }
  | { kind: "channel-change"; text: string; timestamp: string }
  | { kind: "vault-change"; text: string; timestamp: string }
  | { kind: "plan-continuation"; text: string; timestamp: string }
  | { kind: "sign-in-failure"; provider: AgentProviderId; text: string; timestamp: string }
  | {
      kind: "instructions-change";
      agentId: string | null;
      change: AgentInstructionsChange | null;
      text: string;
      timestamp: string;
    }
  | {
      kind: "unavailable";
      label: string;
      timestamp: string;
    };

export interface MessageCitation {
  number: number;
  label: string;
  url: string;
  host?: string;
}

export interface MessageReactionSummary {
  emojis: MessageReaction[];
  overflowCount?: number;
}

export interface AgentMessage {
  id: string;
  turnId?: string | undefined;
  author: "you" | "agent";
  body: string;
  time: string;
  createdAt?: string;
  streaming?: boolean;
  animate?: boolean | undefined;
  itemType?: string | undefined;
  kind?: MessageKind;
  status?: string | undefined;
  senderAgentId?: string | undefined;
  senderMember?: ConversationMessageSender | undefined;
  replyToMessageId?: string | null | undefined;
  steered?: true | undefined;
  attachments?: AttachmentSummary[] | undefined;
  voiceRecording?: AttachmentSummary | undefined;
  imageGeneration?: ImageGenerationInfo | undefined;
  videoGeneration?: VideoGenerationInfo | undefined;
  questionPrompt?: ConversationQuestionPrompt | undefined;
  uiBlock?: ConversationUiBlock;
  citations?: MessageCitation[];
  exchange?: AgentExchangeSummary | undefined;
  remoteSender?: { agentId: string; agentName: string; serverName: string } | undefined;
  reaction?: MessageReaction | null | undefined;
  reactions?: ConversationReaction[];
  reactionSummary?: MessageReactionSummary;
  routine?:
    | {
        routineId: string;
        runId: string;
        name: string;
        scheduledFor: string;
      }
    | undefined;
  actionMarker?: ChatActionMarkerModel | undefined;
  items?: string[];
  itemIds?: string[];
  itemCreatedAt?: string[];
  itemStreaming?: boolean[];
  plan?: AgentMessagePlan | undefined;
  subagents?: ConversationSubagent[] | undefined;
  memoryChanges?: ConversationMemoryChange[] | undefined;
  trace?: ConversationTurnTrace | undefined;
}

export interface AgentProfile {
  id: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  provider: AgentProviderRef;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  providerAccountId?: string | undefined;
  access?: AgentAccess | undefined;
  computerUse?: boolean | undefined;
  allowAutomation?: boolean | undefined;
  allowNewChat?: boolean | undefined;
  quickAcknowledgement?: boolean | undefined;
  ownBrowserSession?: boolean | undefined;
  browserProfileId?: string | undefined;
  fastMode?: boolean | undefined;
  ultrafast?: boolean | undefined;
  busyMessageMode?: ClientAgentSummary["busyMessageMode"];
  taskLimit?: ClientAgentSummary["taskLimit"];
  backupModels?: ClientAgentSummary["backupModels"];
  additionalFolders?: ClientAgentSummary["additionalFolders"];
  excludedFolders?: ClientAgentSummary["excludedFolders"];
  usageLimitReturn?: ClientAgentSummary["usageLimitReturn"];
  pendingRuntime?: ClientAgentSummary["pendingRuntime"];
  threadId: string | null;
  workspacePath?: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor?: AvatarColor | null;
  chatColor?: AvatarColor | undefined;
  avatarUrl: string | null;
  marketplaceSource?: NonNullable<ClientAgentSummary["marketplaceSource"]>;
  updatedAt?: string | null;
  time: string;
  preview: string;
}

export type ComposerAgent = Pick<
  AgentProfile,
  "id" | "name" | "title" | "description" | "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl" | "chatColor"
>;

export type ComposerSkill = Pick<
  InstalledSkill,
  "skillId" | "slug" | "name" | "state" | "enabled" | "origin" | "description" | "problem"
>;

export type ComposerMcpServer = Pick<
  McpServerConfig,
  "id" | "name" | "enabled" | "transport" | "command" | "args" | "url"
>;

export type ComposerBrowserTab = Pick<BrowserTab, "id" | "title" | "url">;

export type ComposerThread = Pick<AgentTask, "id" | "title" | "state" | "outcome" | "progress" | "error">;

export interface ComposerThreadMessageMatch {
  threadId: string;
  body: string;
}
