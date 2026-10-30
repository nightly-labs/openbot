import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { isMissingFileError } from "../src/backend/file-errors";
import { elfSearchPaths, ORIGIN_SEARCH_PATH } from "./elf-search-paths";

const logger = createOpenBotLogger("verify-linux-package");

// Each launch step ends on a state or an event. This limit only turns a real hang into a clear failure:
// a slow release runner can need much more time than usual to start the first instance.
const launchStepLimitMs = 5 * 60_000;

/** The scripts that a server installs from a release (`RELEASE_FILES` in scripts/hosting/openbot-hosted-update). */
const HOSTED_SCRIPTS = [
  "openbot-hosted-server",
  "openbot-hosted-env",
  "openbot-hosted-update",
  "openbot",
  "openbot-boat-pre-stop",
  // Not installed on a server: `install-server.sh` runs it from the unpacked release.
  "openbot-server-setup",
];
const HOSTED_UNITS = [
  "openbot.service",
  "openbot-update.service",
  "openbot-update.timer",
  "openbot-update-apply.service",
  "openbot-update-request.path",
  "openbot-update-request.service",
];

const FUSE_DISABLED = 48;
const FUSE_ENABLED = 49;

if (process.platform !== "linux") {
  throw new Error("The Linux package verifier must run on Linux.");
}

/** The verifier checks a build for the host it runs on: CI builds each architecture on its own runner. */
const LINUX_ARCHITECTURES = {
  x64: { label: "x86-64", elfMachine: 0x3e },
  arm64: { label: "AArch64", elfMachine: 0xb7 },
} as const;
const architecture = process.arch;
if (architecture !== "x64" && architecture !== "arm64") {
  throw new Error(`The Linux package verifier does not support ${architecture}.`);
}
const target = LINUX_ARCHITECTURES[architecture];

const requireUpdateMetadata = process.argv.includes("--require-update-metadata");
const appPathArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const appPath = resolve(
  appPathArgument ?? (architecture === "x64" ? "dist/linux-unpacked" : "dist/linux-arm64-unpacked"),
);
// electron-builder names the Linux binary after `name` in package.json, not `productName`.
const executablePath = resolve(appPath, "openbot");
const resourcesPath = resolve(appPath, "resources");
const asarPath = resolve(resourcesPath, "app.asar");
const voiceRuntimePath = resolve(resourcesPath, "voice/runtime");
const voiceRuntimeFiles = ["sherpa-onnx.node", "libsherpa-onnx-c-api.so", "libonnxruntime.so"];
const voiceHostPath = resolve(resourcesPath, "app.asar.unpacked/out/main/voice-transcription-host.js");
const speechHostPath = resolve(resourcesPath, "app.asar.unpacked/out/main/voice-speech-host.js");

await Promise.all([
  access(executablePath),
  access(resolve(resourcesPath, "app.asar.unpacked/node_modules/effect/package.json")),
  access(resolve(resourcesPath, "app.asar.unpacked/node_modules/effect/dist/index.js")),
  access(asarPath),
  access(resolve(resourcesPath, "managed-skills")),
  access(resolve(resourcesPath, "licenses/Electron-LICENSE")),
  access(resolve(resourcesPath, "licenses/LICENSES.chromium.html")),
  access(resolve(resourcesPath, "licenses/sherpa-onnx-LICENSE")),
  access(resolve(resourcesPath, "licenses/onnxruntime-LICENSE")),
  ...voiceRuntimeFiles.map((name) => access(resolve(voiceRuntimePath, name))),
  access(voiceHostPath),
  access(speechHostPath),
  // A hosted server refuses an update to a release without all of its hosting files.
  ...["packages.txt", "openbot-hosted.apparmor", ...HOSTED_UNITS].map((file) =>
    access(resolve(resourcesPath, "hosting", file)),
  ),
  ...HOSTED_SCRIPTS.map((file) => access(resolve(resourcesPath, "hosting", file), constants.X_OK)),
  // The Computer Use driver of this architecture.
  access(resolve(resourcesPath, `cua-driver/linux/${architecture}/cua-driver`)),
  access(resolve(resourcesPath, `cua-driver/linux/${architecture}/wayland-helper/winrects@cua/extension.js`)),
  access(resolve(resourcesPath, `cua-driver/linux/${architecture}/LICENSE.md`)),
]);
await Promise.all(
  ["darwin", "win32"].map((name) =>
    assertAbsent(resolve(resourcesPath, "cua-driver", name), "Only this platform's driver ships"),
  ),
);

