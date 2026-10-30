import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { parse as parseYaml } from "yaml";
import { isMissingFileError } from "../src/backend/file-errors";

const logger = createOpenBotLogger("verify-windows-package");

const FUSE_DISABLED = 48;
const FUSE_ENABLED = 49;

// Each launch step ends on a state or an event. This limit only turns a real hang into a clear failure:
// a slow release runner can need much more time than usual to start the first instance.
const launchStepLimitMs = 5 * 60_000;

if (process.platform !== "win32") {
  throw new Error("The Windows package verifier must run on Windows.");
}

const requireUpdateMetadata = process.argv.includes("--require-update-metadata");
// A tag build signs with `electron-builder.windows-signing.yml`. Local and dry-run builds stay unsigned.
const requireSignature = process.argv.includes("--require-signature");
const appPathArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const appPath = resolve(appPathArgument ?? "dist/win-unpacked");
const executablePath = resolve(appPath, "OpenBot.exe");
const resourcesPath = resolve(appPath, "resources");
const voiceRuntimePath = resolve(resourcesPath, "voice/runtime");
const voiceRuntimeFiles = [
  "sherpa-onnx.node",
  "sherpa-onnx-c-api.dll",
  "onnxruntime.dll",
  "onnxruntime_providers_shared.dll",
];
const voiceHostPath = resolve(resourcesPath, "app.asar.unpacked/out/main/voice-transcription-host.js");
const speechHostPath = resolve(resourcesPath, "app.asar.unpacked/out/main/voice-speech-host.js");

await Promise.all([
  access(executablePath),
  access(resolve(resourcesPath, "app.asar.unpacked/node_modules/effect/package.json")),
  access(resolve(resourcesPath, "app.asar.unpacked/node_modules/effect/dist/index.js")),
  access(resolve(resourcesPath, "app.asar")),
  access(resolve(resourcesPath, "licenses/Electron-LICENSE")),
  access(resolve(resourcesPath, "licenses/LICENSES.chromium.html")),
  access(resolve(resourcesPath, "licenses/sherpa-onnx-LICENSE")),
  access(resolve(resourcesPath, "licenses/onnxruntime-LICENSE")),
  access(resolve(resourcesPath, "licenses/NVIDIA-Parakeet-TDT-0.6B-v3-LICENSE")),
  access(resolve(resourcesPath, "licenses/Underdog-Bark-3.0-Plus-LICENSE")),
  access(resolve(resourcesPath, "licenses/OpenAI-Whisper-LICENSE")),
  access(resolve(resourcesPath, "licenses/Supertone-Supertonic-3-LICENSE")),
  ...voiceRuntimeFiles.map((name) => access(resolve(voiceRuntimePath, name))),
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
  access(resolve(resourcesPath, "remote-desktop-runtime/win32/x64/sunshine.exe")),
  access(resolve(resourcesPath, "remote-desktop-runtime/win32/x64/web-server.exe")),
  access(resolve(resourcesPath, "remote-desktop-runtime/win32/x64/streamer.exe")),
  access(resolve(resourcesPath, "remote-desktop-runtime/win32/x64/static/stream.html")),
  access(
    resolve(
      resourcesPath,
      "remote-desktop-runtime/win32/x64/assets/shaders/directx/convert_yuv420_packed_uv_type0_ps.hlsl",
    ),
  ),
  access(resolve(resourcesPath, "remote-desktop-runtime/win32/x64/SHA256SUMS.txt")),
  access(resolve(resourcesPath, "cua-driver/win32/x64/cua-driver.exe")),
  access(resolve(resourcesPath, "cua-driver/win32/x64/LICENSE.md")),
]);
// Only this platform's driver ships, so a shared `extraResources` entry is a loud failure.
await Promise.all(["darwin", "linux"].map((name) => assertAbsent(resolve(resourcesPath, "cua-driver", name))));
await Promise.all(["codex", "claude", "grok"].map((name) => assertAbsent(resolve(resourcesPath, name))));
await assertAbsent(resolve(resourcesPath, "cloudflared"));
await assertAbsent(resolve(resourcesPath, "app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64"));

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

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (!isDynamicRecord(packageJson)) throw new Error("package.json is not a JSON object.");
if (!isString(packageJson.version)) throw new Error("package.json version is missing.");

const executable = await readFile(executablePath);
if (executable.toString("ascii", 0, 2) !== "MZ") throw new Error("The executable has no MZ header.");
const peOffset = executable.readUInt32LE(0x3c);
if (executable.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
  throw new Error("The executable has no PE header.");
}
const machine = executable.readUInt16LE(peOffset + 4);
if (machine !== 0x8664) {
  throw new Error(`Expected a Windows x64 executable, but its machine type is 0x${machine.toString(16)}.`);
}

