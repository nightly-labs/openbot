import { type ClaudeUserSetupSetting, DEFAULT_CLAUDE_USER_SETUP } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { PreferenceStore } from "./preference-file";

export type ClaudeUserSetupPreferenceStore = PreferenceStore<ClaudeUserSetupSetting>;

export function createClaudeUserSetupPreferenceStore(path: string): ClaudeUserSetupPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_CLAUDE_USER_SETUP,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.enabled) ? { enabled: parsed.enabled } : null,
  });
}

export type ClaudeUserSetupControl = ReturnType<typeof claudeUserSetupControl>;

export function claudeUserSetupControl(store: ClaudeUserSetupPreferenceStore, changed: () => void) {
  return {
    get: () => store.get(),
    set: Effect.fn("ClaudeUserSetup.set")(function* (enabled: boolean) {
      const before = store.get().enabled;
      const next = yield* store.set({ enabled });
      if (before !== enabled) changed();
      return next;
    }),
  };
}
