import {
  attachmentReferenceIds,
  removeAttachmentReferences,
  serializeAttachmentReference,
} from "@openbot/contracts/attachment-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { DraftAttachment } from "@openbot/contracts/ipc";
import type { ComposerPasteResult, ComposerSelection } from "@openbot/ui/features/conversation/ComposerEditor";
import { DRAFT_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { currentText } from "@openbot/ui/text";
import { actionToast } from "../../../action-toast";
import { EMPTY_DRAFT, insertAtSelection, insertPastedText } from "../composer-draft";
import { threadDraftKey } from "../conversation-keys";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps, ConversationThreads } from "../conversation-types";
import { importPastedFiles, type PastePreview, pastePreviewTracker } from "./composer-actions";
import { currentConversationTarget } from "./composer-store";

// Each member reads the interface language when it is called.
const { t, errorMessage } = currentText();

type Drafts = Record<string, ComposerDraft>;

export interface ThreadComposerActionsDeps {
  props: ConversationProps;
  threadDrafts: () => Drafts;
  setThreadDrafts: (update: (current: Drafts) => Drafts) => void;
  pastePreviews: () => readonly PastePreview[];
  setPastePreviews: (update: (current: readonly PastePreview[]) => readonly PastePreview[]) => void;
}

/**
 * The message box of a side thread. Each file is a reference in the text, where it was added. An image
 * also shows in the thumbnail row, as in the agent's own chat, and stays there when its reference goes. A thread takes files on this computer, or on a host with
 * `agent-thread-files-v1`: `agent-tasks-v1` carries text only.
 */