const versionInfo = JSON.parse(
  runWindowsPowerShell(
    `$value = (Get-Item -LiteralPath '${powerShellLiteral(executablePath)}').VersionInfo; ` +
      "[pscustomobject]@{ ProductName = $value.ProductName; FileDescription = $value.FileDescription; ProductVersion = $value.ProductVersion } | ConvertTo-Json -Compress",
  ),
);
if (!isDynamicRecord(versionInfo)) throw new Error("Windows version metadata is invalid.");
expectEqual(versionInfo.ProductName, "OpenBot", "product name");
expectEqual(versionInfo.FileDescription, "OpenBot", "file description");
if (!String(versionInfo.ProductVersion).startsWith(packageJson.version)) {
  throw new Error(
    `Unexpected product version: ${String(versionInfo.ProductVersion)} (expected ${packageJson.version})`,
  );
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

const ownExecutables = [
  executablePath,
  ...["sunshine.exe", "web-server.exe", "streamer.exe"].map((name) =>
    resolve(resourcesPath, "remote-desktop-runtime/win32/x64", name),
  ),
];
if (requireSignature) {
  // An installed signed build accepts an update only from this publisher, so every executable must
  // carry the name that app-update.yml gives to the updater.
  const metadata = updateMetadata === null ? null : parseYaml(updateMetadata);
  const publisherNames = isDynamicRecord(metadata) ? metadata.publisherName : undefined;
  if (!Array.isArray(publisherNames) || publisherNames.length !== 1 || !isString(publisherNames[0])) {
    throw new Error("app-update.yml must name exactly one publisher.");
  }
  const publisherName = publisherNames[0];
  for (const path of [...ownExecutables, resolve(resourcesPath, "cua-driver/win32/x64/cua-driver.exe")]) {
    verifyAuthenticode(path, "Valid", publisherName);
  }
} else {
  for (const path of ownExecutables) verifyAuthenticode(path, "NotSigned");
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
  `OpenBot ${packageJson.version} · Windows x64 · metadata · GPL remote runtime · ASAR integrity · hardened fuses · launch`,
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

function powerShellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function runWindowsPowerShell(command: string): string {
  const environment = { ...process.env };
  // GitHub's pwsh runner exports its PowerShell 7 module path. Windows PowerShell
  // must rebuild its own path so built-in modules such as Security can load.
  delete environment.PSModulePath;
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    env: environment,
  }).trim();
}

function verifyAuthenticode(path: string, expectedStatus: "NotSigned" | "Valid", publisherName?: string): void {
  // Windows PowerShell writes the console code page by default, which would garble a non-ASCII name.
  const signature = JSON.parse(
    runWindowsPowerShell(
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
        `$value = Get-AuthenticodeSignature -LiteralPath '${powerShellLiteral(path)}'; ` +
        "[pscustomobject]@{ Status = $value.Status.ToString(); Subject = $value.SignerCertificate.Subject } | ConvertTo-Json -Compress",
    ),
  );
  if (!isDynamicRecord(signature)) throw new Error(`Signature metadata is invalid for ${path}.`);
  if (signature.Status !== expectedStatus) {
    throw new Error(
      `Unexpected signature status for ${path}: ${String(signature.Status)} (expected ${expectedStatus})`,
    );
  }
  if (publisherName !== undefined && !String(signature.Subject).startsWith(`CN=${publisherName},`)) {
    throw new Error(`Unexpected signer for ${path}: ${String(signature.Subject)} (expected CN=${publisherName})`);
  }
}

async function verifyLaunch(executable: string): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), "openbot-package-smoke-"));
  const child = spawn(executable, [`--user-data-dir=${userDataPath}`], {
    env: {
      ...process.env,
      CODEX_HOME: join(userDataPath, "codex-home"),
      CLAUDE_CONFIG_DIR: join(userDataPath, "claude-home"),
      OPENBOT_CODEX_PATH: join(userDataPath, "missing-codex.exe"),
      OPENBOT_CLAUDE_PATH: join(userDataPath, "missing-claude.exe"),
      OPENBOT_GROK_PATH: join(userDataPath, "missing-grok.exe"),
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
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
    // Chromium on Windows keeps `lockfile` in userData open while main holds its single-instance lock. A
    // second instance that starts before that does not forward to the first one: it takes the lock and stays open.
    await waitForFirstInstance(
      launchExit,
      () => pathExists(join(userDataPath, "lockfile")),
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
    terminateProcessTree(child.pid);
    await Promise.race([
      new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
      new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
    ]);
    try {
      await rm(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (error) {
      logger.warn("Could not remove the temporary Windows profile:", toLogValue(error));
    }
  }
}

function terminateProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
  } catch {
    // The application can finish before taskkill reads the process tree.
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
    env: {
      ...process.env,
      CODEX_HOME: join(userDataPath, "codex-home"),
      CLAUDE_CONFIG_DIR: join(userDataPath, "claude-home"),
      OPENBOT_CODEX_PATH: join(userDataPath, "missing-codex.exe"),
      OPENBOT_CLAUDE_PATH: join(userDataPath, "missing-claude.exe"),
      OPENBOT_GROK_PATH: join(userDataPath, "missing-grok.exe"),
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
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
    if (second.exitCode === null && second.signalCode === null) terminateProcessTree(second.pid);
  }
}
