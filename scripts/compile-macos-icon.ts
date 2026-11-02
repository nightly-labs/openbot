/**
 * Compiles `build/icon-production.icon` into `build/macos/Assets.car`.
 *
 * macOS 26 makes its own dark, clear and tinted versions of an app that has only an `.icns`. For
 * our flat icon, the dark version is a black tile with black eyes. The `.icon` file from Icon
 * Composer gives macOS 26 our own versions: the lavender tile in light mode, and the black tile
 * with white eyes in dark mode. The packaged app names it with `CFBundleIconName`.
 *
 * electron-builder can compile a `.icon` given as `mac.icon`, but then it also replaces
 * `icon.icns` with the 256-pixel fallback from `actool`, and `verify-macos-package` needs the
 * 1024-pixel file. So the app keeps `build/icon-production.icns` and adds this catalog. The catalog
 * is committed, so the release runners do not need Xcode 26.
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
const targetPath = resolve("build/macos/Assets.car");

const workPath = await mkdtemp(join(tmpdir(), "openbot-macos-icon-"));
try {
  // actool names the icon after the file, and the app reads it as `CFBundleIconName: Icon`.
  const iconPath = join(workPath, "Icon.icon");
  const outputPath = join(workPath, "out");
  await cp(sourcePath, iconPath, { recursive: true });
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
  await copyFile(join(outputPath, "Assets.car"), targetPath);
  logger.info(`Wrote ${targetPath}`);
} finally {
  await rm(workPath, { recursive: true, force: true });
}
