import type {
  AgentExchangeSummary,
  AttachmentSummary,
  ConversationMessage,
  ConversationQuestionPrompt,
} from "@openbot/contracts/ipc";

export type ChatMessage =
  | { id: string; kind: "exchange"; exchange: AgentExchangeSummary }
  | { id: string; kind: "question"; turnId: string | undefined; prompt: ConversationQuestionPrompt }
  | {
      id: string;
      kind: "message";
      author: "agent" | "user";
      body: string;
      streaming: boolean;
      source?: ConversationMessage["source"];
      replyToMessageId?: string | null;
      delivery?: ConversationMessage["delivery"];
      awaitingQueueReceipt?: boolean;
      attachments?: AttachmentSummary[];
    }
  | { id: string; kind: "thinking"; turnId: string | undefined; steps: { id: string; text: string }[] };

export interface PendingChatMessage {
  message: Extract<ChatMessage, { kind: "message" }>;
  baseline: Set<string>;
  serverId: string | null;
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
  const result = visible.map((message) =>
    aliases.has(message.id) ? { ...message, id: aliases.get(message.id) ?? message.id } : message,
  );
  if (pending && !messages.some((message) => message.id === pending.serverId)) result.push(pending.message);
  return result;
}

export function projectChatMessages(messages: ConversationMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const thinkingByTurn = new Map<string, Extract<ChatMessage, { kind: "thinking" }>>();
  for (const message of messages) {
    if (message.delivery?.status === "cancelled") continue;
    const queued = message.delivery?.status === "queued" || message.delivery?.status === "starting";
    if (message.exchange && !queued) {
      result.push({ id: `exchange:${message.id}`, kind: "exchange", exchange: message.exchange });
      // Match desktop: exchanges have markers, not another agent's text bubble.
      // Incoming attachments remain visible below their marker.
      if (message.exchange.direction !== "incoming" || !message.attachments?.length) continue;
    }
    if (message.questionPrompt) {
      result.push({ id: message.id, kind: "question", turnId: message.turnId, prompt: message.questionPrompt });
      continue;
    }
    if ((!message.text.trim() && !message.attachments?.length) || message.author === "system") continue;
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
      result.push({
        id: message.id,
        kind: "message",
        author: message.author === "user" ? "user" : "agent",
        body: message.exchange && !queued ? "" : message.text,
        ...(message.source ? { source: message.source } : {}),
        streaming: message.status === "streaming",
        attachments: message.attachments,
        ...(message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {}),
        ...(message.delivery ? { delivery: message.delivery } : {}),
      });
    }
  }
  return result;
}

export function latestReadableMessage(messages: ConversationMessage[]) {
  return messages.findLast(
    (message) =>
      Boolean(message.questionPrompt) ||
      (message.author !== "system" && (message.text.trim().length > 0 || Boolean(message.attachments?.length))),
  );
}

export function partitionChatMessages(messages: ChatMessage[], immediateMessageId: string | null = null) {
  const history: ChatMessage[] = [];
  const queued: Extract<ChatMessage, { kind: "message" }>[] = [];
  for (const message of messages) {
    if (
      message.kind === "message" &&
      message.id !== immediateMessageId &&
      (message.awaitingQueueReceipt || message.delivery?.status === "queued" || message.delivery?.status === "starting")
    )
      queued.push(message);
    else history.push(message);
  }
  queued.sort(
    (left, right) =>
      (left.delivery?.position ?? Number.MAX_SAFE_INTEGER) - (right.delivery?.position ?? Number.MAX_SAFE_INTEGER),
  );
  return { history, queued };
}
