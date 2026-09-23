import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type AgentRuntimeLock, loadAgentRuntimeLock } from "./agent-runtime-lock";
import { sha256, sha256File } from "./remote-desktop-runtime-release";

export type BunRuntimeTarget = "darwin-arm64" | "linux-x64" | "linux-arm64" | "win32-x64";

/**
 * The npm platform package and the executable inside it, per target OpenBot supports.
 *
 * `baseline` on x64, as the lock file's own comment explains: Bun's plain x64 builds need AVX2, and
 * an older machine answers a spawn with an illegal instruction and no message.
 */
const TARGETS = {
  "darwin-arm64": { package: "@oven/bun-darwin-aarch64", executable: "bun" },
  "linux-x64": { package: "@oven/bun-linux-x64-baseline", executable: "bun" },
  "linux-arm64": { package: "@oven/bun-linux-aarch64", executable: "bun" },
  "win32-x64": { package: "@oven/bun-windows-x64-baseline", executable: "bun.exe" },
} as const satisfies Record<BunRuntimeTarget, { package: string; executable: string }>;

/** The same keys as `TARGETS`, in the order the lock file lists them. */
const TARGET_IDS: readonly BunRuntimeTarget[] = ["darwin-arm64", "linux-x64", "linux-arm64", "win32-x64"];

const REGISTRY = "https://registry.npmjs.org";
const REPOSITORY = "https://github.com/oven-sh/bun";
/**
 * `installedBytes` only funds the manager's free-space precheck, so it is rounded generously - and
 * doubled, because the staged layout holds the binary twice under the second name `bunx`. That is
 * a hard link on an ordinary filesystem and costs nothing; the precheck has to assume the
 * filesystem that refuses one and takes the copy instead.
 */
const DISK_COPIES = 2;
const DISK_HEADROOM = 1.05;
const DISK_GRANULARITY = 10_000_000;

const umbrellaSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/u) });
const platformSchema = z.object({
  name: z.string(),
  version: z.string(),
  dist: z.object({
    tarball: z.string().url(),
    unpackedSize: z.number().int().positive(),
  }),
});
const packageManifestSchema = z.object({ name: z.string(), version: z.string() });

export interface BunRuntimePin {
  registry: string;
  repository: string;
  version: string;
  tag: string;
  license: "MIT";
  licenseSha256: string;
  artifacts: Record<BunRuntimeTarget, BunArtifactPin>;
}

interface BunArtifactPin {
  package: string;
  asset: string;
  assetSha256: string;
  binarySha256: string;
  downloadBytes: number;
  installedBytes: number;
  executable: string;
}

/**
 * Recomputes the `bun` block of `native-runtime.lock.json` from the npm registry.
 *
 * Run this at release preparation, not on a schedule: a pinned runtime is OpenBot's supply chain,
 * and moving it is a reviewed commit like any other dependency change. `verifyInstalledRuntime`
 * compares `bun --version` against `lock.bun.version` for exact equality, so a pin is only
 * trustworthy if the staged binary really prints that string. This script asserts it on the target
 * that matches the host; the others are asserted by whoever runs it on a matching machine, or
 * by the first install on one.
 */
export async function pinBunRuntime(
  input: {
    version?: string;
    fetchImpl?: typeof fetch;
    /** Set to false to skip the `--version` assertion on the target that matches this host. */
    runBinary?: boolean;
  } = {},
): Promise<BunRuntimePin> {
  const fetchImpl = input.fetchImpl ?? fetch;
  // The `bun` package itself only decides which version "latest" means. It does not list the
  // baseline builds below - they are published beside it under the same version - so nothing here
  // can be read out of its `optionalDependencies`.
  const umbrella = await fetchParsed(fetchImpl, `${REGISTRY}/bun/${input.version ?? "latest"}`, umbrellaSchema);
  const version = umbrella.version;

  const pinTarget = (target: BunRuntimeTarget) => pinArtifact(fetchImpl, target, version, input.runBinary);
  // One target at a time, in the lock file's order: four 40 MB downloads at once only make the
  // registry slower, and a literal is what proves every key is present without an assertion.
  const artifacts: Record<BunRuntimeTarget, BunArtifactPin> = {
    "darwin-arm64": await pinTarget("darwin-arm64"),
    "linux-x64": await pinTarget("linux-x64"),
    "linux-arm64": await pinTarget("linux-arm64"),
    "win32-x64": await pinTarget("win32-x64"),
  };

  const tag = `bun-v${version}`;
  const license = await fetchBytes(fetchImpl, `${REPOSITORY}/raw/${tag}/LICENSE.md`);
  return {
    registry: REGISTRY,
    repository: REPOSITORY,
    version,
    tag,
    license: "MIT",
    licenseSha256: sha256(license),
    artifacts,
  };
}

