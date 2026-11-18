import { type SetStateAction, useCallback } from "react";
import { create } from "zustand";
import { outboxChatKey } from "./outbox";

/** The chat that owns a draft: an agent chat or a channel, by its id. */
type DraftChat = Parameters<typeof outboxChatKey>[0];

interface Draft {
  serverId: string;
  text: string;
}

/**
 * The unsent composer text of each chat, keyed by `outboxChatKey`, so that a look at another chat
 * does not lose it.
 *
 * It stays in memory only: it is not part of the phone's workspace copy, and a closed app starts
 * with empty composers. A change of account and server removal delete it, as they delete that copy.
 */
const useComposerDrafts = create<{ drafts: Readonly<Record<string, Draft>> }>(() => ({ drafts: {} }));

function writeDraft({ serverId }: DraftChat, key: string, value: SetStateAction<string>): void {
  useComposerDrafts.setState(({ drafts }) => {
    const current = drafts[key]?.text ?? "";
    const text = typeof value === "function" ? value(current) : value;
    if (text === current) return {};
    const { [key]: _previous, ...rest } = drafts;
    return { drafts: text ? { ...rest, [key]: { serverId, text } } : rest };
  });
}

/** The draft of one chat, with a setter that takes a value or an update, as `useState` does. */
export function useComposerDraft(chat: DraftChat): [string, (value: SetStateAction<string>) => void] {
  const key = outboxChatKey(chat);
  const { kind, serverId, id } = chat;
  const draft = useComposerDrafts((state) => state.drafts[key]?.text ?? "");
  const setDraft = useCallback(
    (value: SetStateAction<string>) => writeDraft({ kind, serverId, id }, key, value),
    [key, kind, serverId, id],
  );
  return [draft, setDraft];
}

/** The draft of one chat as it is now, for code that runs after an `await`. */
export function getComposerDraft(chat: DraftChat): string {
  return useComposerDrafts.getState().drafts[outboxChatKey(chat)]?.text ?? "";
}

/** Deletes the drafts of these servers' chats. */
export function deleteServerDrafts(serverIds: ReadonlySet<string>): void {
  useComposerDrafts.setState(({ drafts }) => {
    const kept = Object.entries(drafts).filter(([, draft]) => !serverIds.has(draft.serverId));
    return kept.length === Object.keys(drafts).length ? {} : { drafts: Object.fromEntries(kept) };
  });
}

/** Deletes every draft, when the account changes or signs out. */
export function deleteComposerDrafts(): void {
  useComposerDrafts.setState({ drafts: {} });
}
