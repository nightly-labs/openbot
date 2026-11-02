import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const mobileRoot = join(repositoryRoot, "apps/mobile");
// Without node_modules, Bun resolves expo from its global cache, where @expo/cli is missing.
if (!existsSync(join(repositoryRoot, "node_modules/expo"))) {
  throw new Error("Dependencies are not installed in this worktree. Run `bun install --frozen-lockfile` first.");
}
const require = createRequire(join(mobileRoot, "package.json"));
const expo = require.resolve("expo/bin/cli");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const VALID_ARCHITECTURES = ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"];

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: mobileRoot, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readVariant(args: string[]): string {
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith("--variant=")) return arg.slice("--variant=".length);
    if (arg === "--variant") return args[index + 1] ?? "debug";
  }
  return "debug";
}

// The ABIs of the connected devices and running emulators. Expo builds only the device ABI for debug
// variants and every ABI in gradle.properties for other variants.
function connectedDeviceAbis(): string[] {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const sdkAdb = sdk ? join(sdk, "platform-tools/adb") : null;
  const adb = sdkAdb && existsSync(sdkAdb) ? sdkAdb : "adb";
  const adbOutput = (adbArgs: string[]) => {
    const result = spawnSync(adb, adbArgs, { encoding: "utf8" });
    return result.status === 0 ? result.stdout : "";
  };
  const serials = adbOutput(["devices"])
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const [serial, state] = line.trim().split(/\s+/);
      return serial && state === "device" ? [serial] : [];
    });
  const abis = serials.map((serial) => adbOutput(["-s", serial, "shell", "getprop", "ro.product.cpu.abi"]).trim());
  return [...new Set(abis.filter((abi) => VALID_ARCHITECTURES.includes(abi)))];
}

if (args.includes("--help") || args.includes("-h")) {
  run("node", [expo, "run:android", ...args]);
  process.exit(0);
}

const buildType = readVariant(args)
  .split(/(?=[A-Z])/)
  .at(-1)
  ?.toLowerCase();
if (
  buildType !== "debug" &&
  buildType !== "optimized" &&
  !args.includes("--all-arch") &&
  !process.env.ORG_GRADLE_PROJECT_reactNativeArchitectures
) {
  const abis = connectedDeviceAbis();
  if (abis.length > 0) {
    // A project property from the environment takes precedence over android/gradle.properties.
    process.env.ORG_GRADLE_PROJECT_reactNativeArchitectures = abis.join(",");
    process.stderr.write(`Building native code for ${abis.join(", ")} only. Pass --all-arch to build every ABI.\n`);
  }
}

// ccache shares C++ results between worktrees only when it removes the worktree path from the
// compiler arguments. React Native's CMake setup uses ccache when it is on PATH.
process.env.CCACHE_BASEDIR ??= repositoryRoot;
process.env.CCACHE_NOHASHDIR ??= "true";

// run:android skips prebuild when android/ exists. Apply config plugins to existing projects too.
run("node", [expo, "prebuild", "--platform", "android", "--no-clean", "--no-install"]);

// Gradle stores task outputs in ~/.gradle/caches/build-cache-1, which every worktree shares. The
// property is local: android/ is generated and ignored, and the app config does not change, so the
// fingerprint and runtimeVersion stay the same.
const gradleProperties = join(mobileRoot, "android/gradle.properties");
if (!/^org\.gradle\.caching=/m.test(readFileSync(gradleProperties, "utf8"))) {
  appendFileSync(gradleProperties, "\norg.gradle.caching=true\n");
}

run("node", [expo, "run:android", ...args]);