async function pinArtifact(
  fetchImpl: typeof fetch,
  target: BunRuntimeTarget,
  version: string,
  runBinary = true,
): Promise<BunArtifactPin> {
  const descriptor = TARGETS[target];
  const platform = await fetchParsed(fetchImpl, `${REGISTRY}/${descriptor.package}/${version}`, platformSchema);
  if (platform.name !== descriptor.package || platform.version !== version) {
    throw new Error(`The registry served the wrong package for ${target}.`);
  }
  // The scope is not part of the file name: `@oven/bun-darwin-aarch64` is served as
  // `bun-darwin-aarch64-<version>.tgz`, and the descriptor in the app builds the same URL.
  const asset = `${descriptor.package.replace(/^@[^/]+\//u, "")}-${version}.tgz`;
  if (platform.dist.tarball !== `${REGISTRY}/${descriptor.package}/-/${asset}`) {
    throw new Error(`Unexpected tarball URL for ${target}: ${platform.dist.tarball}`);
  }

  const archiveBytes = await fetchBytes(fetchImpl, platform.dist.tarball);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-bun-pin-"));
  try {
    const archive = join(temporaryRoot, asset);
    const extracted = join(temporaryRoot, "extracted");
    await writeFile(archive, archiveBytes, { mode: 0o600 });
    validateBunArchive(archive, descriptor.executable);
    await mkdir(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", extracted, "--no-same-owner"], { stdio: "inherit" });
    const packageRoot = join(extracted, "package");
    const manifest = packageManifestSchema.parse(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")));
    if (manifest.name !== descriptor.package || manifest.version !== version) {
      throw new Error(`The ${target} package manifest does not match the registry metadata.`);
    }
    const binary = join(packageRoot, "bin", descriptor.executable);
    if (runBinary && target === `${process.platform}-${process.arch}`) {
      await chmod(binary, 0o755);
      const printed = execFileSync(binary, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
      if (printed !== version) {
        throw new Error(`The ${target} binary prints "${printed}" and not "${version}".`);
      }
    }
    const installed = platform.dist.unpackedSize * DISK_COPIES * DISK_HEADROOM;
    return {
      package: descriptor.package,
      asset,
      assetSha256: sha256(archiveBytes),
      binarySha256: await sha256File(binary),
      downloadBytes: archiveBytes.byteLength,
      installedBytes: Math.ceil(installed / DISK_GRANULARITY) * DISK_GRANULARITY,
      executable: descriptor.executable,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

/** The Bun platform tarball is three files, and anything else is not the package we pinned. */
export function validateBunArchive(archive: string, executable: string): string[] {
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean);
  const details = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean);
  if (details.some((line) => !["-", "d"].includes(line.trimStart().charAt(0)))) {
    throw new Error("The Bun runtime archive contains a link or a special file.");
  }
  for (const name of names) {
    if (name.includes("\0") || name.includes("\\")) throw new Error(`Unsafe Bun archive path: ${name}`);
    const parts = name.replace(/\/+$/u, "").split("/");
    if (parts[0] !== "package" || parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Unsafe Bun archive path: ${name}`);
    }
  }
  for (const required of ["package/package.json", `package/bin/${executable}`]) {
    if (!names.includes(required)) throw new Error(`The Bun runtime archive is missing ${required}.`);
  }
  return names;
}

/** Fetches one registry document and parses it, so no caller ever holds the raw JSON. */
async function fetchParsed<Schema extends z.ZodType>(
  fetchImpl: typeof fetch,
  url: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  return schema.parse(JSON.parse(Buffer.from(await fetchBytes(fetchImpl, url)).toString("utf8")));
}

async function fetchBytes(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "OpenBot-runtime-pin" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

/** True when the pin matches what `native-runtime.lock.json` already holds. */
export function isPinnedAlready(pin: BunRuntimePin, lock: AgentRuntimeLock): boolean {
  return JSON.stringify(pin) === JSON.stringify(lock.bun);
}

if (import.meta.main) {
  const pin = await pinBunRuntime({ version: process.argv[2] });
  const lock = await loadAgentRuntimeLock().catch(() => null);
  process.stdout.write(`${JSON.stringify({ bun: pin }, null, 2)}\n`);
  for (const target of TARGET_IDS) {
    if (target !== `${process.platform}-${process.arch}`) {
      process.stdout.write(`This host cannot run the ${target} binary, so its version is not asserted.\n`);
    }
  }
  if (lock && isPinnedAlready(pin, lock)) {
    process.stdout.write(`native-runtime.lock.json already pins Bun ${pin.version}.\n`);
  } else {
    process.stdout.write(`Copy the "bun" block above into native-runtime.lock.json.\n`);
  }
}
