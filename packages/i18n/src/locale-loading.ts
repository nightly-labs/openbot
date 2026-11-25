import type { TranslatedLocale } from "./locale";

export function localeLoaded(_locale: TranslatedLocale): boolean {
  return true;
}

export function loadLocale(_locale: TranslatedLocale): Promise<void> {
  return Promise.resolve();
}
