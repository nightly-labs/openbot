import type { ChannelDraft } from "@openbot/contracts/ipc";

export function emptyChannelDraft(): ChannelDraft {
  return { name: "", purpose: "", members: [], leadAgentId: null, linkedThreadIds: [] };
}

/**
 * Adds a member with `responsibility`, or removes it when `responsibility` is null, then keeps the
 * lead on a current member: the first one when the lead is unset or has left. Written as a mutator
 * because the store setter merges any returned value key by key, which would corrupt the draft.
 */
export function toggleChannelMember(draft: ChannelDraft, agentId: string, responsibility: string | null): void {
  draft.members =
    responsibility === null
      ? draft.members.filter((member) => member.agentId !== agentId)
      : [...draft.members, { agentId, responsibility }];
  if (!draft.leadAgentId || !draft.members.some((member) => member.agentId === draft.leadAgentId))
    draft.leadAgentId = draft.members[0]?.agentId ?? null;
}
