import { type AppLanguagePreference, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";

const DEFAULT_PREFERENCE: AppLanguagePreference = { language: DEFAULT_APP_LANGUAGE };

export const readLanguagePreference = Effect.fn("readLanguagePreference")((path: string) =>
  readPreferenceFile(path, (parsed): AppLanguagePreference => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppLanguage(parsed.language)) {
      return { ...DEFAULT_PREFERENCE };
    }
    return { language: parsed.language };
  }).pipe(
    Effect.catch(() => {
      return Effect.succeed({ ...DEFAULT_PREFERENCE });
    }),
  ),
);

export const writeLanguagePreference = Effect.fn("LanguagePreference.write")(function* (
  path: string,
  preference: AppLanguagePreference,
) {
  yield* writePreferenceFile(path, { version: 1, language: preference.language });
  return { language: preference.language };
});
