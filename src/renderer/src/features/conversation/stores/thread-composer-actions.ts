import { attachmentReferenceIds, serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { DraftAttachment } from "@openbot/contracts/ipc";
import type { ComposerPasteResult, ComposerSelection } from "@openbot/ui/features/conversation/ComposerEditor";
import { DRAFT_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { currentText } from "@openbot/ui/text";
import { actionToast } from "../../../action-toast";
import { EMPTY_DRAFT } from "../composer-draft";
import { threadDraftKey } from "../conversation-keys";
import { conversationRuntime } from "../conversation-runtime";
import type { ComposerDraft, ConversationProps, ConversationThreads } from "../conversation-types";
import { importPastedFiles } from "./composer-actions";
import { currentConversationTarget } from "./composer-store";

// Each member reads the interface language when it is called.
const { t, errorMessage } = currentText();

type Drafts = Record<string, ComposerDraft>;

export interface ThreadComposerActionsDeps {
  props: ConversationProps;
  threadDrafts: () => Drafts;
  setThreadDrafts: (update: (current: Drafts) => Drafts) => void;
}

/**
 * The message box of the open side thread. Each file in it is a reference in the text, so the box
 * shows no file row. A thread takes files only on this computer: `agent-tasks-v1` carries text only.
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
      if (next.text || next.attachments.length > 0) return { ...current, [key]: next };
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  function discard(attachments: readonly DraftAttachment[], serverId: string): void {
    for (const attachment of attachments)
      void conversationRuntime(deps.props).agent.discardDraftAttachment(attachment.id, serverId);
  }

  function refuseFiles(): void {
    actionToast.error(t("conversation.threads.error.files"));
  }

  /**
   * Discards each file whose reference the user deleted. The box shows no file row, so such a file
   * could not be removed, and it would still count toward the limit.
   */
  function dropUnreferenced(key: string, serverId: string): void {
    const referenced = attachmentReferenceIds(draft(key).text);
    const unreferenced = draft(key).attachments.filter((attachment) => !referenced.has(attachment.id));
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
    const current = draft(key).text;
    const atSelection = at && current === at.before ? at.selection : undefined;
    const text = atSelection
      ? `${current.slice(0, atSelection.start)}${references}${current.slice(atSelection.end)}`
      : [current, references].filter(Boolean).join(" ");
    if (text.length > INPUT_LIMITS.messageText) {
      discard(accepted, serverId);
      actionToast.error(t("error.agent.messageTooLong"));
      return;
    }
    updateDraft(key, (current) => ({ ...current, text, attachments: [...current.attachments, ...accepted] }));
    return { value: text, caret: atSelection ? atSelection.start + references.length : text.length };
  }

  async function pasteFiles(
    files: ReadonlyArray<File | Promise<File>>,
    selection: ComposerSelection,
  ): Promise<ComposerPasteResult | undefined> {
    const key = openDraftKey();
    const target = currentConversationTarget(deps.props);
    if (!key || !target) return;
    if (!deps.props.threads?.acceptsFiles) {
      refuseFiles();
      return;
    }
    dropUnreferenced(key, target.serverId);
    const before = draft(key).text;
    const requestId = crypto.randomUUID();
    trackImport(requestId, key);
    try {
      const imported = await importPastedFiles(
        files,
        () => draft(key).attachments.length,
        (data) => conversationRuntime(deps.props).agent.importAttachmentData(data, target.serverId),
      );
      return addFiles(key, target.serverId, imported, { before, selection });
    } catch (error) {
      actionToast.error(errorMessage(error, t("composer.error.keepAttachments")));
    } finally {
      releaseImport(requestId);
    }
  }

  function setText(key: string | undefined, text: string): void {
    if (key) updateDraft(key, (current) => ({ ...current, text }));
  }

  /**
   * Sends the draft with the files that it still names, after each import of the draft ended. When the
   * message went, the sent text leaves the draft and each file whose reference the user deleted is
   * discarded. A file that came during the send stays.
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
    const text = key ? draft(key).text.trim() : typed;
    if (!text) return false;
    const target = currentConversationTarget(deps.props);
    const before = key ? draft(key).text : "";
    const attachments = key ? draft(key).attachments : [];
    const referenced = attachmentReferenceIds(text);
    const sent = await threads.onSend(
      text,
      attachments.filter((attachment) => referenced.has(attachment.id)).map((attachment) => attachment.id),
    );
    if (!sent || !key) return sent;
    const known = new Set(attachments.map((attachment) => attachment.id));
    updateDraft(key, (current) => ({
      ...current,
      // A file that came during the send put its reference after the sent text.
      text: current.text.startsWith(before) ? current.text.slice(before.length).trimStart() : "",
      attachments: current.attachments.filter((attachment) => !known.has(attachment.id)),
    }));
    if (target)
      discard(
        attachments.filter((attachment) => !referenced.has(attachment.id)),
        target.serverId,
      );
    return sent;
  }

  return { openDraftKey, sideDraftKey, draft, addFiles, pasteFiles, claimImport, releaseImport, setText, send };
}
