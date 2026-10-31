import type { AnalyticsPreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The saved answer. `unsentAt` is the time (ms) of a choice of the user that the account does not
 * have yet, or null when the account has it or the answer is a default. `keepOff` marks an "off"
 * from before the account kept answers: an answer of "on" from the account does not replace it.
 */
export interface SavedAnalyticsPreference {
  enabled: boolean;
  unsentAt: number | null;
  keepOff: boolean;
}

/**
 * Reads the saved answer. Null: no file. A file that cannot be read as an answer reads as a kept
 * "off". A file without `keepOff` is from an app before the account kept answers, so its "off" is
 * kept.
 */
export const readSavedAnalyticsPreference = Effect.fn("readSavedAnalyticsPreference")((path: string) =>
  readPreferenceFile(path, (parsed): SavedAnalyticsPreference => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isBoolean(parsed.enabled)) {
      return { enabled: false, unsentAt: null, keepOff: true };
    }
    return {
      enabled: parsed.enabled,
      unsentAt: isNumber(parsed.unsentAt) ? parsed.unsentAt : null,
      keepOff: !parsed.enabled && parsed.keepOff !== false,
    };
  }).pipe(
    Effect.catch((failure) => {
      const error = failure.cause;
      if (isMissingFileError(error)) return Effect.succeed(null);
      if (error instanceof SyntaxError) return Effect.succeed({ enabled: false, unsentAt: null, keepOff: true });
      return Effect.fail(failure);
    }),
  ),
);

/**
 * Analytics is off until first run saves the user's choice before setup completes. A missing file
 * with a completed setup is a user from before the choice existed, and they keep analytics on, as
 * they had it.
 */
export const readAnalyticsPreference = Effect.fn("readAnalyticsPreference")((path: string, setupCompleted: boolean) =>
  readSavedAnalyticsPreference(path).pipe(
    Effect.map((saved): AnalyticsPreference => ({ enabled: saved?.enabled ?? setupCompleted })),
  ),
);

/**
 * Saves the default when no choice is saved: "on" for a user from before the choice existed (setup
 * already completed), else "off". Setup calls it before it completes, so a setup that skips the
 * first-run choice, such as joining a server, cannot read as a user from before the choice.
 */
export const saveAnalyticsDefault = Effect.fn("saveAnalyticsDefault")(function* (
  path: string,
  setupCompleted: boolean,
) {
  // A file that cannot be read or parsed is a saved choice that reads as "off", so it stays.
  const saved = yield* readPreferenceFile(path, () => true).pipe(
    Effect.catch((failure) => Effect.succeed(!isMissingFileError(failure.cause))),
  );
  if (!saved) yield* writeAnalyticsPreference(path, setupCompleted, false);
});

/**
 * `keepOff` is the mark of the answer before this write: a kept "off" stays kept until this computer
 * turns analytics on. `unsentAt` marks a choice of the user that the account has not received. An
 * older app reads only `version` and `enabled`, so the extra fields are safe after a downgrade.
 */
export function writeAnalyticsPreference(
  path: string,
  enabled: boolean,
  keepOff: boolean,
  unsentAt: number | null = null,
): Effect.Effect<AnalyticsPreference, PreferenceFileFailure> {
  return writePreferenceFile(path, {
    version: 1,
    enabled,
    keepOff: !enabled && keepOff,
    ...(unsentAt === null ? {} : { unsentAt }),
  }).pipe(Effect.as({ enabled }));
}
