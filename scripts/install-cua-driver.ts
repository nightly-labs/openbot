import { execFileSync } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import {
  CUA_DRIVER_LICENSE_FILE,
  CUA_DRIVER_TARGETS,
  type CuaDriverLock,
  type CuaDriverTarget,
  cuaDriverDownloadUrl,
  cuaDriverInstallRoot,
  cuaDriverLicenseUrl,
  cuaDriverTarget,
  loadCuaDriverLock,
} from "./cua-driver-lock";
import { sha256 } from "./remote-desktop-runtime-release";

const logger = createOpenBotLogger("install-cua-driver");

/**
 * Puts the pinned `cua-driver` build under `build/cua-driver/<platform>/<architecture>` so
 * `electron-builder` can ship it as `resources/cua-driver/<platform>/<architecture>`.
 *
 * The release is fetched by its direct download URL rather than through the GitHub releases API:
 * the tag and every digest are already pinned, so the API adds a rate limit and a token
 * requirement without adding a check that the digests do not already make.
 */
export async function installCuaDriver(
  input: { sourceRoot?: string; outputRoot?: string; target?: CuaDriverTarget; fetchImpl?: typeof fetch } = {},
): Promise<"installed" | "current"> {
  const sourceRoot = input.sourceRoot ?? process.cwd();
  const target = input.target ?? cuaDriverTarget();
  const outputRoot = input.outputRoot ?? cuaDriverInstallRoot(sourceRoot, target);
  const fetchImpl = input.fetchImpl ?? fetch;
  const lock = await loadCuaDriverLock(sourceRoot);
  const artifact = lock.artifacts[target];

  if (await isCurrentInstallation(outputRoot, target, lock)) {
    logger.info(`The ${target} cua-driver ${lock.version} build is current.`);
    return "current";
  }

  const archiveBytes = await download(fetchImpl, cuaDriverDownloadUrl(lock, artifact.asset));
  if (archiveBytes.byteLength !== artifact.downloadBytes) {
    throw new Error(
      `The ${target} cua-driver asset is ${archiveBytes.byteLength} bytes and not ${artifact.downloadBytes}.`,
    );
  }
  if (sha256(archiveBytes) !== artifact.assetSha256) {
    throw new Error(`The ${target} cua-driver asset checksum is invalid.`);
  }
  const licenseBytes = await download(fetchImpl, cuaDriverLicenseUrl(lock));
  if (sha256(licenseBytes) !== lock.licenseSha256) throw new Error("The cua-driver licence checksum is invalid.");

  const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-cua-driver-install-"));
  // The staging tree is a sibling of the installed one so the final step is a rename inside one
  // directory. A temporary directory could sit on another volume, where a rename fails.
  const staging = join(dirname(outputRoot), `.${basename(outputRoot)}.installing`);
  try {
    const archive = join(temporaryRoot, artifact.asset);
    const extracted = join(temporaryRoot, "extracted");
    await writeFile(archive, archiveBytes, { mode: 0o600 });
    await mkdir(extracted, { recursive: true });
    extractArchive(archive, extracted, target);
    await rm(staging, { recursive: true, force: true });
    await stageValidatedFiles(extracted, staging, target, lock);
    await writeFile(join(staging, CUA_DRIVER_LICENSE_FILE), licenseBytes, { mode: 0o644 });
    await verifyCuaDriverTree(staging, target, lock);
    await rm(outputRoot, { recursive: true, force: true });
    await rename(staging, outputRoot);
    await verifyCuaDriverTree(outputRoot, target, lock);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
  logger.info(`Installed cua-driver ${lock.version} for ${target}.`);
  return "installed";
}

/**
 * Checks an installed tree against the pin.
 *
 * Only the files the pin names are checked, because only those files were ever copied: the staging
 * step reads the archive by name instead of moving a directory, so nothing else reaches the tree.
 */
export async function verifyCuaDriverTree(root: string, target: CuaDriverTarget, lock: CuaDriverLock): Promise<void> {
  const artifact = lock.artifacts[target];
  for (const file of CUA_DRIVER_TARGETS[target].files) {
    const path = join(root, ...file.path.split("/"));
    const contents = await readFile(path);
    if (sha256(contents) !== artifact.files[file.path]) {
      throw new Error(`The installed cua-driver file ${file.path} does not match the pin.`);
    }
    if (process.platform !== "win32" && file.executable) {
      const metadata = await lstat(path);
      if ((metadata.mode & 0o111) === 0) throw new Error(`The installed cua-driver file ${file.path} is not runnable.`);
    }
  }
  const license = await readFile(join(root, CUA_DRIVER_LICENSE_FILE));
  if (sha256(license) !== lock.licenseSha256)
    throw new Error("The installed cua-driver licence does not match the pin.");
}

/** Copies the pinned files out of an extracted archive, rejecting anything that is not a plain file. */
async function stageValidatedFiles(
  extracted: string,
  staging: string,
  target: CuaDriverTarget,
  lock: CuaDriverLock,
): Promise<void> {
  const artifact = lock.artifacts[target];
  for (const file of CUA_DRIVER_TARGETS[target].files) {
    const parts = file.path.split("/");
    const source = join(extracted, ...parts);
    const metadata = await lstat(source);
    if (!metadata.isFile()) throw new Error(`The cua-driver archive entry ${file.path} is not a plain file.`);
    if (sha256(await readFile(source)) !== artifact.files[file.path]) {
      throw new Error(`The cua-driver archive file ${file.path} does not match the pin.`);
    }
    const destination = join(staging, ...parts);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, file.executable ? 0o755 : 0o644);
  }
}

function extractArchive(archive: string, destination: string, target: CuaDriverTarget): void {
  if (CUA_DRIVER_TARGETS[target].archive === "zip") {
    execFileSync("unzip", ["-q", "-o", archive, "-d", destination], { stdio: "inherit" });
    return;
  }
  execFileSync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"], { stdio: "inherit" });
}

async function isCurrentInstallation(root: string, target: CuaDriverTarget, lock: CuaDriverLock): Promise<boolean> {
  try {
    await verifyCuaDriverTree(root, target, lock);
    return true;
  } catch {
    return false;
  }
}

async function download(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  const response = await fetchImpl(url, { headers: { "User-Agent": "OpenBot-runtime-installer" }, redirect: "follow" });
  if (!response.ok) throw new Error(`The cua-driver download answered HTTP ${response.status} for ${url}.`);
  return Buffer.from(await response.arrayBuffer());
}

if (import.meta.main) {
  await installCuaDriver({ target: cuaDriverTarget(process.argv[2], process.argv[3]) });
}
