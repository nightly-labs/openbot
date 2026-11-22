import { type AgentProviderId, agentProviderDescriptor } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { integerInRange, isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import {
  type ConversationReadState,
  type ConversationSnapshot,
  isConversationReadState,
  isConversationSnapshot,
} from "./ipc-conversations";
import { isQueueDelivery, type QueueDelivery } from "./ipc-queue";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const AGENT_TASK_LIMIT_MAX = 4;
export const HOST_AGENT_TASK_LIMIT_MAX = 64;
export const AGENT_TASK_LIMIT_DEFAULT = 4;

export function isAgentTaskLimit(value: unknown): value is number {
  return integerInRange(value, 1, AGENT_TASK_LIMIT_MAX);
}

export function isHostAgentTaskLimit(value: unknown): value is number {
  return integerInRange(value, 1, HOST_AGENT_TASK_LIMIT_MAX);
}

export function agentTaskLimit(
  agent: { provider: AgentProviderId; taskLimit?: number },
  hostDefault: number = AGENT_TASK_LIMIT_DEFAULT,
): number {
  if (!agentProviderDescriptor(agent.provider).concurrentTurns) return 1;
  return agent.taskLimit ?? hostDefault;
}

export const AGENT_TASK_STATES = ["running", "queued", "idle", "closed"] as const;
export type AgentTaskState = (typeof AGENT_TASK_STATES)[number];

export const AGENT_TASK_HOLDS = [
  "task-limit",
  "agent-restarting",
  "usage-limit",
  "server-busy",
  "agent-busy",
  "one-turn",
  "sign-in",
] as const;
export type AgentTaskHold = (typeof AGENT_TASK_HOLDS)[number];

export const AGENT_TASK_OUTCOMES = ["completed", "failed", "interrupted"] as const;
export type AgentTaskOutcome = (typeof AGENT_TASK_OUTCOMES)[number];

export const AGENT_TASK_QUEUED_PREVIEW = 500;

export const AGENT_TASK_AWAITED_STATES = ["queued", "starting", "running"] as const;

export interface AgentTaskAwaitedReply {
  messageId: string;
  recipientAgentId: string;
  status: (typeof AGENT_TASK_AWAITED_STATES)[number];
}

export function isAgentTaskAwaitedReply(value: unknown): value is AgentTaskAwaitedReply {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.messageId) &&
    isIdentifier(value.recipientAgentId) &&
    isOneOf(AGENT_TASK_AWAITED_STATES, value.status)
  );
}

export interface AgentTaskQueuedMessage {
  deliveryId: string;
  text: string;
  createdAt: string;
}

export interface AgentTask {
  id: string;
  agentId: string;
  threadId: string;
  origin: "user" | "agent";
  title: string;
  state: AgentTaskState;
  outcome: AgentTaskOutcome | null;
  hold: AgentTaskHold | null;
  activeTurnId: string | null;
  progress: string | null;
  error: string | null;
  queuedMessages: AgentTaskQueuedMessage[];
  queue?: QueueDelivery[];
  awaitedReplies?: AgentTaskAwaitedReply[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  branch?: AgentTaskBranch | null;
  routineId?: string | null;
}

export interface AgentTaskBranch {
  sourceTaskId: string | null;
  sourceTitle: string | null;
  sourceMessageId: string;
  throughMessageId: string;
}

export interface AgentTasksSnapshot {
  agentId: string;
  tasks: AgentTask[];
  limit: number;
}

export interface StartAgentTaskInput {
  agentId: string;
  text: string;
  attachmentDraftIds?: string[];
  clientMessageId?: string;
}

export interface RunQueuedMessageAsTaskInput {
  agentId: string;
  deliveryId: string;
}

export interface AgentTaskInput {
  agentId: string;
  taskId: string;
}

export interface ReadAgentTaskPageInput extends AgentTaskInput {
  beforeMessageId: string;
  limit: number;
}

export interface AgentTaskPage {
  conversation: ConversationSnapshot;
  hasOlder: boolean;
}

export function isAgentTaskPage(value: unknown): value is AgentTaskPage {
  return isDynamicRecord(value) && isConversationSnapshot(value.conversation) && typeof value.hasOlder === "boolean";
}

export interface ReadAgentTaskAroundInput extends AgentTaskInput {
  messageId: string;
  limit: number;
}

export interface AgentTaskWindow extends AgentTaskPage {
  hasNewer: boolean;
}

export function isAgentTaskWindow(value: unknown): value is AgentTaskWindow {
  return isAgentTaskPage(value) && isDynamicRecord(value) && typeof value.hasNewer === "boolean";
}

export interface BranchAgentTaskInput {
  agentId: string;
  taskId: string | null;
  messageId: string;
  requestId: string;
}

export interface RenameAgentTaskInput extends AgentTaskInput {
  title: string;
}

export interface MarkAgentTaskReadInput extends AgentTaskInput {
  throughMessageId: string;
}

export interface AgentTaskReadState extends ConversationReadState {
  taskId: string;
}

export function isAgentTaskReadState(value: unknown): value is AgentTaskReadState {
  return isDynamicRecord(value) && isIdentifier(value.taskId) && isConversationReadState(value);
}

export function agentThreadTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title && title.length <= INPUT_LIMITS.agentTaskTitle && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(title) ? title : null;
}

