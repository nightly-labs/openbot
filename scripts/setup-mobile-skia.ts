import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The root `postinstall` step for the mobile app. React Native Skia copies ~700 MB of prebuilt
// native libraries into its package before CocoaPods or Gradle can link them. Desktop and API work
// never reads them, so `OPENBOT_SKIP_SKIA=1` skips the copy. The default runs it, because EAS and
// local mobile builds install with no extra environment and need the libraries.
if (process.env.OPENBOT_SKIP_SKIA === "1") {
  process.stdout.write("Skipped the React Native Skia setup (OPENBOT_SKIP_SKIA=1).\n");
} else {
  const mobileRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), "apps", "mobile");
  const result = spawnSync(process.execPath, ["run", "--cwd", mobileRoot, "setup:skia"], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
