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
const TILE_RATIO = 824 / 1024;
const ICONSET_SIZES = [16, 32, 128, 256, 512] as const;
const iconComposerTool = join(
  execFileSync("xcode-select", ["--print-path"], { encoding: "utf8" }).trim(),
  "../Applications/Icon Composer.app/Contents/Executables/ictool",
);

const workPath = await mkdtemp(join(tmpdir(), "openbot-macos-icon-"));
try {
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
