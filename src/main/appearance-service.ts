import {
  type AppAppearancePreference,
  type AppThemePalette,
  DEFAULT_APP_APPEARANCE,
  DEFAULT_TRANSPARENT_WINDOW,
  isAppAppearance,
  isAppThemePaletteId,
  type SetAppAppearancePreferenceInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";
import { readThemePalettes, watchThemePalettes } from "./theme-palette-files";

/** What the file holds. The palettes are not saved: they are read from their own files. */
type StoredAppearancePreference = Pick<AppAppearancePreference, "appearance" | "transparentWindow" | "palette">;

const DEFAULT_PREFERENCE: StoredAppearancePreference = {
  appearance: DEFAULT_APP_APPEARANCE,
  transparentWindow: DEFAULT_TRANSPARENT_WINDOW,
  palette: null,
};

/**
 * The saved appearance, or null when nothing was saved. A file that is unreadable or names an
 * appearance this build does not offer reads as the default: a lost choice must not stop the app
 * from starting. A file with no `transparentWindow` reads as an opaque window, and one with no
 * `palette`, which every file before palettes is, reads as no palette.
 */
const readAppearancePreference = Effect.fn("AppearancePreference.read")(function* (path: string) {
  const read = yield* Effect.result(
    readPreferenceFile(path, (parsed): StoredAppearancePreference => {
      if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isAppAppearance(parsed.appearance))
        return { ...DEFAULT_PREFERENCE };
      return {
        appearance: parsed.appearance,
        transparentWindow: parsed.transparentWindow === true,
        palette: isAppThemePaletteId(parsed.palette) ? parsed.palette : null,
      };
    }),
  );
  if (Result.isSuccess(read)) return read.success;
  return isMissingFileError(read.failure.cause) ? null : { ...DEFAULT_PREFERENCE };
});

const writeAppearancePreference = Effect.fn("AppearancePreference.write")(function* (
  path: string,
  preference: StoredAppearancePreference,
) {
  yield* writePreferenceFile(path, { version: 1, ...preference });
  return { ...preference };
});

function samePalettes(left: readonly AppThemePalette[], right: readonly AppThemePalette[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

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
    const palette = this.#palettes.some((item) => item.id === this.#preference.palette)
      ? this.#preference.palette
      : null;
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
   * When no choice was ever saved, a palette that is present is the first choice: the Omarchy
   * installer writes its palette before the first start, so a new install matches the desktop. A
   * saved choice, Dark included, stays as it is.
   */
  load(): Effect.Effect<AppAppearancePreference, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const saved = yield* readAppearancePreference(this.#path);
      this.#palettes = yield* readThemePalettes(this.#paletteDirectory);
      const first = this.#palettes[0];
      this.#preference = saved ?? { ...DEFAULT_PREFERENCE, palette: first === undefined ? null : first.id };
      return this.preference;
    });
  }

  /**
   * Follows the palette folder until the returned function is called. A change to a palette file,
   * such as an Omarchy theme switch, reaches every window without a restart.
   */
  followPalettes(): Effect.Effect<() => void> {
    return watchThemePalettes(this.#paletteDirectory, () => {
      Effect.runFork(this.refreshPalettes());
    }).pipe(
      // A file written between `load` and the start of the watch has no event of its own.
      Effect.tap(() => this.refreshPalettes()),
      Effect.orElseSucceed(() => () => undefined),
    );
  }

  /** Reads the palette files again, one read at a time, and tells the windows when they changed. */
  refreshPalettes(): Effect.Effect<void> {
    return this.#paletteReads.withPermit(
      Effect.gen({ self: this }, function* () {
        const palettes = yield* readThemePalettes(this.#paletteDirectory);
        if (samePalettes(palettes, this.#palettes)) return;
        this.#palettes = palettes;
        this.#notify();
      }),
    );
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
      this.#notify();
      return this.preference;
    }).pipe(Effect.uninterruptible);
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
