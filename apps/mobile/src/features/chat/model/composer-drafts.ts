import { type SetStateAction, useCallback } from "react";
import { create } from "zustand";

/** The chat that owns a draft: an agent chat or a channel, by its id. */
export interface DraftChat {
  kind: "agent" | "channel";
  serverId: string;
  id: string;
}

/**
 * The unsent composer text of each chat, so that a look at another chat does not lose it.
 *
 * It stays in memory only: it is not part of the phone's workspace copy, and a closed app starts
 * with empty composers. Sign-out and server removal delete it, as they delete that copy.
 */
const useComposerDrafts = create<{ drafts: Readonly<Record<string, string>> }>(() => ({ drafts: {} }));

function draftKey(chat: DraftChat): string {
  return `${chat.serverId}\0${chat.kind}\0${chat.id}`;
}

/** The draft of one chat, with a setter that takes a value or an update, as `useState` does. */
export function useComposerDraft(chat: DraftChat): [string, (value: SetStateAction<string>) => void] {
  const key = draftKey(chat);
  const draft = useComposerDrafts((state) => state.drafts[key] ?? "");
  const setDraft = useCallback(
    (value: SetStateAction<string>) =>
      useComposerDrafts.setState(({ drafts }) => {
        const current = drafts[key] ?? "";
        const next = typeof value === "function" ? value(current) : value;
        if (next === current) return {};
        const { [key]: _removed, ...rest } = drafts;
        return { drafts: next ? { ...rest, [key]: next } : rest };
      }),
    [key],
  );
  return [draft, setDraft];
}

/** Deletes the drafts of these servers' chats. */
export function deleteServerDrafts(serverIds: Iterable<string>): void {
  const prefixes = [...serverIds].map((serverId) => `${serverId}\0`);
  if (!prefixes.length) return;
  useComposerDrafts.setState(({ drafts }) => ({
    drafts: Object.fromEntries(
      Object.entries(drafts).filter(([key]) => !prefixes.some((prefix) => key.startsWith(prefix))),
    ),
  }));
}

/** Deletes every draft, on sign-out or when the session ends. */
export function deleteComposerDrafts(): void {
  useComposerDrafts.setState({ drafts: {} });
}
