import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { ChannelDraft } from "@openbot/contracts/ipc";

export function toggleChannelMember(draft: ChannelDraft, agentId: string): ChannelDraft {
  const selected = draft.members.some((member) => member.agentId === agentId);
  return {
    ...draft,
    members: selected ? draft.members.filter((member) => member.agentId !== agentId) : [...draft.members, { agentId }],
    leadAgentId: selected && draft.leadAgentId === agentId ? null : draft.leadAgentId,
  };
}

export function channelRecipient(text: string, members: readonly { agentId: string }[]) {
  const mention = chatTagReferences(text).find(
    (reference) => reference.kind === "agent" && !text.slice(0, reference.start).trim(),
  );
  return mention && members.some((member) => member.agentId === mention.id) ? mention.id : null;
}
