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
  if (snapshot.agentId !== agentId || snapshot.messages !== messages || snapshot.enabled !== enabled) {
    const known = new Set(snapshot.messages.map((message) => message.id));
    const arriving = new Set<string>();
    if (enabled && snapshot.enabled && snapshot.agentId === agentId) {
      for (const message of messages) {
        if (!known.has(message.id) || snapshot.arriving.has(message.id)) arriving.add(message.id);
      }
    }
    setSnapshot({ agentId, messages, enabled, arriving });
    return arriving;
  }
  return snapshot.arriving;
}
