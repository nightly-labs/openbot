import type { ConversationPage } from "@openbot/contracts/ipc";

/**
 * Which messages a conversation shows after a page or a snapshot arrives.
 *
 * Pure, and separate from `conversation-read-state.ts`, because this is list
 * arithmetic over whatever the caller stores rather than anything about read
 * state: `conversation.tsx` passes the stored message objects it already holds
 * so identity survives a merge, and the renderer only re-animates what is
 * genuinely new.
 *
 * Both functions exist because a conversation can be showing a window into a
 * longer history - older pages the user scrolled back to, or a page loaded
 * *around* a searched message - and main sends the tail of that history without
 * knowing what is on screen. Dropping the loaded prefix would scroll the user
 * away from what they were reading.
 */

/**
 * How a page joins what is already loaded: `replace` for a fresh window,
 * `older` for one prepended by scrolling back, `latest` for one appended at the
 * end.
 */
export type ConversationPageMerge = "replace" | "older" | "latest";

/**
 * A page joined to the loaded messages, with the page's copy of any message
 * that appears in both. Ordering is the caller's `merge`; de-duplication is by
 * id, so a page that overlaps the loaded range moves those messages rather than
 * showing them twice.
 */
export function mergeConversationPage<Message extends { id: string }>(
  loaded: readonly Message[],
  page: readonly Message[],
  merge: ConversationPageMerge,
): Message[] {
  if (merge === "replace") return [...page];
  const pageIds = new Set(page.map((message) => message.id));
  const kept = loaded.filter((message) => !pageIds.has(message.id));
  return merge === "older" ? [...page, ...kept] : [...kept, ...page];
}

/**
 * The originals that the replies of a host page quote and that the host no longer has. A page
 * sends each quoted original that is not on it among its references, so an original that is in
 * neither was deleted. A live message comes with no references, so only a page can tell.
 */
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

/**
 * The part of a refreshed snapshot a conversation may show without losing its
 * window.
 *
 * A snapshot that is not capped is the whole conversation, so it is shown
 * whole. A capped one is only the tail: loaded messages before the first one it
 * shares are older than that tail, so they stay. After them, a window at the
 * latest end shows the snapshot from that first shared message, so a new
 * message shows wherever it sorts. A window loaded *around* a message keeps
 * only the messages already on screen, because the rest of the snapshot
 * belongs to the far end of a gap.
 */
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
