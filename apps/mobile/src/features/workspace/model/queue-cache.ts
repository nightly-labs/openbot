import type { AgentEvent } from "@openbot/contracts/ipc";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/features/workspace/model/query-keys";

type QueueEvent = Extract<AgentEvent, { type: "queue-changed" | "queue-invalidated" }>;

export async function applyMobileQueueEvent(client: QueryClient, serverId: string, event: QueueEvent): Promise<void> {
  const agentId = event.type === "queue-changed" ? event.snapshot.agentId : event.agentId;
  const queryKey = queryKeys.chatQueue(serverId, agentId);
  await client.cancelQueries({ queryKey });
  if (event.type === "queue-changed") client.setQueryData(queryKey, event.snapshot);
  else await client.invalidateQueries({ queryKey });
}
