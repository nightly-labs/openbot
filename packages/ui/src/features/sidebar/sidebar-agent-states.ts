import type { ChannelSummary, QueueSnapshot } from "@openbot/contracts/ipc";
import type { SidebarAgentState, SidebarChannelWait, SidebarRoutinePhase } from "./sidebar-types";

export type SidebarAttention =
  | { type: "prompt"; turnId: string; questions?: readonly { question: string }[] }
  | { type: "browser-takeover-requested"; request: { turnId: string } };

export interface SidebarApproval {
  turnId: string;
  command?: string | null;
  reason?: string | null;
}

export interface SidebarAgentStatesInput {
  agentIds: readonly string[];
  activeTurns: Record<string, string | null>;
  queues: Record<string, QueueSnapshot>;
  unreadReplies: Record<string, number>;
  unreadThreadReplies?: Record<string, number>;
  recentReplies: Record<string, boolean>;
  pendingPrompts: Record<string, SidebarAttention | undefined>;
  pendingApprovals: Record<string, SidebarApproval | undefined>;
  failedTurns: Record<string, string | undefined>;
  usageLimits?: Record<string, number | null>;
}

export function isAgentWorking(
  agentId: string,
  activeTurns: Record<string, string | null>,
  queues: Record<string, QueueSnapshot>,
): boolean {
  const queue = queues[agentId];
  return (
    Boolean(activeTurns[agentId]) ||
    queue?.hold?.agentId === agentId ||
    Boolean(queue?.deliveries.some((delivery) => delivery.status === "starting" || delivery.status === "running"))
  );
}

export function computeSidebarAgentStates(input: SidebarAgentStatesInput): Record<string, SidebarAgentState> {
  const states: Record<string, SidebarAgentState> = {};
  for (const agentId of input.agentIds) {
    const marked = sidebarAgentWait(agentId, input) ?? routineBadge(agentId, input);
    if (marked) states[agentId] = marked;
    else if (isAgentWorking(agentId, input.activeTurns, input.queues)) states[agentId] = { kind: "working" };
    else if ((input.unreadReplies[agentId] ?? 0) > 0) {
      states[agentId] = { kind: "unread", count: input.unreadReplies[agentId] ?? 1 };
    } else if ((input.unreadThreadReplies?.[agentId] ?? 0) > 0) states[agentId] = { kind: "unread", count: 0 };
    else if (input.recentReplies[agentId]) states[agentId] = { kind: "responded" };
  }
  return states;
}

export type SidebarAgentWait = Extract<SidebarAgentState, { kind: "waiting" | "limited" }>;

export function sidebarAgentWait(
  agentId: string,
  input: Pick<SidebarAgentStatesInput, "pendingPrompts" | "pendingApprovals" | "usageLimits">,
): SidebarAgentWait | undefined {
  return (
    waitingState(input.pendingPrompts[agentId], input.pendingApprovals[agentId]) ??
    limitedState(input.usageLimits, agentId)
  );
}

export function sidebarAgentWaits(
  input: Pick<SidebarAgentStatesInput, "agentIds" | "pendingPrompts" | "pendingApprovals" | "usageLimits">,
): Record<string, SidebarAgentWait> {
  const waits: Record<string, SidebarAgentWait> = {};
  for (const agentId of input.agentIds) {
    const wait = sidebarAgentWait(agentId, input);
    if (wait) waits[agentId] = wait;
  }
  return waits;
}

function routineBadge(agentId: string, input: SidebarAgentStatesInput): SidebarAgentState | undefined {
  const deliveries = (input.queues[agentId]?.deliveries ?? []).filter((delivery) => delivery.sender.kind === "routine");
  if (deliveries.length === 0) return undefined;

  const running = deliveries.filter((delivery) => delivery.status === "starting" || delivery.status === "running");
  if (running.length > 0) return routineState("running", running.length);

  const failedTurnId = input.failedTurns[agentId];
  const failed = deliveries.filter((delivery) => delivery.status === "failed" && delivery.turnId === failedTurnId);
  if (failedTurnId && failed.length > 0) return routineState("failed", failed.length);

  const queued = deliveries.filter((delivery) => delivery.status === "queued");
  if (queued.length > 0) return routineState("queued", queued.length);
  return undefined;
}

function limitedState(
  usageLimits: SidebarAgentStatesInput["usageLimits"],
  agentId: string,
): SidebarAgentWait | undefined {
  const resetsAt = usageLimits?.[agentId];
  return resetsAt === undefined ? undefined : { kind: "limited", resetsAt };
}

function routineState(phase: SidebarRoutinePhase, count: number): SidebarAgentState {
  return { kind: "routine", phase, count };
}

function waitingState(
  prompt: SidebarAttention | undefined,
  approval: SidebarApproval | undefined,
): SidebarAgentWait | undefined {
  if (prompt?.type === "prompt") return questionWait(prompt.questions);
  if (prompt?.type === "browser-takeover-requested") return TAKEOVER_WAIT;
  if (approval) return approvalWait(approval);
  return undefined;
}

const TAKEOVER_WAIT: SidebarChannelWait = { kind: "waiting", reason: "takeover", detail: null };

function questionWait(questions: readonly { question: string }[] | undefined): SidebarChannelWait {
  return { kind: "waiting", reason: "question", detail: questions?.[0]?.question.trim() || null };
}

function approvalWait(approval: Pick<SidebarApproval, "command" | "reason">): SidebarChannelWait {
  return { kind: "waiting", reason: "approval", detail: approval.command?.trim() || approval.reason?.trim() || null };
}

interface SidebarThreadRequest {
  agentId: string;
  threadId?: string | undefined;
}

interface SidebarChannelWaitsInput {
  channels: readonly Pick<ChannelSummary, "id" | "archived" | "threads">[];
  prompts: readonly (SidebarThreadRequest & { questions?: readonly { question: string }[] })[];
  takeovers: readonly SidebarThreadRequest[];
  approvals: readonly (SidebarThreadRequest & Pick<SidebarApproval, "command" | "reason">)[];
}

export function sidebarChannelWaits(input: SidebarChannelWaitsInput): Record<string, SidebarChannelWait> {
  const channelByThread = new Map<string, string>();
  for (const channel of input.channels) {
    if (channel.archived) continue;
    for (const thread of channel.threads ?? [])
      channelByThread.set(threadKey(thread.agentId, thread.threadId), channel.id);
  }
  const waits: Record<string, SidebarChannelWait> = {};
  const mark = (request: SidebarThreadRequest, wait: () => SidebarChannelWait) => {
    if (request.threadId === undefined) return;
    const channelId = channelByThread.get(threadKey(request.agentId, request.threadId));
    if (channelId && !waits[channelId]) waits[channelId] = wait();
  };
  for (const prompt of input.prompts) mark(prompt, () => questionWait(prompt.questions));
  for (const takeover of input.takeovers) mark(takeover, () => TAKEOVER_WAIT);
  for (const approval of input.approvals) mark(approval, () => approvalWait(approval));
  return waits;
}

function threadKey(agentId: string, threadId: string): string {
  return `${agentId}\n${threadId}`;
}

export function sidebarUnreadBadge(unreadCount: number, wait?: SidebarAgentState): SidebarAgentState | undefined {
  return wait ?? (unreadCount > 0 ? { kind: "unread", count: Math.min(unreadCount, 99) } : undefined);
}
