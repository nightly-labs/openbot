import type { AgentEvent } from "@openbot/contracts/ipc";
import type { QueryClient } from "@tanstack/react-query";

type QueueEvent = Extract<AgentEvent, { type: "queue-changed" | "queue-invalidated" }>;

export async function applyMobileQueueEvent(client: QueryClient, serverId: string, event: QueueEvent): Promise<void> {
  const agentId = event.type === "queue-changed" ? event.snapshot.agentId : event.agentId;
  const queryKey = ["chat-queue", serverId, agentId];
  // Cancel even the first pending read. Invalidation alone can reuse a read that
  // started before the mutation and install an old queue after the event.
  await client.cancelQueries({ queryKey });
  if (event.type === "queue-changed") client.setQueryData(queryKey, event.snapshot);
  else await client.invalidateQueries({ queryKey });
}
