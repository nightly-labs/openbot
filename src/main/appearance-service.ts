import {
  type AppAppearancePreference,
  type AppThemePalette,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  isAppAppearance,
  isAppFontFamily,
  isAppThemePaletteId,
  isChatBackgroundColor,
  type SetAppAppearancePreferenceInput,
  sameThemePalettes,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Exit, Result, Scope, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";
import { readThemePalettes, watchThemePalettes } from "./theme-palette-files";

type StoredAppearancePreference = Pick<
  AppAppearancePreference,
  | "appearance"
  | "transparentWindow"
  | "palette"
  | "chatBackgroundLight"
  | "chatBackgroundDark"
  | "interfaceFont"
  | "codeFont"
> & {
  themeChosen: boolean;
};

const DEFAULT_PREFERENCE: StoredAppearancePreference = {
  appearance: DEFAULT_APP_APPEARANCE,
  transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
  palette: null,
  chatBackgroundLight: null,
  chatBackgroundDark: null,
  interfaceFont: null,
  codeFont: null,
  themeChosen: false,
};

const readAppearancePreference = Effect.fn("AppearancePreference.read")(function* (path: string) {
  const read = yield* Effect.result(
    readPreferenceFile(path, (parsed): StoredAppearancePreference => {
      if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppAppearance(parsed.appearance))
        return { ...DEFAULT_PREFERENCE, themeChosen: true };
      return {
        appearance: parsed.appearance,
        transparentWindow: parsed.transparentWindow === true,
        palette: isAppThemePaletteId(parsed.palette) ? parsed.palette : null,
        chatBackgroundLight: isChatBackgroundColor(parsed.chatBackgroundLight) ? parsed.chatBackgroundLight : null,
        chatBackgroundDark: isChatBackgroundColor(parsed.chatBackgroundDark) ? parsed.chatBackgroundDark : null,
        interfaceFont: isAppFontFamily(parsed.interfaceFont) ? parsed.interfaceFont : null,
        codeFont: isAppFontFamily(parsed.codeFont) ? parsed.codeFont : null,
        themeChosen: parsed.themeChosen !== false,
      };
    }),
  );
  if (Result.isSuccess(read)) return read.success;
  return isMissingFileError(read.failure.cause)
    ? { ...DEFAULT_PREFERENCE }
    : { ...DEFAULT_PREFERENCE, themeChosen: true };
});

export const readSavedTransparentWindow = Effect.fn("AppearancePreference.readTransparentWindow")(function* (
  path: string,
) {
  return (yield* readAppearancePreference(path)).transparentWindow;
});

const writeAppearancePreference = Effect.fn("AppearancePreference.write")(function* (
  path: string,
  preference: StoredAppearancePreference,
) {
  yield* writePreferenceFile(path, { version: 1, ...preference });
  return { ...preference };
});

export class AppearanceService {
  readonly #path: string;
  readonly #paletteDirectory: string;
  readonly #supportsTransparentWindow: boolean;
  readonly #listeners = new Set<(preference: AppAppearancePreference) => void>();
  #preference: StoredAppearancePreference = { ...DEFAULT_PREFERENCE };
  #palettes: AppThemePalette[] = [];
  #writes = Semaphore.makeUnsafe(1);
  #paletteReads = Semaphore.makeUnsafe(1);
  #paletteReadQueued = false;

  constructor(input: { path: string; paletteDirectory: string; supportsTransparentWindow: boolean }) {
    this.#path = input.path;
    this.#paletteDirectory = input.paletteDirectory;
    this.#supportsTransparentWindow = input.supportsTransparentWindow;
  }

  get preference(): AppAppearancePreference {
    const wanted = this.#preference.palette;
    const palette = this.#palettes.some((item) => item.id === wanted) ? wanted : null;
    return {
      appearance: this.#preference.appearance,
      transparentWindow: this.#supportsTransparentWindow && this.#preference.transparentWindow,
      palette,
      palettes: this.#palettes.map((item) => ({ ...item, colors: { ...item.colors } })),
      chatBackgroundLight: this.#preference.chatBackgroundLight,
      chatBackgroundDark: this.#preference.chatBackgroundDark,
      interfaceFont: this.#preference.interfaceFont,
      codeFont: this.#preference.codeFont,
    };
  }

  load(): Effect.Effect<AppAppearancePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* readAppearancePreference(this.#path);
      this.#palettes = yield* readThemePalettes(this.#paletteDirectory);
      this.#showFirstPalette();
      return this.preference;
    });
  }

  followPalettes(): Effect.Effect<() => Promise<void>> {
    return Effect.gen({ self: this }, function* () {
      const reads = Scope.makeUnsafe();
      const stopWatch = yield* watchThemePalettes(this.#paletteDirectory, () => {
        if (this.#paletteReadQueued) return;
        this.#paletteReadQueued = true;
        Effect.runFork(this.refreshPalettes().pipe(Effect.forkIn(reads, { startImmediately: true })));
      }).pipe(Effect.orElseSucceed(() => () => undefined));
      yield* this.refreshPalettes();
      return () => {
        stopWatch();
        return Effect.runPromise(Scope.close(reads, Exit.void));
      };
    });
  }

  refreshPalettes(): Effect.Effect<void> {
    return this.#paletteReads.withPermit(
      Effect.gen({ self: this }, function* () {
        this.#paletteReadQueued = false;
        const palettes = yield* readThemePalettes(this.#paletteDirectory);
        if (sameThemePalettes(palettes, this.#palettes)) return;
        this.#palettes = palettes;
        this.#showFirstPalette();
        this.#notify();
      }),
    );
  }

  set(change: SetAppAppearancePreferenceInput): Effect.Effect<AppAppearancePreference, PreferenceFileFailure> {
    return this.#writes.withPermit(this.#write(change));
  }

  #write(change: SetAppAppearancePreferenceInput): Effect.Effect<AppAppearancePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const themeChosen =
        this.#preference.themeChosen || change.appearance !== undefined || change.palette !== undefined;
      this.#preference = yield* writeAppearancePreference(this.#path, { ...this.#preference, ...change, themeChosen });
      this.#notify();
      return this.preference;
    }).pipe(Effect.uninterruptible);
  }

  #showFirstPalette(): void {
    if (this.#preference.themeChosen) return;
    const shown = this.#preference.palette;
    if (this.#palettes.some((item) => item.id === shown)) return;
    this.#preference = { ...this.#preference, palette: this.#palettes[0]?.id ?? null };
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.preference);
  }

  subscribe(listener: (preference: AppAppearancePreference) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
