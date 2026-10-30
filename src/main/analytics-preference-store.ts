import type { AnalyticsPreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/** The saved answer, and whether it is a choice of the user that the account does not have yet. */
export interface SavedAnalyticsPreference {
  enabled: boolean;
  accountPending: boolean;
}

/** Reads the saved answer. Null: no file. A file that cannot be read as an answer reads as "off". */
export const readSavedAnalyticsPreference = Effect.fn("readSavedAnalyticsPreference")((path: string) =>
  readPreferenceFile(path, (parsed): SavedAnalyticsPreference => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isBoolean(parsed.enabled)) {
      return { enabled: false, accountPending: false };
    }
    return { enabled: parsed.enabled, accountPending: parsed.accountPending === true };
  }).pipe(
    Effect.catch((failure) => {
      const error = failure.cause;
      if (isMissingFileError(error)) return Effect.succeed(null);
      if (error instanceof SyntaxError) return Effect.succeed({ enabled: false, accountPending: false });
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
 * Saves "off" when no choice is saved. Setup calls it before it completes, so a setup that skips
 * the first-run choice, such as joining a server, cannot read as a user from before the choice.
 */
export const saveAnalyticsDefault = Effect.fn("saveAnalyticsDefault")(function* (path: string) {
  // A file that cannot be read or parsed is a saved choice that reads as "off", so it stays.
  const saved = yield* readPreferenceFile(path, () => true).pipe(
    Effect.catch((failure) => Effect.succeed(!isMissingFileError(failure.cause))),
  );
  if (!saved) yield* writeAnalyticsPreference(path, false);
});

/**
 * `accountPending` marks a choice of the user that the account has not received. An older app
 * reads only `version` and `enabled`, so the extra field is safe after a downgrade.
 */
export function writeAnalyticsPreference(
  path: string,
  enabled: boolean,
  accountPending = false,
): Effect.Effect<AnalyticsPreference, PreferenceFileFailure> {
  return Effect.gen(function* () {
    const preference = { enabled };
    yield* writePreferenceFile(path, { version: 1, enabled, ...(accountPending ? { accountPending: true } : {}) });
    return preference;
  });
}
