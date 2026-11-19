import { type AppLanguagePreference, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/ipc";
import { type AppTranslate, resolveLocale, type TranslatedLocale, translateFor } from "@openbot/i18n";
import { Effect, Semaphore } from "effect";
import { readLanguagePreference, writeLanguagePreference } from "./language-preference-store";
import type { PreferenceFileFailure } from "./preference-file";

export class LanguageService {
  readonly #path: string;
  readonly #systemLocale: string;
  readonly #listeners = new Set<(preference: AppLanguagePreference) => void>();
  #preference: AppLanguagePreference = { language: DEFAULT_APP_LANGUAGE };
  #translate: AppTranslate;
  #writes = Semaphore.makeUnsafe(1);

  constructor(input: { path: string; systemLocale: string }) {
    this.#path = input.path;
    this.#systemLocale = input.systemLocale;
    this.#translate = translateFor(this.locale);
  }

  readonly translate: AppTranslate = (key, ...params) => this.#translate(key, ...params);

  get preference(): AppLanguagePreference {
    return { ...this.#preference };
  }

  get locale(): TranslatedLocale {
    return resolveLocale(this.#preference.language, this.#systemLocale);
  }

  load(): Effect.Effect<AppLanguagePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#apply(yield* readLanguagePreference(this.#path));
      return this.preference;
    });
  }

  set(preference: AppLanguagePreference): Effect.Effect<AppLanguagePreference, PreferenceFileFailure> {
    return this.#writes.withPermit(this.#write(preference));
  }

  #write(preference: AppLanguagePreference): Effect.Effect<AppLanguagePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const saved = yield* writeLanguagePreference(this.#path, preference);
      this.#apply(saved);
      for (const listener of this.#listeners) listener(this.preference);
      return this.preference;
    }).pipe(Effect.uninterruptible);
  }

  subscribe(listener: (preference: AppLanguagePreference) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #apply(preference: AppLanguagePreference): void {
    this.#preference = preference;
    this.#translate = translateFor(this.locale);
  }
}
