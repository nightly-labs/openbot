import {
  type ClaudeCompactWindowSetting,
  DEFAULT_CLAUDE_COMPACT_WINDOW,
  isClaudeCompactWindowTokens,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { PreferenceStore } from "./preference-file";

/**
 * The size at which Claude Code compacts the chats of this computer's agents. A Claude process reads
 * it when it starts, so a change applies to the next process, not to a running turn. A missing file,
 * or a file without a valid size, reads as the default: Claude Code's own size.
 */
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

/** The size as Settings and a joined server's admin change it: a change tells `changed`. */
export type ClaudeCompactWindowControl = ReturnType<typeof claudeCompactWindowControl>;

/**
 * The size with its change event. `changed` sends the provider status event, so that every open
 * settings page, on this computer and on a joined client, reads the size again.
 */
export function claudeCompactWindowControl(store: ClaudeCompactWindowPreferenceStore, changed: () => void) {
  // One change at a time: two saves that read the same earlier size could both skip the event.
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