export function createThreadComposerActions(deps: ThreadComposerActionsDeps) {
  /** The thread draft that each import in progress goes to, by request id. A send waits for them. */
  const imports = new Map<string, { key: string; ended: Promise<void>; end: () => void }>();

  function trackImport(requestId: string, key: string): void {
    let end = () => {};
    const ended = new Promise<void>((resolve) => {
      end = resolve;
    });
    imports.set(requestId, { key, ended, end });
  }

  /** Ends an import, and returns the key of its draft. */
  function releaseImport(requestId: string): string | undefined {
    const entry = imports.get(requestId);
    imports.delete(requestId);
    entry?.end();
    return entry?.key;
  }

  /** The draft of the open side thread, or of the new thread tab. Undefined while the agent's own chat is open. */
  function openDraftKey(): string | undefined {
    const target = currentConversationTarget(deps.props);
    const open = deps.props.threads?.open;
    return target && open !== undefined ? threadDraftKey(target, open?.id ?? DRAFT_THREAD_ID) : undefined;
  }

  /** The draft of a side thread in the side panel. */
  function sideDraftKey(id: string): string | undefined {
    const target = currentConversationTarget(deps.props);
    return target ? threadDraftKey(target, id) : undefined;
  }

  function draft(key: string): ComposerDraft {
    return deps.threadDrafts()[key] ?? EMPTY_DRAFT;
  }

  /** An empty draft leaves the list, so the stored drafts keep only the boxes with content. */
  function updateDraft(key: string, update: (draft: ComposerDraft) => ComposerDraft): void {
    deps.setThreadDrafts((current) => {
      const next = update(current[key] ?? EMPTY_DRAFT);
      if (next.text || next.attachments.length > 0 || next.replyToMessageId) return { ...current, [key]: next };
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  function discard(attachments: readonly DraftAttachment[], serverId: string): void {
    for (const attachment of attachments)
      void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, serverId);
  }

  // Each file of a drop is its own import, and all of them start in one task: one toast is enough.
  let refusedInTask = false;
  function refuseFiles(): void {
    if (refusedInTask) return;
    refusedInTask = true;
    queueMicrotask(() => {
      refusedInTask = false;
    });
    actionToast.error(t("conversation.threads.error.files"));
  }

  /** The images of the draft, in the thumbnail row. A send takes them, also when the text no longer names them. */
  function rowImages(key: string): DraftAttachment[] {
    return draft(key).attachments.filter((attachment) => attachment.kind === "image");
  }

  /** The pasted images that still import into the draft. */
  function pendingImages(key: string | undefined): readonly PastePreview[] {
    return key ? deps.pastePreviews().filter((preview) => preview.draftKey === key) : [];
  }

  function removeAttachment(key: string | undefined, id: string): void {
    const target = currentConversationTarget(deps.props);
    if (!key || !target) return;
    const removed = draft(key).attachments.filter((attachment) => attachment.id === id);
    if (!removed.length) return;
    updateDraft(key, (current) => ({
      ...current,
      text: removeAttachmentReferences(current.text, id),
      attachments: current.attachments.filter((attachment) => attachment.id !== id),
    }));
    discard(removed, target.serverId);
  }

  /**
   * Discards each file other than an image whose reference the user deleted. The row shows only
   * images, so such a file could not be removed, and it would still count toward the limit.
   */
  function dropUnreferenced(key: string, serverId: string): void {
    const referenced = attachmentReferenceIds(draft(key).text);
    const unreferenced = draft(key).attachments.filter(
      (attachment) => attachment.kind !== "image" && !referenced.has(attachment.id),
    );
    if (!unreferenced.length) return;
    const ids = new Set(unreferenced.map((attachment) => attachment.id));
    updateDraft(key, (current) => ({
      ...current,
      attachments: current.attachments.filter((attachment) => !ids.has(attachment.id)),
    }));
    discard(unreferenced, serverId);
  }

  /**
   * Takes an import from a drop or the file picker for the open thread. A thread on another computer
   * refuses it, and the import then has no target. False when no thread takes the files.
   */
  function claimImport(requestId: string, serverId: string): boolean {
    const key = openDraftKey();
    if (!key) return false;
    if (!deps.props.threads?.acceptsFiles) {
      refuseFiles();
      return false;
    }
    if (currentConversationTarget(deps.props)?.serverId !== serverId) return false;
    trackImport(requestId, key);
    return true;
  }

  /**
   * Adds the files that fit the draft and puts their references at the selection, or at the end when
   * the text changed since `before`. A message that would be too long keeps none of them.
   */
  function addFiles(
    key: string,
    serverId: string,
    imported: readonly DraftAttachment[],
    at?: { before: string; selection: ComposerSelection },
  ): ComposerPasteResult | undefined {
    dropUnreferenced(key, serverId);
    const available = Math.max(0, INPUT_LIMITS.attachments - draft(key).attachments.length);
    const accepted = imported.slice(0, available);
    discard(imported.slice(available), serverId);
    if (imported.length > accepted.length)
      actionToast.error(t("composer.error.attachmentLimit", { limit: INPUT_LIMITS.attachments }));
    if (!accepted.length) return;
    const references = accepted
      .map((attachment) => serializeAttachmentReference(attachment.name, attachment.id))
      .join(" ");
    const result = insertAtSelection(draft(key).text, references, at);
    if (result.value.length > INPUT_LIMITS.messageText) {
      discard(accepted, serverId);
      actionToast.error(t("error.agent.messageTooLong"));
      return;
    }
    updateDraft(key, (current) => ({
      ...current,
      text: result.value,
      attachments: [...current.attachments, ...accepted],
    }));
    return result;
  }

  /** Puts a pasted text at the selection, or at the end when the text changed since `at.before`. */
  function insertText(
    key: string,
    text: string,
    at: { before: string; selection: ComposerSelection },
  ): ComposerPasteResult | undefined {
    const result = insertPastedText(draft(key).text, text, at);
    if (result) updateDraft(key, (current) => ({ ...current, text: result.value }));
    return result;
  }

  /**
   * Imports pasted files and puts their references at the selection. `text` is the text of a long paste
   * that `files` holds: when no file comes, that text goes at the selection, so the paste loses nothing.
   */
  async function pasteFiles(
    files: ReadonlyArray<File | Promise<File>>,
    selection: ComposerSelection,
    key = openDraftKey(),
    text?: string,
  ): Promise<ComposerPasteResult | undefined> {
    const target = currentConversationTarget(deps.props);
    if (!key || !target) return;
    const fallback = (before: string) =>
      text === undefined ? undefined : insertText(key, text, { before, selection });
    if (!deps.props.threads?.acceptsFiles) {
      // A thread that takes no files still takes a long text.
      if (text !== undefined) return fallback(draft(key).text);
      refuseFiles();
      return;
    }
    dropUnreferenced(key, target.serverId);
    const before = draft(key).text;
    const requestId = crypto.randomUUID();
    trackImport(requestId, key);
    const previews = pastePreviewTracker(key, deps.setPastePreviews);
    try {
      const imported = await importPastedFiles(
        files,
        () => draft(key).attachments.length,
        (data) => conversationRuntime(deps.props).agent.importAttachmentData(data, target.serverId),
        previews.onAccepted,
      );
      // The draft refused the files and shows why. The pasted text still comes.
      return addFiles(key, target.serverId, imported, { before, selection }) ?? fallback(before);
    } catch (error) {
      actionToast.error(errorMessage(error, t("composer.error.keepAttachments")));
      return fallback(before);
    } finally {
      previews.stop();
      releaseImport(requestId);
    }
  }

  function setText(key: string | undefined, text: string): void {
    if (key) updateDraft(key, (current) => ({ ...current, text }));
  }

  /** The message of the thread that the draft replies to, or null for no reply. */
  function setReply(key: string | undefined, replyToMessageId: string | null): void {
    if (key) updateDraft(key, (current) => ({ ...current, replyToMessageId }));
  }

  /**
   * Sends the draft with the files that it still names and the images of its row, after each import of
   * the draft ended. When the message went, the sent text leaves the draft and each file whose
   * reference the user deleted is discarded. A file that came during the send stays.
   */
  async function send(
    threads: Pick<ConversationThreads, "onSend">,
    typed: string,
    // The first message of a new thread starts the thread and opens it, so the key is read before the send.
    key = openDraftKey(),
  ): Promise<boolean> {
    for (;;) {
      const pending = [...imports.values()].filter((entry) => entry.key === key).map((entry) => entry.ended);
      if (!pending.length) break;
      await Promise.all(pending);
    }
    // An import that ended put its reference in the draft after the user pressed Send.
    const images = key ? rowImages(key) : [];
    const typedText = key ? draft(key).text.trim() : typed;
    // A thread takes its title from the text, so a message of images only names them.
    const text = typedText || images.map((image) => serializeAttachmentReference(image.name, image.id)).join(" ");
    if (!text) return false;
    const target = currentConversationTarget(deps.props);
    const before = key ? draft(key).text : "";
    const attachments = key ? draft(key).attachments : [];
    // A server that lost the reply route takes the message without its reply.
    const replyToMessageId = key && deps.props.threads?.acceptsReplies ? draft(key).replyToMessageId : null;
    const referenced = attachmentReferenceIds(text);
    for (const image of images) referenced.add(image.id);
    const sent = await threads.onSend(
      text,
      attachments.filter((attachment) => referenced.has(attachment.id)).map((attachment) => attachment.id),
      replyToMessageId,
    );
    if (!sent || !key) return sent;
    const known = new Set(attachments.map((attachment) => attachment.id));
    updateDraft(key, (current) => ({
      ...current,
      // A file that came during the send put its reference after the sent text.
      text: current.text.startsWith(before) ? current.text.slice(before.length).trimStart() : "",
      attachments: current.attachments.filter((attachment) => !known.has(attachment.id)),
      // A reply that the user chose during the send stays for the next message.
      replyToMessageId: current.replyToMessageId === replyToMessageId ? null : current.replyToMessageId,
    }));
    if (target)
      discard(
        attachments.filter((attachment) => !referenced.has(attachment.id)),
        target.serverId,
      );
    return sent;
  }

  return {
    openDraftKey,
    sideDraftKey,
    draft,
    rowImages,
    pendingImages,
    removeAttachment,
    addFiles,
    pasteFiles,
    claimImport,
    releaseImport,
    setText,
    setReply,
    send,
  };
}
