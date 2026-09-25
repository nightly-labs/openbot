import { spawnSync } from "node:child_process";
import { createOpenBotLogger } from "@openbot/logging";

// Pull request screenshots and recordings go in the pull request body, not in the repository
// (AGENTS.md, "Pull requests"). Only the product owns image files, in these directories.
const ALLOWED_DIRECTORIES = [
  // electron-builder application icons.
  "build/",
  // Images that the renderer bundles, and Storybook fixtures.
  "src/renderer/src/assets/",
  "src/renderer/stories/assets/",
  // Expo icons and splash screens.
  "apps/mobile/assets/",
  // Public site files, news and guide art, and guide images.
  "apps/auth-api/public/",
  "apps/auth-api/content-art/",
  "apps/auth-api/src/content/guides/media/",
] as const;

const IMAGE_FILE = /\.(avif|bmp|gif|heic|icns|ico|jpe?g|mov|mp4|png|svg|tiff?|webm|webp)$/i;

const logger = createOpenBotLogger("check-image-assets");

const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (result.status !== 0) {
  logger.error(`git ls-files failed: ${result.stderr}`);
  process.exit(1);
}

const misplaced = result.stdout
  .split("\0")
  .filter((path) => IMAGE_FILE.test(path))
  .filter((path) => !ALLOWED_DIRECTORIES.some((directory) => path.startsWith(directory)));

if (misplaced.length > 0) {
  logger.error(
    [
      "These image files are outside the allowed asset directories:",
      ...misplaced.map((path) => `  ${path}`),
      "Put pull request screenshots in the pull request body. If the product needs the file,",
      "move it to an allowed directory or add its directory in scripts/check-image-assets.ts.",
    ].join("\n"),
  );
  process.exit(1);
}
