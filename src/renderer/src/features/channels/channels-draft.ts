import type { ChannelDraft } from "@openbot/contracts/ipc";

export function emptyChannelDraft(): ChannelDraft {
  return { name: "", title: "", instructions: "", members: [], leadAgentId: null };
}

/** The agent search of both member pickers: a case-blind match on the name and the description. */
export function matchesAgentSearch(agent: { name: string; description: string }, search: string): boolean {
  return `${agent.name} ${agent.description}`.toLowerCase().includes(search.toLowerCase());
}

/**
 * Adds or removes one member, then keeps the lead on a current member: the first one when the lead
 * is unset or has left. Written as a mutator because the store setter merges any returned value key
 * by key, which would corrupt the draft.
 */
export function toggleChannelMember(draft: ChannelDraft, agentId: string, present: boolean): void {
  draft.members = present
    ? [...draft.members.filter((member) => member.agentId !== agentId), { agentId }]
    : draft.members.filter((member) => member.agentId !== agentId);
  if (!draft.leadAgentId || !draft.members.some((member) => member.agentId === draft.leadAgentId))
    draft.leadAgentId = draft.members[0]?.agentId ?? null;
}
