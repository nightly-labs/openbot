import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

export const cuaDriverTargets = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"] as const;
export type CuaDriverTarget = (typeof cuaDriverTargets)[number];

export interface CuaDriverShippedFile {
  readonly path: string;
  readonly executable: boolean;
}

interface CuaDriverTargetDescriptor {
  readonly platform: "darwin" | "linux" | "win32";
  readonly architecture: "arm64" | "x64";
  readonly assetSuffix: string;
  readonly archive: "tar.gz" | "zip";
  readonly executable: "cua-driver" | "cua-driver.exe";
  readonly files: readonly CuaDriverShippedFile[];
}

const LINUX_FILES = [
  { path: "cua-driver", executable: true },
  { path: "wayland-helper/install.sh", executable: true },
  { path: "wayland-helper/README.md", executable: false },
  { path: "wayland-helper/winrects@cua/metadata.json", executable: false },
  { path: "wayland-helper/winrects@cua/extension.js", executable: false },
] as const satisfies readonly CuaDriverShippedFile[];

export const CUA_DRIVER_TARGETS = {
  "darwin-arm64": {
    platform: "darwin",
    architecture: "arm64",
    assetSuffix: "darwin-universal-binary.tar.gz",
    archive: "tar.gz",
    executable: "cua-driver",
    files: [{ path: "cua-driver", executable: true }],
  },
  "darwin-x64": {
    platform: "darwin",
    architecture: "x64",
    assetSuffix: "darwin-universal-binary.tar.gz",
    archive: "tar.gz",
    executable: "cua-driver",
    files: [{ path: "cua-driver", executable: true }],
  },
  "linux-x64": {
    platform: "linux",
    architecture: "x64",
    assetSuffix: "linux-x86_64-binary.tar.gz",
    archive: "tar.gz",
    executable: "cua-driver",
    files: LINUX_FILES,
  },
  "linux-arm64": {
    platform: "linux",
    architecture: "arm64",
    assetSuffix: "linux-arm64-binary.tar.gz",
    archive: "tar.gz",
    executable: "cua-driver",
    files: LINUX_FILES,
  },
  "win32-x64": {
    platform: "win32",
    architecture: "x64",
    assetSuffix: "windows-x86_64-binary.zip",
    archive: "zip",
    executable: "cua-driver.exe",
    files: [{ path: "cua-driver.exe", executable: true }],
  },
} as const satisfies Record<CuaDriverTarget, CuaDriverTargetDescriptor>;

export const CUA_DRIVER_LICENSE_FILE = "LICENSE.md";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u, "Must use a complete SHA-256 value.");
const cuaDriverArtifactSchema = z.object({
  asset: z.string().min(1),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  files: z.record(z.string().min(1), sha256Schema),
});

const cuaDriverLockSchema = z.object({
  cuaDriver: z.object({
    repository: z.literal("https://github.com/trycua/cua"),
    tag: z.string().regex(/^cua-driver-rs-v\d+\.\d+\.\d+$/u),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    license: z.literal("MIT"),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": cuaDriverArtifactSchema,
      "darwin-x64": cuaDriverArtifactSchema,
      "linux-x64": cuaDriverArtifactSchema,
      "linux-arm64": cuaDriverArtifactSchema,
      "win32-x64": cuaDriverArtifactSchema,
    }),
  }),
});

export type CuaDriverLock = z.infer<typeof cuaDriverLockSchema>["cuaDriver"];
export type CuaDriverArtifact = z.infer<typeof cuaDriverArtifactSchema>;

export async function loadCuaDriverLock(sourceRoot = process.cwd()): Promise<CuaDriverLock> {
  const path = resolve(sourceRoot, "native-runtime.lock.json");
  return parseCuaDriverLock(JSON.parse(await readFile(path, "utf8")));
}

export function parseCuaDriverLock(value: unknown): CuaDriverLock {
  const lock = cuaDriverLockSchema.parse(value).cuaDriver;
  if (lock.tag !== `cua-driver-rs-v${lock.version}`) {
    throw new Error("The cua-driver tag and version disagree.");
  }
  for (const target of cuaDriverTargets) {
    const descriptor = CUA_DRIVER_TARGETS[target];
    const artifact = lock.artifacts[target];
    const expectedAsset = cuaDriverAssetName(lock.version, target);
    if (artifact.asset !== expectedAsset) {
      throw new Error(`The ${target} cua-driver asset is ${artifact.asset} and not ${expectedAsset}.`);
    }
    const pinned = Object.keys(artifact.files).sort();
    const shipped = descriptor.files.map((file) => file.path).sort();
    if (pinned.length !== shipped.length || pinned.some((path, index) => path !== shipped[index])) {
      throw new Error(`The ${target} cua-driver pin does not list the files OpenBot ships.`);
    }
  }
  return lock;
}

export function cuaDriverAssetName(version: string, target: CuaDriverTarget): string {
  return `cua-driver-rs-${version}-${CUA_DRIVER_TARGETS[target].assetSuffix}`;
}

export function cuaDriverDownloadUrl(lock: CuaDriverLock, asset: string): string {
  return `${lock.repository}/releases/download/${encodeURIComponent(lock.tag)}/${encodeURIComponent(asset)}`;
}

export function cuaDriverLicenseUrl(lock: CuaDriverLock): string {
  return `${lock.repository}/raw/${encodeURIComponent(lock.tag)}/${CUA_DRIVER_LICENSE_FILE}`;
}

export function cuaDriverInstallRoot(sourceRoot: string, target: CuaDriverTarget): string {
  const { platform, architecture } = CUA_DRIVER_TARGETS[target];
  return resolve(sourceRoot, "build/cua-driver", platform, architecture);
}

export function cuaDriverTarget(
  platform: string = process.platform,
  architecture: string = process.arch,
): CuaDriverTarget {
  const target = cuaDriverTargets.find(
    (candidate) =>
      CUA_DRIVER_TARGETS[candidate].platform === platform &&
      CUA_DRIVER_TARGETS[candidate].architecture === architecture,
  );
  if (!target) throw new Error(`Unsupported cua-driver target: ${platform}-${architecture}.`);
  return target;
}
