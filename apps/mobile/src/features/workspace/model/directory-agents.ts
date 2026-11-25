import type { MobileAgent } from "./workspace-types";

const MESSAGE_FIELDS: ReadonlySet<string> = new Set<keyof MobileAgent>(["preview", "updatedAt", "updatedLabel"]);

function isOwnField(agent: MobileAgent, key: string): key is keyof MobileAgent {
  return Object.hasOwn(agent, key);
}

export function sameAgentApartFromMessage(previous: MobileAgent, next: MobileAgent): boolean {
  if (previous === next) return true;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return false;
  for (const key of keys) {
    if (MESSAGE_FIELDS.has(key)) continue;
    if (!isOwnField(previous, key) || !Object.is(previous[key], next[key])) return false;
  }
  return true;
}

export function sameAgentsApartFromMessage(previous: readonly MobileAgent[], next: readonly MobileAgent[]): boolean {
  return keepDirectoryAgents(previous, next) === previous;
}

export function keepDirectoryAgents(
  previous: readonly MobileAgent[],
  next: readonly MobileAgent[],
): readonly MobileAgent[] {
  if (previous === next) return previous;
  if (previous.length !== next.length) return next;
  return next.every((agent, index) => {
    const before = previous[index];
    return before !== undefined && sameAgentApartFromMessage(before, agent);
  })
    ? previous
    : next;
}

export function findChatAgent(
  agents: readonly MobileAgent[],
  agentId: string | undefined,
  serverId: string | undefined,
  activeServerId: string,
): MobileAgent | undefined {
  const withId = agents.filter((agent) => agent.id === agentId);
  if (serverId) return withId.find((agent) => agent.serverId === serverId);
  return withId.find((agent) => agent.serverId === activeServerId) ?? withId[0];
}
