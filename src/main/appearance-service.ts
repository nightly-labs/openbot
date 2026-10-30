import {
  type AppAppearancePreference,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  isAppAppearance,
  type SetAppAppearancePreferenceInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const DEFAULT_PREFERENCE: AppAppearancePreference = {
  appearance: DEFAULT_APP_APPEARANCE,
  transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
};

/**
 * The saved appearance, or the default. A file that is missing, unreadable or names an appearance
 * this build does not offer reads as the default: a lost choice must not stop the app from starting.
 * A file with no `transparentWindow` reads as an opaque window.
 */
const readAppearancePreference = Effect.fn("AppearancePreference.read")((path: string) =>
  readPreferenceFile(path, (parsed): AppAppearancePreference => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppAppearance(parsed.appearance))
      return { ...DEFAULT_PREFERENCE };
    return { appearance: parsed.appearance, transparentWindow: parsed.transparentWindow === true };
  }).pipe(Effect.catch(() => Effect.succeed({ ...DEFAULT_PREFERENCE }))),
);

const writeAppearancePreference = Effect.fn("AppearancePreference.write")(function* (
  path: string,
  preference: AppAppearancePreference,
) {
  yield* writePreferenceFile(path, { version: 1, ...preference });
  return { ...preference };
});

/**
 * The light, dark or system appearance of OpenBot's own windows. Main holds it so every window
 * reads one choice, and it tells each window about a change through `subscribe`.
 */
export class AppearanceService {
  readonly #path: string;
  readonly #supportsTransparentWindow: boolean;
  readonly #listeners = new Set<(preference: AppAppearancePreference) => void>();
  #preference: AppAppearancePreference = { ...DEFAULT_PREFERENCE };
  #writes = Semaphore.makeUnsafe(1);

  /** `supportsTransparentWindow` is false where the window cannot blur the desktop: there it reads as off. */
  constructor(input: { path: string; supportsTransparentWindow: boolean }) {
    this.#path = input.path;
    this.#supportsTransparentWindow = input.supportsTransparentWindow;
  }

  get preference(): AppAppearancePreference {
    return {
      ...this.#preference,
      transparentWindow: this.#supportsTransparentWindow && this.#preference.transparentWindow,
    };
  }

  /** Read the saved preference. Called once at startup, before the first window loads. */
  load(): Effect.Effect<AppAppearancePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* readAppearancePreference(this.#path);
      return this.preference;
    });
  }

  /**
   * Serialized, as `LogoColorService.set` is, so two quick choices save the newer one. A field the
   * input leaves out keeps its saved value.
   */
  set(change: SetAppAppearancePreferenceInput): Effect.Effect<AppAppearancePreference, PreferenceFileFailure> {
    return this.#writes.withPermit(this.#write(change));
  }

  #write(change: SetAppAppearancePreferenceInput): Effect.Effect<AppAppearancePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* writeAppearancePreference(this.#path, { ...this.#preference, ...change });
      for (const listener of this.#listeners) listener(this.preference);
      return this.preference;
    }).pipe(Effect.uninterruptible);
  }

  subscribe(listener: (preference: AppAppearancePreference) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
