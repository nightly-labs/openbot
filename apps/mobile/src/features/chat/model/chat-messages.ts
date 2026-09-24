import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type {
  AgentExchangeSummary,
  AttachmentSummary,
  ChannelMessage,
  ChannelRoutingConversationEvent,
  ConversationMessage,
  ConversationQuestionPrompt,
  ImageGenerationInfo,
} from "@openbot/contracts/ipc";
import { channelRoutingConversationEvent } from "@openbot/contracts/ipc";

export type ChatMessage =
  | {
      id: string;
      kind: "channel-routing";
      event:
        | ChannelRoutingConversationEvent
        | {
            action: ChannelRoutingConversationEvent["action"];
            agentId: null;
            agentName: string;
          };
    }
  | { id: string; kind: "exchange"; exchange: AgentExchangeSummary }
  | { id: string; kind: "question"; turnId: string | undefined; prompt: ConversationQuestionPrompt }
  | {
      id: string;
      kind: "message";
      author: "agent" | "user";
      speaker?: ChannelMessage["author"];
      superseded?: boolean;
      body: string;
      streaming: boolean;
      status?: ConversationMessage["status"];
      replyToMessageId?: string | null;
      attachments?: AttachmentSummary[];
      /** An image the agent is generating or generated. Its first attachment is the image. */
      imageGeneration?: ImageGenerationInfo;
    }
  | { id: string; kind: "thinking"; turnId: string | undefined; steps: { id: string; text: string }[] };

export interface PendingChatMessage {
  message: Extract<ChatMessage, { kind: "message" }>;
  baseline: Set<string>;
  serverId: string | null;
}

export function indexChatMessages(
  messages: readonly ChatMessage[],
  aliases: ReadonlyMap<string, string>,
  references: readonly ChatMessage[] = [],
) {
  const index = new Map([...references, ...messages].map((message) => [message.id, message]));
  // Reply references use host IDs even when a delivered bubble keeps its local render key.
  for (const [hostId, localId] of aliases) {
    const message = index.get(localId);
    if (message) index.set(hostId, message);
  }
  return index;
}

export function presentChatMessages(
  messages: ChatMessage[],
  pending: PendingChatMessage | null,
  aliases: ReadonlyMap<string, string>,
): ChatMessage[] {
  // Events can precede the receipt. Wait for its ID rather than matching by text,
  // which could incorrectly merge another member's identical message.
  const visible =
    pending && !pending.serverId ? messages.filter((message) => pending.baseline.has(message.id)) : messages;
  const result = visible.map((message) => {
    // Keep the local image mounted until the caller caches the final attachment IDs.
    if (pending?.serverId === message.id) return pending.message;
    const alias = aliases.get(message.id);
    if (alias === undefined) return message;
    let aliased = aliasedMessages.get(message);
    if (aliased?.id !== alias) {
      aliased = { ...message, id: alias };
      aliasedMessages.set(message, aliased);
    }
    return aliased;
  });
  if (pending && !messages.some((message) => message.id === pending.serverId)) result.push(pending.message);
  return result;
}

const projectedBubbles = new WeakMap<ConversationMessage, ChatMessage>();
const projectedExchanges = new WeakMap<ConversationMessage, ChatMessage>();
const projectedQuestions = new WeakMap<ConversationMessage, ChatMessage>();
const aliasedMessages = new WeakMap<ChatMessage, ChatMessage>();

/** Reuse the item projected from the same host message, so memoized rows skip unchanged items. */
function projectedMarker(
  cache: WeakMap<ConversationMessage, ChatMessage>,
  message: ConversationMessage,
  project: () => ChatMessage,
) {
  let item = cache.get(message);
  if (!item) {
    item = project();
    cache.set(message, item);
  }
  return item;
}

/** The order of the last sorted transcript, and the fields that decided it. */
let lastOrder: { key: string; ids: string[] } | null = null;

/**
 * The sort reads only these fields. A streamed chunk changes only text and status, so the order of
 * the previous frame applies and the transcript is not sorted again.
 */
function sortedConversationMessages(messages: readonly ConversationMessage[]) {
  const key = messages
    .map(
      (message) =>
        `${message.id}\u0000${message.turnId ?? ""}\u0000${message.createdAt}\u0000${message.author}\u0000${message.itemType ?? ""}\u0000${message.exchange?.direction ?? ""}`,
    )
    .join("\u0001");
  if (lastOrder?.key === key) {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const ordered = lastOrder.ids.flatMap((id) => byId.get(id) ?? []);
    if (byId.size === messages.length && ordered.length === messages.length) return ordered;
  }
  const sorted = sortConversationMessages([...messages]);
  lastOrder = { key, ids: sorted.map((message) => message.id) };
  return sorted;
}

