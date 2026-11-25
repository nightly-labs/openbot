import { type SetStateAction, useCallback } from "react";
import { create } from "zustand";
import { outboxChatKey } from "./outbox";

type DraftChat = Parameters<typeof outboxChatKey>[0];

interface Draft {
  serverId: string;
  text: string;
}

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

export function appendComposerDraft(chat: DraftChat, text: string): void {
  writeDraft(chat, outboxChatKey(chat), (current) => (current.trim() ? `${current.trimEnd()}\n${text}` : text));
}

export function getComposerDraft(chat: DraftChat): string {
  return useComposerDrafts.getState().drafts[outboxChatKey(chat)]?.text ?? "";
}

export function deleteServerDrafts(serverIds: ReadonlySet<string>): void {
  useComposerDrafts.setState(({ drafts }) => {
    const kept = Object.entries(drafts).filter(([, draft]) => !serverIds.has(draft.serverId));
    return kept.length === Object.keys(drafts).length ? {} : { drafts: Object.fromEntries(kept) };
  });
}

export function deleteComposerDrafts(): void {
  useComposerDrafts.setState({ drafts: {} });
}
