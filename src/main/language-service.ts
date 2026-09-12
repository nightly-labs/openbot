import { type AppLanguagePreference, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/ipc";
import { type AppTranslate, resolveLocale, type TranslatedLocale, translateFor } from "@openbot/i18n";
import { readLanguagePreference, writeLanguagePreference } from "./language-preference-store";

/**
 * The language every native surface draws in: the application menu, desktop notifications, the file
 * pickers and the one error box shown when the app cannot start.
 *
 * The main process holds the setting because it is the only part of the app that survives a window
 * being closed, and because a notification can fire while no renderer exists to translate it. The
 * renderers keep their own translator over the same preference and learn about a change from the
 * broadcast `index.ts` wires to `subscribe`.
 *
 * This module takes the system locale as a value rather than calling `app.getLocale()`, so it can
 * be tested without Electron.
 */
export class LanguageService {
  readonly #path: string;
  readonly #systemLocale: string;
  readonly #listeners = new Set<(preference: AppLanguagePreference) => void>();
  #preference: AppLanguagePreference = { language: DEFAULT_APP_LANGUAGE };
  #translate: AppTranslate;

  constructor(input: { path: string; systemLocale: string }) {
    this.#path = input.path;
    this.#systemLocale = input.systemLocale;
    this.#translate = translateFor(this.locale);
  }

  /**
   * One indirection so a caller can hold `translate` for the life of the process and still read the
   * current language. A module that captured the translator itself would keep drawing the language
   * that was set when it started.
   */
  readonly translate: AppTranslate = (key, ...params) => this.#translate(key, ...params);

  get preference(): AppLanguagePreference {
    return { ...this.#preference };
  }

  get locale(): TranslatedLocale {
    return resolveLocale(this.#preference.language, this.#systemLocale);
  }

  /** Read the saved preference. Called once at startup, before the first window opens. */
  async load(): Promise<AppLanguagePreference> {
    this.#apply(await readLanguagePreference(this.#path));
    return this.preference;
  }

  async set(preference: AppLanguagePreference): Promise<AppLanguagePreference> {
    const saved = await writeLanguagePreference(this.#path, preference);
    this.#apply(saved);
    for (const listener of this.#listeners) listener(this.preference);
    return this.preference;
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
