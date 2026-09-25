import {
  attachmentReferenceIds,
  expandAttachmentReferences,
  removeAttachmentReferences,
} from "@openbot/contracts/attachment-references";
import { expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { InstalledSkill, MessageReaction } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { errorMessage } from "@openbot/ui/error-message";
import { desktopAnalytics } from "../../../analytics";
import { writeClipboardText } from "../../../clipboard";
import type { StoredQueueEdit } from "../composer-draft";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps, ConversationTarget } from "../conversation-types";

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
  setOpenMoreMessageId: (id: string | null) => void;
  setExpandedEmojiMessageId: (id: string | null) => void;
  copiedMessageId: () => string | null;
  setCopiedMessageId: (id: string | null) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
}

export function createMessageActions(deps: MessageActionsDeps) {
  function replyToMessage(message: AgentMessage) {
    deps.updateCurrentDraft({ replyToMessageId: message.id });
    deps.setOpenReactionMessageId(null);
    deps.setOpenMoreMessageId(null);
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
      deps.setComposerError(errorMessage(error, "Could not update the reaction. Try again."), target);
    }
  }

  async function copyMessage(message: AgentMessage) {
    const attachmentNames = new Map((message.attachments ?? []).map((attachment) => [attachment.id, attachment.name]));
    const agentNames = new Map(deps.props.agents.map((agent) => [agent.id, agent.name]));
    const skillNames = new Map(
      deps
        .installedSkills()
        .filter((skill) => skill.state !== "needs-repair")
        .map((skill) => [skill.skillId, skill.name]),
    );
    const text = expandAttachmentReferences(
      expandChatTagReferences(message.body, (reference) =>
        reference.kind === "agent" ? agentNames.get(reference.id) : skillNames.get(reference.id),
      ),
      (reference) => attachmentNames.get(reference.attachmentId),
    );
    if (!text) return;
    const agentId = deps.props.agent?.id;
    const target = agentId ? { agentId, serverId: deps.props.server?.id ?? "local" } : undefined;
    try {
      await writeClipboardText(text);
      deps.setCopiedMessageId(message.id);
      window.setTimeout(() => {
        if (deps.copiedMessageId() === message.id) deps.setCopiedMessageId(null);
      }, 1_400);
    } catch (error) {
      deps.setComposerError(errorMessage(error, "Could not copy the message."), target);
    }
  }

  function removeAttachment(id: string) {
    // A pending Save keeps its attachment IDs for retry. Do not change or discard them,
    // but only in the edited conversation: the pending state survives agent/server switches.
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
    void conversationRuntime(deps.props).agent.discardDraftAttachment(id, serverId);
  }

  function draftAttachmentIds(): Set<string> {
    return attachmentReferenceIds(deps.currentDraft().text);
  }

  return {
    replyToMessage,
    reactToMessage,
    copyMessage,
    removeAttachment,
    draftAttachmentIds,
  };
}
