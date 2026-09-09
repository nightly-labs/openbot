/*
 * What a refresh keeps of the transcript already on screen.
 *
 * `readChannel` returns the newest window of a channel, not the whole history, so a refresh has to
 * decide what to do with the messages the reader has already loaded. It is a decision about
 * sequence numbers alone, so it is here and it is tested as data.
 */

import type { ChannelMessage } from "@openbot/contracts/ipc";

export interface ChannelPageMerge {
  /** The transcript after the refresh, oldest first. */
  messages: ChannelMessage[];
  /** True when the merged transcript takes the cursor of the fetched window. */
  takeFetchedCursor: boolean;
}

/**
 * Join the fetched window to the loaded transcript, or replace the transcript with it.
 *
 * The two join when the last loaded message sits right below the first fetched one. Sequences are
 * dense, so anything else means messages arrived between the two blocks while the reader was away.
 * Keeping the loaded block then hides them for good: the loaded cursor names a sequence below that
 * block, so "load earlier" steps over the gap rather than into it. The fetched window replaces the
 * transcript in that case, and its own cursor walks back through the gap.
 */
export function mergeChannelPage(loaded: ChannelMessage[], fetched: ChannelMessage[]): ChannelPageMerge {
  const first = fetched[0]?.sequence ?? 0;
  const older = loaded.filter((message) => message.sequence < first);
  if (!older.length) return { messages: fetched, takeFetchedCursor: true };
  const joins = (older.at(-1)?.sequence ?? 0) + 1 >= first;
  return joins
    ? { messages: [...older, ...fetched], takeFetchedCursor: false }
    : { messages: fetched, takeFetchedCursor: true };
}
