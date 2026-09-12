import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("verify-linux-package");

const FUSE_DISABLED = 48;
const FUSE_ENABLED = 49;

if (process.platform !== "linux") {
  throw new Error("The Linux package verifier must run on Linux.");
}

const requireUpdateMetadata = process.argv.includes("--require-update-metadata");
const appPathArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const appPath = resolve(appPathArgument ?? "dist/linux-unpacked");
// electron-builder names the Linux binary after `name` in package.json, not `productName`.
const executablePath = resolve(appPath, "openbot");
const resourcesPath = resolve(appPath, "resources");
const asarPath = resolve(resourcesPath, "app.asar");

await Promise.all([
  access(executablePath),
  access(asarPath),
  access(resolve(resourcesPath, "managed-skills")),
  access(resolve(resourcesPath, "licenses/Electron-LICENSE")),
  access(resolve(resourcesPath, "licenses/LICENSES.chromium.html")),
]);

// Voice and remote desktop are not built for Linux. These two assertions are the regression guard
// for the platform split of `extraResources`: if either ever returns to the shared list, the Linux
// build either fails outright on a missing source or ships a runtime it cannot use.
await assertAbsent(resolve(resourcesPath, "whisper"), "Voice transcription is not available on Linux");
await assertAbsent(resolve(resourcesPath, "remote-desktop-runtime"), "Remote desktop is not available on Linux");

// Providers and the tunnel are downloaded on demand, exactly as on macOS and Windows.
await Promise.all(
  ["codex", "claude", "grok", "cloudflared"].map((name) =>
    assertAbsent(resolve(resourcesPath, name), "Runtimes must not be packaged"),
  ),
);
await assertAbsent(
  resolve(resourcesPath, "app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64"),
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

const executable = await readFile(executablePath);
if (executable.toString("binary", 0, 4) !== "\x7fELF") throw new Error("The executable has no ELF header.");
if (executable[4] !== 2) throw new Error("Expected a 64-bit ELF executable.");
const machine = executable.readUInt16LE(18);
if (machine !== 0x3e) {
  throw new Error(`Expected a Linux x86-64 executable, but its ELF machine type is 0x${machine.toString(16)}.`);
}

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
  `OpenBot ${packageJson.version} · Linux x64 · manifest · no voice or remote desktop · ASAR integrity · hardened fuses · launch`,
);

function expectEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`Unexpected ${label}: ${String(actual)} (expected ${String(expected)})`);
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

  try {
    await Promise.race([
      new Promise<never>((_, reject) => {
        child.once("exit", (code, signal) => {
          reject(
            new Error(`Packaged OpenBot exited during launch (${signal ?? `code ${String(code)}`}): ${stderr.trim()}`),
          );
        });
      }),
      new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 3_000)),
    ]);
    await verifySecondInstanceExits(executable, userDataPath);
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

async function verifySecondInstanceExits(executable: string, userDataPath: string): Promise<void> {
  const second = spawn(executable, [`--user-data-dir=${userDataPath}`], {
    env: launchEnvironment(userDataPath),
    stdio: "ignore",
  });
  const result = await Promise.race([
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      second.once("exit", (code, signal) => resolveExit({ code, signal }));
    }),
    new Promise<null>((resolveDelay) => setTimeout(() => resolveDelay(null), 3_000)),
  ]);
  if (!result) {
    second.kill();
    throw new Error("A second OpenBot instance did not exit.");
  }
  if (result.code !== 0 || result.signal) {
    throw new Error(
      `A second OpenBot instance exited unexpectedly (${result.signal ?? `code ${String(result.code)}`}).`,
    );
  }
}
