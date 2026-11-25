import type { ConversationPage } from "@openbot/contracts/ipc";

export type ConversationPageMerge = "replace" | "older" | "latest";

export function mergeConversationPage<Message extends { id: string }>(
  loaded: readonly Message[],
  page: readonly Message[],
  merge: ConversationPageMerge,
): Message[] {
  if (merge === "replace") return [...page];
  const pageIds = new Set(page.map((message) => message.id));
  if (merge === "latest") {
    const firstShared = loaded.findIndex((message) => pageIds.has(message.id));
    if (firstShared !== -1) return [...loaded.slice(0, firstShared), ...page];
  }
  const kept = loaded.filter((message) => !pageIds.has(message.id));
  return merge === "older" ? [...page, ...kept] : [...kept, ...page];
}

export function missingReplyOriginals(page: Pick<ConversationPage, "messages" | "references">): Record<string, true> {
  const pageIds = new Set(page.messages.map((message) => message.id));
  const missing: Record<string, true> = {};
  for (const { replyToMessageId } of page.messages) {
    if (replyToMessageId && !pageIds.has(replyToMessageId) && !(replyToMessageId in page.references)) {
      missing[replyToMessageId] = true;
    }
  }
  return missing;
}

export function windowedSnapshotMessages<Message extends { id: string }>(
  loaded: readonly Message[],
  snapshot: readonly Message[],
  window: { mode: "latest" | "around"; capped: boolean },
): Message[] {
  if (!window.capped) return [...snapshot];
  const snapshotIds = new Set(snapshot.map((message) => message.id));
  const firstShared = loaded.findIndex((message) => snapshotIds.has(message.id));
  if (window.mode === "latest" && firstShared === -1) return [...snapshot];
  const older = loaded.slice(0, firstShared === -1 ? loaded.length : firstShared);
  if (window.mode === "around") {
    const loadedIds = new Set(loaded.map((message) => message.id));
    return [...older, ...snapshot.filter((message) => loadedIds.has(message.id))];
  }
  const firstSharedId = loaded[firstShared]?.id;
  return [...older, ...snapshot.slice(snapshot.findIndex((message) => message.id === firstSharedId))];
}
