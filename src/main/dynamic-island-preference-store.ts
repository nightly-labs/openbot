import {
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  DYNAMIC_ISLAND_SIZE_LIMITS,
  type DynamicIslandPreference,
  isDynamicIslandServerVisibility,
  isDynamicIslandSizePercent,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

export const readDynamicIslandPreference = Effect.fn("readDynamicIslandPreference")(
  (path: string, defaults: DynamicIslandPreference = DEFAULT_DYNAMIC_ISLAND_PREFERENCE) =>
    readPreferenceFile(path, (parsed): DynamicIslandPreference => {
      if (!isDynamicRecord(parsed) || !isBoolean(parsed.enabled)) {
        return { ...defaults };
      }
      if (parsed.version === 1) return { ...defaults, enabled: parsed.enabled };
      if (parsed.version === 2 && isBoolean(parsed.hapticsEnabled)) {
        return {
          ...defaults,
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
        return { ...defaults };
      }
      return {
        enabled: parsed.enabled,
        hapticsEnabled: parsed.hapticsEnabled,
        idleVisible: parsed.idleVisible,
        additionalDisplaysEnabled: parsed.additionalDisplaysEnabled,
        widthPercent: isDynamicIslandSizePercent(parsed.widthPercent, DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent)
          ? parsed.widthPercent
          : defaults.widthPercent,
        heightPercent: isDynamicIslandSizePercent(parsed.heightPercent, DYNAMIC_ISLAND_SIZE_LIMITS.heightPercent)
          ? parsed.heightPercent
          : defaults.heightPercent,
        ...(isDynamicIslandServerVisibility(parsed.serverVisibility) && isBoolean(parsed.newServersVisible)
          ? { serverVisibility: { ...parsed.serverVisibility }, newServersVisible: parsed.newServersVisible }
          : { serverVisibility: {}, newServersVisible: defaults.newServersVisible }),
      };
    }).pipe(
      Effect.catch((failure) => {
        const error = failure.cause;
        if (isMissingFileError(error) || error instanceof SyntaxError) return Effect.succeed({ ...defaults });
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
