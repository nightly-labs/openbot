import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { isMissingFileError } from "../src/backend/file-errors";

const logger = createOpenBotLogger("verify-macos-package");

const FUSE_DISABLED = 48;
const FUSE_ENABLED = 49;

// Each launch step ends on a state or an event. This limit only turns a real hang into a clear failure:
// a slow release runner can need much more time than usual to start the first instance.
const launchStepLimitMs = 5 * 60_000;

const EXPECTED_MACOS_ICON_FILES = [
  "icon_16x16.png",
  "icon_16x16@2x.png",
  "icon_32x32.png",
  "icon_32x32@2x.png",
  "icon_128x128.png",
  "icon_128x128@2x.png",
  "icon_256x256.png",
  "icon_256x256@2x.png",
  "icon_512x512.png",
  "icon_512x512@2x.png",
] as const;

// electron-builder writes the default x64 build to `dist/mac` and adds a suffix for any other one.
// The package is built for the runner's own architecture, so that is the one to verify.
const architecture = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
if (!architecture) throw new Error(`OpenBot does not ship for macOS ${process.arch}.`);
const machOArchitecture = architecture === "arm64" ? "arm64" : "x86_64";
const appPath = resolve(
  process.argv[2] ?? (architecture === "arm64" ? "dist/mac-arm64/OpenBot.app" : "dist/mac/OpenBot.app"),
);
const contentsPath = resolve(appPath, "Contents");
const executablePath = resolve(contentsPath, "MacOS/OpenBot");
const resourcesPath = resolve(contentsPath, "Resources");
const packagedIconPath = resolve(resourcesPath, "icon.icns");
const sourceIconPath = resolve("build/icon-production.icns");
const packagedIconCatalogPath = resolve(resourcesPath, "Assets.car");
const sourceIconCatalogPath = resolve("build/macos/Assets.car");
const plistPath = resolve(contentsPath, "Info.plist");
const voiceRuntimePath = resolve(resourcesPath, "voice/runtime");
const voiceRuntimeFiles = ["sherpa-onnx.node", "libsherpa-onnx-c-api.dylib", "libonnxruntime.dylib"];
const remoteRuntimePath = resolve(resourcesPath, "remote-desktop-runtime/darwin", architecture);
const cuaDriverPath = resolve(resourcesPath, "cua-driver/darwin", architecture);
// The database host is spawned by path as its own process, so it has to survive the asar unchanged.
// Packed into app.asar it would still be readable, but `utilityProcess` cannot start it from there.
const databaseHostPath = resolve(resourcesPath, "app.asar.unpacked/out/main/agent-database-host.js");
const voiceHostPath = resolve(resourcesPath, "app.asar.unpacked/out/main/voice-transcription-host.js");
const speechHostPath = resolve(resourcesPath, "app.asar.unpacked/out/main/voice-speech-host.js");

