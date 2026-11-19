import type { ChannelMessage } from "@openbot/contracts/ipc";

export interface ChannelPageMerge {
  messages: ChannelMessage[];
  takeFetchedCursor: boolean;
}

export function mergeChannelPage(loaded: ChannelMessage[], fetched: ChannelMessage[]): ChannelPageMerge {
  const first = fetched[0]?.sequence ?? 0;
  const older = loaded.filter((message) => message.sequence < first);
  if (!older.length) return { messages: fetched, takeFetchedCursor: true };
  const joins = (older.at(-1)?.sequence ?? 0) + 1 >= first;
  return joins
    ? { messages: [...older, ...fetched], takeFetchedCursor: false }
    : { messages: fetched, takeFetchedCursor: true };
}
