/**
 * Makes the macOS app icon files from `build/icon-production.icon`:
 *
 * - `build/macos/Assets.car`, the catalog that macOS 26 reads. It has the glass eyes and our own
 *   dark, clear and tinted versions. Without it, macOS 26 makes these versions from the `.icns`.
 * - `build/icon-production.icns`, for macOS versions that read only `CFBundleIconFile`.
 * - `build/icon-production-macos-safe-area.png`, the Dock image that the app sets while it runs when
 *   it cannot show the bundle icon.
 *
 * The two images are the light render of the `.icon` from Icon Composer, so all macOS versions show
 * the same icon. Their tile has the size and position of the macOS icon grid: 824 of 1024 pixels.
 *
 * electron-builder can compile a `.icon` given as `mac.icon`, but then it also replaces
 * `icon.icns` with the 256-pixel fallback from `actool`, and `verify-macos-package` needs the
 * 1024-pixel file. So the app keeps `build/icon-production.icns` and adds this catalog. The files
 * are committed, so the release runners do not need Xcode 26.
 *
 * Run with `bun scripts/compile-macos-icon.ts` on a Mac with Xcode 26 or later, after a change
 * to `build/icon-production.icon`.
 */
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("compile-macos-icon");
const sourcePath = resolve("build/icon-production.icon");
const catalogPath = resolve("build/macos/Assets.car");
const icnsPath = resolve("build/icon-production.icns");
const dockImagePath = resolve("build/icon-production-macos-safe-area.png");
const DOCK_IMAGE_SIZE = 1600;
/** The macOS icon grid: the tile is 824 pixels of a 1024-pixel image. */
const TILE_RATIO = 824 / 1024;
const ICONSET_SIZES = [16, 32, 128, 256, 512] as const;
/** The `ictool` of Icon Composer exports images. `xcrun ictool` is another tool, like `actool`. */
const iconComposerTool = join(
  execFileSync("xcode-select", ["--print-path"], { encoding: "utf8" }).trim(),
  "../Applications/Icon Composer.app/Contents/Executables/ictool",
);

const workPath = await mkdtemp(join(tmpdir(), "openbot-macos-icon-"));
try {
  // actool names the icon after the file, and the app reads it as `CFBundleIconName: Icon`.
  const iconPath = join(workPath, "Icon.icon");
  await cp(sourcePath, iconPath, { recursive: true });
  await compileCatalog(iconPath);
  renderWithSafeArea(iconPath, 1024, join(workPath, "icon-1024.png"));
  await writeIcns(join(workPath, "icon-1024.png"));
  renderWithSafeArea(iconPath, DOCK_IMAGE_SIZE, dockImagePath);
  logger.info(`Wrote ${catalogPath}, ${icnsPath} and ${dockImagePath}`);
} finally {
  await rm(workPath, { recursive: true, force: true });
}

async function compileCatalog(iconPath: string): Promise<void> {
  const outputPath = join(workPath, "out");
  await mkdir(outputPath);
  execFileSync(
    "xcrun",
    [
      "actool",
      iconPath,
      "--compile",
      outputPath,
      "--output-format",
      "human-readable-text",
      "--warnings",
      "--errors",
      "--output-partial-info-plist",
      join(outputPath, "assetcatalog_generated_info.plist"),
      "--app-icon",
      "Icon",
      "--include-all-app-icons",
      "--enable-on-demand-resources",
      "NO",
      "--development-region",
      "en",
      "--target-device",
      "mac",
      "--minimum-deployment-target",
      "26.0",
      "--platform",
      "macosx",
    ],
    { stdio: "inherit" },
  );
  await copyFile(join(outputPath, "Assets.car"), catalogPath);
}

/** Renders the light icon as a tile in the middle of a transparent square of `size` pixels. */
function renderWithSafeArea(iconPath: string, size: number, outputPath: string): void {
  const tileSize = String(Math.round(size * TILE_RATIO));
  execFileSync(
    iconComposerTool,
    [
      iconPath,
      "--export-image",
      "--output-file",
      outputPath,
      "--platform",
      "macOS",
      "--rendition",
      "Default",
      "--width",
      tileSize,
      "--height",
      tileSize,
      "--scale",
      "1",
    ],
    // ictool writes its errors to standard output, which the thrown error keeps.
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  execFileSync("sips", ["--padToHeightWidth", String(size), String(size), outputPath], { stdio: "ignore" });
}

async function writeIcns(masterPath: string): Promise<void> {
  const iconsetPath = join(workPath, "icon.iconset");
  await mkdir(iconsetPath);
  for (const size of ICONSET_SIZES) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
      execFileSync("sips", ["--resampleHeightWidth", pixels, pixels, masterPath, "--out", join(iconsetPath, name)], {
        stdio: "ignore",
      });
    }
  }
  execFileSync("iconutil", ["--convert", "icns", "--output", icnsPath, iconsetPath]);
}