await Promise.all([
  access(executablePath),
  access(resolve(resourcesPath, "app.asar.unpacked/node_modules/effect/package.json")),
  access(resolve(resourcesPath, "app.asar.unpacked/node_modules/effect/dist/index.js")),
  access(resolve(resourcesPath, "app.asar")),
  access(packagedIconPath),
  access(sourceIconPath),
  access(resolve(resourcesPath, "licenses/Electron-LICENSE")),
  access(resolve(resourcesPath, "licenses/LICENSES.chromium.html")),
  access(resolve(resourcesPath, "licenses/sherpa-onnx-LICENSE")),
  access(resolve(resourcesPath, "licenses/onnxruntime-LICENSE")),
  access(resolve(resourcesPath, "licenses/NVIDIA-Parakeet-TDT-0.6B-v3-LICENSE")),
  access(resolve(resourcesPath, "licenses/Underdog-Bark-3.0-Plus-LICENSE")),
  access(resolve(resourcesPath, "licenses/OpenAI-Whisper-LICENSE")),
  access(resolve(resourcesPath, "licenses/Supertone-Supertonic-3-LICENSE")),
  ...voiceRuntimeFiles.map((name) => access(resolve(voiceRuntimePath, name))),
  access(databaseHostPath),
  access(voiceHostPath),
  access(speechHostPath),
  access(resolve(resourcesPath, "remote-desktop-runtime/licenses/Sunshine-GPL-3.0.txt")),
  access(resolve(resourcesPath, "remote-desktop-runtime/licenses/moonlight-web-stream-GPL-3.0.txt")),
  access(resolve(resourcesPath, "remote-desktop-runtime/source-manifest.json")),
  access(resolve(resourcesPath, "remote-desktop-runtime/DISTRIBUTION-SHA256SUMS.txt")),
  access(resolve(resourcesPath, "remote-desktop-runtime/sources/Sunshine-v2026.516.143833-source.tar.gz")),
  access(resolve(resourcesPath, "remote-desktop-runtime/sources/sunshine-v2026.516.143833-openbot.patch")),
  access(resolve(resourcesPath, "remote-desktop-runtime/sources/moonlight-web-stream-v2.10.0-openbot-source.tar.gz")),
  access(resolve(resourcesPath, "remote-desktop-runtime/sources/moonlight-web-stream-v2.10.0-openbot.patch")),
  access(resolve(remoteRuntimePath, "Sunshine.app/Contents/MacOS/Sunshine")),
  access(resolve(remoteRuntimePath, "web-server")),
  access(resolve(remoteRuntimePath, "streamer")),
  access(resolve(remoteRuntimePath, "static/stream.html")),
  access(resolve(remoteRuntimePath, "SHA256SUMS.txt")),
  access(resolve(cuaDriverPath, "cua-driver")),
  access(resolve(cuaDriverPath, "LICENSE.md")),
]);
// Only this Mac's driver ships. A `from: build/cua-driver` that forgot the target would put the
// Windows and Linux builds in every installer.
await Promise.all(["win32", "linux"].map((name) => assertAbsent(resolve(resourcesPath, "cua-driver", name))));
// Each application carries one architecture's runtimes. The other one would only add size.
const otherArchitecture = architecture === "arm64" ? "x64" : "arm64";
await Promise.all(
  ["remote-desktop-runtime", "cua-driver"].map((name) =>
    assertAbsent(resolve(resourcesPath, name, "darwin", otherArchitecture)),
  ),
);
// `signIgnore` keeps the driver's own Developer ID signature, and with it the Automation
// entitlement that re-signing under OpenBot's inherited entitlements would drop.
assertCuaDriverSignature(resolve(cuaDriverPath, "cua-driver"));
await verifyPackagedIcon(packagedIconPath, sourceIconPath);
await verifyPackagedIconCatalog(packagedIconCatalogPath, sourceIconCatalogPath);
await Promise.all(["codex", "claude", "grok"].map((name) => assertAbsent(resolve(resourcesPath, name))));
await assertAbsent(resolve(resourcesPath, "cloudflared"));
await assertAbsent(
  resolve(resourcesPath, `app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-${architecture}`),
);

const plist = JSON.parse(run("plutil", ["-convert", "json", "-o", "-", plistPath]));
if (!isDynamicRecord(plist)) throw new Error("Info.plist is not a JSON object.");
expectEqual(plist.CFBundleDisplayName, "OpenBot", "display name");
expectEqual(plist.CFBundleExecutable, "OpenBot", "executable name");
expectEqual(plist.CFBundleIdentifier, "app.openbot.desktop", "bundle identifier");
expectEqual(plist.CFBundleIconFile, "icon.icns", "application icon");
expectEqual(plist.CFBundleIconName, "Icon", "macOS 26 application icon");
expectEqual(plist.LSMinimumSystemVersion, "13.0", "minimum macOS version");
expectEqual(plist.ElectronTeamID, "ZTRDTUL87R", "Apple Team ID");
if (!Array.isArray(plist.NSUserActivityTypes) || !plist.NSUserActivityTypes.includes("NSUserActivityTypeBrowsingWeb")) {
  throw new Error("The Universal Links activity type is missing.");
}
if (!plist.ElectronAsarIntegrity) throw new Error("ASAR integrity metadata is missing.");
expectEqual(
  plist.NSMicrophoneUsageDescription,
  "OpenBot uses the microphone to transcribe voice prompts locally on this Mac.",
  "microphone usage description",
);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!isDynamicRecord(packageJson)) throw new Error("package.json is not a JSON object.");
expectEqual(plist.CFBundleShortVersionString, packageJson.version, "application version");

// Electron is unavailable to this process, and its own imports are what keep it startable there.
// The unpacked Effect package checked above is its only import outside node: builtins.
const databaseHost = await readFile(databaseHostPath, "utf8");
if (/from "(?!node:|effect["/])/.test(databaseHost)) {
  throw new Error("The database host must import nothing but node: builtins and effect.");
}
for (const [path, name] of [
  [voiceHostPath, "voice transcription"],
  [speechHostPath, "speech"],
] as const) {
  if (/from "(?!node:)/.test(await readFile(path, "utf8"))) {
    throw new Error(`The ${name} host must import nothing but node: builtins.`);
  }
}

