import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { PARAKEET_MODEL_FILES, VOICE_RUNTIME_ADDON } from "../src/main/voice-model-service";

const logger = createOpenBotLogger("prepare-voice");

const SHERPA_ONNX_VERSION = "1.13.8";

interface RuntimePackage {
  name: string;
  /** The npm `dist.integrity` of the published tarball. */
  integrity: string;
  /** The addon and the libraries it loads from its own directory. */
  files: readonly string[];
}

// Only these native files run. The JavaScript wrapper of `sherpa-onnx-node` is not used: the voice
// host calls the N-API addon directly. The C++ API library is not loaded by the addon.
const RUNTIME_PACKAGES: Readonly<Record<string, RuntimePackage>> = {
  "darwin-arm64": {
    name: "sherpa-onnx-darwin-arm64",
    integrity: "sha512-FPNgJMgnWVl/KhRTIhG3KL3A4Om63Rn4YKXc9/uHY7SzLcvqLJLc/h7UBWJwduXvv7K18t5NpxHR6XgXn4sjWw==",
    files: [VOICE_RUNTIME_ADDON, "libsherpa-onnx-c-api.dylib", "libonnxruntime.dylib"],
  },
  "darwin-x64": {
    name: "sherpa-onnx-darwin-x64",
    integrity: "sha512-7BLRpjM6w4f9W46/nmkmq8lEKUayhebvcpslCVQ+6QN2uReYlZEMDZlSpXMjme+hUFrPfRz8P3UNq8ep/4d19g==",
    files: [VOICE_RUNTIME_ADDON, "libsherpa-onnx-c-api.dylib", "libonnxruntime.dylib"],
  },
  "win32-x64": {
    name: "sherpa-onnx-win-x64",
    integrity: "sha512-oZF1c9VPOKtMwn83Bboc5XSWL+76BRoyB3eUuVnCknBKxwSULZU2Foia9VHWzU+n4I12rPsP6z6H9Rp1hD9o8g==",
    files: [VOICE_RUNTIME_ADDON, "sherpa-onnx-c-api.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll"],
  },
};

const buildRoot = resolve(".openbot-build/voice");
const runtimeRoot = join(buildRoot, "runtime");
const modelRoot = join(buildRoot, "model");
// Beside the runtime, not in it: electron-builder copies the whole runtime directory.
const runtimeMarker = join(buildRoot, "runtime-package.txt");
const runtimeOnly = process.argv.includes("--runtime-only");
const target = `${process.platform}-${process.arch}`;
const runtimePackage = RUNTIME_PACKAGES[target];

if (!runtimePackage) {
  throw new Error(`Voice assets can be prepared only on macOS (arm64, x64) or Windows (x64), not ${target}.`);
}

requireCommand("tar", ["--version"]);
await prepareRuntime(runtimePackage);
if (!runtimeOnly) await prepareModel();
logger.info(`Prepared voice assets in ${buildRoot}`);

async function prepareRuntime(runtime: RuntimePackage): Promise<void> {
  const marker = `${runtime.name}@${SHERPA_ONNX_VERSION}`;
  if (
    existsSync(runtimeMarker) &&
    (await readFile(runtimeMarker, "utf8")).trim() === marker &&
    runtime.files.every((file) => existsSync(join(runtimeRoot, file)))
  ) {
    return;
  }
  await mkdir(buildRoot, { recursive: true });
  const workRoot = await mkdtemp(join(buildRoot, "runtime-download-"));
  try {
    const url = `https://registry.npmjs.org/${runtime.name}/-/${runtime.name}-${SHERPA_ONNX_VERSION}.tgz`;
    logger.info(`Downloading ${runtime.name}@${SHERPA_ONNX_VERSION}…`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to download ${runtime.name} (${response.status}).`);
    const archive = Buffer.from(await response.arrayBuffer());
    const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    if (integrity !== runtime.integrity) throw new Error(`The downloaded ${runtime.name} failed its SHA-512 check.`);
    const archivePath = join(workRoot, "package.tgz");
    const extractRoot = join(workRoot, "extract");
    await Promise.all([writeFile(archivePath, archive), mkdir(extractRoot)]);
    execFileSync("tar", ["-xzf", archivePath, "-C", extractRoot], { stdio: "inherit" });
    await rm(runtimeMarker, { force: true });
    await rm(runtimeRoot, { recursive: true, force: true });
    await mkdir(runtimeRoot, { recursive: true });
    for (const file of runtime.files) copyFileSync(join(extractRoot, "package", file), join(runtimeRoot, file));
    await writeFile(runtimeMarker, `${marker}\n`);
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

async function prepareModel(): Promise<void> {
  await mkdir(modelRoot, { recursive: true });
  await removeOtherModels();
  for (const file of PARAKEET_MODEL_FILES) {
    const path = join(modelRoot, file.name);
    if (await isExpectedFile(path, file.bytes, file.sha256)) continue;
    logger.info(`Downloading ${file.name}…`);
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`Unable to download ${file.name} (${response.status}).`);
    const partialPath = `${path}.part`;
    await writeFile(partialPath, Buffer.from(await response.arrayBuffer()));
    if (!(await isExpectedFile(partialPath, file.bytes, file.sha256))) {
      await rm(partialPath, { force: true });
      throw new Error(`The downloaded ${file.name} failed its size or SHA-256 check.`);
    }
    await rename(partialPath, path);
  }
}

/** Removes model files of an earlier pin, so a stale encoder cannot be packaged or loaded by mistake. */
async function removeOtherModels(): Promise<void> {
  const expected = new Set(PARAKEET_MODEL_FILES.map((file) => file.name));
  const entries = await readdir(modelRoot);
  await Promise.all(
    entries
      .filter((entry) => /\.(onnx|txt|part)$/u.test(entry) && !expected.has(entry))
      .map((entry) => rm(join(modelRoot, entry), { force: true })),
  );
}

async function isExpectedFile(path: string, bytes: number, expectedSha256: string): Promise<boolean> {
  if (!existsSync(path) || (await stat(path)).size !== bytes) return false;
  return (await sha256(path)) === expectedSha256;
}

function requireCommand(command: string, arguments_: string[]): void {
  try {
    execFileSync(command, arguments_, { stdio: "ignore" });
  } catch {
    throw new Error(`${command} is required to prepare local voice transcription assets.`);
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
