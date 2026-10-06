import { rewriteAttachmentReferences } from "@openbot/contracts/attachment-references";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createEffect, onCleanup } from "solid-js";
import { EMPTY_DRAFT } from "./composer-draft";
import { composerDraftKey } from "./conversation-keys";
import type { ComposerDraft } from "./conversation-types";

const COMPOSER_DRAFTS_STORAGE_KEY = "openbot:composer-drafts";
const WRITE_DELAY_MS = 300;

type Drafts = Record<string, ComposerDraft>;

export interface StoredComposerDrafts {
  agents: Drafts;
  channels: Drafts;
}

interface ComposerDraftOwner {
  drafts: () => Drafts;
  channelDrafts: () => Drafts;
  editingAgentId: () => string | null;
  editingServerId: () => string | null;
  editingDraftBackup: () => ComposerDraft | null;
}

/**
 * Unsent composer text from the last session, so an update mid-message loses nothing.
 *
 * Only the text is kept. The main process deletes draft attachment files at startup, so a restored
 * attachment would point at nothing: its inline reference becomes its name. A reply target is not
 * kept either, because the message it names may not be loaded, and the user could not see or cancel
 * the reply.
 */
export function readStoredComposerDrafts(): StoredComposerDrafts {
  try {
    return decodeStoredDrafts(JSON.parse(window.localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY) ?? "null"));
  } catch {
    return { agents: {}, channels: {} };
  }
}

function decodeStoredDrafts(value: unknown): StoredComposerDrafts {
  return isDynamicRecord(value)
    ? { agents: decodeDrafts(value.agents), channels: decodeDrafts(value.channels) }
    : { agents: {}, channels: {} };
}

/**
 * Writes the drafts shortly after each change, and at once when the window goes away.
 *
 * A queue edit stores its own draft (`QUEUE_EDIT_STORAGE_KEY`), so for that conversation this keeps
 * the draft the edit restores when it ends.
 */
export function writeComposerDraftsOnChange(owner: ComposerDraftOwner): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    const agents = { ...owner.drafts() };
    const editAgentId = owner.editingAgentId();
    const editServerId = owner.editingServerId();
    if (editAgentId && editServerId)
      agents[composerDraftKey({ agentId: editAgentId, serverId: editServerId })] =
        owner.editingDraftBackup() ?? EMPTY_DRAFT;
    try {
      window.localStorage.setItem(
        COMPOSER_DRAFTS_STORAGE_KEY,
        JSON.stringify({ agents: storableDrafts(agents), channels: storableDrafts(owner.channelDrafts()) }),
      );
    } catch {
      // Storage is full or unavailable. The drafts stay in memory for this session.
    }
  };
  createEffect(
    () => [owner.drafts(), owner.channelDrafts(), owner.editingAgentId(), owner.editingDraftBackup()] as const,
    () => {
      clearTimeout(timer);
      timer = setTimeout(write, WRITE_DELAY_MS);
    },
    { defer: true },
  );
  const flush = () => {
    if (timer !== undefined) write();
  };
  window.addEventListener("pagehide", flush);
  onCleanup(() => {
    window.removeEventListener("pagehide", flush);
    flush();
  });
}

function storableDrafts(drafts: Drafts): Record<string, { text: string }> {
  return Object.fromEntries(
    Object.entries(drafts).flatMap(([key, draft]) => {
      const text = rewriteAttachmentReferences(draft.text, () => null);
      return text.trim() ? [[key, { text }]] : [];
    }),
  );
}

function decodeDrafts(value: unknown): Drafts {
  if (!isDynamicRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, draft]) =>
      isDynamicRecord(draft) && isString(draft.text)
        ? [[key, { text: draft.text, attachments: [], replyToMessageId: null }]]
        : [],
    ),
  );
}
