import type {
  AgentAccess,
  AgentExchangeSummary,
  AgentModelId,
  AgentProviderId,
  AgentReasoningEffort,
  AgentSummary,
  AttachmentSummary,
  AvatarHue,
  ChannelRoutingConversationEvent,
  ConversationQuestionPrompt,
  ConversationReaction,
  HostedSiteConversationEvent,
  ImageGenerationInfo,
  MessageReaction,
  QueueDeliveryStatus,
  RoutineConversationEvent,
  RoutineRunConversationEvent,
  SkillConversationEvent,
} from "@openbot/contracts/ipc";

/**
 * `error` is a message the renderer wrote itself, not one the provider sent: an action of the
 * user failed, and `status` names which one.
 */
export type MessageKind = "text" | "thinking" | "exchange" | "question" | "action-marker" | "error";

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

export type ChatActionMarkerModel =
  | (SkillConversationEvent & { kind: "skill-lifecycle"; timestamp: string })
  | {
      kind: "agent-message";
      direction: "incoming" | "outgoing";
      sourceAgentId: string;
      targetDeliveries: Array<{ agentId: string; status: QueueDeliveryStatus }>;
      status: AgentDeliveryMarkerStatus;
      timestamp: string;
      messageId: string;
      replyToMessageId: string | null;
      /** The sender asked for no answer, so the marker names it as information rather than a request. */
      expectsReply: boolean;
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
  | {
      kind: "routine-run";
      sourceAgentId: string | null;
      routineId: string;
      runId: string;
      routineName: string;
      status: "queued" | RoutineRunConversationEvent["status"];
      timestamp: string;
      previousTransitions?: RoutineRunMarkerTransition[];
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
  | (ChannelRoutingConversationEvent & { kind: "channel-routing"; timestamp: string })
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
  turnId?: string;
  author: "you" | "agent";
  body: string;
  time: string;
  createdAt?: string;
  streaming?: boolean;
  animate?: boolean;
  itemType?: string;
  kind?: MessageKind;
  status?: string;
  senderAgentId?: string;
  replyToMessageId?: string | null;
  attachments?: AttachmentSummary[];
  imageGeneration?: ImageGenerationInfo;
  questionPrompt?: ConversationQuestionPrompt;
  citations?: MessageCitation[];
  exchange?: AgentExchangeSummary;
  reaction?: MessageReaction | null;
  reactions?: ConversationReaction[];
  reactionSummary?: MessageReactionSummary;
  routine?: {
    routineId: string;
    runId: string;
    name: string;
    scheduledFor: string;
  };
  actionMarker?: ChatActionMarkerModel;
  items?: string[];
  itemIds?: string[];
}

export interface AgentProfile {
  id: string;
  name: string;
  title: string;
  description: string;
  notifications: boolean;
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  /** Absent for an agent on a remote host, which does not share it; the host then decides. */
  access?: AgentAccess;
  /** Absent means on. Absent for an agent on a remote host too, which does not share it. */
  computerUse?: boolean;
  threadId: string | null;
  /** The agent's working directory. Absent for profiles built before it was tracked. */
  workspacePath?: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarUrl: string | null;
  marketplaceSource?: AgentSummary["marketplaceSource"];
  updatedAt?: string | null;
  time: string;
  preview: string;
}
