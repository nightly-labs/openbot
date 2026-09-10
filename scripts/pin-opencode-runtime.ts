import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type AgentRuntimeLock, loadAgentRuntimeLock } from "./agent-runtime-lock";
import { sha256, sha256File } from "./remote-desktop-runtime-release";

export type OpencodeRuntimeTarget = "darwin-arm64" | "win32-x64";

/** The npm platform package and the executable inside it, per target OpenBot supports. */
const TARGETS = {
  "darwin-arm64": { package: "opencode-darwin-arm64", executable: "opencode", platformDirectory: "mac" },
  "win32-x64": { package: "opencode-windows-x64", executable: "opencode.exe", platformDirectory: "win" },
} as const satisfies Record<OpencodeRuntimeTarget, { package: string; executable: string; platformDirectory: string }>;

/** The same keys as `TARGETS`, in the order the lock file lists them. */
const TARGET_IDS: readonly OpencodeRuntimeTarget[] = ["darwin-arm64", "win32-x64"];

const REGISTRY = "https://registry.npmjs.org";
const REPOSITORY = "https://github.com/anomalyco/opencode";
/** `installedBytes` only funds the manager's free-space precheck, so it is rounded generously. */
const DISK_HEADROOM = 1.05;
const DISK_GRANULARITY = 10_000_000;

const umbrellaSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  optionalDependencies: z.record(z.string(), z.string()),
});
const platformSchema = z.object({
  name: z.string(),
  version: z.string(),
  dist: z.object({
    tarball: z.string().url(),
    unpackedSize: z.number().int().positive(),
  }),
});
const packageManifestSchema = z.object({ name: z.string(), version: z.string() });

export interface OpencodeRuntimePin {
  registry: string;
  repository: string;
  version: string;
  license: "MIT";
  licenseSha256: string;
  artifacts: Record<OpencodeRuntimeTarget, OpencodeArtifactPin>;
}

interface OpencodeArtifactPin {
  package: string;
  asset: string;
  assetSha256: string;
  binarySha256: string;
  downloadBytes: number;
  installedBytes: number;
  executable: string;
  platformDirectory: string;
}

/**
 * Recomputes the `opencode` block of `native-runtime.lock.json` from the npm registry.
 *
 * `verifyInstalledRuntime` compares `opencode --version` against `lock.opencode.version` for exact
 * equality, so a pin is only trustworthy if the staged binary really prints that string. On darwin
 * this script runs the extracted binary and asserts it; on other hosts the darwin binary cannot be
 * executed, so the caller has to repeat the pin on a matching machine before a release.
 */
export async function pinOpencodeRuntime(
  input: {
    version?: string;
    fetchImpl?: typeof fetch;
    /** Set to false to skip the `--version` assertion on the target that matches this host. */
    runBinary?: boolean;
  } = {},
): Promise<OpencodeRuntimePin> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const umbrella = await fetchParsed(fetchImpl, `${REGISTRY}/opencode-ai/${input.version ?? "latest"}`, umbrellaSchema);
  const version = umbrella.version;

  const pinTarget = (target: OpencodeRuntimeTarget) =>
    pinArtifact(fetchImpl, target, version, umbrella.optionalDependencies, input.runBinary);
  // One target at a time, in the lock file's order: two 50 MB downloads at once only make the
  // registry slower, and a literal is what proves both keys are present without an assertion.
  const artifacts: Record<OpencodeRuntimeTarget, OpencodeArtifactPin> = {
    "darwin-arm64": await pinTarget("darwin-arm64"),
    "win32-x64": await pinTarget("win32-x64"),
  };

  const licenseUrl = `${REPOSITORY}/raw/v${version}/LICENSE`;
  const license = await fetchBytes(fetchImpl, licenseUrl);
  return {
    registry: REGISTRY,
    repository: REPOSITORY,
    version,
    license: "MIT",
    licenseSha256: sha256(license),
    artifacts,
  };
}

async function pinArtifact(
  fetchImpl: typeof fetch,
  target: OpencodeRuntimeTarget,
  version: string,
  optionalDependencies: Record<string, string>,
  runBinary = true,
): Promise<OpencodeArtifactPin> {
  const descriptor = TARGETS[target];
  if (optionalDependencies[descriptor.package] !== version) {
    throw new Error(`opencode-ai ${version} does not list ${descriptor.package} at the same version.`);
  }
  const platform = await fetchParsed(fetchImpl, `${REGISTRY}/${descriptor.package}/${version}`, platformSchema);
  if (platform.name !== descriptor.package || platform.version !== version) {
    throw new Error(`The registry served the wrong package for ${target}.`);
  }
  const asset = `${descriptor.package}-${version}.tgz`;
  if (platform.dist.tarball !== `${REGISTRY}/${descriptor.package}/-/${asset}`) {
    throw new Error(`Unexpected tarball URL for ${target}: ${platform.dist.tarball}`);
  }

  const archiveBytes = await fetchBytes(fetchImpl, platform.dist.tarball);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-opencode-pin-"));
  try {
    const archive = join(temporaryRoot, asset);
    const extracted = join(temporaryRoot, "extracted");
    await writeFile(archive, archiveBytes, { mode: 0o600 });
    validateOpencodeArchive(archive, descriptor.executable);
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
    return {
      package: descriptor.package,
      asset,
      assetSha256: sha256(archiveBytes),
      binarySha256: await sha256File(binary),
      downloadBytes: archiveBytes.byteLength,
      installedBytes: Math.ceil((platform.dist.unpackedSize * DISK_HEADROOM) / DISK_GRANULARITY) * DISK_GRANULARITY,
      executable: descriptor.executable,
      platformDirectory: descriptor.platformDirectory,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

/** The OpenCode platform tarball is two files, and anything else is not the package we pinned. */
export function validateOpencodeArchive(archive: string, executable: string): string[] {
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean);
  const details = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean);
  if (details.some((line) => !["-", "d"].includes(line.trimStart().charAt(0)))) {
    throw new Error("The OpenCode runtime archive contains a link or a special file.");
  }
  for (const name of names) {
    if (name.includes("\0") || name.includes("\\")) throw new Error(`Unsafe OpenCode archive path: ${name}`);
    const parts = name.replace(/\/+$/u, "").split("/");
    if (parts[0] !== "package" || parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Unsafe OpenCode archive path: ${name}`);
    }
  }
  for (const required of ["package/package.json", `package/bin/${executable}`]) {
    if (!names.includes(required)) throw new Error(`The OpenCode runtime archive is missing ${required}.`);
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
export function isPinnedAlready(pin: OpencodeRuntimePin, lock: AgentRuntimeLock): boolean {
  return JSON.stringify(pin) === JSON.stringify(lock.opencode);
}

if (import.meta.main) {
  const pin = await pinOpencodeRuntime({ version: process.argv[2] });
  const lock = await loadAgentRuntimeLock().catch(() => null);
  process.stdout.write(`${JSON.stringify({ opencode: pin }, null, 2)}\n`);
  for (const target of TARGET_IDS) {
    if (target !== `${process.platform}-${process.arch}`) {
      process.stdout.write(`This host cannot run the ${target} binary, so its version is not asserted.\n`);
    }
  }
  if (lock && isPinnedAlready(pin, lock)) {
    process.stdout.write(`native-runtime.lock.json already pins OpenCode ${pin.version}.\n`);
  } else {
    process.stdout.write(`Copy the "opencode" block above into native-runtime.lock.json.\n`);
  }
}
