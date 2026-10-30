import type { AgentMessage } from "@openbot/ui/data";

/**
 * Keeps one row for each hosted site change: the row of its latest status. The host stores each
 * status as a message of its own, so a finished deploy also has its "running" message. The stored
 * messages stay unchanged.
 */
export function summarizeHostedSiteMessages(messages: readonly AgentMessage[]): AgentMessage[] {
  const latestByOperation = new Map<string, string>();
  for (const message of messages) {
    const operationId = hostedSiteOperationId(message);
    if (operationId) latestByOperation.set(operationId, message.id);
  }
  return messages.filter((message) => {
    const operationId = hostedSiteOperationId(message);
    return !operationId || latestByOperation.get(operationId) === message.id;
  });
}

function hostedSiteOperationId(message: AgentMessage): string | null {
  return message.actionMarker?.kind === "hosted-site" ? message.actionMarker.operationId : null;
}
