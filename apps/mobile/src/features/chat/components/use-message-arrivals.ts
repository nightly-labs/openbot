import { useRef } from "react";
import type { ChatMessage } from "@/features/chat/model/chat-messages";

// Only messages appended to an already visible conversation get an entrance.
// Opening history, reconnecting, and returning from the background establish a new baseline.
export function useMessageArrivals(agentId: string, messages: ChatMessage[], enabled: boolean) {
  // The result of the last render, kept in a ref: a state update here would make React render the
  // whole message list a second time for each streamed chunk.
  const kept = useRef<ArrivalSnapshot | null>(null);
  kept.current ??= { agentId, messages, enabled, arriving: new Set<string>() };
  const snapshot = kept.current;
  if (snapshot.agentId !== agentId || snapshot.enabled !== enabled || snapshot.messages !== messages) {
    const arriving = new Set<string>();
    if (enabled && snapshot.enabled && snapshot.agentId === agentId) {
      const previous = snapshot.messages;
      // A streamed chunk keeps each message at its index, so the message before is at the same
      // index. The map of all messages is made only when a message is not there.
      let byId: Map<string, ChatMessage> | undefined;
      const previousTail = previous.at(-1)?.id;
      const tailIndex = !previousTail
        ? -1
        : messages[previous.length - 1]?.id === previousTail
          ? previous.length - 1
          : messages.findIndex((message) => message.id === previousTail);
      for (const [index, message] of messages.entries()) {
        let old = previous[index];
        if (old?.id !== message.id) {
          if (!byId) byId = new Map(previous.map((item) => [item.id, item]));
          old = byId.get(message.id);
        }
        if (
          snapshot.arriving.has(message.id) ||
          (old?.kind === "message" && old.streaming && message.kind === "message" && message.status === "completed") ||
          ((previous.length === 0 || (tailIndex >= 0 && index > tailIndex)) && !old)
        )
          arriving.add(message.id);
      }
    }
    // Keep the same set while a reply streams, so rows that read it do not re-render per chunk.
    const next =
      arriving.size === snapshot.arriving.size && [...arriving].every((id) => snapshot.arriving.has(id))
        ? snapshot.arriving
        : arriving;
    kept.current = { agentId, messages, enabled, arriving: next };
    return next;
  }
  return snapshot.arriving;
}

interface ArrivalSnapshot {
  agentId: string;
  messages: ChatMessage[];
  enabled: boolean;
  arriving: Set<string>;
}