const executableArchitecture = run("file", [executablePath]);
if (!executableArchitecture.includes(machOArchitecture)) {
  throw new Error(`Expected a ${machOArchitecture} executable: ${executableArchitecture}`);
}
for (const name of voiceRuntimeFiles) {
  const path = resolve(voiceRuntimePath, name);
  const voiceArchitecture = run("file", [path]);
  if (!voiceArchitecture.includes(machOArchitecture)) {
    throw new Error(`Expected a ${machOArchitecture} voice runtime library: ${voiceArchitecture}`);
  }
}
// The Parakeet, Bark, Whisper and Supertonic models are downloaded on demand.
if (
  ["voice/model", "voice/bark-3.0-plus-int8", "voice/whisper-turbo-int8", "voice/supertonic-3-int8"].some((path) =>
    existsSync(resolve(resourcesPath, path)),
  ) ||
  ["encoder.int8.onnx", "turbo-encoder.int8.onnx", "vocoder.int8.onnx"].some((name) =>
    existsSync(resolve(voiceRuntimePath, name)),
  )
) {
  throw new Error("The on-demand voice models must not be in the application.");
}

for (const name of ["Sunshine.app", "web-server", "streamer"]) {
  run("codesign", ["--verify", "--strict", "--verbose=2", resolve(remoteRuntimePath, name)]);
}

const fuses = await getCurrentFuseWire(executablePath);
const expectedFuses: Array<[FuseV1Options, number]> = [
  [FuseV1Options.RunAsNode, FUSE_DISABLED],
  [FuseV1Options.EnableCookieEncryption, FUSE_ENABLED],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FUSE_DISABLED],
  [FuseV1Options.EnableNodeCliInspectArguments, FUSE_DISABLED],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FUSE_ENABLED],
  [FuseV1Options.OnlyLoadAppFromAsar, FUSE_ENABLED],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FUSE_DISABLED],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FUSE_DISABLED],
];
for (const [fuse, expected] of expectedFuses) {
  if (fuses[fuse] !== expected) {
    throw new Error(`Unexpected Electron fuse ${FuseV1Options[fuse]}: ${String(fuses[fuse])}`);
  }
}

await verifyLaunch(executablePath);

logger.info(`Verified ${appPath}`);
logger.info(
  `OpenBot ${String(packageJson.version)} · ${machOArchitecture} · icon · GPL remote runtime · WebRTC remote stack · ASAR integrity · hardened fuses · launch`,
);

function expectEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`Unexpected ${label}: ${String(actual)} (expected ${String(expected)})`);
  }
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`Provider runtime must not be packaged: ${path}`);
}

async function verifyPackagedIcon(packagedPath: string, sourcePath: string): Promise<void> {
  const [packagedIcon, sourceIcon] = await Promise.all([readFile(packagedPath), readFile(sourcePath)]);
  if (!packagedIcon.equals(sourceIcon)) {
    throw new Error("The packaged macOS icon does not match build/icon-production.icns.");
  }

  const iconRoot = await mkdtemp(join(tmpdir(), "openbot-icon-"));
  const iconSetPath = join(iconRoot, "OpenBot.iconset");
  try {
    run("iconutil", ["--convert", "iconset", packagedPath, "--output", iconSetPath]);
    await Promise.all(EXPECTED_MACOS_ICON_FILES.map((name) => access(join(iconSetPath, name))));
  } finally {
    await rm(iconRoot, { recursive: true, force: true });
  }
}

/** macOS 26 reads the icon from this catalog. It holds the dark version that the `.icns` cannot. */
async function verifyPackagedIconCatalog(packagedPath: string, sourcePath: string): Promise<void> {
  const [packagedCatalog, sourceCatalog] = await Promise.all([readFile(packagedPath), readFile(sourcePath)]);
  if (!packagedCatalog.equals(sourceCatalog)) {
    throw new Error("The packaged macOS icon catalog does not match build/macos/Assets.car.");
  }
}

/** The Computer Use driver keeps the signature it was published with, not OpenBot's. */
function assertCuaDriverSignature(binary: string): void {
  const description = run("codesign", ["-dvvv", binary], true);
  if (!description.includes("Authority=Developer ID Application: Cua AI, Inc. (YCK386LBJ7)")) {
    throw new Error("The Computer Use driver no longer carries the Cua AI Developer ID signature.");
  }
  if (!description.includes("flags=0x10000(runtime)")) {
    throw new Error("The Computer Use driver is not signed with the hardened runtime.");
  }
}

