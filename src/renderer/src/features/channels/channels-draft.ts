import type { ChannelDraft } from "@openbot/contracts/ipc";

export function emptyChannelDraft(): ChannelDraft {
  return { name: "", title: "", instructions: "", members: [], leadAgentId: null };
}

export function matchesAgentSearch(agent: { name: string; description: string }, search: string): boolean {
  return `${agent.name} ${agent.description}`.toLowerCase().includes(search.toLowerCase());
}

export function toggleChannelMember(draft: ChannelDraft, agentId: string, present: boolean): void {
  draft.members = present
    ? [...draft.members.filter((member) => member.agentId !== agentId), { agentId }]
    : draft.members.filter((member) => member.agentId !== agentId);
  if (!draft.leadAgentId || !draft.members.some((member) => member.agentId === draft.leadAgentId))
    draft.leadAgentId = draft.members[0]?.agentId ?? null;
}
