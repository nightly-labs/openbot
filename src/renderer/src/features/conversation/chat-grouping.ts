/*
 * The rule that decides when a run of messages by one sender reads as one block. Both the agent
 * chat and the channel chat use it, so the rule lives here, away from either timeline, beside the
 * day separator rule it works with.
 */

/**
 * How long a run of messages by one sender stays one block. Beyond it the time returns, because a
 * reply an hour later is a new turn of the conversation, not a continuation.
 */
export const CHAT_GROUPING_WINDOW_MS = 5 * 60_000;

/** A row of a transcript, as the two fields the grouping rule reads. */
export interface SenderRunRow {
  /** Who wrote the row. The agent chat carries "you" or "agent"; a channel carries an author id. */
  author: string;
  createdAt?: string;
}

/** Do two messages fall close enough together to stay one block? An unreadable time says no. */
export function withinGroupingWindow(previousIso: string | undefined, currentIso: string | undefined): boolean {
  if (previousIso === undefined || currentIso === undefined) return false;
  const previous = new Date(previousIso).getTime();
  const current = new Date(currentIso).getTime();
  if (Number.isNaN(previous) || Number.isNaN(current)) return false;
  return current - previous <= CHAT_GROUPING_WINDOW_MS;
}

/**
 * Does this row continue the run above it, and so draw no time of its own?
 *
 * `previous` is absent for the first row of the transcript, which always opens a run.
 * `previousDrawsTime` is false for a row that carries no time the reader can see, such as an
 * activity marker: the run it interrupts cannot continue under it. `startsDay` is true when a day
 * separator stands above the row, which opens a run the same way a new sender does.
 */
export function continuesSenderRun(
  previous: SenderRunRow | undefined,
  current: SenderRunRow,
  options: { previousDrawsTime: boolean; startsDay: boolean },
): boolean {
  if (previous === undefined || !options.previousDrawsTime || options.startsDay) return false;
  if (previous.author !== current.author) return false;
  return withinGroupingWindow(previous.createdAt, current.createdAt);
}
