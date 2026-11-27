import type { UpdatePreference, UpdatePreferenceChange } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";

export const UPDATE_PREFERENCE_FILE = "openbot-update-preference-v1.json";

const DEFAULT_PREFERENCE: UpdatePreference = { autoDownload: true, allowRemoteUpdates: true, autoInstall: false };

export const readUpdatePreference = Effect.fn("readUpdatePreference")((path: string) =>
  readPreferenceFile(path, (parsed): UpdatePreference => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isBoolean(parsed.autoDownload)) {
      return { ...DEFAULT_PREFERENCE };
    }
    return {
      autoDownload: parsed.autoDownload,
      allowRemoteUpdates: isBoolean(parsed.allowRemoteUpdates)
        ? parsed.allowRemoteUpdates
        : DEFAULT_PREFERENCE.allowRemoteUpdates,
      autoInstall: isBoolean(parsed.autoInstall) ? parsed.autoInstall : DEFAULT_PREFERENCE.autoInstall,
    };
  }).pipe(
    Effect.catch((failure) => {
      const error = failure.cause;
      if (isMissingFileError(error) || error instanceof SyntaxError) return Effect.succeed({ ...DEFAULT_PREFERENCE });
      return Effect.fail(failure);
    }),
  ),
);

const writeLock = Semaphore.makeUnsafe(1);

export const writeUpdatePreference = Effect.fn("writeUpdatePreference")(
  (path: string, change: UpdatePreferenceChange) =>
    writeLock
      .withPermit(
        Effect.gen(function* () {
          const preference = { ...(yield* readUpdatePreference(path)), ...change };
          yield* writePreferenceFile(path, { version: 1, ...preference });
          return preference;
        }),
      )
      .pipe(Effect.uninterruptible),
);
