import { access, chmod, copyFile, link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ManagedRuntimeId } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import type { AgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import {
  parseBunVersion,
  parseClaudeVersion,
  parseCodexVersion,
  parseGrokVersion,
  parseOpencodeVersion,
} from "../backend/cli";
import { sha256File } from "../backend/file-hash";
import { assertSafeArchive, extractArchive, rejectNonRegularFiles } from "./provider-runtime-archive";

export type RuntimeTarget = "darwin-arm64" | "linux-x64" | "linux-arm64" | "win32-x64";

/** A hash of the download, in the algorithm its source publishes. */
export interface ArchiveDigest {
  algorithm: "sha256" | "sha512";
  hex: string;
}

/**
 * Where a version came from, which decides what vouches for its bytes.
 *
 * `lock` is the version this build carries in `native-runtime.lock.json`: every file has a hash the
 * repository reviewed. `latest` is a release found upstream after the build: the download has the
 * hash its source publishes, and the installed files have the hashes recorded when they were
 * installed (see `INSTALL_RECORD`).
 */
type RuntimeSource = "lock" | "latest";

export interface RuntimeSpec {
  runtime: ManagedRuntimeId;
  version: string;
  /** The version the package inside the download carries. Claude's is the SDK version, not the CLI's. */
  packageVersion: string;
  source: RuntimeSource;
  target: RuntimeTarget;
  url: string;
  /** `null` only where the source publishes no hash: Grok's latest release is trusted on TLS alone. */
  archiveDigest: ArchiveDigest | null;
  downloadBytes: number;
  installedBytes: number;
  executableName: string;
}

/**
 * The file an install from an upstream release writes beside its files, naming each one's SHA-256.
 *
 * The lock cannot vouch for a version it has never seen, so what was verified at install time is
 * written down and checked on every start, as the lock's hashes are for a pinned version. It guards
 * against a damaged or replaced install, not against a writer who can change the record as well:
 * the store is the user's, and anything that can write to it can already run as the user.
 */
export const INSTALL_RECORD = "openbot-install.json";

/** Everything a staging step may use. `downloadSmallFile` is passed in so fetching stays private
 *  to the manager: a descriptor can ask for a checksummed LICENSE, and nothing else. */
interface ProviderStageContext {
  readonly spec: RuntimeSpec;
  /** The verified archive or bare binary the manager downloaded. */
  readonly downloadedPath: string;
  /** The directory the descriptor fills, renamed into place by the manager once it verifies. */
  readonly staging: string;
  readonly lock: AgentRuntimeLock;
  /** `expectedSha256` is `null` for a file of an upstream release, which the lock has no hash for. */
  downloadSmallFile(url: string, expectedSha256: string | null): Promise<Uint8Array>;
}

/**
 * How one pinned tool is downloaded, unpacked and checked: a provider CLI, or the JavaScript runtime
 * the MCP servers need.
 *
 * The manager used to answer these four questions with `if codex … else if claude … else grok`, so
 * a provider it had never heard of silently downloaded Grok's binary from x.ai into that provider's
 * directory. `Record<ManagedRuntimeId, …>` is the fix: a runtime with no descriptor is a `TS2741`
 * naming the id.
 */
export interface ProviderRuntimeDescriptor {
  readonly runtime: ManagedRuntimeId;
  /** Where the artifact for this target lives, and what it should weigh and hash. */
  spec(target: RuntimeTarget, lock: AgentRuntimeLock): RuntimeSpec;
  /** Fill `staging` with the installed layout: `bin/<executable>`, licences and the manifest. */
  stage(context: ProviderStageContext): Promise<void>;
  /** Check a pinned install against the lock, beyond the shared executable and `--version` checks. */
  verify(root: string, spec: RuntimeSpec, lock: AgentRuntimeLock): Promise<void>;
  parseVersion(output: string): string;
}

const CODEX_ARCHIVE_ROOTS = ["bin", "codex-package.json", "codex-path", "codex-resources"];

/** The lock's hash for a file of a pinned version; an upstream release's file has none to compare. */
function pinnedHash(spec: RuntimeSpec, sha256: string): string | null {
  return spec.source === "lock" ? sha256 : null;
}

/**
 * The name Bun answers `npx`-shaped arguments under. Bun decides what it is from `argv[0]`, so the
 * same bytes under this second name run packages instead of scripts, and `bunx -y pkg` takes the
 * arguments a catalog entry already writes for `npx`.
 */
export function bunxExecutableName(target: RuntimeTarget): "bunx" | "bunx.exe" {
  return target === "win32-x64" ? "bunx.exe" : "bunx";
}

/**
 * A hard link, because 80MB twice on disk buys nothing and a symlink would fail the staged-layout
 * guard that keeps an archive from writing outside the store. `copyFile` covers the filesystem that
 * refuses a link, so the runtime still installs there; it only costs the space.
 */
async function stageBunx(binary: string, bunx: string): Promise<void> {
  try {
    await link(binary, bunx);
  } catch {
    await copyFile(binary, bunx);
    if (!bunx.endsWith(".exe")) await chmod(bunx, 0o755);
  }
}

const PROVIDER_RUNTIME_DESCRIPTORS: Record<ManagedRuntimeId, ProviderRuntimeDescriptor> = {
  codex: {
    runtime: "codex",
    spec: (target, lock) => {
      const artifact = lock.codex.artifacts[target];
      return {
        runtime: "codex",
        target,
        version: lock.codex.version,
        packageVersion: lock.codex.version,
        source: "lock",
        url: `${lock.codex.repository}/releases/download/${encodeURIComponent(lock.codex.tag)}/${artifact.asset}`,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: target === "win32-x64" ? "codex.exe" : "codex",
      };
    },
    stage: async ({ spec, downloadedPath, staging, lock, downloadSmallFile }) => {
      await assertSafeArchive(downloadedPath, CODEX_ARCHIVE_ROOTS, sourceText("error.provider.codexArchivePath"));
      await extractArchive(downloadedPath, staging);
      await rejectNonRegularFiles(staging);
      const license = await downloadSmallFile(
        `${lock.codex.repository}/raw/${encodeURIComponent(codexTag(spec.version))}/LICENSE`,
        pinnedHash(spec, lock.codex.licenseSha256),
      );
      await writeFile(join(staging, "LICENSE"), license);
    },
    verify: async (root, spec, lock) => {
      const manifest = JSON.parse(await readFile(join(root, "codex-package.json"), "utf8"));
      if (!isDynamicRecord(manifest) || manifest.version !== lock.codex.version) {
        throw new Error(sourceText("error.provider.codexVersionUnexpected"));
      }
      await Promise.all([
        access(join(root, "bin", spec.target === "win32-x64" ? "codex-code-mode-host.exe" : "codex-code-mode-host")),
        access(join(root, "codex-path", spec.target === "win32-x64" ? "rg.exe" : "rg")),
      ]);
    },
    parseVersion: parseCodexVersion,
  },
  claude: {
    runtime: "claude",
    spec: (target, lock) => {
      const artifact = lock.claude.artifacts[target];
      return {
        runtime: "claude",
        target,
        version: lock.claude.version,
        packageVersion: lock.claude.sdkVersion,
        source: "lock",
        url: `${lock.claude.registry}/${artifact.package}/-/${artifact.asset}`,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    stage: async ({ spec, downloadedPath, staging, lock }) => {
      const extracted = `${staging}.extracted`;
      await rm(extracted, { recursive: true, force: true });
      await mkdir(extracted, { recursive: true });
      try {
        await assertSafeArchive(downloadedPath, ["package"], sourceText("error.provider.claudeArchivePath"));
        await extractArchive(downloadedPath, extracted);
        await rejectNonRegularFiles(extracted);
        const packageRoot = join(extracted, "package");
        const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
        const artifact = lock.claude.artifacts[spec.target];
        if (
          !isDynamicRecord(packageManifest) ||
          packageManifest.name !== artifact.package ||
          packageManifest.version !== spec.packageVersion
        ) {
          throw new Error(sourceText("error.provider.claudePackageMismatch"));
        }
        await mkdir(join(staging, "bin"), { recursive: true });
        await Promise.all([
          copyFile(join(packageRoot, artifact.executable), join(staging, "bin", artifact.executable)),
          copyFile(join(packageRoot, "LICENSE.md"), join(staging, "LICENSE.md")),
          writeFile(
            join(staging, "claude-package.json"),
            `${JSON.stringify({
              layoutVersion: 1,
              version: spec.version,
              sdkVersion: spec.packageVersion,
              target: spec.target,
              executable: `bin/${artifact.executable}`,
            })}\n`,
          ),
        ]);
        if (spec.target !== "win32-x64") await chmod(join(staging, "bin", artifact.executable), 0o755);
      } finally {
        await rm(extracted, { recursive: true, force: true });
      }
    },
    verify: async (root, spec, lock) => {
      const artifact = lock.claude.artifacts[spec.target];
      const executable = join(root, "bin", spec.executableName);
      if ((await sha256File(executable)) !== artifact.binarySha256)
        throw new Error(sourceText("error.provider.claudeChecksum"));
      if ((await sha256File(join(root, "LICENSE.md"))) !== lock.claude.licenseSha256) {
        throw new Error(sourceText("error.provider.claudeLicenseChecksum"));
      }
    },
    parseVersion: parseClaudeVersion,
  },
  opencode: {
    runtime: "opencode",
    spec: (target, lock) => {
      const artifact = lock.opencode.artifacts[target];
      return {
        runtime: "opencode",
        target,
        version: lock.opencode.version,
        packageVersion: lock.opencode.version,
        source: "lock",
        url: `${lock.opencode.registry}/${artifact.package}/-/${artifact.asset}`,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    stage: async ({ spec, downloadedPath, staging, lock, downloadSmallFile }) => {
      const extracted = `${staging}.extracted`;
      await rm(extracted, { recursive: true, force: true });
      await mkdir(extracted, { recursive: true });
      try {
        await assertSafeArchive(downloadedPath, ["package"], sourceText("error.provider.opencodeArchivePath"));
        await extractArchive(downloadedPath, extracted);
        await rejectNonRegularFiles(extracted);
        const packageRoot = join(extracted, "package");
        const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
        const artifact = lock.opencode.artifacts[spec.target];
        if (
          !isDynamicRecord(packageManifest) ||
          packageManifest.name !== artifact.package ||
          packageManifest.version !== spec.packageVersion
        ) {
          throw new Error(sourceText("error.provider.opencodePackageMismatch"));
        }
        // The platform tarball carries no licence, so it comes from the tagged source like Codex's.
        const license = await downloadSmallFile(
          `${lock.opencode.repository}/raw/v${spec.version}/LICENSE`,
          pinnedHash(spec, lock.opencode.licenseSha256),
        );
        await mkdir(join(staging, "bin"), { recursive: true });
        await Promise.all([
          copyFile(join(packageRoot, "bin", artifact.executable), join(staging, "bin", artifact.executable)),
          writeFile(join(staging, "LICENSE"), license),
          writeFile(
            join(staging, "opencode-package.json"),
            `${JSON.stringify({
              layoutVersion: 1,
              version: spec.version,
              target: spec.target,
              executable: `bin/${artifact.executable}`,
            })}\n`,
          ),
        ]);
        if (spec.target !== "win32-x64") await chmod(join(staging, "bin", artifact.executable), 0o755);
      } finally {
        await rm(extracted, { recursive: true, force: true });
      }
    },
    verify: async (root, spec, lock) => {
      const artifact = lock.opencode.artifacts[spec.target];
      const executable = join(root, "bin", spec.executableName);
      if ((await sha256File(executable)) !== artifact.binarySha256) {
        throw new Error(sourceText("error.provider.opencodeChecksum"));
      }
      if ((await sha256File(join(root, "LICENSE"))) !== lock.opencode.licenseSha256) {
        throw new Error(sourceText("error.provider.opencodeLicenseChecksum"));
      }
    },
    parseVersion: parseOpencodeVersion,
  },
  grok: {
    runtime: "grok",
    spec: (target, lock) => {
      const artifact = lock.grok.artifacts[target];
      return {
        runtime: "grok",
        target,
        version: lock.grok.version,
        packageVersion: lock.grok.version,
        source: "lock",
        url: `${lock.grok.distribution}/${artifact.asset}`,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    stage: async ({ spec, downloadedPath, staging, lock, downloadSmallFile }) => {
      const rawRepository = lock.grok.repository.replace("github.com", "raw.githubusercontent.com");
      const [license, notices] = await Promise.all([
        downloadSmallFile(`${rawRepository}/${lock.grok.sourceCommit}/LICENSE`, lock.grok.licenseSha256),
        downloadSmallFile(`${rawRepository}/${lock.grok.sourceCommit}/THIRD-PARTY-NOTICES`, lock.grok.noticesSha256),
      ]);
      await mkdir(join(staging, "bin"), { recursive: true });
      await Promise.all([
        copyFile(downloadedPath, join(staging, "bin", spec.executableName)),
        writeFile(join(staging, "LICENSE"), license),
        writeFile(join(staging, "THIRD-PARTY-NOTICES"), notices),
        writeFile(
          join(staging, "grok-package.json"),
          `${JSON.stringify({
            layoutVersion: 1,
            version: spec.version,
            target: spec.target,
            executable: `bin/${spec.executableName}`,
          })}\n`,
        ),
      ]);
      if (spec.target !== "win32-x64") await chmod(join(staging, "bin", spec.executableName), 0o755);
    },
    verify: async (root, spec, lock) => {
      const executable = join(root, "bin", spec.executableName);
      if ((await sha256File(executable)) !== lock.grok.artifacts[spec.target].assetSha256) {
        throw new Error(sourceText("error.provider.grokChecksum"));
      }
      if ((await sha256File(join(root, "LICENSE"))) !== lock.grok.licenseSha256) {
        throw new Error(sourceText("error.provider.grokLicenseChecksum"));
      }
      if ((await sha256File(join(root, "THIRD-PARTY-NOTICES"))) !== lock.grok.noticesSha256) {
        throw new Error(sourceText("error.provider.grokNoticesChecksum"));
      }
    },
    parseVersion: parseGrokVersion,
  },
  bun: {
    runtime: "bun",
    spec: (target, lock) => {
      const artifact = lock.bun.artifacts[target];
      return {
        runtime: "bun",
        target,
        version: lock.bun.version,
        packageVersion: lock.bun.version,
        source: "lock",
        url: `${lock.bun.registry}/${artifact.package}/-/${artifact.asset}`,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    stage: async ({ spec, downloadedPath, staging, lock, downloadSmallFile }) => {
      const extracted = `${staging}.extracted`;
      await rm(extracted, { recursive: true, force: true });
      await mkdir(extracted, { recursive: true });
      try {
        await assertSafeArchive(downloadedPath, ["package"], sourceText("error.provider.bunArchivePath"));
        await extractArchive(downloadedPath, extracted);
        await rejectNonRegularFiles(extracted);
        const packageRoot = join(extracted, "package");
        const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
        const artifact = lock.bun.artifacts[spec.target];
        if (
          !isDynamicRecord(packageManifest) ||
          packageManifest.name !== artifact.package ||
          packageManifest.version !== lock.bun.version
        ) {
          throw new Error(sourceText("error.provider.bunPackageMismatch"));
        }
        // The platform tarball carries no licence, so it comes from the tagged source like Codex's.
        const license = await downloadSmallFile(
          `${lock.bun.repository}/raw/${encodeURIComponent(lock.bun.tag)}/LICENSE.md`,
          lock.bun.licenseSha256,
        );
        const binary = join(staging, "bin", artifact.executable);
        await mkdir(join(staging, "bin"), { recursive: true });
        await Promise.all([
          copyFile(join(packageRoot, "bin", artifact.executable), binary),
          writeFile(join(staging, "LICENSE.md"), license),
          writeFile(
            join(staging, "bun-package.json"),
            `${JSON.stringify({
              layoutVersion: 1,
              version: lock.bun.version,
              target: spec.target,
              executable: `bin/${artifact.executable}`,
            })}\n`,
          ),
        ]);
        if (spec.target !== "win32-x64") await chmod(binary, 0o755);
        await stageBunx(binary, join(staging, "bin", bunxExecutableName(spec.target)));
      } finally {
        await rm(extracted, { recursive: true, force: true });
      }
    },
    verify: async (root, spec, lock) => {
      const artifact = lock.bun.artifacts[spec.target];
      const executable = join(root, "bin", spec.executableName);
      if ((await sha256File(executable)) !== artifact.binarySha256)
        throw new Error(sourceText("error.provider.bunChecksum"));
      if ((await sha256File(join(root, "LICENSE.md"))) !== lock.bun.licenseSha256) {
        throw new Error(sourceText("error.provider.bunLicenseChecksum"));
      }
      // Only the size, because the second name is the same bytes: hashing 80MB twice on every start
      // would buy nothing. A truncated or replaced file fails this, and a swapped whole binary is
      // what the `bun` hash above already answers for.
      const [bun, bunx] = await Promise.all([
        stat(executable),
        stat(join(root, "bin", bunxExecutableName(spec.target))),
      ]);
      if (bun.size !== bunx.size) throw new Error(sourceText("error.provider.bunxDamaged"));
    },
    parseVersion: parseBunVersion,
  },
};

/** Codex tags each release `rust-v<version>`; the lock's `tag` is the same string for its version. */
export function codexTag(version: string): string {
  return `rust-v${version}`;
}

export function providerRuntimeDescriptor(runtime: ManagedRuntimeId): ProviderRuntimeDescriptor {
  return PROVIDER_RUNTIME_DESCRIPTORS[runtime];
}
