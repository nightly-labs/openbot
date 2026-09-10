/*
 * How many messages arrived below the reader, away from the components that draw the count.
 *
 * A chat that is open and focused marks its messages read as they arrive, so the unread count a
 * conversation carries stays at zero however far the reader scrolled up. The pill above the
 * composer needs the other number: what came in since the reader left the bottom. That is a
 * function of the ids the timeline holds and whether the view still follows the newest message,
 * so it is here and it is tested as data.
 */

import type { AgentMessage } from "../../data";

export interface NewMessageTally {
  count: number;
  /** The last id the reader has accounted for. `undefined` before the first page arrives. */
  anchorId: string | undefined;
}

/** The reader has seen everything: no count, and the newest id becomes the anchor. */
export function anchorNewMessages(ids: readonly string[]): NewMessageTally {
  return { count: 0, anchorId: ids.at(-1) };
}

/**
 * The tally after a timeline change.
 *
 * `following` is whether the view still sticks to the newest message. It has to be read at the
 * moment the messages change, not after the frame that scrolls the view: by then every arrival
 * would look like one the reader watched.
 */
export function tallyNewMessages(
  previous: NewMessageTally,
  ids: readonly string[],
  following: boolean,
): NewMessageTally {
  if (following) return anchorNewMessages(ids);
  if (ids.length === 0) return { count: 0, anchorId: undefined };
  const latestId = ids[ids.length - 1];
  const anchorIndex = previous.anchorId === undefined ? -1 : ids.indexOf(previous.anchorId);
  /*
   * Nothing here says what arrived, so the count stands: the anchor is missing because a message
   * was deleted, because a page scrolled out of the window, or because this is the first page of
   * a thread the reader just opened, and none of those is news.
   */
  if (anchorIndex < 0) return { count: previous.count, anchorId: latestId };
  // A body that grows while it streams, and an older page that only prepends, both add nothing.
  return { count: previous.count + (ids.length - 1 - anchorIndex), anchorId: latestId };
}

/** Rows the reader would call a new message. */
export function countableTimelineMessage(message: AgentMessage): boolean {
  if (message.author === "you") return false;
  if (message.kind === "thinking") return false;
  // A routine notice or a lifecycle marker carries no message of its own.
  if (message.actionMarker && !message.exchange) return false;
  return true;
}
