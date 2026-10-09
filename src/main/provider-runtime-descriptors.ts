import {
  access,
  chmod,
  copyFile,
  cp,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { ManagedRuntimeId } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import {
  ANTIGRAVITY_MANIFEST,
  antigravityHarnessName,
  CURSOR_MANIFEST,
  parseAntigravityVersion,
  parseBunVersion,
  parseClaudeVersion,
  parseClineVersion,
  parseCodexVersion,
  parseCursorManifestVersion,
  parseGrokVersion,
  parseOpencodeVersion,
} from "../backend/cli";
import { sha256File } from "../backend/file-hash";
import {
  assertSafeArchive,
  extractArchive,
  extractZipFiles,
  extractZipTree,
  rejectNonRegularFiles,
} from "./provider-runtime-archive";
import { ProviderRuntimeFailure, runtimeIO, runtimeSync } from "./provider-runtime-effects";

export type RuntimeTarget = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "win32-x64";

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
  downloadSmallFile(url: string, expectedSha256: string | null): Effect.Effect<Uint8Array, ProviderRuntimeFailure>;
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
  stage(context: ProviderStageContext): Effect.Effect<void, ProviderRuntimeFailure>;
  /** Check a pinned install against the lock, beyond the shared executable and `--version` checks. */
  verify(root: string, spec: RuntimeSpec, lock: AgentRuntimeLock): Effect.Effect<void, ProviderRuntimeFailure>;
  /** A file of the install whose text `parseVersion` reads, for a program with no `--version`. */
  readonly versionFile?: string;
  parseVersion(output: string): string;
}

const CODEX_ARCHIVE_ROOTS = ["bin", "codex-package.json", "codex-path", "codex-resources"];

/** The one folder of a Cursor archive, which the install renames to `bin`. */
const CURSOR_ARCHIVE_ROOT = "dist-package";

/** Where Cursor publishes one build for one target. The build names the folder. */
export function cursorPackageUrl(
  distribution: string,
  version: string,
  artifact: AgentRuntimeLock["cursor"]["artifacts"][RuntimeTarget],
): string {
  return `${distribution}/${version}/${artifact.platformDirectory}/${artifact.architecture}/${artifact.asset}`;
}

/** Cline tags each CLI release `cli-v<version>`, apart from the tags of its editor extension. */
function clineTag(version: string): string {
  return `cli-v${version}`;
}

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
const stageBunx = Effect.fn("ProviderRuntime.stageBunx")((binary: string, bunx: string) =>
  runtimeIO(() => link(binary, bunx)).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* runtimeIO(() => copyFile(binary, bunx));
        if (!bunx.endsWith(".exe")) yield* runtimeIO(() => chmod(bunx, 0o755));
      }),
    ),
  ),
);

/** The npm package that lists OpenCode's platform packages and carries its LICENSE. */
export const OPENCODE_UMBRELLA_PACKAGE = "opencode-ai";

interface NpmPackageCheck {
  name: string;
  version: string;
  archivePathError: string;
  mismatchError: string;
}

/**
 * Unpacks an npm platform tarball beside `staging`, checks that its `package.json` names the pinned
 * package and version, and gives `fill` the package root. The unpacked copy is removed after `fill`,
 * so only what `fill` copies into `staging` is installed.
 */
const withNpmPackage = Effect.fn("ProviderRuntime.withNpmPackage")(function* (
  downloadedPath: string,
  staging: string,
  expected: NpmPackageCheck,
  fill: (packageRoot: string) => Effect.Effect<void, ProviderRuntimeFailure>,
) {
  const extracted = `${staging}.extracted`;
  yield* runtimeIO(() => rm(extracted, { recursive: true, force: true }));
  yield* Effect.acquireUseRelease(
    runtimeIO(() => mkdir(extracted, { recursive: true })),
    () =>
      Effect.gen(function* () {
        yield* assertSafeArchive(downloadedPath, ["package"], expected.archivePathError);
        yield* extractArchive(downloadedPath, extracted);
        yield* rejectNonRegularFiles(extracted);
        const packageRoot = join(extracted, "package");
        const text = yield* runtimeIO(() => readFile(join(packageRoot, "package.json"), "utf8"));
        const packageManifest = yield* runtimeSync(() => JSON.parse(text));
        if (
          !isDynamicRecord(packageManifest) ||
          packageManifest.name !== expected.name ||
          packageManifest.version !== expected.version
        )
          return yield* new ProviderRuntimeFailure({ cause: new Error(expected.mismatchError) });
        yield* fill(packageRoot);
      }),
    () => runtimeIO(() => rm(extracted, { recursive: true, force: true })).pipe(Effect.orDie),
  );
});

