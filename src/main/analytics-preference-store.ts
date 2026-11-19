import type { AnalyticsPreference } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export interface SavedAnalyticsPreference {
  enabled: boolean;
  unsentAt: number | null;
  keepOff: boolean;
}

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

export const readAnalyticsPreference = Effect.fn("readAnalyticsPreference")((path: string, setupCompleted: boolean) =>
  readSavedAnalyticsPreference(path).pipe(
    Effect.map((saved): AnalyticsPreference => ({ enabled: saved?.enabled ?? setupCompleted })),
  ),
);

export const saveAnalyticsDefault = Effect.fn("saveAnalyticsDefault")(function* (
  path: string,
  setupCompleted: boolean,
) {
  const saved = yield* readPreferenceFile(path, () => true).pipe(
    Effect.catch((failure) => Effect.succeed(!isMissingFileError(failure.cause))),
  );
  if (!saved) yield* writeAnalyticsPreference(path, setupCompleted, false);
});

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
