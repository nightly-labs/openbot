import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = fileURLToPath(new URL("../apps/mobile", import.meta.url));
if (!existsSync(join(mobileRoot, "../../node_modules/expo"))) {
  throw new Error("Dependencies are not installed in this worktree. Run `bun install --frozen-lockfile` first.");
}
const require = createRequire(join(mobileRoot, "package.json"));
const expo = require.resolve("expo/bin/cli");
const launchArgs = process.argv.slice(2);
const useRocketSim = launchArgs.includes("--rocketsim");
const args = launchArgs.filter((arg) => arg !== "--" && arg !== "--rocketsim");

function run(command: string, args: string[], cwd = mobileRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (args.includes("--help") || args.includes("-h")) {
  run("node", [expo, "run:ios", ...args]);
  process.exit(0);
}

if (process.platform !== "darwin") throw new Error("The iOS simulator requires macOS.");

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

process.env.OPENBOT_XCODE_DERIVED_DATA ??= join(mobileRoot, "ios/DerivedData");
process.env.PATH = [fileURLToPath(new URL("mobile-ios-bin", import.meta.url)), process.env.PATH].join(delimiter);

const podsOutput = join(mobileRoot, "ios/build/generated/autolinking/autolinking.json");
const podfileLock = join(mobileRoot, "ios/Podfile.lock");
const podsStamp = join(mobileRoot, "ios/Pods/.openbot-installed");
const modulesRoot = join(mobileRoot, "modules");
const nativeInputs = [
  join(mobileRoot, "package.json"),
  join(mobileRoot, "../../bun.lock"),
  ...(existsSync(modulesRoot)
    ? readdirSync(modulesRoot).flatMap((name) => {
        const ios = join(modulesRoot, name, "ios");
        return existsSync(ios)
          ? [
              ios,
              ...readdirSync(ios)
                .filter((file) => file.endsWith(".podspec"))
                .map((file) => join(ios, file)),
            ]
          : [];
      })
    : []),
];
const podsInstalledAt = Math.max(
  existsSync(podfileLock) ? statSync(podfileLock).mtimeMs : 0,
  existsSync(podsStamp) ? statSync(podsStamp).mtimeMs : 0,
);
const podsStale =
  !existsSync(podfileLock) ||
  nativeInputs.some((input) => existsSync(input) && statSync(input).mtimeMs > podsInstalledAt);
const installPods = existsSync(join(mobileRoot, "ios/Pods")) && (!existsSync(podsOutput) || podsStale);
run("node", [expo, "prebuild", "--platform", "ios", "--no-clean", "--no-install"]);
if (installPods) {
  run("pod", ["install"], join(mobileRoot, "ios"));
  writeFileSync(podsStamp, "");
}
run("node", [expo, "run:ios", ...args]);