export function projectChatMessages(messages: ConversationMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const thinkingByTurn = new Map<string, Extract<ChatMessage, { kind: "thinking" }>>();
  for (const message of sortedConversationMessages(messages)) {
    if (message.delivery?.status === "queued" || message.delivery?.status === "cancelled") continue;
    if (message.exchange) {
      const { exchange } = message;
      result.push(
        projectedMarker(projectedExchanges, message, () => ({
          id: `exchange:${message.id}`,
          kind: "exchange",
          exchange,
        })),
      );
      // Match desktop: exchanges have markers, not another agent's text bubble.
      // Incoming attachments remain visible below their marker.
      if (message.exchange.direction !== "incoming" || !message.attachments?.length) continue;
    }
    if (message.questionPrompt) {
      const prompt = message.questionPrompt;
      result.push(
        projectedMarker(projectedQuestions, message, () => ({
          id: message.id,
          kind: "question",
          turnId: message.turnId,
          prompt,
        })),
      );
      continue;
    }
    // A generation has no text or attachment until its image arrives, and it still needs its placeholder.
    if (
      (!message.text.trim() && !message.attachments?.length && !message.imageGeneration) ||
      message.author === "system"
    )
      continue;
    if (message.author === "assistant" && message.itemType === "commentary") {
      const key = message.turnId ?? message.id;
      let thinking = thinkingByTurn.get(key);
      if (!thinking) {
        thinking = { id: `thinking:${key}`, kind: "thinking", turnId: message.turnId, steps: [] };
        thinkingByTurn.set(key, thinking);
        result.push(thinking);
      }
      thinking.steps.push({ id: message.id, text: message.text });
    } else {
      let bubble = projectedBubbles.get(message);
      if (!bubble) {
        bubble = {
          id: message.id,
          kind: "message",
          author: message.author === "user" ? "user" : "agent",
          body: message.exchange ? "" : message.text,
          streaming: message.status === "streaming",
          status: message.status,
          attachments: message.attachments,
          imageGeneration: message.imageGeneration,
          replyToMessageId: message.replyToMessageId,
        };
        projectedBubbles.set(message, bubble);
      }
      result.push(bubble);
    }
  }
  return result;
}

export function latestReadableMessage(messages: ConversationMessage[]) {
  return messages.findLast(
    (message) =>
      Boolean(message.questionPrompt) ||
      (message.author !== "system" &&
        (message.text.trim().length > 0 || Boolean(message.attachments?.length) || Boolean(message.imageGeneration))),
  );
}

const projectedChannelMessages = new WeakMap<ChannelMessage, { self: boolean; message: ChatMessage }>();

function projectChannelMessage(entry: ChannelMessage, self: boolean): ChatMessage {
  if (entry.message.questionPrompt) {
    return {
      id: entry.id,
      kind: "question",
      turnId: entry.message.turnId,
      prompt:
        entry.superseded && !entry.message.questionPrompt.resolution
          ? { ...entry.message.questionPrompt, resolution: { status: "expired" } }
          : entry.message.questionPrompt,
    };
  }
  const routing = channelRoutingConversationEvent(entry.message);
  if (routing) return { id: entry.id, kind: "channel-routing", event: routing };
  // Older hosts stored only the receipt text. Never reinterpret a typed event as legacy text.
  if (
    !entry.message.itemType &&
    entry.author.kind === "agent" &&
    entry.message.author === "system" &&
    entry.message.status === "completed" &&
    entry.taskId
  ) {
    const assigned = /^Assigned to (.+)\.$/.exec(entry.message.text);
    const continued = /^Continuing existing work with (.+)\.$/.exec(entry.message.text);
    const name = assigned?.[1] ?? continued?.[1];
    if (name)
      return {
        id: entry.id,
        kind: "channel-routing",
        event: { action: assigned ? "assigned" : "continued", agentId: null, agentName: name },
      };
  }
  if (entry.author.kind === "agent" && entry.message.itemType === "commentary" && !entry.superseded) {
    return {
      id: entry.id,
      kind: "thinking",
      turnId: entry.message.turnId,
      steps: [{ id: entry.id, text: entry.message.text }],
    };
  }
  return {
    id: entry.id,
    kind: "message",
    author: self ? "user" : "agent",
    speaker: entry.author,
    superseded: entry.superseded,
    body: entry.message.text,
    streaming: entry.message.status === "streaming",
    status: entry.message.status,
    replyToMessageId: entry.message.replyToMessageId,
    attachments: entry.message.attachments,
    imageGeneration: entry.message.imageGeneration,
  };
}

/** Keep channel authors explicit: another human member is not the current user. */
export function projectChannelMessages(messages: ChannelMessage[], memberId: string | null): ChatMessage[] {
  return messages
    .filter(
      (entry) =>
        entry.message.questionPrompt ||
        entry.message.imageGeneration ||
        entry.message.text.trim() ||
        entry.message.attachments?.length,
    )
    .map((entry) => {
      const self = entry.author.kind === "member" && entry.author.id === memberId;
      const cached = projectedChannelMessages.get(entry);
      if (cached && cached.self === self) return cached.message;
      const message = projectChannelMessage(entry, self);
      projectedChannelMessages.set(entry, { self, message });
      return message;
    });
}

/** The host accepted a send, but its transcript still needs a successful read. */
export interface ChatHistoryReceipt {
  refreshHistory: () => Promise<void>;
}