// The voice runtime is the one this architecture loads. The Parakeet, Bark, Whisper and Supertonic
// models are downloaded on demand.
await Promise.all(voiceRuntimeFiles.map((name) => assertElfMachine(resolve(voiceRuntimePath, name))));
// `prepare-voice` removes the CI build directory and the working directory from the search paths.
for (const name of voiceRuntimeFiles) {
  const paths = elfSearchPaths(await readFile(resolve(voiceRuntimePath, name)));
  if (paths.some(({ value }) => value !== ORIGIN_SEARCH_PATH)) {
    throw new Error(
      `${name} must load libraries only from its own directory: ${paths.map(({ value }) => value).join(", ")}`,
    );
  }
}
await Promise.all(
  [
    "voice/model",
    "voice/bark-3.0-plus-int8",
    "voice/whisper-turbo-int8",
    "voice/supertonic-3-int8",
    "voice/runtime/encoder.int8.onnx",
    "voice/runtime/turbo-encoder.int8.onnx",
    "voice/runtime/vocoder.int8.onnx",
  ].map((path) =>
    assertAbsent(resolve(resourcesPath, path), "The on-demand voice models must not be in the application"),
  ),
);
for (const [path, name] of [
  [voiceHostPath, "voice transcription"],
  [speechHostPath, "speech"],
] as const) {
  if (/from "(?!node:)/.test(await readFile(path, "utf8"))) {
    throw new Error(`The ${name} host must import nothing but node: builtins.`);
  }
}
// The remote desktop runtime is built for x64 only, and only for this platform.
if (architecture === "x64") {
  await Promise.all(
    ["sunshine", "web-server", "streamer", "static/stream.html"].map((name) =>
      access(resolve(resourcesPath, "remote-desktop-runtime/linux/x64", name)),
    ),
  );
  await Promise.all(
    ["darwin", "win32"].map((name) =>
      assertAbsent(resolve(resourcesPath, "remote-desktop-runtime", name), "Only this platform's runtime ships"),
    ),
  );
} else {
  await assertAbsent(
    resolve(resourcesPath, "remote-desktop-runtime"),
    "Remote desktop is not available on Linux arm64",
  );
}

// Providers and the tunnel are downloaded on demand, exactly as on macOS and Windows.
await Promise.all(
  ["codex", "claude", "grok", "cloudflared"].map((name) =>
    assertAbsent(resolve(resourcesPath, name), "Runtimes must not be packaged"),
  ),
);
await assertAbsent(
  resolve(resourcesPath, `app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-${architecture}`),
  "The native Claude runtime must not be duplicated",
);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!isDynamicRecord(packageJson)) throw new Error("package.json is not a JSON object.");
if (!isString(packageJson.version)) throw new Error("package.json version is missing.");

// The Linux build has no version resource to read, so the packaged manifest is the record of what
// was built. It is the same file the running app reports through `app.getVersion()`.
const packagedManifest = JSON.parse(await readAsarFile(asarPath, "package.json"));
if (!isDynamicRecord(packagedManifest)) throw new Error("The packaged package.json is not a JSON object.");
expectEqual(packagedManifest.name, "openbot", "packaged name");
expectEqual(packagedManifest.productName, "OpenBot", "packaged product name");
expectEqual(packagedManifest.version, packageJson.version, "packaged version");

await assertElfMachine(executablePath);

const appImages = existsSync("dist") ? await findAppImages() : [];
for (const appImage of appImages) {
  if (!appImage.startsWith(`OpenBot-${packageJson.version}-`)) {
    throw new Error(`Unexpected AppImage name: ${appImage} (expected OpenBot-${packageJson.version}-<arch>.AppImage)`);
  }
}

