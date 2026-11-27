import { agentBubbleKey } from "./chat-bubble-preference";

const alive = new Set<string>();

export function markBubbleActivityAlive(serverId: string, agentId: string): void {
  alive.add(agentBubbleKey(serverId, agentId));
}

export function unmarkBubbleActivityAlive(serverId: string, agentId: string): void {
  alive.delete(agentBubbleKey(serverId, agentId));
}

export function isBubbleActivityAlive(serverId: string, agentId: string): boolean {
  return alive.has(agentBubbleKey(serverId, agentId));
}
