import { access, chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ManagedProviderId } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { AgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import { parseClaudeVersion, parseCodexVersion, parseGrokVersion } from "../backend/cli";
import { assertSafeArchive, extractArchive, rejectNonRegularFiles, sha256File } from "./provider-runtime-archive";

export type RuntimeTarget = "darwin-arm64" | "win32-x64";

export interface RuntimeSpec {
  provider: ManagedProviderId;
  version: string;
  target: RuntimeTarget;
  url: string;
  archiveSha256: string;
  downloadBytes: number;
  installedBytes: number;
  executableName: string;
}

/** Everything a staging step may use. `downloadSmallFile` is passed in so fetching stays private
 *  to the manager: a descriptor can ask for a checksummed LICENSE, and nothing else. */
export interface ProviderStageContext {
  readonly spec: RuntimeSpec;
  /** The verified archive or bare binary the manager downloaded. */
  readonly downloadedPath: string;
  /** The directory the descriptor fills, renamed into place by the manager once it verifies. */
  readonly staging: string;
  readonly lock: AgentRuntimeLock;
  downloadSmallFile(url: string, expectedSha256: string): Promise<Uint8Array>;
}

/**
 * How one provider's pinned CLI is downloaded, unpacked and checked.
 *
 * The manager used to answer these four questions with `if codex … else if claude … else grok`, so
 * a provider it had never heard of silently downloaded Grok's binary from x.ai into that provider's
 * directory. `Record<ManagedProviderId, …>` is the fix: a provider with no descriptor is a `TS2741`
 * naming the id.
 */
export interface ProviderRuntimeDescriptor {
  readonly provider: ManagedProviderId;
  /** Where the artifact for this target lives, and what it should weigh and hash. */
  spec(target: RuntimeTarget, lock: AgentRuntimeLock): RuntimeSpec;
  /** Fill `staging` with the installed layout: `bin/<executable>`, licences and the manifest. */
  stage(context: ProviderStageContext): Promise<void>;
  /** Check an installed layout beyond the shared executable and `--version` checks. */
  verify(root: string, spec: RuntimeSpec, lock: AgentRuntimeLock): Promise<void>;
  parseVersion(output: string): string;
}

const CODEX_ARCHIVE_ROOTS = ["bin", "codex-package.json", "codex-path", "codex-resources"];

export const PROVIDER_RUNTIME_DESCRIPTORS: Record<ManagedProviderId, ProviderRuntimeDescriptor> = {
  codex: {
    provider: "codex",
    spec: (target, lock) => {
      const artifact = lock.codex.artifacts[target];
      return {
        provider: "codex",
        target,
        version: lock.codex.version,
        url: `${lock.codex.repository}/releases/download/${encodeURIComponent(lock.codex.tag)}/${artifact.asset}`,
        archiveSha256: artifact.assetSha256,
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: target === "win32-x64" ? "codex.exe" : "codex",
      };
    },
    stage: async ({ downloadedPath, staging, lock, downloadSmallFile }) => {
      await assertSafeArchive(downloadedPath, CODEX_ARCHIVE_ROOTS, "The Codex archive has an unexpected path.");
      await extractArchive(downloadedPath, staging);
      await rejectNonRegularFiles(staging);
      const license = await downloadSmallFile(
        `${lock.codex.repository}/raw/${encodeURIComponent(lock.codex.tag)}/LICENSE`,
        lock.codex.licenseSha256,
      );
      await writeFile(join(staging, "LICENSE"), license);
    },
    verify: async (root, spec, lock) => {
      const manifest = JSON.parse(await readFile(join(root, "codex-package.json"), "utf8"));
      if (!isDynamicRecord(manifest) || manifest.version !== lock.codex.version) {
        throw new Error("Unexpected Codex runtime version.");
      }
      await Promise.all([
        access(join(root, "bin", spec.target === "win32-x64" ? "codex-code-mode-host.exe" : "codex-code-mode-host")),
        access(join(root, "codex-path", spec.target === "win32-x64" ? "rg.exe" : "rg")),
      ]);
    },
    parseVersion: parseCodexVersion,
  },
  claude: {
    provider: "claude",
    spec: (target, lock) => {
      const artifact = lock.claude.artifacts[target];
      return {
        provider: "claude",
        target,
        version: lock.claude.version,
        url: `${lock.claude.registry}/${artifact.package}/-/${artifact.asset}`,
        archiveSha256: artifact.assetSha256,
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
        await assertSafeArchive(downloadedPath, ["package"], "The Claude archive has an unexpected path.");
        await extractArchive(downloadedPath, extracted);
        await rejectNonRegularFiles(extracted);
        const packageRoot = join(extracted, "package");
        const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
        const artifact = lock.claude.artifacts[spec.target];
        if (
          !isDynamicRecord(packageManifest) ||
          packageManifest.name !== artifact.package ||
          packageManifest.version !== lock.claude.sdkVersion
        ) {
          throw new Error("The Claude package does not match the runtime catalog.");
        }
        await mkdir(join(staging, "bin"), { recursive: true });
        await Promise.all([
          copyFile(join(packageRoot, artifact.executable), join(staging, "bin", artifact.executable)),
          copyFile(join(packageRoot, "LICENSE.md"), join(staging, "LICENSE.md")),
          writeFile(
            join(staging, "claude-package.json"),
            `${JSON.stringify({
              layoutVersion: 1,
              version: lock.claude.version,
              sdkVersion: lock.claude.sdkVersion,
              target: spec.target,
              executable: `bin/${artifact.executable}`,
            })}\n`,
          ),
        ]);
        if (spec.target === "darwin-arm64") await chmod(join(staging, "bin", artifact.executable), 0o755);
      } finally {
        await rm(extracted, { recursive: true, force: true });
      }
    },
    verify: async (root, spec, lock) => {
      const artifact = lock.claude.artifacts[spec.target];
      const executable = join(root, "bin", spec.executableName);
      if ((await sha256File(executable)) !== artifact.binarySha256)
        throw new Error("Claude runtime checksum mismatch.");
      if ((await sha256File(join(root, "LICENSE.md"))) !== lock.claude.licenseSha256) {
        throw new Error("Claude license checksum mismatch.");
      }
    },
    parseVersion: parseClaudeVersion,
  },
  grok: {
    provider: "grok",
    spec: (target, lock) => {
      const artifact = lock.grok.artifacts[target];
      return {
        provider: "grok",
        target,
        version: lock.grok.version,
        url: `${lock.grok.distribution}/${artifact.asset}`,
        archiveSha256: artifact.assetSha256,
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
      if (spec.target === "darwin-arm64") await chmod(join(staging, "bin", spec.executableName), 0o755);
    },
    verify: async (root, spec, lock) => {
      const executable = join(root, "bin", spec.executableName);
      if ((await sha256File(executable)) !== lock.grok.artifacts[spec.target].assetSha256) {
        throw new Error("Grok runtime checksum mismatch.");
      }
      if ((await sha256File(join(root, "LICENSE"))) !== lock.grok.licenseSha256) {
        throw new Error("Grok license checksum mismatch.");
      }
      if ((await sha256File(join(root, "THIRD-PARTY-NOTICES"))) !== lock.grok.noticesSha256) {
        throw new Error("Grok notices checksum mismatch.");
      }
    },
    parseVersion: parseGrokVersion,
  },
};

export function providerRuntimeDescriptor(provider: ManagedProviderId): ProviderRuntimeDescriptor {
  return PROVIDER_RUNTIME_DESCRIPTORS[provider];
}
