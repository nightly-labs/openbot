import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { PARAKEET_MODEL_FILES, VOICE_RUNTIME_ADDON, VOICE_SESSION_CONFIGS } from "../src/main/voice-model-service";
import { elfSearchPaths, ORIGIN_SEARCH_PATH } from "./elf-search-paths";

const logger = createOpenBotLogger("prepare-voice");

const SHERPA_ONNX_VERSION = "2.0.3";

interface RuntimePackage {
  name: string;
  integrity: string;
  files: readonly string[];
}

const RUNTIME_PACKAGES: Readonly<Record<string, RuntimePackage>> = {
  "darwin-arm64": {
    name: "sherpa-onnx-darwin-arm64",
    integrity: "sha512-PuPsSgMvzKYYBG+/CwEZbbtl4kmztravlpN8KmsQy2jWGJ3WjEJ1NkPzUNgEbrq/9s5xnyd20FFlWJXOIcAHoA==",
    files: [VOICE_RUNTIME_ADDON, "libsherpa-onnx-c-api.dylib", "libonnxruntime.dylib"],
  },
  "darwin-x64": {
    name: "sherpa-onnx-darwin-x64",
    integrity: "sha512-ZFSsikOf0xrnvEl8Xj5Z8IpG0hqWGFDy3HwLFagwV1apftVgh/SVXbwQ+pIf0xFRBrAr+SaR3asvoCEc6DxOSg==",
    files: [VOICE_RUNTIME_ADDON, "libsherpa-onnx-c-api.dylib", "libonnxruntime.dylib"],
  },
  "win32-x64": {
    name: "sherpa-onnx-win-x64",
    integrity: "sha512-UDPUCNmuhWWC0oNMphHjgdRE0M8bVbUFXk9AyyJUuOtubmxhQBLz2sd2v6RWIAXSDh/7GwPbImLqAWI51ITTNQ==",
    files: [VOICE_RUNTIME_ADDON, "sherpa-onnx-c-api.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll"],
  },
  "linux-x64": {
    name: "sherpa-onnx-linux-x64",
    integrity: "sha512-cORrflhfgu/vD22UAfU4DvwCjKC6cSmVGM2o2fXnM6O9meN8Mpu5enqb/afIi+Nwweo9eS6YmaQcvmT+L6ia2A==",
    files: [VOICE_RUNTIME_ADDON, "libsherpa-onnx-c-api.so", "libonnxruntime.so"],
  },
  "linux-arm64": {
    name: "sherpa-onnx-linux-arm64",
    integrity: "sha512-F4cciAFw4rrV39CR6o1yNLG1e/Gcd4Je2wGxi4Q+jl1NJh7VSvE3n4NCz4bQzBlvZWgU8ThhV9ggD6xC5iJWFQ==",
    files: [VOICE_RUNTIME_ADDON, "libsherpa-onnx-c-api.so", "libonnxruntime.so"],
  },
};

const buildRoot = resolve(".openbot-build/voice");
const runtimeRoot = join(buildRoot, "runtime");
const modelRoot = join(buildRoot, "model");
const runtimeMarker = join(buildRoot, "runtime-package.txt");
const runtimeOnly = process.argv.includes("--runtime-only");
const target = `${process.platform}-${process.arch}`;
const runtimePackage = RUNTIME_PACKAGES[target];

if (!runtimePackage) {
  throw new Error(
    `Voice assets can be prepared only on macOS (arm64, x64), Windows (x64) or Linux (x64, arm64), not ${target}.`,
  );
}

requireCommand("tar", ["--version"]);
await prepareRuntime(runtimePackage);
await writeSessionConfigs();
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
    for (const file of runtime.files) {
      copyFileSync(join(extractRoot, "package", file), join(runtimeRoot, file));
      if (process.platform === "linux") pinSearchPathToOrigin(join(runtimeRoot, file));
    }
    await writeFile(runtimeMarker, `${marker}\n`);
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

async function writeSessionConfigs(): Promise<void> {
  await Promise.all(
    Object.entries(VOICE_SESSION_CONFIGS).map(([name, content]) => writeFile(join(runtimeRoot, name), content)),
  );
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

function pinSearchPathToOrigin(path: string): void {
  const file = readFileSync(path);
  const paths = elfSearchPaths(file).filter(({ value }) => value !== ORIGIN_SEARCH_PATH);
  if (paths.length === 0) return;
  for (const { offset, value } of paths) {
    if (!value.startsWith(`${ORIGIN_SEARCH_PATH}:`))
      throw new Error(`Unexpected library search path in ${path}: ${value}`);
    file.fill(0, offset, offset + Buffer.byteLength(value));
    file.write(ORIGIN_SEARCH_PATH, offset, "utf8");
  }
  writeFileSync(path, file);
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
