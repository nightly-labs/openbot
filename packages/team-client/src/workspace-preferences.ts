import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { remoteHostFingerprint } from "./remote-directory";

export interface RemoteWorkspacePreferences {
  hidden: string[];
  pinned: string[];
  pinnedChannels?: string[];
  hiddenChannels?: string[];
}

export function createWorkspacePreferences(
  apiUrl: string,
  userId: string,
  storage: { get(key: string): string | null; set(key: string, value: string): void },
) {
  const scope = remoteHostFingerprint(JSON.stringify([new URL(apiUrl).origin, userId]));
  const key = (hostId: string) => `openbot.workspace.v1.${scope}.${remoteHostFingerprint(hostId)}`;
  // This store is the only writer of its keys, so a value read or written once stays current. Mobile
  // reads preferences for each delivered message, and each storage read is a synchronous Keychain call.
  const cache = new Map<string, RemoteWorkspacePreferences>();
  return {
    read(hostId: string): RemoteWorkspacePreferences {
      const cached = cache.get(hostId);
      if (cached) return cached;
      const stored = storage.get(key(hostId));
      const value = stored ? decodePreferences(JSON.parse(stored)) : { hidden: [], pinned: [] };
      cache.set(hostId, value);
      return value;
    },
    write(hostId: string, value: RemoteWorkspacePreferences): void {
      storage.set(key(hostId), JSON.stringify({ version: 1, ...value }));
      cache.set(hostId, value);
    },
  };
}

function decodePreferences(value: unknown): RemoteWorkspacePreferences {
  if (
    !isDynamicRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.hidden) ||
    !value.hidden.every(isString) ||
    !Array.isArray(value.pinned) ||
    !value.pinned.every(isString) ||
    (value.pinnedChannels !== undefined &&
      (!Array.isArray(value.pinnedChannels) || !value.pinnedChannels.every(isString))) ||
    (value.hiddenChannels !== undefined &&
      (!Array.isArray(value.hiddenChannels) || !value.hiddenChannels.every(isString)))
  ) {
    throw new Error(sourceText("error.remote.preferencesUnreadable"));
  }
  return {
    hidden: value.hidden,
    pinned: value.pinned,
    ...(value.pinnedChannels ? { pinnedChannels: value.pinnedChannels } : {}),
    ...(value.hiddenChannels ? { hiddenChannels: value.hiddenChannels } : {}),
  };
}
