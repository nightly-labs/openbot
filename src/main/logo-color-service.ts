import { type AppLogoColorPreference, DEFAULT_APP_LOGO_COLOR, isAppLogoColor } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const DEFAULT_PREFERENCE: AppLogoColorPreference = { color: DEFAULT_APP_LOGO_COLOR };

/**
 * The saved logo color, or `null` when the user has not chosen one. A file that is missing,
 * unreadable or names a color this build does not ship reads as no choice: a lost color choice must
 * not stop the app from starting.
 */

const readLogoColorPreference = Effect.fn("LogoColorPreference.read")((path: string) =>
  readPreferenceFile(path, (parsed): AppLogoColorPreference | null => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppLogoColor(parsed.color)) return null;
    return { color: parsed.color };
  }).pipe(Effect.catch(() => Effect.succeed(null))),
);

const writeLogoColorPreference = Effect.fn("LogoColorPreference.write")(function* (
  path: string,
  preference: AppLogoColorPreference,
) {
  yield* writePreferenceFile(path, { version: 1, color: preference.color });
  return { color: preference.color };
});

/**
 * The logo color the app icon and every window show. The main process holds it because it sets the
 * Dock and window icons, and it tells each window about a change through `subscribe`.
 */
export class LogoColorService {
  readonly #path: string;
  readonly #listeners = new Set<(preference: AppLogoColorPreference) => void>();
  #preference: AppLogoColorPreference = { ...DEFAULT_PREFERENCE };
  #chosen = false;
  #writes = Semaphore.makeUnsafe(1);

  constructor(input: { path: string }) {
    this.#path = input.path;
  }

  get preference(): AppLogoColorPreference {
    return { ...this.#preference };
  }

  /**
   * Whether the user has chosen a color, the default one included. Without a choice the macOS Dock
   * keeps the bundle icon, which follows the system dark and tinted icon styles.
   */
  get chosen(): boolean {
    return this.#chosen;
  }

  /** Read the saved preference. Called once at startup, before the first window loads. */
  load(): Effect.Effect<AppLogoColorPreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const saved = yield* readLogoColorPreference(this.#path);
      this.#chosen = saved !== null;
      this.#preference = saved ?? { ...DEFAULT_PREFERENCE };
      return this.preference;
    });
  }

  /**
   * Serialized, as `LanguageService.set` is: each write renames its own temporary file into place,
   * so two quick choices could otherwise save the color the user moved away from.
   */
  set(preference: AppLogoColorPreference): Effect.Effect<AppLogoColorPreference, PreferenceFileFailure> {
    return this.#writes.withPermit(this.#write(preference));
  }

  #write(preference: AppLogoColorPreference): Effect.Effect<AppLogoColorPreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* writeLogoColorPreference(this.#path, preference);
      this.#chosen = true;
      for (const listener of this.#listeners) listener(this.preference);
      return this.preference;
    }).pipe(Effect.uninterruptible);
  }

  subscribe(listener: (preference: AppLogoColorPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
