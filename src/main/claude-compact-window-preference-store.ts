import {
  type ClaudeCompactWindowSetting,
  DEFAULT_CLAUDE_COMPACT_WINDOW,
  isClaudeCompactWindowTokens,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { PreferenceStore } from "./preference-file";

export type ClaudeCompactWindowPreferenceStore = PreferenceStore<ClaudeCompactWindowSetting>;

export function createClaudeCompactWindowPreferenceStore(path: string): ClaudeCompactWindowPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_CLAUDE_COMPACT_WINDOW,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isClaudeCompactWindowTokens(parsed.tokens)
        ? { tokens: parsed.tokens }
        : null,
  });
}

export type ClaudeCompactWindowControl = ReturnType<typeof claudeCompactWindowControl>;

export function claudeCompactWindowControl(store: ClaudeCompactWindowPreferenceStore, changed: () => void) {
  const changes = Semaphore.makeUnsafe(1);
  return {
    get: () => store.get(),
    set: Effect.fn("ClaudeCompactWindow.set")(function* (tokens: number | null) {
      return yield* changes.withPermit(
        Effect.gen(function* () {
          const before = store.get().tokens;
          const next = yield* store.set({ tokens });
          if (before !== tokens) changed();
          return next;
        }),
      );
    }),
  };
}
