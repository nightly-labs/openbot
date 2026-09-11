import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = fileURLToPath(new URL("../apps/mobile", import.meta.url));
const require = createRequire(join(mobileRoot, "package.json"));
const expo = require.resolve("expo/bin/cli");
const launchArgs = process.argv.slice(2);
const useRocketSim = launchArgs.includes("--rocketsim");
const args = launchArgs.filter((arg) => arg !== "--" && arg !== "--rocketsim");

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: mobileRoot, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (args.includes("--help") || args.includes("-h")) {
  run("node", [expo, "run:ios", ...args]);
  process.exit(0);
}

if (process.platform !== "darwin") throw new Error("The iOS simulator requires macOS.");

// Expo opens a deep link with simctl openurl, which does not pass launch environment variables.
// Supply the local framework path to prebuild; the Swift hook is simulator Debug only.
delete process.env.OPENBOT_ROCKETSIM_FRAMEWORK;
if (useRocketSim) {
  const app =
    process.env.ROCKETSIM_APP_PATH ??
    ["/Applications/RocketSim.app", join(homedir(), "Applications/RocketSim.app")].find(existsSync);
  const framework = app && join(app, "Contents/Frameworks/RocketSimConnectLinker.nocache.framework");
  if (!app || !framework || !existsSync(framework)) {
    throw new Error(
      "Install RocketSim or set ROCKETSIM_APP_PATH to RocketSim.app. Use bun ios or bun mobile:ios to run without it.",
    );
  }
  run("open", ["-a", app]);
  process.env.OPENBOT_ROCKETSIM_FRAMEWORK = framework;
}

// run:ios skips prebuild when ios/ exists. Apply config plugins to existing projects too.
run("node", [expo, "prebuild", "--platform", "ios", "--no-clean", "--no-install"]);
run("node", [expo, "run:ios", ...args]);
