const CHAT_GROUPING_WINDOW_MS = 5 * 60_000;

export const CHAT_TIME_GAP_MS = 60 * 60 * 1000;

export interface SenderRunRow {
  author: string;
  createdAt?: string;
  turnId?: string;
}

function withinGroupingWindow(previousIso: string | undefined, currentIso: string | undefined): boolean {
  if (previousIso === undefined || currentIso === undefined) return false;
  const previous = new Date(previousIso).getTime();
  const current = new Date(currentIso).getTime();
  if (Number.isNaN(previous) || Number.isNaN(current)) return false;
  return current - previous <= CHAT_GROUPING_WINDOW_MS;
}

export function continuesSenderRun(
  previous: SenderRunRow | undefined,
  current: SenderRunRow,
  options: { previousDrawsTime: boolean; startsDay: boolean },
): boolean {
  if (previous === undefined || !options.previousDrawsTime || options.startsDay) return false;
  if (previous.author !== current.author) return false;
  if (previous.turnId !== undefined && previous.turnId === current.turnId) return true;
  return withinGroupingWindow(previous.createdAt, current.createdAt);
}