export function fitAgentTaskTitle(title: string): string {
  const limit = INPUT_LIMITS.agentTaskTitle;
  return title.length > limit ? `${title.slice(0, limit - 1)}…` : title;
}

function isAgentTaskQueuedMessage(value: unknown): value is AgentTaskQueuedMessage {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.deliveryId) &&
    isBoundedString(value.text, AGENT_TASK_QUEUED_PREVIEW) &&
    isBoundedString(value.createdAt, 160)
  );
}

export function isAgentTask(value: unknown): value is AgentTask {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.threadId) &&
    (value.origin === "user" || value.origin === "agent") &&
    isBoundedString(value.title, INPUT_LIMITS.agentTaskTitle) &&
    isOneOf(AGENT_TASK_STATES, value.state) &&
    (value.outcome === null || isOneOf(AGENT_TASK_OUTCOMES, value.outcome)) &&
    (value.hold === null || isOneOf(AGENT_TASK_HOLDS, value.hold)) &&
    (value.activeTurnId === null || isIdentifier(value.activeTurnId)) &&
    (value.progress === null || isBoundedString(value.progress, INPUT_LIMITS.agentTaskProgress)) &&
    (value.error === null || isBoundedString(value.error, INPUT_LIMITS.agentTaskError)) &&
    Array.isArray(value.queuedMessages) &&
    value.queuedMessages.every(isAgentTaskQueuedMessage) &&
    (value.queue === undefined || (Array.isArray(value.queue) && value.queue.every(isQueueDelivery))) &&
    (value.awaitedReplies === undefined ||
      (Array.isArray(value.awaitedReplies) && value.awaitedReplies.every(isAgentTaskAwaitedReply))) &&
    isBoundedString(value.createdAt, 160) &&
    isBoundedString(value.updatedAt, 160) &&
    (value.closedAt === null || isBoundedString(value.closedAt, 160)) &&
    (value.branch === undefined || value.branch === null || isAgentTaskBranch(value.branch)) &&
    (value.routineId === undefined || value.routineId === null || isIdentifier(value.routineId))
  );
}

export function isAgentTaskBranch(value: unknown): value is AgentTaskBranch {
  return (
    isDynamicRecord(value) &&
    (value.sourceTaskId === null || isIdentifier(value.sourceTaskId)) &&
    isNullableBoundedString(value.sourceTitle, INPUT_LIMITS.agentTaskTitle) &&
    isIdentifier(value.sourceMessageId) &&
    isIdentifier(value.throughMessageId)
  );
}

export function isAgentTasksSnapshot(value: unknown): value is AgentTasksSnapshot {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    Array.isArray(value.tasks) &&
    value.tasks.length <= INPUT_LIMITS.agentTasks &&
    value.tasks.every(isAgentTask) &&
    isHostAgentTaskLimit(value.limit)
  );
}
