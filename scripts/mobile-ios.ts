import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = fileURLToPath(new URL("../apps/mobile", import.meta.url));
// Without node_modules, Bun resolves expo from its global cache, where @expo/cli is missing.
if (!existsSync(join(mobileRoot, "../../node_modules/expo"))) {
  throw new Error("Dependencies are not installed in this worktree. Run `bun install --frozen-lockfile` first.");
}
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

// Keep the Xcode build in the ignored ios/ directory of this worktree. See mobile-ios-bin/xcodebuild.
// Do not use ios/build: pod install writes codegen and autolinking output there, and removing the
// Xcode build must not remove that output.
process.env.OPENBOT_XCODE_DERIVED_DATA ??= join(mobileRoot, "ios/DerivedData");
process.env.PATH = [fileURLToPath(new URL("mobile-ios-bin", import.meta.url)), process.env.PATH].join(delimiter);

// run:ios skips prebuild when ios/ exists. Apply config plugins to existing projects too.
// run:ios installs pods only when Podfile.lock changes. Install them again when their generated
// output is missing, because Xcode's fallback codegen does not match the Pods project, and when a
// native dependency changed after the last install: a removed package otherwise stays a Pods target
// whose source files no longer exist, and a new local module is not built.
const podsOutput = join(mobileRoot, "ios/build/generated/autolinking/autolinking.json");
const podfileLock = join(mobileRoot, "ios/Podfile.lock");
const modulesRoot = join(mobileRoot, "modules");
const nativeInputs = [
  join(mobileRoot, "package.json"),
  join(mobileRoot, "../../bun.lock"),
  ...(existsSync(modulesRoot)
    ? readdirSync(modulesRoot).flatMap((name) => {
        const ios = join(modulesRoot, name, "ios");
        return existsSync(ios)
          ? readdirSync(ios)
              .filter((file) => file.endsWith(".podspec"))
              .map((file) => join(ios, file))
          : [];
      })
    : []),
];
const podsStale =
  !existsSync(podfileLock) ||
  nativeInputs.some((input) => existsSync(input) && statSync(input).mtimeMs > statSync(podfileLock).mtimeMs);
const installPods = existsSync(join(mobileRoot, "ios/Pods")) && (!existsSync(podsOutput) || podsStale);
run("node", [expo, "prebuild", "--platform", "ios", "--no-clean", ...(installPods ? [] : ["--no-install"])]);
run("node", [expo, "run:ios", ...args]);
