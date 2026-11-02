import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { PreferenceStore } from "./preference-file";

/**
 * The app version that last started the provider CLI update checks. A different version, or none,
 * is an app upgrade: the first check then updates the managed provider CLIs with no offer (#3164).
 */
export type ProviderCliAppVersionStore = PreferenceStore<ProviderCliAppVersion>;

interface ProviderCliAppVersion {
  appVersion: string | null;
}

export function createProviderCliAppVersionStore(path: string): ProviderCliAppVersionStore {
  return new PreferenceStore<ProviderCliAppVersion>({
    path,
    defaultValue: { appVersion: null },
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isString(parsed.appVersion)
        ? { appVersion: parsed.appVersion }
        : null,
  });
}