/** The `<runtime>-package.json` text that each install writes beside its files. */
function layoutManifest(fields: Record<string, string>): string {
  return `${JSON.stringify({ layoutVersion: 1, ...fields })}\n`;
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
    stage: Effect.fn("ProviderRuntime.codex.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
      downloadSmallFile,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      yield* assertSafeArchive(downloadedPath, CODEX_ARCHIVE_ROOTS, sourceText("error.provider.codexArchivePath"));
      yield* extractArchive(downloadedPath, staging);
      yield* rejectNonRegularFiles(staging);
      const license = yield* downloadSmallFile(
        `${lock.codex.repository}/raw/${encodeURIComponent(codexTag(spec.version))}/LICENSE`,
        pinnedHash(spec, lock.codex.licenseSha256),
      );
      yield* runtimeIO(() => writeFile(join(staging, "LICENSE"), license));
    }),
    verify: Effect.fn("ProviderRuntime.codex.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const manifest = JSON.parse(yield* runtimeIO(() => readFile(join(root, "codex-package.json"), "utf8")));
      if (!isDynamicRecord(manifest) || manifest.version !== lock.codex.version) {
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.codexVersionUnexpected")),
        });
      }
      yield* Effect.all(
        [
          runtimeIO(() =>
            access(
              join(root, "bin", spec.target === "win32-x64" ? "codex-code-mode-host.exe" : "codex-code-mode-host"),
            ),
          ),
          runtimeIO(() => access(join(root, "codex-path", spec.target === "win32-x64" ? "rg.exe" : "rg"))),
        ],
        { concurrency: "unbounded" },
      );
    }),
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
    stage: Effect.fn("ProviderRuntime.claude.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.claude.artifacts[spec.target];
      yield* withNpmPackage(
        downloadedPath,
        staging,
        {
          name: artifact.package,
          version: spec.packageVersion,
          archivePathError: sourceText("error.provider.claudeArchivePath"),
          mismatchError: sourceText("error.provider.claudePackageMismatch"),
        },
        (packageRoot: string) =>
          Effect.gen(function* () {
            yield* runtimeIO(() => mkdir(join(staging, "bin"), { recursive: true }));
            yield* Effect.all(
              [
                runtimeIO(() =>
                  copyFile(join(packageRoot, artifact.executable), join(staging, "bin", artifact.executable)),
                ),
                runtimeIO(() => copyFile(join(packageRoot, "LICENSE.md"), join(staging, "LICENSE.md"))),
                runtimeIO(() =>
                  writeFile(
                    join(staging, "claude-package.json"),
                    layoutManifest({
                      version: spec.version,
                      sdkVersion: spec.packageVersion,
                      target: spec.target,
                      executable: `bin/${artifact.executable}`,
                    }),
                  ),
                ),
              ],
              { concurrency: "unbounded" },
            );
            if (spec.target !== "win32-x64")
              yield* runtimeIO(() => chmod(join(staging, "bin", artifact.executable), 0o755));
          }),
      );
    }),
    verify: Effect.fn("ProviderRuntime.claude.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.claude.artifacts[spec.target];
      const executable = join(root, "bin", spec.executableName);
      if (
        (yield* sha256File(executable).pipe(Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })))) !==
        artifact.binarySha256
      )
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.claudeChecksum")) });
      if (
        (yield* sha256File(join(root, "LICENSE.md")).pipe(
          Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
        )) !== lock.claude.licenseSha256
      ) {
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.claudeLicenseChecksum")),
        });
      }
    }),
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
    stage: Effect.fn("ProviderRuntime.opencode.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
      downloadSmallFile,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.opencode.artifacts[spec.target];
      // The platform tarball carries no licence. The umbrella package on the same registry does, so
      // an install needs no host other than npm. `verify` checks its hash against the lock. It is
      // fetched first because it is small: a failed request stops before the binary is unpacked.
      const umbrella = yield* downloadSmallFile(
        `${lock.opencode.registry}/${OPENCODE_UMBRELLA_PACKAGE}/-/${OPENCODE_UMBRELLA_PACKAGE}-${spec.version}.tgz`,
        null,
      );
      yield* withNpmPackage(
        downloadedPath,
        staging,
        {
          name: artifact.package,
          version: spec.packageVersion,
          archivePathError: sourceText("error.provider.opencodeArchivePath"),
          mismatchError: sourceText("error.provider.opencodePackageMismatch"),
        },
        (packageRoot: string) =>
          Effect.gen(function* () {
            yield* runtimeIO(() => mkdir(join(staging, "bin"), { recursive: true }));
            yield* Effect.all(
              [
                runtimeIO(() =>
                  copyFile(join(packageRoot, "bin", artifact.executable), join(staging, "bin", artifact.executable)),
                ),
                runtimeIO(() =>
                  writeFile(
                    join(staging, "opencode-package.json"),
                    layoutManifest({
                      version: spec.version,
                      target: spec.target,
                      executable: `bin/${artifact.executable}`,
                    }),
                  ),
                ),
              ],
              { concurrency: "unbounded" },
            );
            if (spec.target !== "win32-x64")
              yield* runtimeIO(() => chmod(join(staging, "bin", artifact.executable), 0o755));
          }),
      );
      // A directory beside the staging one, so the sweep of abandoned staging removes it after a crash.
      const umbrellaRoot = `${staging}.umbrella`;
      const umbrellaPath = join(umbrellaRoot, `${OPENCODE_UMBRELLA_PACKAGE}.tgz`);
      yield* Effect.acquireUseRelease(
        runtimeIO(() => mkdir(umbrellaRoot, { recursive: true })),
        () =>
          Effect.gen(function* () {
            yield* runtimeIO(() => writeFile(umbrellaPath, umbrella, { mode: 0o600 }));
            yield* withNpmPackage(
              umbrellaPath,
              staging,
              {
                name: OPENCODE_UMBRELLA_PACKAGE,
                version: spec.version,
                archivePathError: sourceText("error.provider.opencodeArchivePath"),
                mismatchError: sourceText("error.provider.opencodePackageMismatch"),
              },
              (packageRoot: string) =>
                runtimeIO(() => copyFile(join(packageRoot, "LICENSE"), join(staging, "LICENSE"))),
            );
          }),
        () => runtimeIO(() => rm(umbrellaRoot, { recursive: true, force: true })).pipe(Effect.orDie),
      );
    }),
    verify: Effect.fn("ProviderRuntime.opencode.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.opencode.artifacts[spec.target];
      const executable = join(root, "bin", spec.executableName);
      if (
        (yield* sha256File(executable).pipe(Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })))) !==
        artifact.binarySha256
      ) {
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.opencodeChecksum")) });
      }
      if (
        (yield* sha256File(join(root, "LICENSE")).pipe(
          Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
        )) !== lock.opencode.licenseSha256
      ) {
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.opencodeLicenseChecksum")),
        });
      }
    }),
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
    stage: Effect.fn("ProviderRuntime.grok.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
      downloadSmallFile,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const rawRepository = lock.grok.repository.replace("github.com", "raw.githubusercontent.com");
      const [license, notices] = yield* Effect.all(
        [
          downloadSmallFile(`${rawRepository}/${lock.grok.sourceCommit}/LICENSE`, lock.grok.licenseSha256),
          downloadSmallFile(`${rawRepository}/${lock.grok.sourceCommit}/THIRD-PARTY-NOTICES`, lock.grok.noticesSha256),
        ],
        { concurrency: "unbounded" },
      );
      yield* runtimeIO(() => mkdir(join(staging, "bin"), { recursive: true }));
      yield* Effect.all(
        [
          runtimeIO(() => copyFile(downloadedPath, join(staging, "bin", spec.executableName))),
          runtimeIO(() => writeFile(join(staging, "LICENSE"), license)),
          runtimeIO(() => writeFile(join(staging, "THIRD-PARTY-NOTICES"), notices)),
          runtimeIO(() =>
            writeFile(
              join(staging, "grok-package.json"),
              layoutManifest({ version: spec.version, target: spec.target, executable: `bin/${spec.executableName}` }),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );
      if (spec.target !== "win32-x64") yield* runtimeIO(() => chmod(join(staging, "bin", spec.executableName), 0o755));
    }),
    verify: Effect.fn("ProviderRuntime.grok.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const executable = join(root, "bin", spec.executableName);
      if (
        (yield* sha256File(executable).pipe(Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })))) !==
        lock.grok.artifacts[spec.target].assetSha256
      ) {
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.grokChecksum")) });
      }
      if (
        (yield* sha256File(join(root, "LICENSE")).pipe(
          Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
        )) !== lock.grok.licenseSha256
      ) {
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.grokLicenseChecksum")),
        });
      }
      if (
        (yield* sha256File(join(root, "THIRD-PARTY-NOTICES")).pipe(
          Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
        )) !== lock.grok.noticesSha256
      ) {
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.grokNoticesChecksum")),
        });
      }
    }),
    parseVersion: parseGrokVersion,
  },
  antigravity: {
    runtime: "antigravity",
    spec: (target, lock) => {
      const artifact = lock.antigravity.artifacts[target];
      return {
        runtime: "antigravity",
        target,
        version: lock.antigravity.version,
        packageVersion: lock.antigravity.version,
        source: "lock",
        url: `${lock.antigravity.distribution}/${artifact.platformDirectory}/${artifact.asset}`,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    // The server looks for the harness beside itself, so both go to `bin/`. The zip has no licence
    // file; the manifest names the terms Google publishes instead.
    stage: Effect.fn("ProviderRuntime.antigravity.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const bin = join(staging, "bin");
      const harness = antigravityHarnessName(spec.target);
      yield* runtimeIO(() => mkdir(bin, { recursive: true }));
      yield* extractZipFiles(
        downloadedPath,
        bin,
        [spec.executableName, harness],
        sourceText("error.provider.antigravityArchivePath"),
      );
      yield* runtimeIO(() =>
        writeFile(
          join(staging, ANTIGRAVITY_MANIFEST),
          layoutManifest({
            version: spec.version,
            target: spec.target,
            executable: `bin/${spec.executableName}`,
            harness: `bin/${harness}`,
            licenseUrl: lock.antigravity.licenseUrl,
          }),
        ),
      );
      if (spec.target !== "win32-x64") {
        yield* Effect.all(
          [
            runtimeIO(() => chmod(join(bin, spec.executableName), 0o755)),
            runtimeIO(() => chmod(join(bin, harness), 0o755)),
          ],
          { concurrency: "unbounded" },
        );
      }
    }),
    verify: Effect.fn("ProviderRuntime.antigravity.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.antigravity.artifacts[spec.target];
      const [executable, harness] = yield* Effect.all(
        [
          sha256File(join(root, "bin", artifact.executable)).pipe(
            Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
          ),
          sha256File(join(root, "bin", artifact.harness)).pipe(
            Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
          ),
        ],
        { concurrency: "unbounded" },
      );
      if (executable !== artifact.executableSha256 || harness !== artifact.harnessSha256) {
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.antigravityChecksum")),
        });
      }
    }),
    // The server takes no `--version`: it starts and waits for ACP on stdin. OpenBot writes the
    // manifest at install. `verify` hashes only the programs, so the version check compares the
    // manifest with the version that OpenBot wrote, not with the programs.
    versionFile: ANTIGRAVITY_MANIFEST,
    parseVersion: parseAntigravityVersion,
  },
  cursor: {
    runtime: "cursor",
    spec: (target, lock) => {
      const artifact = lock.cursor.artifacts[target];
      return {
        runtime: "cursor",
        target,
        version: lock.cursor.version,
        packageVersion: lock.cursor.version,
        source: "lock",
        url: cursorPackageUrl(lock.cursor.distribution, lock.cursor.version, artifact),
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    // The launcher starts the Node.js runtime and the script beside it, so the whole folder goes to
    // `bin/`. The archive has no licence file; the manifest names the terms Cursor publishes instead.
    // GNU tar on Linux reads no zip, so the Windows zip is read by OpenBot.
    stage: Effect.fn("ProviderRuntime.cursor.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const message = sourceText("error.provider.cursorArchivePath");
      if (spec.target === "win32-x64") {
        yield* extractZipTree(downloadedPath, staging, CURSOR_ARCHIVE_ROOT, message);
      } else {
        yield* assertSafeArchive(downloadedPath, [CURSOR_ARCHIVE_ROOT], message);
        yield* extractArchive(downloadedPath, staging);
      }
      yield* rejectNonRegularFiles(staging);
      yield* runtimeIO(() => rename(join(staging, CURSOR_ARCHIVE_ROOT), join(staging, "bin")));
      yield* runtimeIO(() => access(join(staging, "bin", spec.executableName)));
      yield* runtimeIO(() =>
        writeFile(
          join(staging, CURSOR_MANIFEST),
          layoutManifest({
            version: spec.version,
            target: spec.target,
            executable: `bin/${spec.executableName}`,
            licenseUrl: lock.cursor.licenseUrl,
          }),
        ),
      );
    }),
    verify: Effect.fn("ProviderRuntime.cursor.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const files = Object.entries(lock.cursor.artifacts[spec.target].files);
      const hashes = yield* Effect.forEach(files, ([name]) => sha256File(join(root, "bin", name)), {
        concurrency: "unbounded",
      }).pipe(Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })));
      if (files.some(([, sha256], index) => hashes[index] !== sha256)) {
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.cursorChecksum")) });
      }
    }),
    // The Windows launcher is a `.cmd` file, which `execFile` cannot start, so the version comes from
    // the manifest that OpenBot wrote, as for Antigravity.
    versionFile: CURSOR_MANIFEST,
    parseVersion: parseCursorManifestVersion,
  },
  cline: {
    runtime: "cline",
    spec: (target, lock) => {
      const artifact = lock.cline.artifacts[target];
      return {
        runtime: "cline",
        target,
        version: lock.cline.version,
        packageVersion: lock.cline.version,
        source: "lock",
        url: `${lock.cline.registry}/${artifact.package}/-/${artifact.asset}`,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    stage: Effect.fn("ProviderRuntime.cline.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
      downloadSmallFile,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.cline.artifacts[spec.target];
      yield* withNpmPackage(
        downloadedPath,
        staging,
        {
          name: artifact.package,
          version: spec.packageVersion,
          archivePathError: sourceText("error.provider.clineArchivePath"),
          mismatchError: sourceText("error.provider.clinePackageMismatch"),
        },
        (packageRoot) =>
          Effect.gen(function* () {
            // The platform tarball carries no licence, so it comes from the tagged source like OpenCode's.
            const license = yield* downloadSmallFile(
              `${lock.cline.repository}/raw/${encodeURIComponent(clineTag(spec.version))}/LICENSE`,
              pinnedHash(spec, lock.cline.licenseSha256),
            );
            // The CLI finds its plugin bootstrap and hub webview from the folder of its executable, so
            // the whole package keeps its layout. Only the npm manifest stays out.
            const entries = (yield* runtimeIO(() => readdir(packageRoot))).filter((entry) => entry !== "package.json");
            yield* Effect.forEach(
              entries,
              (entry) =>
                runtimeIO(() => cp(join(packageRoot, entry), join(staging, entry), { recursive: true })).pipe(
                  Effect.uninterruptible,
                ),
              { concurrency: "unbounded", discard: true },
            );
            yield* Effect.all(
              [
                runtimeIO(() => writeFile(join(staging, "LICENSE"), license)).pipe(Effect.uninterruptible),
                runtimeIO(() =>
                  writeFile(
                    join(staging, "cline-package.json"),
                    layoutManifest({
                      version: spec.version,
                      target: spec.target,
                      executable: `bin/${spec.executableName}`,
                    }),
                  ),
                ).pipe(Effect.uninterruptible),
              ],
              { concurrency: "unbounded" },
            );
            if (spec.target !== "win32-x64")
              yield* runtimeIO(() => chmod(join(staging, "bin", spec.executableName), 0o755));
          }),
      );
    }),
    verify: Effect.fn("ProviderRuntime.cline.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.cline.artifacts[spec.target];
      const [executable, bootstrap, license] = yield* Effect.all(
        [
          sha256File(join(root, "bin", spec.executableName)).pipe(
            Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
          ),
          sha256File(join(root, "extensions", "plugin-sandbox-bootstrap.js")).pipe(
            Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
          ),
          sha256File(join(root, "LICENSE")).pipe(Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause }))),
        ],
        { concurrency: "unbounded" },
      );
      if (executable !== artifact.binarySha256 || bootstrap !== artifact.bootstrapSha256) {
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.clineChecksum")) });
      }
      if (license !== lock.cline.licenseSha256)
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.clineLicenseChecksum")),
        });
    }),
    parseVersion: parseClineVersion,
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
    stage: Effect.fn("ProviderRuntime.bun.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
      downloadSmallFile,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.bun.artifacts[spec.target];
      yield* withNpmPackage(
        downloadedPath,
        staging,
        {
          name: artifact.package,
          version: lock.bun.version,
          archivePathError: sourceText("error.provider.bunArchivePath"),
          mismatchError: sourceText("error.provider.bunPackageMismatch"),
        },
        (packageRoot: string) =>
          Effect.gen(function* () {
            // The platform tarball carries no licence, so it comes from the tagged source like Codex's.
            const license = yield* downloadSmallFile(
              `${lock.bun.repository}/raw/${encodeURIComponent(lock.bun.tag)}/LICENSE.md`,
              lock.bun.licenseSha256,
            );
            const binary = join(staging, "bin", artifact.executable);
            yield* runtimeIO(() => mkdir(join(staging, "bin"), { recursive: true }));
            yield* Effect.all(
              [
                runtimeIO(() => copyFile(join(packageRoot, "bin", artifact.executable), binary)),
                runtimeIO(() => writeFile(join(staging, "LICENSE.md"), license)),
                runtimeIO(() =>
                  writeFile(
                    join(staging, "bun-package.json"),
                    layoutManifest({
                      version: lock.bun.version,
                      target: spec.target,
                      executable: `bin/${artifact.executable}`,
                    }),
                  ),
                ),
              ],
              { concurrency: "unbounded" },
            );
            if (spec.target !== "win32-x64") yield* runtimeIO(() => chmod(binary, 0o755));
            yield* stageBunx(binary, join(staging, "bin", bunxExecutableName(spec.target)));
          }),
      );
    }),
    verify: Effect.fn("ProviderRuntime.bun.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.bun.artifacts[spec.target];
      const executable = join(root, "bin", spec.executableName);
      if (
        (yield* sha256File(executable).pipe(Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })))) !==
        artifact.binarySha256
      )
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.bunChecksum")) });
      if (
        (yield* sha256File(join(root, "LICENSE.md")).pipe(
          Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
        )) !== lock.bun.licenseSha256
      ) {
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.bunLicenseChecksum")) });
      }
      // Only the size, because the second name is the same bytes: hashing 80MB twice on every start
      // would buy nothing. A truncated or replaced file fails this, and a swapped whole binary is
      // what the `bun` hash above already answers for.
      const [bun, bunx] = yield* Effect.all(
        [runtimeIO(() => stat(executable)), runtimeIO(() => stat(join(root, "bin", bunxExecutableName(spec.target))))],
        { concurrency: "unbounded" },
      );
      if (bun.size !== bunx.size)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.bunxDamaged")) });
    }),
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
