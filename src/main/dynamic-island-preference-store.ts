import {
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  DYNAMIC_ISLAND_SIZE_LIMITS,
  type DynamicIslandPreference,
  isDynamicIslandSizePercent,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const readDynamicIslandPreference = Effect.fn("readDynamicIslandPreference")((path: string) =>
  readPreferenceFile(path, (parsed): DynamicIslandPreference => {
    if (!isDynamicRecord(parsed) || !isBoolean(parsed.enabled)) {
      return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
    }
    if (parsed.version === 1) return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE, enabled: parsed.enabled };
    if (parsed.version === 2 && isBoolean(parsed.hapticsEnabled)) {
      return {
        ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
        enabled: parsed.enabled,
        hapticsEnabled: parsed.hapticsEnabled,
      };
    }
    if (
      parsed.version !== 3 ||
      !isBoolean(parsed.hapticsEnabled) ||
      !isBoolean(parsed.idleVisible) ||
      !isBoolean(parsed.additionalDisplaysEnabled)
    ) {
      return { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
    }
    return {
      enabled: parsed.enabled,
      hapticsEnabled: parsed.hapticsEnabled,
      idleVisible: parsed.idleVisible,
      additionalDisplaysEnabled: parsed.additionalDisplaysEnabled,
      // The size is optional so that 0.18.0 and earlier, which refuse any version but 3, still read
      // this file. A missing or out-of-range size resets only the size, so a bad value cannot make
      // the island too small to find and does not discard the switches beside it.
      widthPercent: isDynamicIslandSizePercent(parsed.widthPercent, DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent)
        ? parsed.widthPercent
        : DEFAULT_DYNAMIC_ISLAND_PREFERENCE.widthPercent,
      heightPercent: isDynamicIslandSizePercent(parsed.heightPercent, DYNAMIC_ISLAND_SIZE_LIMITS.heightPercent)
        ? parsed.heightPercent
        : DEFAULT_DYNAMIC_ISLAND_PREFERENCE.heightPercent,
    };
  }).pipe(
    Effect.catch((failure) => {
      const error = failure.cause;
      if (isMissingFileError(error) || error instanceof SyntaxError)
        return Effect.succeed({ ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE });
      return Effect.fail(failure);
    }),
  ),
);

export function writeDynamicIslandPreference(
  path: string,
  preference: DynamicIslandPreference,
): Effect.Effect<DynamicIslandPreference, PreferenceFileFailure> {
  return Effect.gen(function* () {
    yield* writePreferenceFile(path, { version: 3, ...preference });
    return { ...preference };
  });
}
