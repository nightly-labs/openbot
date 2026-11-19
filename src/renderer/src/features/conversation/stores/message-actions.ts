import {
  attachmentReferenceIds,
  expandAttachmentReferences,
  removeAttachmentReferences,
} from "@openbot/contracts/attachment-references";
import {
  chatTagReferences,
  expandChatTagReferences,
  limitedQuoteText,
  serializeChatTagReference,
} from "@openbot/contracts/chat-tag-references";
import type { InstalledSkill, MessageReaction } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { desktopAnalytics } from "../../../analytics";
import { writeClipboardText } from "../../../clipboard";
import { copiedFileRead, copyMessageWithAttachments } from "../composer-clipboard";
import type { StoredQueueEdit } from "../composer-draft";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps, ConversationTarget } from "../conversation-types";
import { conversationOwnerId } from "./composer-store";

const { t, errorMessage } = currentText();

export interface MessageActionsDeps {
  props: ConversationProps;
  installedSkills: () => InstalledSkill[];
  currentDraft: () => ComposerDraft;
  updateCurrentDraft: (patch: Partial<ComposerDraft>) => void;
  currentTarget: () => { agentId: string; serverId: string } | undefined;
  editingAgentId: () => string | null;
  editingServerId: () => string | null;
  editingDeliveryId: () => string | null;
  editingPendingSave: () => StoredQueueEdit["pendingSave"] | null;
  setOpenReactionMessageId: (id: string | null) => void;
  setExpandedEmojiMessageId: (id: string | null) => void;
  copiedMessageId: () => string | null;
  setCopiedMessageId: (id: string | null) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  setComposerFocusRequest: (update: (current: number) => number) => void;
}

export function draftWithPageText(draft: string, text: string): string {
  const current = draft.trimEnd();
  return current ? `${current}\n${text}` : text;
}

export function draftWithPageContext(draft: string, messageId: string, text: string): string | undefined {
  const quote = text.trim() ? serializeChatTagReference("quote", limitedQuoteText(text), messageId) : "";
  const shown = chatTagReferences(draft).find((reference) => reference.kind === "quote" && reference.id === messageId);
  if (!shown && !quote) return undefined;
  const end = shown && !quote && draft[shown.end] === " " ? shown.end + 1 : shown?.end;
  return shown ? `${draft.slice(0, shown.start)}${quote}${draft.slice(end)}` : `${quote} ${draft}`;
}

export function createMessageActions(deps: MessageActionsDeps) {
  function replyToMessage(message: AgentMessage) {
    deps.updateCurrentDraft({ replyToMessageId: message.id });
    deps.setOpenReactionMessageId(null);
    deps.setComposerFocusRequest((value) => value + 1);
  }

  function addPageText(text: string) {
    deps.updateCurrentDraft({ text: draftWithPageText(deps.currentDraft().text, text) });
    deps.setComposerFocusRequest((value) => value + 1);
  }

  function setPageContext(message: AgentMessage, text: string) {
    const next = draftWithPageContext(deps.currentDraft().text, message.id, text);
    if (next !== undefined) deps.updateCurrentDraft({ text: next });
  }

  async function reactToMessage(message: AgentMessage, emoji: MessageReaction | null) {
    const agentId = deps.props.agent?.id;
    if (!agentId) return;
    const target = { agentId, serverId: deps.props.server?.id ?? "local" };
    const analytics = desktopAnalytics.scope();
    deps.setOpenReactionMessageId(null);
    deps.setExpandedEmojiMessageId(null);
    try {
      await conversationRuntime(deps.props).agent.setMessageReaction({
        agentId,
        messageId: message.id,
        emoji,
      });
      analytics.track("reaction_action", { action: emoji ? "add" : "remove", result: "succeeded" });
    } catch (error) {
      analytics.track("reaction_action", {
        action: emoji ? "add" : "remove",
        result: "failed",
        failure_code: "reaction_failed",
      });
      deps.setComposerError(errorMessage(error, t("chat.actions.reactionFailed")), target);
    }
  }

  function messageText(message: AgentMessage): string {
    const attachmentNames = new Map((message.attachments ?? []).map((attachment) => [attachment.id, attachment.name]));
    const agentNames = new Map(deps.props.agents.map((agent) => [agent.id, agent.name]));
    const skillNames = new Map(
      deps
        .installedSkills()
        .filter((skill) => skill.state !== "needs-repair")
        .map((skill) => [skill.skillId, skill.name]),
    );
    return expandAttachmentReferences(
      expandChatTagReferences(message.body, (reference) =>
        reference.kind === "agent" ? agentNames.get(reference.id) : skillNames.get(reference.id),
      ),
      (reference) => attachmentNames.get(reference.attachmentId),
    );
  }

  async function copyMessage(message: AgentMessage) {
    const text = messageText(message);
    if (!text && !message.attachments?.length) return;
    const agentId = conversationOwnerId(deps.props);
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    try {
      if (message.attachments?.length)
        await copyMessageWithAttachments(
          message.body,
          text,
          message.attachments,
          deps.props.runtime?.previewAttachment,
        );
      else await writeClipboardText(text);
      deps.setCopiedMessageId(message.id);
      window.setTimeout(() => {
        if (deps.copiedMessageId() === message.id) deps.setCopiedMessageId(null);
      }, 1_400);
    } catch (error) {
      deps.setComposerError(errorMessage(error, t("chat.actions.copyFailed")), target);
    }
  }

  function removeAttachment(id: string) {
    const target = deps.currentTarget();
    if (
      target &&
      deps.editingPendingSave() &&
      deps.editingAgentId() === target.agentId &&
      deps.editingServerId() === target.serverId &&
      deps.editingDeliveryId()
    )
      return;
    const serverId = target?.serverId;
    deps.updateCurrentDraft({
      attachments: deps.currentDraft().attachments.filter((attachment) => attachment.id !== id),
      text: removeAttachmentReferences(deps.currentDraft().text, id),
    });
    const runtime = conversationRuntime(deps.props);
    void copiedFileRead(id).then(() => runtime.agent.discardDraftAttachment(id, serverId));
  }

  function draftAttachmentIds(): Set<string> {
    return attachmentReferenceIds(deps.currentDraft().text);
  }

  return {
    replyToMessage,
    addPageText,
    setPageContext,
    reactToMessage,
    copyMessage,
    messageText,
    removeAttachment,
    draftAttachmentIds,
  };
}
