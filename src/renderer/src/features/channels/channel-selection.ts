import { z } from "zod";

export const CHANNEL_SELECTION_STORAGE_KEY = "openbot:selected-channel:v1";

export type ChannelSelectionsByAccount = Record<string, Record<string, string>>;

type ChannelSelectionStorage = Pick<Storage, "getItem" | "setItem">;

const channelSelectionSchema = z.record(
  z.string().trim().min(1),
  z.record(z.string().trim().min(1), z.string().trim().min(1).nullable().catch(null)).catch({}),
);

export function readChannelSelection(storage?: ChannelSelectionStorage): ChannelSelectionsByAccount {
  try {
    const target = storage ?? window.localStorage;
    const parsed = channelSelectionSchema.safeParse(JSON.parse(target.getItem(CHANNEL_SELECTION_STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).flatMap(([accountId, selections]) => {
        const valid = Object.fromEntries(
          Object.entries(selections).flatMap(([serverId, channelId]) => (channelId ? [[serverId, channelId]] : [])),
        );
        return Object.keys(valid).length > 0 ? [[accountId, valid]] : [];
      }),
    );
  } catch {
    return {};
  }
}

export function writeChannelSelection(
  accountId: string,
  serverId: string,
  channelId: string | null,
  storage?: ChannelSelectionStorage,
): void {
  try {
    const target = storage ?? window.localStorage;
    const selections = readChannelSelection(target);
    if (channelId) {
      selections[accountId] = { ...(selections[accountId] ?? {}), [serverId]: channelId };
    } else if (selections[accountId]) {
      const accountSelections = { ...selections[accountId] };
      delete accountSelections[serverId];
      if (Object.keys(accountSelections).length > 0) selections[accountId] = accountSelections;
      else delete selections[accountId];
    }
    target.setItem(CHANNEL_SELECTION_STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // A local display preference must not block channel navigation.
  }
}
