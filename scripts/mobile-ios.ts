import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const IOS_BUNDLE_ID = "run.openbot.mobile";
const WATCH_APP = "OpenBotWatch.app";
const WATCH_BUNDLE_ID = "run.openbot.mobile.watchkitapp";
const WATCH_INSTALL_POLL_MS = 3_000;
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

process.env.OPENBOT_KEEP_METRO_CACHE = "1";

const { mobileBuildCacheRoot }: { mobileBuildCacheRoot: (projectRoot: string) => string | undefined } = require(
  join(mobileRoot, "metro-cache.js"),
);
const buildCacheRoot = mobileBuildCacheRoot(mobileRoot);
if (buildCacheRoot) {
  const checkout = dirname(dirname(mobileRoot));
  process.env.OPENBOT_XCODE_COMPILATION_CACHE = join(buildCacheRoot, "xcode");
  process.env.OPENBOT_XCODE_PREFIX_MAPPINGS = [...new Set([checkout, realpathSync(checkout)])]
    .map((path) => `"${path}=/^openbot"`)
    .join(" ");
}

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
const installedWatchApps = new Set<string>();
const containersBeforeBuild = new Map(
  bootedSimulatorPairs().map(({ phone }) => [phone.udid, phoneAppContainer(phone.udid)]),
);
const watchInstaller = setInterval(() => installWatchAppOnPairedSimulators(), WATCH_INSTALL_POLL_MS);
const expoRun = spawn("node", [expo, "run:ios", ...args], { cwd: mobileRoot, stdio: "inherit", env: process.env });
expoRun.on("exit", (code) => {
  clearInterval(watchInstaller);
  installWatchAppOnPairedSimulators();
  process.exit(code ?? 1);
});

interface SimulatorDevice {
  udid: string;
  state: string;
}

interface SimulatorPair {
  watch: SimulatorDevice;
  phone: SimulatorDevice;
}

function isSimulatorDevice(value: unknown): value is SimulatorDevice {
  return (
    typeof value === "object" &&
    value !== null &&
    "udid" in value &&
    typeof value.udid === "string" &&
    "state" in value &&
    typeof value.state === "string"
  );
}

function isSimulatorPair(value: unknown): value is SimulatorPair {
  return (
    typeof value === "object" &&
    value !== null &&
    "watch" in value &&
    isSimulatorDevice(value.watch) &&
    "phone" in value &&
    isSimulatorDevice(value.phone)
  );
}

function bootedSimulatorPairs(): SimulatorPair[] {
  const listed = spawnSync("xcrun", ["simctl", "list", "pairs", "-j"], { encoding: "utf8" });
  if (listed.status !== 0) return [];
  return simulatorPairs(JSON.parse(listed.stdout)).filter(
    (pair) => pair.watch.state === "Booted" && pair.phone.state === "Booted",
  );
}

function simulatorPairs(list: unknown): SimulatorPair[] {
  if (typeof list !== "object" || list === null || !("pairs" in list)) return [];
  const pairs = list.pairs;
  if (typeof pairs !== "object" || pairs === null) return [];
  return Object.values(pairs).filter(isSimulatorPair);
}

function phoneAppContainer(udid: string): string | null {
  const container = spawnSync("xcrun", ["simctl", "get_app_container", udid, IOS_BUNDLE_ID], { encoding: "utf8" });
  return container.status === 0 ? container.stdout.trim() : null;
}

function hasWatchApp(udid: string): boolean {
  return spawnSync("xcrun", ["simctl", "get_app_container", udid, WATCH_BUNDLE_ID]).status === 0;
}

function installWatchAppOnPairedSimulators() {
  for (const { watch, phone } of bootedSimulatorPairs()) {
    const container = phoneAppContainer(phone.udid);
    if (!container) continue;
    const watchApp = join(container, "Watch", WATCH_APP);
    if (!existsSync(watchApp)) continue;
    const installKey = `${watch.udid}:${watchApp}:${statSync(watchApp).mtimeMs}`;
    if (installedWatchApps.has(installKey)) continue;
    const reinstalled = container !== containersBeforeBuild.get(phone.udid);
    if (!reinstalled && hasWatchApp(watch.udid)) continue;
    installedWatchApps.add(installKey);
    process.stdout.write(`Installing ${WATCH_APP} on the paired watch simulator ${watch.udid}\n`);
    spawnSync("xcrun", ["simctl", "install", watch.udid, watchApp], { stdio: "inherit" });
  }
}