const updateMetadataPath = resolve(resourcesPath, "app-update.yml");
let updateMetadata: string | null = null;
try {
  updateMetadata = await readFile(updateMetadataPath, "utf8");
} catch (error) {
  if (requireUpdateMetadata) throw error;
}
if (updateMetadata !== null && !updateMetadata.includes("provider: github")) {
  throw new Error("The packaged update provider is not GitHub.");
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
  `OpenBot ${packageJson.version} · Linux ${architecture} · manifest · voice runtime · ASAR integrity · hardened fuses · launch`,
);

function expectEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`Unexpected ${label}: ${String(actual)} (expected ${String(expected)})`);
  }
}

async function assertElfMachine(path: string): Promise<void> {
  const file = await readFile(path);
  if (file.toString("binary", 0, 4) !== "\x7fELF") throw new Error(`${path} has no ELF header.`);
  if (file[4] !== 2) throw new Error(`Expected a 64-bit ELF file: ${path}`);
  const machine = file.readUInt16LE(18);
  if (machine !== target.elfMachine) {
    throw new Error(
      `Expected a Linux ${target.label} file, but the ELF machine type of ${path} is 0x${machine.toString(16)}.`,
    );
  }
}

async function assertAbsent(path: string, reason: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`${reason}: ${path}`);
}

async function findAppImages(): Promise<string[]> {
  return (await readdir("dist")).filter((name) => name.endsWith(".AppImage"));
}

/**
 * Reads one top-level file out of an asar archive.
 *
 * The archive opens with four little-endian 32-bit words - a constant `4`, the size of the header
 * block, the size of the JSON inside it, and the length of the JSON string itself - and then the
 * JSON file table, which gives every entry an offset into the data that follows the header block.
 * Doing this here keeps the verifier on the declared dependencies: `@electron/asar` is only a
 * transitive dependency of electron-builder, and reading four words of a stable on-disk format is a
 * smaller commitment than depending on it.
 */
async function readAsarFile(archive: string, name: string): Promise<string> {
  const buffer = await readFile(archive);
  const headerSize = buffer.readUInt32LE(4);
  const headerJsonLength = buffer.readUInt32LE(12);
  const header = JSON.parse(buffer.toString("utf8", 16, 16 + headerJsonLength));
  if (!isDynamicRecord(header) || !isDynamicRecord(header.files)) {
    throw new Error(`${archive} has no asar file table.`);
  }
  const entry = header.files[name];
  if (!isDynamicRecord(entry) || !isString(entry.offset) || !isNumber(entry.size)) {
    throw new Error(`${archive} does not contain ${name}.`);
  }
  const start = 8 + headerSize + Number(entry.offset);
  return buffer.toString("utf8", start, start + entry.size);
}

/**
 * Starts the packaged application once and makes sure it stays up.
 *
 * This needs a display, so in CI it runs under `xvfb-run -a`. It cannot be verified on a macOS
 * worktree at all: the verifier refuses to run there, and a headless Electron does not reach
 * `ready` in an agent shell.
 *
 * No `--no-sandbox` here or anywhere else. If the launch fails with a user-namespace error, the
 * host is missing the AppArmor profile, which is a real defect in the install instructions rather
 * than something to switch the sandbox off for.
 */
async function verifyLaunch(executable: string): Promise<void> {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error("The launch check needs a display. Run it under `xvfb-run -a`.");
  }
  const userDataPath = await mkdtemp(join(tmpdir(), "openbot-package-smoke-"));
  const child = spawn(executable, [`--user-data-dir=${userDataPath}`], {
    env: launchEnvironment(userDataPath),
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
      new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
    ]);
    child.kill("SIGKILL");
    try {
      await rm(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (error) {
      logger.warn("Could not remove the temporary Linux profile:", toLogValue(error));
    }
  }
}

function launchEnvironment(userDataPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CODEX_HOME: join(userDataPath, "codex-home"),
    CLAUDE_CONFIG_DIR: join(userDataPath, "claude-home"),
    OPENBOT_CODEX_PATH: join(userDataPath, "missing-codex"),
    OPENBOT_CLAUDE_PATH: join(userDataPath, "missing-claude"),
    OPENBOT_GROK_PATH: join(userDataPath, "missing-grok"),
  };
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
  const second = spawn(executable, [`--user-data-dir=${userDataPath}`], {
    env: launchEnvironment(userDataPath),
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
