import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

export const cuaDriverTargets = ["darwin-arm64", "linux-x64", "win32-x64"] as const;
export type CuaDriverTarget = (typeof cuaDriverTargets)[number];

/** One file OpenBot copies out of a release archive, and the mode it gets on disk. */
export interface CuaDriverShippedFile {
  /** The path inside the archive. The installed tree keeps the same relative path. */
  readonly path: string;
  /** True for a file the driver runs. The installer sets the mode; an archive's bits are not trusted. */
  readonly executable: boolean;
}

interface CuaDriverTargetDescriptor {
  readonly platform: "darwin" | "linux" | "win32";
  readonly architecture: "arm64" | "x64";
  /** Appended to `cua-driver-rs-<version>-` to name the release asset. */
  readonly assetSuffix: string;
  readonly archive: "tar.gz" | "zip";
  /** The name `resolveCuaDriver` looks for inside the installed directory. */
  readonly executable: "cua-driver" | "cua-driver.exe";
  readonly files: readonly CuaDriverShippedFile[];
}

/**
 * The `-binary` assets, whose entries sit at the archive root, rather than the directory assets the
 * upstream install script uses. OpenBot needs neither extra the directory asset carries:
 *
 * - `CuaDriver.app` only exists so `cua-driver mcp` can relaunch the daemon through
 *   `open -a CuaDriver` when it has to own its own TCC identity. OpenBot spawns `serve` itself with
 *   `CUA_DRIVER_EMBEDDED=1`, so that relaunch path never runs and OpenBot stays the responsible
 *   process for both grants.
 * - `libcua_driver_sdk`, `cua_driver_node_runtime.node` and `cua_driver_abi.h` serve the native SDK
 *   bindings. OpenBot speaks MCP over stdio to the binary and links nothing.
 *
 * `cua-driver-uia.exe` is skipped for the same reason: upstream describes it as reserved for a
 * future forwarding path that nothing launches today.
 */
export const CUA_DRIVER_TARGETS = {
  "darwin-arm64": {
    platform: "darwin",
    architecture: "arm64",
    // Upstream builds one universal Mach-O for both Mac architectures, and signs only that one.
    assetSuffix: "darwin-universal-binary.tar.gz",
    archive: "tar.gz",
    executable: "cua-driver",
    files: [
      { path: "cua-driver", executable: true },
      { path: "cua-cursor-theme", executable: true },
    ],
  },
  "linux-x64": {
    platform: "linux",
    architecture: "x64",
    assetSuffix: "linux-x86_64-binary.tar.gz",
    archive: "tar.gz",
    executable: "cua-driver",
    // `wayland-helper` holds the GNOME shell extension that gives the driver window rectangles on
    // Wayland. OpenBot does not install or enable it, but the user cannot get it separately.
    files: [
      { path: "cua-driver", executable: true },
      { path: "cua-cursor-theme", executable: true },
      { path: "wayland-helper/install.sh", executable: true },
      { path: "wayland-helper/README.md", executable: false },
      { path: "wayland-helper/winrects@cua/metadata.json", executable: false },
      { path: "wayland-helper/winrects@cua/extension.js", executable: false },
    ],
  },
  "win32-x64": {
    platform: "win32",
    architecture: "x64",
    assetSuffix: "windows-x86_64-binary.zip",
    archive: "zip",
    executable: "cua-driver.exe",
    files: [
      { path: "cua-driver.exe", executable: true },
      { path: "cua-cursor-theme.exe", executable: true },
    ],
  },
} as const satisfies Record<CuaDriverTarget, CuaDriverTargetDescriptor>;

/** The licence file the driver's repository publishes, shipped next to the binary. */
export const CUA_DRIVER_LICENSE_FILE = "LICENSE.md";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u, "Must use a complete SHA-256 value.");
const cuaDriverArtifactSchema = z.object({
  asset: z.string().min(1),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  /** One digest per shipped file, keyed by its path inside the archive. */
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
      "linux-x64": cuaDriverArtifactSchema,
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

/**
 * Parses the `cuaDriver` block and checks it against the target table above. A release that renamed
 * an asset, or dropped a file OpenBot ships, has to fail here rather than produce an installer that
 * is missing a binary.
 */
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

/**
 * Where the packaging step puts a target's files. `resolveCuaDriver` reads the same
 * `<platform>/<architecture>` layout under `build/` in a checkout and under `resources/` in a
 * packaged app, so this path and `electron-builder.yml` have to agree.
 */
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
