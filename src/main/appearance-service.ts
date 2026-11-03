import {
  type AppAppearancePreference,
  type AppThemePalette,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  isAppAppearance,
  isAppThemePaletteId,
  type SetAppAppearancePreferenceInput,
  sameThemePalettes,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Exit, Result, Scope, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";
import { readThemePalettes, watchThemePalettes } from "./theme-palette-files";

/** What the file holds. The palettes are not saved: they are read from their own files. */
type StoredAppearancePreference = Pick<AppAppearancePreference, "appearance" | "transparentWindow" | "palette"> & {
  /**
   * False until the user picks a theme in Settings: a light, dark or system choice, or a palette.
   * While it is false, `palette` is the palette that shows: the first one, also one that appears after
   * the start, as the Omarchy installer can write its palette while OpenBot runs. It stays until its
   * file goes, so a new file does not replace it. A change to another field keeps it false.
   */
  themeChosen: boolean;
};

/** Nothing saved: no theme chosen yet. */
const DEFAULT_PREFERENCE: StoredAppearancePreference = {
  appearance: DEFAULT_APP_APPEARANCE,
  transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
  palette: null,
  themeChosen: false,
};

/**
 * The saved appearance, or the default when nothing was saved. A file that is unreadable or names an
 * appearance this build does not offer reads as a chosen Dark: a lost choice must not stop the app
 * from starting, and must not let a palette replace it. A file with no `transparentWindow` reads as
 * an opaque window. A file with no `palette`, which every file before palettes is, reads as no
 * palette, and one with no `themeChosen` as a chosen theme: the user saved it.
 */
const readAppearancePreference = Effect.fn("AppearancePreference.read")(function* (path: string) {
  const read = yield* Effect.result(
    readPreferenceFile(path, (parsed): StoredAppearancePreference => {
      if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppAppearance(parsed.appearance))
        return { ...DEFAULT_PREFERENCE, themeChosen: true };
      return {
        appearance: parsed.appearance,
        transparentWindow: parsed.transparentWindow === true,
        palette: isAppThemePaletteId(parsed.palette) ? parsed.palette : null,
        themeChosen: parsed.themeChosen !== false,
      };
    }),
  );
  if (Result.isSuccess(read)) return read.success;
  return isMissingFileError(read.failure.cause)
    ? { ...DEFAULT_PREFERENCE }
    : { ...DEFAULT_PREFERENCE, themeChosen: true };
});

const writeAppearancePreference = Effect.fn("AppearancePreference.write")(function* (
  path: string,
  preference: StoredAppearancePreference,
) {
  yield* writePreferenceFile(path, { version: 1, ...preference });
  return { ...preference };
});

/**
 * The light, dark or system appearance of OpenBot's own windows, or a theme palette that another
 * program gives. Main holds it so every window reads one choice, and it tells each window about a
 * change through `subscribe`, a change to a palette file included.
 */
export class AppearanceService {
  readonly #path: string;
  readonly #paletteDirectory: string;
  readonly #supportsTransparentWindow: boolean;
  readonly #listeners = new Set<(preference: AppAppearancePreference) => void>();
  #preference: StoredAppearancePreference = { ...DEFAULT_PREFERENCE };
  #palettes: AppThemePalette[] = [];
  #writes = Semaphore.makeUnsafe(1);
  #paletteReads = Semaphore.makeUnsafe(1);
  /** A read is waiting for its turn. It sees each change made before it starts, so one is enough. */
  #paletteReadQueued = false;

  /**
   * `supportsTransparentWindow` is false where the window cannot blur the desktop: there it reads as
   * off. `paletteDirectory` is the folder of palette files.
   */
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
    };
  }

  /**
   * Read the saved preference and the palette files. Called once at startup, before the first
   * window loads.
   *
   * Until the user picks a theme, the first palette shows: the Omarchy installer writes its palette
   * before the first start, so a new install matches the desktop. A saved choice, Dark included,
   * stays as it is.
   */
  load(): Effect.Effect<AppAppearancePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* readAppearancePreference(this.#path);
      this.#palettes = yield* readThemePalettes(this.#paletteDirectory);
      this.#showFirstPalette();
      return this.preference;
    });
  }

  /**
   * Follows the palette folder until the returned function is called. A change to a palette file,
   * such as an Omarchy theme switch, reaches every window without a restart. The returned function
   * stops the watch and waits for a read that already started, so no window hears of a change after
   * it.
   */
  followPalettes(): Effect.Effect<() => Promise<void>> {
    return Effect.gen({ self: this }, function* () {
      const reads = Scope.makeUnsafe();
      const stopWatch = yield* watchThemePalettes(this.#paletteDirectory, () => {
        // One write is several events (the temporary file and the rename). A read that waits for
        // its turn sees all of them.
        if (this.#paletteReadQueued) return;
        this.#paletteReadQueued = true;
        Effect.runFork(this.refreshPalettes().pipe(Effect.forkIn(reads, { startImmediately: true })));
      }).pipe(Effect.orElseSucceed(() => () => undefined));
      // A file written between `load` and the start of the watch has no event of its own.
      yield* this.refreshPalettes();
      return () => {
        stopWatch();
        return Effect.runPromise(Scope.close(reads, Exit.void));
      };
    });
  }

  /** Reads the palette files again, one read at a time, and tells the windows when they changed. */
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

  /**
   * Serialized, as `LogoColorService.set` is, so two quick choices save the newer one. A field the
   * input leaves out keeps its saved value. An appearance or a palette is a theme choice.
   */
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

  /**
   * While no theme is chosen, the palette that shows stays until its file goes. Then the first palette
   * shows. Settings shows it as selected, so a click on it is no change and cannot fix it.
   */
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
