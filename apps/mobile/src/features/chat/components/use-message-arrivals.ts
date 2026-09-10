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
  if (
    snapshot.agentId !== agentId ||
    snapshot.enabled !== enabled ||
    snapshot.messages.length !== messages.length ||
    snapshot.messages[0]?.id !== messages[0]?.id ||
    snapshot.messages.at(-1)?.id !== messages.at(-1)?.id
  ) {
    const known = new Set(snapshot.messages.map((message) => message.id));
    const arriving = new Set<string>();
    if (enabled && snapshot.enabled && snapshot.agentId === agentId) {
      const previousTail = snapshot.messages.at(-1)?.id;
      const tailIndex = previousTail ? messages.findIndex((message) => message.id === previousTail) : -1;
      for (const [index, message] of messages.entries()) {
        if (snapshot.arriving.has(message.id) || (tailIndex >= 0 && index > tailIndex && !known.has(message.id)))
          arriving.add(message.id);
      }
    }
    setSnapshot({ agentId, messages, enabled, arriving });
    return arriving;
  }
  return snapshot.arriving;
}
