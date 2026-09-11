export const MAX_PINNED_AGENTS = 16;

export function canToggleAgentPin(pinned: readonly string[], agentId: string): boolean {
  return pinned.includes(agentId) || pinned.length < MAX_PINNED_AGENTS;
}
