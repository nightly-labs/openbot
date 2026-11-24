import {
  type AgentTask,
  type ChannelTask,
  isQueuedAgentReply,
  type QueueDelivery,
  type QueueSnapshot,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import {
  type AwaitingReplyItem,
  type AwaitingReplyState,
  awaitingReplyEnded,
} from "@openbot/ui/features/conversation/AwaitingReplies";
import type { SidebarAgentWait } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { currentText } from "@openbot/ui/text";

const PREVIEW_LIMIT = 160;

export interface AgentAwaitingInput {
  messages: readonly AgentMessage[];
  queue: QueueSnapshot | undefined;
  agents: readonly AgentProfile[];
  self: AgentProfile | undefined;
  waits?: Record<string, SidebarAgentWait> | undefined;
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
      ...(reply ? { preview: previewText(replyResult(reply.text)), detail: readsNext, deliveryId: reply.id } : {}),
    };
  };
  const lastUserIndex = input.messages.findLastIndex((message) => message.author === "you");
  const lastRequestIndex = lastRequestIndexByRecipient(input.messages);
  const rows: AwaitingReplyItem[] = [];
  const shownReplies = new Set<string>();
  input.messages.forEach((message, index) => {
    const exchange = message.exchange;
    if (exchange?.direction !== "outgoing" || exchange.expectsReply === false) return;
    const firstRow = rows.length;
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
      const superseded = index < lastUserIndex || index < (lastRequestIndex.get(delivery.recipientAgentId) ?? index);
      if (!state || (awaitingReplyEnded(state) && superseded)) continue;
      const wait = awaitingReplyEnded(state) ? undefined : input.waits?.[delivery.recipientAgentId];
      const row = rowFor(delivery.recipientAgentId, state, id);
      const stoppable = state === "asked" && row.agent !== undefined;
      rows.push({
        ...row,
        ...(wait ? { wait } : {}),
        ...(stoppable ? { deliveryId: delivery.id } : { stoppable: false }),
      });
    }
    const exchangeRows = rows.slice(firstRow);
    if (exchangeRows.some((row) => row.state === "asked" || row.state === "working")) {
      for (const row of exchangeRows) delete row.detail;
    }
  });
  for (const reply of replies) {
    if (shownReplies.has(reply.id) || reply.sender.kind !== "agent") continue;
    rows.push(rowFor(reply.sender.agentId, "replied", reply.id, reply));
  }
  return rows;
}

export function threadAwaitingReplies(
  task: AgentTask | null | undefined,
  agents: readonly AgentProfile[],
  waits: Record<string, SidebarAgentWait> | undefined,
): AwaitingReplyItem[] {
  const { t } = currentText();
  return (task?.awaitedReplies ?? []).map(({ messageId, recipientAgentId, status }) => {
    const agent = agents.find((candidate) => candidate.id === recipientAgentId);
    const wait = waits?.[recipientAgentId];
    return {
      id: `${messageId}:${recipientAgentId}`,
      agent,
      name: agent?.name ?? t("chat.activity.agentFallback"),
      state: deliveryState(status) ?? "working",
      ...(wait ? { wait } : {}),
    };
  });
}

function lastRequestIndexByRecipient(messages: readonly AgentMessage[]): Map<string, number> {
  const last = new Map<string, number>();
  messages.forEach((message, index) => {
    const exchange = message.exchange;
    if (exchange?.direction !== "outgoing" || exchange.expectsReply === false) return;
    for (const delivery of exchange.deliveries) last.set(delivery.recipientAgentId, index);
  });
  return last;
}

function deliveryState(status: QueueDelivery["status"]): Exclude<AwaitingReplyState, "replied"> | null {
  if (status === "queued") return "asked";
  if (status === "starting" || status === "running") return "working";
  if (status === "cancelled") return "stopped";
  if (status === "failed" || status === "interrupted") return "failed";
  return null;
}

export interface ChannelAwaitingInput {
  tasks: readonly ChannelTask[];
  agents: readonly AgentProfile[];
  name: (agentId: string | null) => string;
}

export function channelAwaitingReplies(input: ChannelAwaitingInput): AwaitingReplyItem[] {
  const { t } = currentText();
  const waiting = new Map(input.tasks.filter((task) => task.state === "waiting").map((task) => [task.id, task]));
  return input.tasks.flatMap((task) => {
    const parent = task.parentTaskId ? waiting.get(task.parentTaskId) : undefined;
    if (!parent) return [];
    const state = channelTaskState(task.state);
    const finished = state === "replied" || state === "failed";
    if (!state || (finished && parent.seenDependencies?.includes(task.id))) return [];
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

function channelTaskState(state: ChannelTask["state"]): Exclude<AwaitingReplyState, "stopped"> | null {
  if (state === "paused") return null;
  if (state === "queued") return "asked";
  if (state === "running" || state === "waiting") return "working";
  if (state === "completed") return "replied";
  return "failed";
}

function replyResult(text: string): string {
  const result = /^\s*Result:[ \t]*(.*?)(?=^\s*Evidence:|(?![\s\S]))/imsu.exec(text)?.[1]?.trim();
  return result || text;
}

function previewText(text: string): string {
  return markdownPreviewText(text).slice(0, PREVIEW_LIMIT);
}
