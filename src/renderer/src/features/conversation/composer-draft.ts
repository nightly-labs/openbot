import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type { MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import type { ComposerDraft } from "./conversation-types";

export const EMPTY_DRAFT: ComposerDraft = {
  text: "",
  attachments: [],
  replyToMessageId: null,
};

export function copyComposerDraft(draft: ComposerDraft): ComposerDraft {
  return {
    text: draft.text,
    attachments: [...draft.attachments],
    replyToMessageId: draft.replyToMessageId,
  };
}

export function appendSkillExample(
  draft: ComposerDraft,
  skill: Pick<MarketplaceSkillDetail, "id" | "name" | "examplePrompt">,
): ComposerDraft {
  const example = `${serializeChatTagReference("skill", skill.name, skill.id)} ${skill.examplePrompt?.trim() || "Help me use this skill."}`;
  return { ...draft, text: draft.text ? `${draft.text}\n${example}` : example };
}

export function appendSkillCreationRequest(draft: ComposerDraft): ComposerDraft {
  const request =
    "Help me create a new local skill. Use the skill-creation guide. Ask me what workflow it should support before you create it.";
  return { ...draft, text: draft.text ? `${draft.text}\n${request}` : request };
}
