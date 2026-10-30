import { DEFAULT_REMOTE_SESSION_REUSE_PREFERENCE, type RemoteSessionReusePreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { PreferenceStore } from "./preference-file";

/**
 * Whether the desktop keeps its remote server sessions between runs. Main reads it at start and when
 * the app quits. A file without the switch reads as the default, on.
 */
export type RemoteSessionReusePreferenceStore = PreferenceStore<RemoteSessionReusePreference>;

export function createRemoteSessionReusePreferenceStore(path: string): RemoteSessionReusePreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_REMOTE_SESSION_REUSE_PREFERENCE,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.keepBetweenRuns)
        ? { keepBetweenRuns: parsed.keepBetweenRuns }
        : null,
  });
}
