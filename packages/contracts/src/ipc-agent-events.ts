import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { type AgentColorEntry, isAgentColors } from "./ipc-agent-colors";
import { type AgentNotificationLevelEntry, isAgentNotificationLevelsSnapshot } from "./ipc-agent-notification-levels";
import { type AgentRuntimeSnapshot, isAgentRuntimeSnapshot } from "./ipc-agent-runtime";
import type { AccountUsage, AgentStatus } from "./ipc-agent-status";
import { type AgentTasksSnapshot, isAgentTasksSnapshot } from "./ipc-agent-tasks";
import { type AgentWaitsSnapshot, isAgentWaitsSnapshot } from "./ipc-agent-waits";
import { type ClientAgentSummary, isClientAgentSummary } from "./ipc-agents";
import {
  type AgentApproval,
  type BrowserTakeoverRequest,
  isAgentApproval,
  isBrowserTakeoverRequest,
} from "./ipc-approvals";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import type { BrowserControlState, BrowserTab } from "./ipc-browser";
import { type AgentChatColorEntry, isChatColors, type MemberChatColorEntry } from "./ipc-chat-colors";
import { type AgentPromptQuestion, isAgentPromptQuestion, isConversationMessage } from "./ipc-conversation-messages";
import { CONVERSATION_SUBAGENT_TITLE_LIMIT } from "./ipc-conversation-subagents";
import { CONVERSATION_TRACE_TEXT_LIMIT } from "./ipc-conversation-trace";
import {
  type ConversationPage,
  type ConversationSnapshot,
  isConversationReadState,
  isConversationSnapshot,
} from "./ipc-conversations";
import { type HiddenAgent, isHiddenAgentsSnapshot } from "./ipc-hidden-agents";
import { isQueueSnapshot, type QueueSnapshot } from "./ipc-queue";
import { isSidebarLayoutSnapshot, type SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import { isSidebarPinsSnapshot, type SidebarPin } from "./ipc-sidebar-pins";
import type { ServerNotificationLevel } from "./ipc-team-host";
import { isBoolean, isDynamicRecord, isNumber, isString } from "./runtime-values";

export type AgentTurnOrigin = "user" | "routine" | "agent" | "unknown";

export const AGENT_STEP_ACTIVITIES = [
  "searching",
  "browsing",
  "reading",
  "running",
  "editing",
  "delegating",
  "working",
  "reviewing",
] as const;
export type AgentStepActivity = (typeof AGENT_STEP_ACTIVITIES)[number];

export function agentStepActivity(value: string | undefined): AgentStepActivity | null {
  return AGENT_STEP_ACTIVITIES.find((activity) => activity === value) ?? null;
}

function isAgentTurnOrigin(value: unknown): value is AgentTurnOrigin {
  return value === "user" || value === "routine" || value === "agent" || value === "unknown";
}

export interface AgentTurnCompletedEvent {
  type: "turn-completed";
  agentId: string;
  threadId: string;
  turnId: string;
  status: string;
  origin?: AgentTurnOrigin;
  quiet?: true;
  continues?: true;
  answersAgent?: boolean;
}

export type AgentEvent =
  | { type: "channels-changed"; channelId: string; revision: number }
  | { type: "status"; status: AgentStatus }
  | { type: "usage-changed"; usage: AccountUsage }
  | { type: "agents-changed"; agents: ClientAgentSummary[] }
  | { type: "memories-changed"; agentId: string }
  | { type: "routines-changed"; agentId: string }
  | { type: "skills-changed"; agentId: string }
  | { type: "routine-flows-changed"; agentId: string }
  | { type: "workflows-changed"; workflowId: string; agentId?: string }
  | { type: "crm-changed" }
  | { type: "vault-changed" }
  | { type: "browser-profiles-changed" }
  | { type: "library-folders-changed" }
  | { type: "usage-credits-changed" }
  | { type: "agent-session-settings-changed"; agentId: string }
  | { type: "message-pins-changed"; agentId: string }
  | { type: "channel-memories-changed"; channelId: string }
  | { type: "channel-routines-changed"; channelId: string }
  | { type: "sidebar-layout-changed"; layout: SidebarLayoutSnapshot }
  | { type: "hidden-agents-changed"; agents: HiddenAgent[] }
  | { type: "agent-colors-changed"; agents: AgentColorEntry[] }
  | { type: "chat-colors-changed"; agents: AgentChatColorEntry[]; members: MemberChatColorEntry[] }
  | {
      type: "agent-notification-levels-changed";
      server: ServerNotificationLevel | null;
      agents: AgentNotificationLevelEntry[];
    }
  | { type: "sidebar-pins-changed"; items: SidebarPin[]; updatedAt: string | null }
  | { type: "agent-access-changed"; revision: number }
  | { type: "conversation"; snapshot: ConversationSnapshot }
  | { type: "conversation-invalidated"; agentId: string; revision: number }
  | { type: "conversation-page"; page: ConversationPage }
  | {
      type: "conversation-delta";
      agentId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      delta: string;
      createdAt: string;
      revision: number;
    }
  | { type: "queue-invalidated"; agentId: string }
  | { type: "queue-changed"; snapshot: QueueSnapshot }
  | { type: "waits-changed"; snapshot: AgentWaitsSnapshot }
  | { type: "agent-tasks-changed"; snapshot: AgentTasksSnapshot }
  | { type: "agent-task-conversation"; taskId: string; snapshot: ConversationSnapshot }
  | {
      type: "agent-task-conversation-delta";
      taskId: string;
      agentId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      delta: string;
      createdAt: string;
      revision: number;
    }
  | {
      type: "turn-progress";
      agentId: string;
      threadId: string;
      turnId: string;
      detail: string;
      running?: boolean;
      activity?: string;
      error?: string;
    }
  | { type: "turn-started"; agentId: string; threadId: string; turnId: string; origin?: AgentTurnOrigin }
  | AgentTurnCompletedEvent
  | { type: "thread-turn-completed"; taskId: string; routine: boolean; turn: AgentTurnCompletedEvent }
  | {
      type: "prompt";
      requestId: string | number;
      agentId: string;
      threadId: string;
      turnId: string;
      questions: AgentPromptQuestion[];
      detached?: true;
    }
  | {
      type: "agent-input-resolved";
      kind: "prompt" | "approval";
      requestId: string | number;
      agentId: string;
    }
  | { type: "browser-takeover-requested"; request: BrowserTakeoverRequest }
  | { type: "browser-takeover-resolved"; requestId: string | number; agentId: string }
  | { type: "approval"; approval: AgentApproval }
  | { type: "runtime-snapshot"; snapshot: AgentRuntimeSnapshot }
  | { type: "browser-changed"; tabs: BrowserTab[]; activeTabId: string | null }
  | { type: "browser-control-changed"; state: BrowserControlState }
  | { type: "browser-user-control-changed"; tabIds: string[] }
  | {
      type: "browser-page-state-changed";
      tabs: { tabId: string; canGoBack: boolean; canGoForward: boolean }[];
    }
  | {
      type: "error";
      agentId?: string;
      code: string;
      message: string;
      provider?: AgentProviderId;
      model?: string;
      link?: string;
    }
  | {
      type: "usage-limit-reached";
      agentId: string;
      provider: AgentProviderId;
      resetsAt: number | null;
      agentCount: number;
    }
  | {
      type: "subagent-failed";
      agentId: string;
      threadId: string;
      turnId: string;
      subagentId: string;
      title: string;
    };

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isDynamicRecord(value) || !isString(value.type)) return false;
  switch (value.type) {
    case "channels-changed":
      return (
        isIdentifier(value.channelId) &&
        typeof value.revision === "number" &&
        Number.isSafeInteger(value.revision) &&
        value.revision >= 0
      );
    case "status":
      return isDynamicRecord(value.status);
    case "usage-changed":
      return isDynamicRecord(value.usage);
    case "agents-changed":
      return (
        Array.isArray(value.agents) &&
        value.agents.length <= INPUT_LIMITS.agents &&
        value.agents.every(isClientAgentSummary)
      );
    case "memories-changed":
      return isString(value.agentId) && value.agentId.length > 0 && value.agentId.length <= INPUT_LIMITS.identifier;
    case "routines-changed":
      return isString(value.agentId) && value.agentId.length > 0 && value.agentId.length <= INPUT_LIMITS.identifier;
    case "agent-session-settings-changed":
    case "message-pins-changed":
    case "skills-changed":
    case "routine-flows-changed":
      return isIdentifier(value.agentId);
    case "workflows-changed":
      return isIdentifier(value.workflowId) && (value.agentId === undefined || isIdentifier(value.agentId));
    case "crm-changed":
    case "vault-changed":
    case "browser-profiles-changed":
    case "library-folders-changed":
    case "usage-credits-changed":
      return true;
    case "channel-memories-changed":
    case "channel-routines-changed":
      return isIdentifier(value.channelId);
    case "sidebar-layout-changed":
      return isSidebarLayoutSnapshot(value.layout);
    case "hidden-agents-changed":
      return isHiddenAgentsSnapshot({ agents: value.agents });
    case "agent-colors-changed":
      return isAgentColors({ agents: value.agents });
    case "chat-colors-changed":
      return isChatColors({ agents: value.agents, members: value.members });
    case "agent-notification-levels-changed":
      return isAgentNotificationLevelsSnapshot({ server: value.server, agents: value.agents });
    case "sidebar-pins-changed":
      return isSidebarPinsSnapshot({ items: value.items, updatedAt: value.updatedAt });
    case "agent-access-changed":
      return isNumber(value.revision) && Number.isSafeInteger(value.revision) && value.revision >= 0;
    case "conversation":
      return isConversationSnapshot(value.snapshot);
    case "conversation-invalidated":
      return (
        isIdentifier(value.agentId) &&
        isNumber(value.revision) &&
        Number.isInteger(value.revision) &&
        value.revision >= 0
      );
    case "conversation-page": {
      const page = value.page;
      if (!isDynamicRecord(page)) return false;
      const references = page.references;
      const pageInfo = page.pageInfo;
      const readState = page.readState;
      return (
        isConversationSnapshot(page) &&
        page.messages.length <= 100 &&
        isDynamicRecord(references) &&
        Object.values(references).every(isConversationMessage) &&
        isDynamicRecord(pageInfo) &&
        isBoolean(pageInfo.hasOlder) &&
        (pageInfo.olderCursor === null || isString(pageInfo.olderCursor)) &&
        (readState === undefined || isConversationReadState(readState))
      );
    }
    case "conversation-delta":
      return (
        isString(value.agentId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        isString(value.messageId) &&
        isString(value.delta) &&
        isString(value.createdAt) &&
        isNumber(value.revision)
      );
    case "queue-invalidated":
      return isIdentifier(value.agentId);
    case "queue-changed":
      return isQueueSnapshot(value.snapshot);
    case "waits-changed":
      return isAgentWaitsSnapshot(value.snapshot);
    case "agent-tasks-changed":
      return isAgentTasksSnapshot(value.snapshot);
    case "agent-task-conversation":
      return isIdentifier(value.taskId) && isConversationSnapshot(value.snapshot);
    case "agent-task-conversation-delta":
      return (
        isIdentifier(value.taskId) &&
        isString(value.agentId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        isString(value.messageId) &&
        isString(value.delta) &&
        isString(value.createdAt) &&
        isNumber(value.revision)
      );
    case "turn-progress":
      return (
        isIdentifier(value.agentId) &&
        isIdentifier(value.threadId) &&
        isIdentifier(value.turnId) &&
        isString(value.detail) &&
        value.detail.length > 0 &&
        value.detail.length <= INPUT_LIMITS.promptQuestion &&
        (value.running === undefined || typeof value.running === "boolean") &&
        (value.activity === undefined || isBoundedString(value.activity, INPUT_LIMITS.identifier)) &&
        (value.error === undefined || isBoundedString(value.error, CONVERSATION_TRACE_TEXT_LIMIT))
      );
    case "thread-turn-completed":
      return (
        isIdentifier(value.taskId) &&
        typeof value.routine === "boolean" &&
        isDynamicRecord(value.turn) &&
        value.turn.type === "turn-completed" &&
        isAgentEvent(value.turn)
      );
    case "turn-started":
    case "turn-completed":
      return (
        isString(value.agentId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        (value.origin === undefined || isAgentTurnOrigin(value.origin)) &&
        (value.quiet === undefined || value.quiet === true) &&
        (value.continues === undefined || value.continues === true) &&
        (value.answersAgent === undefined || typeof value.answersAgent === "boolean")
      );
    case "prompt":
      return (
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.agentId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        Array.isArray(value.questions) &&
        value.questions.length <= INPUT_LIMITS.promptQuestions &&
        value.questions.every(isAgentPromptQuestion) &&
        (value.detached === undefined || value.detached === true)
      );
    case "agent-input-resolved":
      return (
        (value.kind === "prompt" || value.kind === "approval") &&
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.agentId)
      );
    case "browser-takeover-requested":
      return isBrowserTakeoverRequest(value.request);
    case "browser-takeover-resolved":
      return (isString(value.requestId) || isNumber(value.requestId)) && isString(value.agentId);
    case "approval":
      return isAgentApproval(value.approval);
    case "runtime-snapshot":
      return isAgentRuntimeSnapshot(value.snapshot);
    case "browser-changed":
      return Array.isArray(value.tabs) && (value.activeTabId === null || isString(value.activeTabId));
    case "browser-control-changed":
      return isDynamicRecord(value.state);
    case "browser-user-control-changed":
      return Array.isArray(value.tabIds) && value.tabIds.every(isString);
    case "browser-page-state-changed":
      return (
        Array.isArray(value.tabs) &&
        value.tabs.every(
          (tab) =>
            isDynamicRecord(tab) && isString(tab.tabId) && isBoolean(tab.canGoBack) && isBoolean(tab.canGoForward),
        )
      );
    case "error":
      return (
        isString(value.code) &&
        isString(value.message) &&
        (value.provider === undefined || isAgentProvider(value.provider)) &&
        (value.model === undefined || isString(value.model)) &&
        (value.link === undefined || isString(value.link))
      );
    case "subagent-failed":
      return (
        isIdentifier(value.agentId) &&
        isIdentifier(value.threadId) &&
        isIdentifier(value.turnId) &&
        isIdentifier(value.subagentId) &&
        isBoundedString(value.title, CONVERSATION_SUBAGENT_TITLE_LIMIT)
      );
    case "usage-limit-reached":
      return (
        isIdentifier(value.agentId) &&
        isAgentProvider(value.provider) &&
        (value.resetsAt === null || (isNumber(value.resetsAt) && Number.isFinite(value.resetsAt))) &&
        isNumber(value.agentCount) &&
        Number.isSafeInteger(value.agentCount) &&
        value.agentCount >= 0
      );
    default:
      return false;
  }
}

export interface ScopedAgentEvent {
  serverId: string;
  event: AgentEvent;
  bufferedLive?: boolean;
}

export interface AgentIpcRequest<T = unknown> {
  serverId: string;
  payload: T;
}
