import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { ChannelDraft } from "@openbot/contracts/ipc";

export function toggleChannelMember(draft: ChannelDraft, agentId: string): ChannelDraft {
  const selected = draft.members.some((member) => member.agentId === agentId);
  const members = selected
    ? draft.members.filter((member) => member.agentId !== agentId)
    : [...draft.members, { agentId }];
  return {
    ...draft,
    members,
    leadAgentId: members.some((member) => member.agentId === draft.leadAgentId)
      ? draft.leadAgentId
      : (members[0]?.agentId ?? null),
  };
}

export function channelRecipient(text: string, members: readonly { agentId: string }[]) {
  const mention = chatTagReferences(text).find(
    (reference) => reference.kind === "agent" && !text.slice(0, reference.start).trim(),
  );
  return mention && members.some((member) => member.agentId === mention.id) ? mention.id : null;
}
