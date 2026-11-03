import { type FSWatcher, watch } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  APP_THEME_PALETTE_COLOR_PATTERN,
  type AppThemePalette,
  isAppThemePaletteId,
} from "@openbot/contracts/app-appearance";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Option, Schema } from "effect";

const logger = createOpenBotLogger("theme-palette-files");

/** The folder in `userData` where other programs, such as Omarchy, write palette files. */
export const THEME_PALETTE_DIRECTORY = "themes";

/** A palette is a few hundred bytes. A larger file is not one, so it is not read. */
const MAX_PALETTE_FILE_BYTES = 64 * 1024;

/** The Settings list stays short, and a folder full of files does not slow the start. */
const MAX_PALETTE_FILES = 32;

const color = Schema.String.check(Schema.isPattern(APP_THEME_PALETTE_COLOR_PATTERN));

/**
 * The file that another program writes. It is untrusted: it is decoded here, and only a hex color
 * passes to a CSS property. Extra keys are ignored, so a newer template still reads.
 */
const ThemePaletteFile = Schema.Struct({
  name: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(64)).check(
    Schema.isPattern(/^[^\p{Cc}]+$/u),
  ),
  appearance: Schema.Literals(["light", "dark"]),
  colors: Schema.Struct({
    canvas: color,
    frame: color,
    sidebar: color,
    surface: color,
    text: color,
    textMuted: color,
    border: color,
    accent: color,
    accentForeground: color,
    success: color,
    warning: color,
    danger: color,
  }),
});

const decodeThemePaletteFile = Schema.decodeUnknownOption(Schema.fromJsonString(ThemePaletteFile));

/** The id of a palette file, or null when the name is not one. */
function paletteId(fileName: string): string | null {
  if (!fileName.endsWith(".json")) return null;
  const id = fileName.slice(0, -".json".length);
  return isAppThemePaletteId(id) ? id : null;
}

/** One palette, or null when the file is missing, too large, not JSON or not a palette. */
const readThemePalette = Effect.fn("ThemePaletteFiles.readOne")(function* (directory: string, id: string) {
  const path = join(directory, `${id}.json`);
  const text = yield* Effect.tryPromise(async () => {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_PALETTE_FILE_BYTES) return null;
    return readFile(path, "utf8");
  }).pipe(Effect.orElseSucceed(() => null));
  if (text === null) return null;
  const file = decodeThemePaletteFile(text);
  if (Option.isNone(file)) {
    logger.warn("Skipped a theme palette file that is not valid.", { id });
    return null;
  }
  return {
    id,
    name: file.value.name,
    scheme: file.value.appearance,
    colors: { ...file.value.colors },
  } satisfies AppThemePalette;
});

/**
 * Every valid palette in the folder, by id. A missing or unreadable folder has none: a palette is an
 * extra, so it never stops the start.
 */
export const readThemePalettes = Effect.fn("ThemePaletteFiles.read")(function* (directory: string) {
  const names = yield* Effect.tryPromise(() => readdir(directory)).pipe(Effect.orElseSucceed(() => []));
  const ids = names
    .map(paletteId)
    .filter((id) => id !== null)
    .sort()
    .slice(0, MAX_PALETTE_FILES);
  const palettes = yield* Effect.forEach(ids, (id) => readThemePalette(directory, id), { concurrency: 4 });
  return palettes.filter((palette) => palette !== null);
});

/**
 * Calls `onChange` after each change in the folder, and returns the function that stops. The folder
 * is made first, so a program that writes a palette later is seen without a restart. Omarchy
 * replaces the file with a rename, which the folder watch reports.
 */
export const watchThemePalettes = Effect.fn("ThemePaletteFiles.watch")(function* (
  directory: string,
  onChange: () => void,
) {
  yield* Effect.tryPromise(() => mkdir(directory, { recursive: true }));
  const watcher = yield* Effect.try((): FSWatcher => watch(directory, { persistent: false }, () => onChange()));
  watcher.on("error", (error) => {
    logger.warn("Stopped following theme palette files.", { error: toLogValue(error) });
    watcher.close();
  });
  return () => watcher.close();
});
