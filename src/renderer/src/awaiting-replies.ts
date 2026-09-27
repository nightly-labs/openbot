import type { ChannelTask, QueueDelivery, QueueSnapshot } from "@openbot/contracts/ipc";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import type { AwaitingReplyItem, AwaitingReplyState } from "@openbot/ui/features/conversation/AwaitingReplies";
import { currentText } from "@openbot/ui/text";
import { isQueuedAgentReply } from "./queue-reconciliation";

/**
 * The rows of the waiting block: which agents this agent asked, and where each answer is.
 *
 * All of it is in data the conversation has already. An outgoing exchange names each delivery and
 * its state, and an answer is a queued delivery from the agent that was asked, linked to the
 * question by `replyToMessageId`. A channel owner that waits has its sub-tasks in the page.
 */

const PREVIEW_LIMIT = 160;

export interface AgentAwaitingInput {
  messages: readonly AgentMessage[];
  queue: QueueSnapshot | undefined;
  agents: readonly AgentProfile[];
  /** The agent of this conversation. It reads each queued answer after its turn. */
  self: AgentProfile | undefined;
}

export function agentAwaitingReplies(input: AgentAwaitingInput): AwaitingReplyItem[] {
  const { t } = currentText();
  const replies = (input.queue?.deliveries ?? []).filter(isQueuedAgentReply);
  const readsNext = input.self ? t("chat.awaiting.readsNext", { name: input.self.name }) : undefined;
  const rowFor = (agentId: string, state: AwaitingReplyState, id: string, reply?: QueueDelivery): AwaitingReplyItem => {
    const agent = input.agents.find((candidate) => candidate.id === agentId);
    return {
      id,
      agent,
      name: agent?.name ?? t("chat.activity.agentFallback"),
      state,
      ...(reply ? { preview: previewText(replyResult(reply.text)), detail: readsNext } : {}),
    };
  };
  // A failed question stays until the person writes again: then they have seen it.
  const lastUserIndex = input.messages.findLastIndex((message) => message.author === "you");
  const rows: AwaitingReplyItem[] = [];
  const shownReplies = new Set<string>();
  input.messages.forEach((message, index) => {
    const exchange = message.exchange;
    if (exchange?.direction !== "outgoing" || exchange.expectsReply === false) return;
    for (const delivery of exchange.deliveries) {
      const reply = replies.find(
        (candidate) =>
          candidate.replyToMessageId === exchange.messageId &&
          candidate.sender.kind === "agent" &&
          candidate.sender.agentId === delivery.recipientAgentId,
      );
      const id = `${exchange.messageId}:${delivery.recipientAgentId}`;
      if (reply) {
        shownReplies.add(reply.id);
        rows.push(rowFor(delivery.recipientAgentId, "replied", id, reply));
        continue;
      }
      const state = deliveryState(delivery.status);
      if (!state || (state === "failed" && index < lastUserIndex)) continue;
      rows.push(rowFor(delivery.recipientAgentId, state, id));
    }
  });
  // An answer to a question on an earlier page, or to one sent from another conversation.
  for (const reply of replies) {
    if (shownReplies.has(reply.id) || reply.sender.kind !== "agent") continue;
    rows.push(rowFor(reply.sender.agentId, "replied", reply.id, reply));
  }
  return rows;
}

/** Null for a delivery that has landed: its answer is in the transcript, or it had none. */
function deliveryState(status: QueueDelivery["status"]): Exclude<AwaitingReplyState, "replied"> | null {
  if (status === "queued") return "asked";
  if (status === "starting" || status === "running") return "working";
  if (status === "failed" || status === "interrupted" || status === "cancelled") return "failed";
  return null;
}

export interface ChannelAwaitingInput {
  tasks: readonly ChannelTask[];
  agents: readonly AgentProfile[];
  /** The name of a task owner, with the channel's own fallback for a task that has none. */
  name: (agentId: string | null) => string;
}

/** The sub-tasks of each channel task that waits for them. */
export function channelAwaitingReplies(input: ChannelAwaitingInput): AwaitingReplyItem[] {
  const { t } = currentText();
  const waiting = new Map(input.tasks.filter((task) => task.state === "waiting").map((task) => [task.id, task]));
  return input.tasks.flatMap((task) => {
    const parent = task.parentTaskId ? waiting.get(task.parentTaskId) : undefined;
    if (!parent) return [];
    const state = channelTaskState(task.state);
    if (!state) return [];
    return [
      {
        id: task.id,
        agent: input.agents.find((candidate) => candidate.id === task.ownerAgentId),
        name: input.name(task.ownerAgentId),
        state,
        preview: previewText(task.instruction),
        ...(state === "replied" && parent.ownerAgentId
          ? { detail: t("chat.awaiting.readsNext", { name: input.name(parent.ownerAgentId) }) }
          : {}),
      },
    ];
  });
}

function channelTaskState(state: ChannelTask["state"]): AwaitingReplyState | null {
  // A paused sub-task shows in the stopped tasks with Resume. It did not fail.
  if (state === "paused") return null;
  if (state === "queued") return "asked";
  if (state === "running" || state === "waiting") return "working";
  if (state === "completed") return "replied";
  return "failed";
}

/**
 * The `Result:` part of a reply in the relay format (`Status:`, `Result:`, `Evidence:` lines, from
 * `delivery-content.ts`). A reply in another form is shown whole.
 */
function replyResult(text: string): string {
  const result = /^\s*Result:[ \t]*(.*?)(?=^\s*Evidence:|(?![\s\S]))/imsu.exec(text)?.[1]?.trim();
  return result || text;
}

function previewText(text: string): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, PREVIEW_LIMIT);
}
