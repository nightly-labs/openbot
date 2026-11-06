import {
  type AgentExchangeSummary,
  type AgentTask,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationSubagent,
  type QueueDeliveryStatus,
} from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import type { AgentWorkNode, AgentWorkState } from "@openbot/ui/features/tasks/AgentWork";

/** The fields of a chat message or a thread message that the tree reads. */
export interface AgentWorkMessage {
  id: string;
  turnId?: string | undefined;
  createdAt?: string | undefined;
  itemType?: string | undefined;
  subagents?: ConversationSubagent[] | undefined;
  exchange?: AgentExchangeSummary | undefined;
  text: string;
}

export interface AgentWorkSource {
  agentId: string;
  /** The loaded messages of the agent's main chat. */
  chat: readonly AgentWorkMessage[];
  chatRunning: boolean;
  chatFailed: boolean;
  /** The open threads of the agent, with their loaded messages. */
  tasks: ReadonlyArray<{ task: AgentTask; messages: readonly AgentWorkMessage[] }>;
  /** The loaded main chat of a teammate, where the work that it does for the agent shows. */
  messagesOf: (agentId: string) => readonly AgentWorkMessage[];
}

const TITLE_LENGTH = 120;

/** The main chat and the open threads of an agent, with the sessions that each one started. */
export function buildAgentWork(source: AgentWorkSource): AgentWorkNode[] {
  const seen = new Set<string>();
  const chatChildren = sessions(source, source.agentId, source.chat, seen);
  const chat: AgentWorkNode = {
    id: "chat",
    kind: "chat",
    title: "",
    agentId: source.agentId,
    state: ownerState(source.chatRunning, source.chatFailed, chatChildren),
    children: chatChildren,
  };
  const tasks = source.tasks
    .filter(({ task }) => task.state !== "closed")
    .map(({ task, messages }): AgentWorkNode => {
      const children = sessions(source, task.agentId, messages, seen);
      const state = taskState(task, children);
      return {
        id: task.id,
        kind: "task",
        title: task.title,
        agentId: task.agentId,
        state,
        note: state === "failed" ? (task.error ?? undefined) : (task.progress ?? undefined),
        startedByAgent: task.origin === "agent",
        children,
      };
    });
  return [chat, ...tasks];
}

function ownerState(running: boolean, failed: boolean, children: readonly AgentWorkNode[]): AgentWorkState {
  if (running) return "running";
  if (children.some((child) => child.kind === "teammate" && (child.state === "running" || child.state === "queued"))) {
    return "waiting";
  }
  return failed ? "failed" : "completed";
}

function taskState(task: AgentTask, children: readonly AgentWorkNode[]): AgentWorkState {
  if (task.state === "running") return "running";
  if (task.state === "queued") return "queued";
  const owner = ownerState(false, task.outcome === "failed", children);
  if (owner !== "completed") return owner;
  return task.outcome === "interrupted" ? "stopped" : "completed";
}

/** The subagents and the teammate requests in these messages, in the order they started. */
function sessions(
  source: AgentWorkSource,
  ownerId: string,
  messages: readonly AgentWorkMessage[],
  seen: Set<string>,
): AgentWorkNode[] {
  const nodes: AgentWorkNode[] = [];
  for (const message of messages) {
    if (message.itemType === CONVERSATION_SUBAGENTS_ITEM_TYPE) {
      for (const subagent of message.subagents ?? []) nodes.push(subagentNode(ownerId, subagent));
      continue;
    }
    const exchange = message.exchange;
    if (exchange?.direction !== "outgoing") continue;
    for (const delivery of exchange.deliveries) {
      // A loop of requests between two agents shows each request once.
      if (seen.has(delivery.id)) continue;
      seen.add(delivery.id);
      const state = deliveryState(delivery.status);
      nodes.push({
        id: `${exchange.messageId}:${delivery.recipientAgentId}`,
        kind: "teammate",
        title: markdownPreviewText(message.text).slice(0, TITLE_LENGTH),
        agentId: delivery.recipientAgentId,
        state,
        note: state === "failed" ? (delivery.error ?? undefined) : undefined,
        // The request has no end time. The row shows the time only while the teammate works.
        startedAt: state === "running" ? message.createdAt : undefined,
        children: teammateSessions(source, delivery.recipientAgentId, delivery.id, seen),
      });
    }
  }
  return nodes;
}

/** The sessions that the teammate started in the turn that answered the request. */
function teammateSessions(
  source: AgentWorkSource,
  teammateId: string,
  deliveryId: string,
  seen: Set<string>,
): AgentWorkNode[] {
  const messages = source.messagesOf(teammateId);
  const turnId = messages.find((message) => message.id === deliveryId)?.turnId;
  if (!turnId) return [];
  return sessions(
    source,
    teammateId,
    messages.filter((message) => message.turnId === turnId && message.id !== deliveryId),
    seen,
  );
}

function deliveryState(status: QueueDeliveryStatus): Exclude<AgentWorkState, "waiting"> {
  switch (status) {
    case "queued":
      return "queued";
    case "starting":
    case "running":
      return "running";
    case "failed":
      return "failed";
    case "interrupted":
    case "cancelled":
      return "stopped";
    default:
      return "completed";
  }
}

function subagentNode(ownerId: string, subagent: ConversationSubagent): AgentWorkNode {
  return {
    id: subagent.id,
    kind: "subagent",
    title: subagent.title,
    agentId: ownerId,
    state: subagent.status,
    note: subagent.error ?? undefined,
    startedAt: subagent.startedAt,
    endedAt: subagent.endedAt,
    subagent,
    children: [],
  };
}
