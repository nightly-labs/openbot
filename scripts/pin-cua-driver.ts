import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CUA_DRIVER_LICENSE_FILE,
  CUA_DRIVER_TARGETS,
  type CuaDriverLock,
  type CuaDriverTarget,
  cuaDriverTargets,
  parseCuaDriverLock,
} from "./cua-driver-lock";
import { sha256 } from "./remote-desktop-runtime-release";

const REPOSITORY = "https://github.com/trycua/cua";

/**
 * Recomputes the `cuaDriver` block of `native-runtime.lock.json` from a published release.
 *
 * Every target is downloaded, because the pin records a digest for each file OpenBot ships and
 * those can only be read out of the archive. Expect around 90 MB of traffic per run.
 */
export async function pinCuaDriver(
  input: { version: string; fetchImpl?: typeof fetch } = { version: "" },
): Promise<CuaDriverLock> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const version = input.version;
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`Not a cua-driver release version: ${version}`);
  const tag = `cua-driver-rs-v${version}`;

  const license = await download(fetchImpl, `${REPOSITORY}/raw/${tag}/${CUA_DRIVER_LICENSE_FILE}`);
  const artifacts = {
    "darwin-arm64": await pinArtifact(fetchImpl, "darwin-arm64", version, tag),
    "linux-x64": await pinArtifact(fetchImpl, "linux-x64", version, tag),
    "win32-x64": await pinArtifact(fetchImpl, "win32-x64", version, tag),
  };
  return parseCuaDriverLock({
    cuaDriver: {
      repository: REPOSITORY,
      tag,
      version,
      license: "MIT",
      licenseSha256: sha256(license),
      artifacts,
    },
  });
}

async function pinArtifact(fetchImpl: typeof fetch, target: CuaDriverTarget, version: string, tag: string) {
  const descriptor = CUA_DRIVER_TARGETS[target];
  const asset = `cua-driver-rs-${version}-${descriptor.assetSuffix}`;
  const archiveBytes = await download(fetchImpl, `${REPOSITORY}/releases/download/${tag}/${asset}`);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-cua-driver-pin-"));
  try {
    const archive = join(temporaryRoot, asset);
    const extracted = join(temporaryRoot, "extracted");
    await writeFile(archive, archiveBytes, { mode: 0o600 });
    await mkdir(extracted, { recursive: true });
    if (descriptor.archive === "zip") {
      execFileSync("unzip", ["-q", "-o", archive, "-d", extracted], { stdio: "inherit" });
    } else {
      execFileSync("tar", ["-xzf", archive, "-C", extracted, "--no-same-owner"], { stdio: "inherit" });
    }
    const files: Record<string, string> = {};
    for (const file of descriptor.files) {
      const path = join(extracted, ...file.path.split("/"));
      const metadata = await lstat(path);
      if (!metadata.isFile()) throw new Error(`The ${target} archive entry ${file.path} is not a plain file.`);
      files[file.path] = sha256(await readFile(path));
    }
    return { asset, assetSha256: sha256(archiveBytes), downloadBytes: archiveBytes.byteLength, files };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function download(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  const response = await fetchImpl(url, { headers: { "User-Agent": "OpenBot-runtime-pin" }, redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) throw new Error("Usage: bun scripts/pin-cua-driver.ts <version>");
  const pin = await pinCuaDriver({ version });
  process.stdout.write(`${JSON.stringify({ cuaDriver: pin }, null, 2)}\n`);
  for (const target of cuaDriverTargets) {
    if (
      `${CUA_DRIVER_TARGETS[target].platform}-${CUA_DRIVER_TARGETS[target].architecture}` !==
      `${process.platform}-${process.arch}`
    ) {
      process.stdout.write(`This host cannot run the ${target} binary, so its version is not asserted.\n`);
    }
  }
  process.stdout.write('Copy the "cuaDriver" block above into native-runtime.lock.json.\n');
}
