import type { ChannelSummary, QueueSnapshot } from "@openbot/contracts/ipc";
import type { SidebarAgentState, SidebarChannelWait, SidebarRoutinePhase } from "./sidebar-types";

/** A question or a browser takeover that an agent is blocked on. */
export type SidebarAttention =
  | { type: "prompt"; turnId: string; questions?: readonly { question: string }[] }
  | { type: "browser-takeover-requested"; request: { turnId: string } };

/** An approval that an agent is blocked on. The command or the reason is the tooltip detail. */
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
  recentReplies: Record<string, boolean>;
  pendingPrompts: Record<string, SidebarAttention | undefined>;
  pendingApprovals: Record<string, SidebarApproval | undefined>;
  failedTurns: Record<string, string | undefined>;
  /**
   * The agents whose queue waits for a plan limit, with the reset in epoch seconds or `null`. Absent
   * where the host does not report it, as on a remote server.
   */
  usageLimits?: Record<string, number | null>;
}

/**
 * Whether an agent is running work right now.
 *
 * A channel turn belongs to another thread, so it reports no active turn and no running delivery
 * here. The queue's hold is the only signal that the agent doing that work is busy.
 *
 * Shared with the avatar's mood so a row's badge and its face can never disagree about who is
 * working - see `features/agents/agent-avatar-mood.ts`.
 */
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

/**
 * The badge each agent shows in the sidebar.
 *
 * Pure, and outside every context, because the inputs come from different domains and a context
 * that read all of them would have to sit under all of them. The precedence is the point: an agent
 * that waits for the user outranks everything, because nothing moves until the user acts. A routine
 * mark outranks a generic working mark, and either outranks unread replies, because that count is
 * about to change again.
 *
 * One routine mark per agent. Several routine deliveries share it; `count` is how many are in the
 * phase the mark shows. A paused schedule is not a delivery, so it does not mark the row.
 *
 * An agent with nothing to say gets no entry at all, so the result is sparse and a missing key
 * means "idle" rather than "unknown".
 */
export function computeSidebarAgentStates(input: SidebarAgentStatesInput): Record<string, SidebarAgentState> {
  const states: Record<string, SidebarAgentState> = {};
  for (const agentId of input.agentIds) {
    const marked = sidebarAgentWait(agentId, input) ?? routineBadge(agentId, input);
    if (marked) states[agentId] = marked;
    else if (isAgentWorking(agentId, input.activeTurns, input.queues)) states[agentId] = { kind: "working" };
    else if ((input.unreadReplies[agentId] ?? 0) > 0) {
      states[agentId] = { kind: "unread", count: input.unreadReplies[agentId] ?? 1 };
    } else if (input.recentReplies[agentId]) states[agentId] = { kind: "responded" };
  }
  return states;
}

/** A state that stops an agent until the user acts or its plan resets. */
export type SidebarAgentWait = Extract<SidebarAgentState, { kind: "waiting" | "limited" }>;

/** What stops the agent now, or undefined when nothing does. A wait for the user comes first. */
export function sidebarAgentWait(
  agentId: string,
  input: Pick<SidebarAgentStatesInput, "pendingPrompts" | "pendingApprovals" | "usageLimits">,
): SidebarAgentWait | undefined {
  return (
    waitingState(input.pendingPrompts[agentId], input.pendingApprovals[agentId]) ??
    limitedState(input.usageLimits, agentId)
  );
}

/** The wait of each agent that has one. The waiting block of a chat reads it for the agents it asked. */
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

/** A spent plan holds every message and routine run of the agent, so it names the wait over a routine mark. */
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

/** When a prompt and an approval are both pending, the prompt names the wait. */
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

/** A request of a member agent, with the thread that it came from. */
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

/**
 * The wait of each channel whose work waits for the user. A request belongs to a channel when it comes
 * from the thread of a member agent there. Selecting the channel opens the view that answers it, so
 * the channel goes to "Needs you" like an agent.
 *
 * A host without channel-attention-v1 does not name the threads, so its channels have no wait here.
 * The order is the one of an agent: a question, then a browser takeover, then an approval.
 */
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
