import { useState } from "react";
import type { ChatMessage } from "@/features/chat/model/chat-messages";

// Only messages appended to an already visible conversation get an entrance.
// Opening history, reconnecting, and returning from the background establish a new baseline.
export function useMessageArrivals(agentId: string, messages: ChatMessage[], enabled: boolean) {
  const [snapshot, setSnapshot] = useState(() => ({
    agentId,
    messages,
    enabled,
    arriving: new Set<string>(),
  }));
  if (snapshot.agentId !== agentId || snapshot.enabled !== enabled || snapshot.messages !== messages) {
    const known = new Map(snapshot.messages.map((message) => [message.id, message]));
    const arriving = new Set<string>();
    if (enabled && snapshot.enabled && snapshot.agentId === agentId) {
      const previousTail = snapshot.messages.at(-1)?.id;
      const tailIndex = previousTail ? messages.findIndex((message) => message.id === previousTail) : -1;
      for (const [index, message] of messages.entries()) {
        const old = known.get(message.id);
        if (
          snapshot.arriving.has(message.id) ||
          (old?.kind === "message" && old.streaming && message.kind === "message" && message.status === "completed") ||
          ((snapshot.messages.length === 0 || (tailIndex >= 0 && index > tailIndex)) && !known.has(message.id))
        )
          arriving.add(message.id);
      }
    }
    // Keep the same set while a reply streams, so rows that read it do not re-render per chunk.
    const next =
      arriving.size === snapshot.arriving.size && [...arriving].every((id) => snapshot.arriving.has(id))
        ? snapshot.arriving
        : arriving;
    setSnapshot({ agentId, messages, enabled, arriving: next });
    return next;
  }
  return snapshot.arriving;
}
