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
  threads: Drafts;
}

interface ComposerDraftOwner {
  drafts: () => Drafts;
  channelDrafts: () => Drafts;
  threadDrafts: () => Drafts;
  editingAgentId: () => string | null;
  editingServerId: () => string | null;
  editingDraftBackup: () => ComposerDraft | null;
  threadQueueEdit: () => { draftKey: string; backup: ComposerDraft } | null;
  unsentTexts: () => Record<string, string[]>;
}

export function readStoredComposerDrafts(): StoredComposerDrafts {
  try {
    return decodeStoredDrafts(JSON.parse(window.localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY) ?? "null"));
  } catch {
    return { agents: {}, channels: {}, threads: {} };
  }
}

function decodeStoredDrafts(value: unknown): StoredComposerDrafts {
  return isDynamicRecord(value)
    ? {
        agents: decodeDrafts(value.agents),
        channels: decodeDrafts(value.channels),
        threads: decodeThreadDrafts(value.threads),
      }
    : { agents: {}, channels: {}, threads: {} };
}

export function clearStoredComposerDrafts(): void {
  try {
    window.localStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
  } catch {}
}

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
    const threads = { ...owner.threadDrafts() };
    const threadEdit = owner.threadQueueEdit();
    if (threadEdit) threads[threadEdit.draftKey] = threadEdit.backup;
    for (const [key, texts] of Object.entries(owner.unsentTexts())) {
      const draft = agents[key] ?? EMPTY_DRAFT;
      agents[key] = { ...draft, text: [...texts, draft.text].filter((text) => text.trim()).join("\n\n") };
    }
    try {
      window.localStorage.setItem(
        COMPOSER_DRAFTS_STORAGE_KEY,
        JSON.stringify({
          agents: storableDrafts(agents),
          channels: storableDrafts(owner.channelDrafts()),
          threads: storableThreadDrafts(threads),
        }),
      );
    } catch {}
  };
  createEffect(
    () =>
      [
        owner.drafts(),
        owner.channelDrafts(),
        owner.threadDrafts(),
        owner.editingAgentId(),
        owner.editingDraftBackup(),
        owner.threadQueueEdit(),
        owner.unsentTexts(),
      ] as const,
    () => {
      timer ??= setTimeout(write, WRITE_DELAY_MS);
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

function storableThreadDrafts(drafts: Drafts): Record<string, string> {
  return Object.fromEntries(Object.entries(storableDrafts(drafts)).map(([key, draft]) => [key, draft.text]));
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

function decodeThreadDrafts(value: unknown): Drafts {
  if (!isDynamicRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, text]) =>
      isString(text) ? [[key, { text, attachments: [], replyToMessageId: null }]] : [],
    ),
  );
}
