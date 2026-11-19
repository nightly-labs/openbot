import { type AppLogoColorPreference, DEFAULT_APP_LOGO_COLOR, isAppLogoColor } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Semaphore } from "effect";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const DEFAULT_PREFERENCE: AppLogoColorPreference = { color: DEFAULT_APP_LOGO_COLOR };

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

  get chosen(): boolean {
    return this.#chosen;
  }

  load(): Effect.Effect<AppLogoColorPreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const saved = yield* readLogoColorPreference(this.#path);
      this.#chosen = saved !== null;
      this.#preference = saved ?? { ...DEFAULT_PREFERENCE };
      return this.preference;
    });
  }

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
