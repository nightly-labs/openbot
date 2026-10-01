import { readFile } from "node:fs/promises";
import { type AppLogoColorPreference, DEFAULT_APP_LOGO_COLOR, isAppLogoColor } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";

const DEFAULT_PREFERENCE: AppLogoColorPreference = { color: DEFAULT_APP_LOGO_COLOR };

/**
 * The saved logo color, or the default. A file that is missing, unreadable or names a color this
 * build does not ship reads as the default: a lost color choice must not stop the app from starting.
 */
export async function readLogoColorPreference(path: string): Promise<AppLogoColorPreference> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppLogoColor(parsed.color)) {
      return { ...DEFAULT_PREFERENCE };
    }
    return { color: parsed.color };
  } catch {
    return { ...DEFAULT_PREFERENCE };
  }
}

export async function writeLogoColorPreference(
  path: string,
  preference: AppLogoColorPreference,
): Promise<AppLogoColorPreference> {
  await writeJsonFileAtomically(path, { version: 1, color: preference.color });
  return { color: preference.color };
}

/**
 * The logo color the app icon and every window show. The main process holds it because it sets the
 * Dock and window icons, and it tells each window about a change through `subscribe`.
 */
export class LogoColorService {
  readonly #path: string;
  readonly #listeners = new Set<(preference: AppLogoColorPreference) => void>();
  #preference: AppLogoColorPreference = { ...DEFAULT_PREFERENCE };
  #pending: Promise<unknown> = Promise.resolve();

  constructor(input: { path: string }) {
    this.#path = input.path;
  }

  get preference(): AppLogoColorPreference {
    return { ...this.#preference };
  }

  /** Read the saved preference. Called once at startup, before the first window loads. */
  async load(): Promise<AppLogoColorPreference> {
    this.#preference = await readLogoColorPreference(this.#path);
    return this.preference;
  }

  /**
   * Serialized, as `LanguageService.set` is: each write renames its own temporary file into place,
   * so two quick choices could otherwise save the color the user moved away from.
   */
  async set(preference: AppLogoColorPreference): Promise<AppLogoColorPreference> {
    const applied = this.#pending.then(
      () => this.#write(preference),
      () => this.#write(preference),
    );
    this.#pending = applied.catch(() => undefined);
    return applied;
  }

  async #write(preference: AppLogoColorPreference): Promise<AppLogoColorPreference> {
    this.#preference = await writeLogoColorPreference(this.#path, preference);
    for (const listener of this.#listeners) listener(this.preference);
    return this.preference;
  }

  subscribe(listener: (preference: AppLogoColorPreference) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