function run(command: string, args: string[], includeStderr = false): string {
  if (includeStderr) {
    const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
    if (result.status !== 0) {
      throw new Error(`${command} failed: ${result.stderr.trim()}`);
    }
    return `${result.stdout}${result.stderr}`.trim();
  }
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

async function verifyLaunch(executable: string): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), "openbot-package-smoke-"));
  const child = spawn(executable, [`--user-data-dir=${userDataPath}`, "--use-mock-keychain"], {
    env: {
      ...process.env,
      CODEX_HOME: join(userDataPath, "codex-home"),
      CLAUDE_CONFIG_DIR: join(userDataPath, "claude-home"),
      OPENBOT_CODEX_PATH: join(userDataPath, "missing-codex"),
      OPENBOT_CLAUDE_PATH: join(userDataPath, "missing-claude"),
      OPENBOT_GROK_PATH: join(userDataPath, "missing-grok"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });

  const launchExit = new Promise<never>((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(
        new Error(`Packaged OpenBot exited during launch (${signal ?? `code ${String(code)}`}): ${stderr.trim()}`),
      );
    });
  });

  try {
    // Chromium makes `SingletonLock` in userData when main takes its single-instance lock. A second
    // instance that starts before that does not forward to the first one: it takes the lock and stays open.
    await waitForFirstInstance(
      launchExit,
      () => pathExists(join(userDataPath, "SingletonLock")),
      "take its lock",
      () => stderr,
    );
    // The lock is not enough. The second instance waits about 20 seconds for the first one to answer, and
    // the answer needs a free main thread; with no answer, Chromium can kill the first instance. Main
    // answers only after its start, and a launch that stops during the start must fail here. So this
    // waits until the window has loaded and called main (`trace.ndjson`, see `rendererCalledMain`).
    await waitForFirstInstance(
      launchExit,
      () => rendererCalledMain(userDataPath),
      "load its window",
      () => stderr,
    );
    await verifySecondInstanceExits(executable, userDataPath, launchExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Packaged OpenBot exited when a second instance started (${child.signalCode ?? `code ${String(child.exitCode)}`}): ${stderr.trim()}`,
      );
    }
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
      new Promise<void>((resolveDelay) =>
        setTimeout(() => {
          child.kill("SIGKILL");
          resolveDelay();
        }, 2_000),
      ),
    ]);
    await rm(userDataPath, { recursive: true, force: true });
  }
}

/** Waits for a state of the first instance. It fails immediately when the first instance exits. */
async function waitForFirstInstance(
  launchExit: Promise<never>,
  reached: () => Promise<boolean>,
  step: string,
  stderr: () => string,
): Promise<void> {
  const stop = new AbortController();
  const waitForState = async () => {
    const limit = Date.now() + launchStepLimitMs;
    while (!(await reached())) {
      if (Date.now() > limit) {
        throw new Error(`Packaged OpenBot did not ${step} in 5 minutes: ${stderr().trim()}`);
      }
      await delay(200, undefined, { signal: stop.signal });
    }
  };
  try {
    await Promise.race([launchExit, waitForState()]);
  } finally {
    stop.abort();
  }
}

// `SingletonLock` is a symbolic link to a host and process name, not to a file, so it must not be followed.
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

/**
 * Whether the window of the first instance has called main. The renderer asks main for `getAppInfo` when
 * it mounts (src/renderer/src/platform.tsx), main records each trusted call in `logs/trace.ndjson`
 * (`setIpcCallObserver` in src/main/index.ts), and a main-thread timer writes the line about one second later.
 */
async function rendererCalledMain(userDataPath: string): Promise<boolean> {
  try {
    return (await readFile(join(userDataPath, "logs", "trace.ndjson"), "utf8")).includes('"kind":"ipc"');
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function verifySecondInstanceExits(
  executable: string,
  userDataPath: string,
  launchExit: Promise<never>,
): Promise<void> {
  const second = spawn(executable, [`--user-data-dir=${userDataPath}`, "--use-mock-keychain"], {
    env: {
      ...process.env,
      CODEX_HOME: join(userDataPath, "codex-home"),
      CLAUDE_CONFIG_DIR: join(userDataPath, "claude-home"),
      OPENBOT_CODEX_PATH: join(userDataPath, "missing-codex"),
      OPENBOT_CLAUDE_PATH: join(userDataPath, "missing-claude"),
      OPENBOT_GROK_PATH: join(userDataPath, "missing-grok"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  second.stderr.setEncoding("utf8");
  second.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });
  const stop = new AbortController();
  try {
    // The second instance exits only after the first one accepts its arguments. A busy first instance
    // accepts them later, so this waits for the exit and not for a fixed time.
    const result = await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
        second.once("exit", (code, signal) => resolveExit({ code, signal }));
      }),
      launchExit,
      delay(launchStepLimitMs, null, { signal: stop.signal }),
    ]);
    if (!result) {
      throw new Error(`A second OpenBot instance did not exit in 5 minutes: ${stderr.trim()}`);
    }
    if (result.code !== 0 || result.signal) {
      throw new Error(
        `A second OpenBot instance exited unexpectedly (${result.signal ?? `code ${String(result.code)}`}): ${stderr.trim()}`,
      );
    }
  } finally {
    stop.abort();
    if (second.exitCode === null && second.signalCode === null) second.kill("SIGKILL");
  }
}
