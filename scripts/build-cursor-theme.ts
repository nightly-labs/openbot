import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { OPENBOT_CURSOR_THEME_ID, openbotCursorThemeSource } from "@openbot/brand/cursor-theme";
import { createOpenBotLogger } from "@openbot/logging";
import { zipSync } from "fflate";
import { cuaCursorThemeToolPath, cuaDriverTarget } from "./cua-driver-lock";
import { installCuaDriver } from "./install-cua-driver";

const logger = createOpenBotLogger("build-cursor-theme");

/** Where the compiled theme waits for `electron-builder`, as `resources/cua-driver-theme`. */
export const CURSOR_THEME_OUTPUT_DIRECTORY = "build/cua-driver-theme";
/** The driver reads a theme only from a file named after its own id. */
export const CURSOR_THEME_FILE = `${OPENBOT_CURSOR_THEME_ID}.cua-theme`;

/**
 * Compiles the OpenBot cursor into the artifact the driver loads at `serve` time.
 *
 * The art is JSON in `@openbot/brand`, not a binary in the repository, so a reader can see what the
 * cursor is and Biome can check it. The compiler is `cua-cursor-theme`, which ships inside the
 * pinned driver tree: the theme format and the daemon that reads it then move together by one pin.
 *
 * A cross-platform packaging run installs the target's driver, which this machine cannot run, so
 * the host target is installed as well and its compiler does the work. The artifact is the same
 * either way: the compiled theme holds no platform code.
 */
export async function buildCursorTheme(
  input: { sourceRoot?: string; outputRoot?: string; runTool?: typeof runCursorThemeTool } = {},
): Promise<string> {
  const sourceRoot = input.sourceRoot ?? process.cwd();
  const outputRoot = input.outputRoot ?? resolve(sourceRoot, CURSOR_THEME_OUTPUT_DIRECTORY);
  const runTool = input.runTool ?? runCursorThemeTool;
  const hostTarget = cuaDriverTarget();
  await installCuaDriver({ sourceRoot, target: hostTarget });
  const tool = cuaCursorThemeToolPath(sourceRoot, hostTarget);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-cursor-theme-"));
  const output = join(outputRoot, CURSOR_THEME_FILE);
  // The compiler writes beside the finished artifact, so the last step is a rename inside one
  // directory. A temporary directory could sit on another volume, where a rename fails.
  const staged = join(outputRoot, `.${CURSOR_THEME_FILE}.building`);
  try {
    const archive = join(temporaryRoot, "openbot.lottie");
    await writeFile(archive, cursorThemeArchive(), { mode: 0o600 });
    await mkdir(outputRoot, { recursive: true });
    await runTool(tool, ["validate", archive]);
    await runTool(tool, ["build", archive, "--output", staged]);
    await rm(output, { force: true });
    await rename(staged, output);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(staged, { force: true });
  }
  logger.info(`Built the ${OPENBOT_CURSOR_THEME_ID} cursor theme.`);
  return output;
}

/** The source archive: a dotLottie zip, which is what the compiler accepts. */
export function cursorThemeArchive(): Uint8Array {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const [path, contents] of Object.entries(openbotCursorThemeSource())) {
    files[path] = encoder.encode(JSON.stringify(contents));
  }
  return zipSync(files, { level: 9 });
}

async function runCursorThemeTool(tool: string, args: readonly string[]): Promise<void> {
  try {
    await promisify(execFile)(tool, [...args]);
  } catch (error) {
    // The compiler names the rule a source file breaks on its standard error, which is the whole
    // value of running it, so the message is carried rather than replaced.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cua-cursor-theme ${args[0]} failed. ${detail}`);
  }
}

if (import.meta.main) {
  await buildCursorTheme();
}
