import type { AgentMessage, ChatActionMarkerModel } from "@openbot/ui/data";

type HostedSiteMarker = Extract<ChatActionMarkerModel, { kind: "hosted-site" }>;

/**
 * Keeps one row for each hosted site change: the row of its latest status. The host stores each
 * status as a message of its own, so a finished deploy also has its "running" message. A final
 * status replaces "running" even when it sorts first. The stored messages stay unchanged.
 */
export function summarizeHostedSiteMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  const latestByOperation = new Map<string, { id: string; marker: HostedSiteMarker }>();
  for (const message of messages) {
    const marker = hostedSiteMarker(message);
    if (!marker) continue;
    const latest = latestByOperation.get(marker.operationId);
    if (latest && latest.marker.status !== "running" && marker.status === "running") continue;
    latestByOperation.set(marker.operationId, { id: message.id, marker });
  }
  return messages.filter((message) => {
    const marker = hostedSiteMarker(message);
    return !marker || latestByOperation.get(marker.operationId)?.id === message.id;
  });
}

function hostedSiteMarker(message: AgentMessage): HostedSiteMarker | null {
  return message.actionMarker?.kind === "hosted-site" ? message.actionMarker : null;
}
