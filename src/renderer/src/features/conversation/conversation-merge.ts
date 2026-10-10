import { type ConversationMessage, isConversationVisibilityAfter } from "@openbot/contracts/ipc";

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

/** Keep late-visible rows inside the existing tail count instead of adding another cache. */
export function retainLatestConversationRows<
  Message extends { id: string; visibilityEpoch?: number; visibilityKind?: ConversationMessage["visibilityKind"] },
>(messages: readonly Message[], limit: number, pageRevision?: number): Message[] {
  if (messages.length <= limit) return [...messages];
  const tail = messages.slice(-limit);
  const epochs = tail.flatMap((message) => (message.visibilityEpoch === undefined ? [] : [message.visibilityEpoch]));
  const floor = epochs.length > 0 ? Math.min(...epochs) : undefined;
  const late = messages
    .slice(0, -limit)
    .filter(
      (message) =>
        message.visibilityEpoch !== undefined &&
        (isConversationVisibilityAfter(message, floor) ||
          (pageRevision !== undefined && message.visibilityEpoch > pageRevision)),
    )
    .sort((left, right) => (right.visibilityEpoch ?? 0) - (left.visibilityEpoch ?? 0));
  const ids = new Set([...late, ...tail.toReversed()].slice(0, limit).map((message) => message.id));
  return messages.filter((message) => ids.has(message.id));
}

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
 * A host-ordered fragment can share anchors with an older loaded generation. Keep its
 * order and attach retained gaps to the next surviving anchor. Never compare SQL keys
 * from different revisions: a new input can change the rank of retained replies.
 * Disjoint fragments keep the requested page direction.
 */
export function mergeConversationFragment<Message extends { id: string }>(
  loaded: readonly Message[],
  page: readonly Message[],
  merge: ConversationPageMerge,
): Message[] {
  if (merge === "replace") return [...page];
  const pageIds = new Set(page.map((message) => message.id));
  if (!loaded.some((message) => pageIds.has(message.id))) return mergeConversationPage(loaded, page, merge);
  const before = new Map<string, Message[]>();
  const tail: Message[] = [];
  let anchor: string | undefined;
  for (const message of loaded.toReversed()) {
    if (pageIds.has(message.id)) anchor = message.id;
    else if (anchor) {
      const bucket = before.get(anchor) ?? [];
      bucket.push(message);
      before.set(anchor, bucket);
    } else tail.push(message);
  }
  return [
    ...page.flatMap((message) => [...(before.get(message.id)?.toReversed() ?? []), message]),
    ...tail.toReversed(),
  ];
}

/**
 * The part of a refreshed snapshot a conversation may show without losing its
 * window.
 *
 * A snapshot with nothing older left to load is the whole conversation, so it
 * is shown whole. Otherwise it is the tail, and what the user is looking at
 * decides how much of it applies: a window loaded *around* a message keeps only
 * messages already on screen, because anything else in the snapshot belongs to
 * the far end of a gap. A window at the latest end keeps those, plus everything
 * after the last one it recognises. It also keeps rows created after the loaded
 * page's time boundary: turn ordering can put new input before an old answer,
 * even before every loaded row of a partial turn. The boundary is chronological,
 * independent of presentation order. Local visibility epochs also admit late-visible rows,
 * including equal-time and early queued input. Missing metadata keeps the legacy fallback.
 */
export function windowedSnapshotMessages<
  Message extends {
    id: string;
    createdAt?: string;
    visibilityEpoch?: number;
    visibilityKind?: ConversationMessage["visibilityKind"];
  },
>(
  loaded: readonly { id: string; createdAt?: string }[],
  snapshot: readonly Message[],
  window: {
    hasOlder: boolean;
    mode: "latest" | "around";
    oldestLoadedMessageTime?: number;
    rawMemberIds?: readonly string[];
    visibilityFloor?: number;
    pageRevision?: number;
    authoritative?: boolean;
  },
): Message[] {
  const loadedIds = new Set([...loaded.map((message) => message.id), ...(window.rawMemberIds ?? [])]);
  if (window.mode === "around") return snapshot.filter((message) => loadedIds.has(message.id));
  if (!window.hasOlder) return [...snapshot];
  const lastLoadedIndex = snapshot.reduce((last, message, index) => (loadedIds.has(message.id) ? index : last), -1);
  const oldestLoadedMessageTime = window.oldestLoadedMessageTime ?? oldestConversationMessageTime(loaded);
  return snapshot.filter((message, index) => {
    if (loadedIds.has(message.id) || (index > lastLoadedIndex && (lastLoadedIndex >= 0 || !window.authoritative)))
      return true;
    if (
      message.visibilityEpoch !== undefined &&
      (window.visibilityFloor !== undefined || window.pageRevision !== undefined)
    )
      return (
        isConversationVisibilityAfter(message, window.visibilityFloor) ||
        (window.pageRevision !== undefined && message.visibilityEpoch > window.pageRevision)
      );
    const createdAt = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    return oldestLoadedMessageTime !== undefined && Number.isFinite(createdAt) && createdAt > oldestLoadedMessageTime;
  });
}

/** The time boundary of a page before queued rows or commentary are projected. */
export function oldestConversationMessageTime(messages: readonly { createdAt?: string }[]): number | undefined {
  let oldest: number | undefined;
  for (const message of messages) {
    const createdAt = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
    if (Number.isFinite(createdAt) && (oldest === undefined || createdAt < oldest)) oldest = createdAt;
  }
  return oldest;
}
