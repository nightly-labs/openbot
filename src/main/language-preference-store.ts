import { type AppLanguagePreference, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";

const DEFAULT_PREFERENCE: AppLanguagePreference = { language: DEFAULT_APP_LANGUAGE };

/**
 * The saved language, or the system default.
 *
 * A file that is missing, unreadable or names a language this build no longer ships reads as the
 * system default. Unlike the analytics preference there is no safe-by-default direction to fall
 * back to: an unreadable file must not leave the app with no language at all.
 *
 * Every read error is absorbed, not only a missing file. `createApplicationServices` awaits this
 * before the first window opens and has no recovery, so a rethrown `EACCES` - a preference file
 * left unreadable by a restore from backup, say - would show the startup error box and quit. Losing
 * a language choice is a small fault; being unable to open the app at all is not.
 */

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
