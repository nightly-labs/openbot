import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import type { AgentProviderId, ProviderRuntimeSnapshot, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import lockValue from "../../native-runtime.lock.json";
import { type AgentRuntimeLock, parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";

const execFileAsync = promisify(execFile);
const PROVIDERS = ["codex", "claude", "grok"] as const satisfies readonly AgentProviderId[];
const FREE_SPACE_HEADROOM = 100_000_000;
const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

type RuntimeTarget = "darwin-arm64" | "win32-x64";
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type PartialMetadata = { url: string; etag: string | null; expectedBytes: number };
type RuntimeSpec = {
  provider: AgentProviderId;
  version: string;
  target: RuntimeTarget;
  url: string;
  archiveSha256: string;
  downloadBytes: number;
  installedBytes: number;
  executableName: string;
};

interface ProviderRuntimeManagerEvents {
  status: [snapshot: ProviderRuntimeSnapshot];
  ready: [provider: AgentProviderId];
}

export interface ProviderRuntimeManagerOptions {
  root: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  fetchImpl?: Fetch;
  lock?: AgentRuntimeLock;
  availableDiskBytes?: () => Promise<number>;
}

export class ProviderRuntimeManager extends EventEmitter<ProviderRuntimeManagerEvents> {
  readonly #root: string;
  readonly #target: RuntimeTarget | null;
  readonly #fetch: Fetch;
  readonly #lock: AgentRuntimeLock;
  readonly #availableDiskBytes: () => Promise<number>;
  readonly #statuses: Record<AgentProviderId, ProviderRuntimeStatus>;
  readonly #controllers = new Map<AgentProviderId, AbortController>();
  readonly #tasks = new Map<AgentProviderId, Promise<void>>();
  readonly #cancelled = new Set<AgentProviderId>();
  /** Versions of provider CLIs the user installed, kept only to compare against the lock. */
  readonly #systemVersions = new Map<AgentProviderId, string>();
  /**
   * The offers the user's own CLI updater has already turned down, one per provider.
   *
   * A CLI decides for itself what its newest version is, and its release channel can name an older
   * one than the lock: `grok update` reports success and leaves the CLI where it was. Kept on disk,
   * because an offer that returns on the next start is the same dead end again.
   */
  readonly #refusedUpdates = new Map<AgentProviderId, { version: string; pinnedVersion: string }>();
  /** The queue that keeps the record's writes in the order the refusals were recorded. */
  #refusedUpdatesWrite: Promise<void> = Promise.resolve();
  #revision = 0;
  #stopping = false;

  constructor(options: ProviderRuntimeManagerOptions) {
    super();
    this.#root = options.root;
    this.#target = runtimeTarget(options.platform ?? process.platform, options.architecture ?? process.arch);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#lock = options.lock ?? parseAgentRuntimeLock(lockValue);
    this.#availableDiskBytes =
      options.availableDiskBytes ??
      (async () => {
        const filesystem = await statfs(this.#root);
        return filesystem.bavail * filesystem.bsize;
      });
    const unsupportedMessage = this.#target ? null : "This platform is not supported.";
    this.#statuses = {
      codex: emptyStatus(unsupportedMessage),
      claude: emptyStatus(unsupportedMessage),
      grok: emptyStatus(unsupportedMessage),
    };
  }

  async initialize(): Promise<ProviderRuntimeSnapshot> {
    await mkdir(this.#root, { recursive: true });
    await this.#removeAbandonedStaging();
    await this.#readRefusedUpdates();
    await Promise.all(PROVIDERS.map((provider) => this.#inspect(provider)));
    const target = this.#target;
    if (target) {
      await Promise.all(
        PROVIDERS.map((provider) => this.#removeOldVersions(runtimeSpec(provider, target, this.#lock))),
      );
    }
    return this.getStatus();
  }

  getStatus(): ProviderRuntimeSnapshot {
    const providers = structuredClone(this.#statuses);
    if (this.#target) {
      for (const provider of PROVIDERS) {
        const version = runtimeSpec(provider, this.#target, this.#lock).version;
        // The install in use, which is the user's own copy whenever there is one: the resolver
        // prefers it, so the managed version on disk is not what the provider runs.
        const installed = this.#systemVersions.get(provider) ?? providers[provider].version;
        const refused = this.#refusedUpdates.get(provider);
        const offer = installed !== null && installed !== undefined && olderVersion(installed, version);
        providers[provider].availableVersion =
          offer && !(refused?.version === installed && refused.pinnedVersion === version) ? version : null;
      }
    }
    return { revision: this.#revision, providers };
  }

  /**
   * Records the version of a provider CLI the user installed, as the agent service resolved it.
   *
   * The manager does not own that install and never downloads for it. It owns the lock, though, and
   * the lock is what says which version is current, so the comparison belongs here with the managed
   * one rather than in the renderer, which must not compare versions at all. Pass `null` when the
   * provider went back to the managed copy or resolved nothing.
   */
  setSystemVersion(provider: AgentProviderId, version: string | null): void {
    if ((this.#systemVersions.get(provider) ?? null) === version) return;
    if (version) this.#systemVersions.set(provider, version);
    else this.#systemVersions.delete(provider);
    this.#revision += 1;
    this.emit("status", this.getStatus());
  }

  /**
   * The result of a run of the provider CLI's own updater: the version the CLI was on before it, and
   * the version it reports now.
   *
   * A CLI that finishes on the version it started on has answered: the version the lock pins is not
   * one its own channel will install, so OpenBot stops offering it. The record is kept against both
   * versions, so a new pinned version is a new offer, and so is a CLI the user moves by other means.
   */
  async noteSystemCliUpdate(provider: AgentProviderId, before: string | null, after: string | null): Promise<void> {
    if (!this.#target) return;
    const pinnedVersion = runtimeSpec(provider, this.#target, this.#lock).version;
    const refused = after !== null && after === before && olderVersion(after, pinnedVersion);
    const current = this.#refusedUpdates.get(provider);
    if (refused && current?.version === after && current.pinnedVersion === pinnedVersion) return;
    if (!refused && !current) return;
    if (refused && after) this.#refusedUpdates.set(provider, { version: after, pinnedVersion });
    else this.#refusedUpdates.delete(provider);
    await this.#writeRefusedUpdates();
    this.#revision += 1;
    this.emit("status", this.getStatus());
  }

  async #readRefusedUpdates(): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.#refusedUpdatesPath(), "utf8"));
    } catch {
      // A record that is missing or unreadable only costs the user one more refused offer.
      return;
    }
    if (!isDynamicRecord(parsed)) return;
    for (const provider of PROVIDERS) {
      const entry = parsed[provider];
      if (!isDynamicRecord(entry) || !isString(entry.version) || !isString(entry.pinnedVersion)) continue;
      this.#refusedUpdates.set(provider, { version: entry.version, pinnedVersion: entry.pinnedVersion });
    }
  }

  /**
   * Writes the record, one write at a time.
   *
   * Two providers can finish an update at once. Each write serializes the record as it stands when
   * its turn comes and renames its own temporary file into place, so without the queue the older
   * snapshot could be renamed last and drop the newer provider's refusal - which the user would meet
   * as an offer that provider has already turned down.
   */
  async #writeRefusedUpdates(): Promise<void> {
    const write = this.#refusedUpdatesWrite.then(async () => {
      const path = this.#refusedUpdatesPath();
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(this.#root, { recursive: true });
        await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(this.#refusedUpdates))}\n`, "utf8");
        await rename(temporaryPath, path);
      } catch {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    });
    this.#refusedUpdatesWrite = write;
    await write;
  }

  #refusedUpdatesPath(): string {
    return join(this.#root, "cli-update-refusals.json");
  }

  executablePath(provider: AgentProviderId): string | null {
    if (!this.#target) return null;
    const spec = runtimeSpec(provider, this.#target, this.#lock);
    return join(this.#installRoot(spec), "bin", spec.executableName);
  }

  async download(provider: AgentProviderId): Promise<ProviderRuntimeSnapshot> {
    if (!this.#target) throw new Error("Provider runtimes are not available on this platform.");
    if (this.#stopping) throw new Error("OpenBot is closing.");
    if (this.#statuses[provider].phase === "ready" || this.#tasks.has(provider)) return this.getStatus();

    const spec = runtimeSpec(provider, this.#target, this.#lock);
    const controller = new AbortController();
    this.#controllers.set(provider, controller);
    this.#cancelled.delete(provider);
    this.#setStatus(provider, {
      phase: "downloading",
      progress: 0,
      message: null,
      version: this.#statuses[provider].version,
    });
    const task = this.#runDownload(spec, controller.signal)
      .catch((error: unknown) => {
        this.#controllers.delete(provider);
        this.#tasks.delete(provider);
        return this.#handleDownloadFailure(provider, error);
      })
      .finally(() => {
        this.#controllers.delete(provider);
        this.#tasks.delete(provider);
        this.#cancelled.delete(provider);
      });
    this.#tasks.set(provider, task);
    return this.getStatus();
  }

  async cancel(provider: AgentProviderId): Promise<ProviderRuntimeSnapshot> {
    if (this.#statuses[provider].phase !== "downloading") return this.getStatus();
    const task = this.#tasks.get(provider);
    this.#cancelled.add(provider);
    this.#controllers.get(provider)?.abort();
    await task;
    if (this.#target) await this.#removePartial(runtimeSpec(provider, this.#target, this.#lock));
    await this.#inspect(provider);
    this.#setStatus(provider, this.#statuses[provider]);
    return this.getStatus();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    for (const controller of this.#controllers.values()) controller.abort();
    await Promise.allSettled(this.#tasks.values());
  }

  async #inspect(provider: AgentProviderId): Promise<void> {
    if (!this.#target) return;
    const spec = runtimeSpec(provider, this.#target, this.#lock);
    try {
      await verifyInstalledRuntime(this.#installRoot(spec), spec, this.#lock);
      this.#statuses[provider] = readyStatus(spec.version);
    } catch {
      this.#statuses[provider] = { ...emptyStatus(), version: await this.#previousVersion(spec) };
    }
  }

  // This is display metadata only. Only the pinned, verified runtime is executable.
  async #previousVersion(spec: RuntimeSpec): Promise<string | null> {
    const targetRoot = dirname(this.#installRoot(spec));
    const entries = await readdir(targetRoot, { withFileTypes: true }).catch(() => []);
    const versions = entries
      .filter((entry) => entry.isDirectory() && olderVersion(entry.name, spec.version))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    for (const version of versions) {
      const executable = await stat(join(targetRoot, version, "bin", spec.executableName)).catch(() => null);
      if (executable?.isFile()) return version;
    }
    return null;
  }

  async #runDownload(spec: RuntimeSpec, signal: AbortSignal): Promise<void> {
    await mkdir(this.#downloadRoot(), { recursive: true });
    await this.#requireDiskSpace(spec);
    const partialPath = this.#partialPath(spec);
    const metadataPath = this.#partialMetadataPath(spec);
    const previous = await readPartialState(partialPath, metadataPath, spec);
    let offset = previous.offset;
    let response = await this.#fetchRuntime(spec, signal, offset, previous.metadata?.etag ?? null);
    if (offset > 0 && !isValidPartialResponse(response, offset, spec.downloadBytes, previous.metadata?.etag ?? null)) {
      await response.body?.cancel().catch(() => undefined);
      await this.#removePartial(spec);
      offset = 0;
      response = await this.#fetchRuntime(spec, signal, 0, null);
    }
    if (!response.ok || (offset > 0 && response.status !== 206)) {
      throw new Error(`Runtime download failed with HTTP ${response.status}.`);
    }
    if (!response.body) throw new Error("Runtime download returned no data.");

    const etag = response.headers.get("etag");
    await writeFile(
      metadataPath,
      `${JSON.stringify({ url: spec.url, etag, expectedBytes: spec.downloadBytes } satisfies PartialMetadata)}\n`,
      { mode: 0o600 },
    );
    await streamResponse(response, partialPath, offset, signal, (received) => {
      const progress = Math.min(99, Math.floor((received / spec.downloadBytes) * 100));
      if (progress !== this.#statuses[spec.provider].progress) {
        this.#setStatus(spec.provider, {
          phase: "downloading",
          progress,
          message: null,
          version: this.#statuses[spec.provider].version,
        });
      }
    });

    this.#setStatus(spec.provider, {
      phase: "finishing",
      progress: null,
      message: null,
      version: this.#statuses[spec.provider].version,
    });
    const downloaded = await stat(partialPath);
    if (downloaded.size !== spec.downloadBytes) {
      throw new Error("The runtime download has an unexpected size.");
    }
    const digest = await sha256File(partialPath);
    if (digest !== spec.archiveSha256) {
      await this.#removePartial(spec);
      throw new Error("The runtime download failed its integrity check.");
    }

    await this.#install(spec, partialPath);
    await this.#removePartial(spec);
    this.#setStatus(spec.provider, readyStatus(spec.version));
    this.emit("ready", spec.provider);
  }

  async #install(spec: RuntimeSpec, downloadedPath: string): Promise<void> {
    const staging = join(this.#providerRoot(spec.provider), `.installing-${spec.target}-${spec.version}`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      if (spec.provider === "codex") await this.#stageCodex(spec, downloadedPath, staging);
      else if (spec.provider === "claude") await this.#stageClaude(spec, downloadedPath, staging);
      else await this.#stageGrok(spec, downloadedPath, staging);
      await verifyInstalledRuntime(staging, spec, this.#lock);
      const destination = this.#installRoot(spec);
      await mkdir(dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      await verifyInstalledRuntime(destination, spec, this.#lock);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async #stageCodex(_spec: RuntimeSpec, archive: string, staging: string): Promise<void> {
    await assertSafeArchive(archive, "codex");
    await extractArchive(archive, staging);
    await rejectNonRegularFiles(staging);
    const license = await this.#downloadSmallFile(
      `${this.#lock.codex.repository}/raw/${encodeURIComponent(this.#lock.codex.tag)}/LICENSE`,
      this.#lock.codex.licenseSha256,
    );
    await writeFile(join(staging, "LICENSE"), license);
  }

  async #stageClaude(spec: RuntimeSpec, archive: string, staging: string): Promise<void> {
    const extracted = `${staging}.extracted`;
    await rm(extracted, { recursive: true, force: true });
    await mkdir(extracted, { recursive: true });
    try {
      await assertSafeArchive(archive, "claude");
      await extractArchive(archive, extracted);
      await rejectNonRegularFiles(extracted);
      const packageRoot = join(extracted, "package");
      const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
      const artifact = this.#lock.claude.artifacts[spec.target];
      if (
        !isDynamicRecord(packageManifest) ||
        packageManifest.name !== artifact.package ||
        packageManifest.version !== this.#lock.claude.sdkVersion
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
            version: this.#lock.claude.version,
            sdkVersion: this.#lock.claude.sdkVersion,
            target: spec.target,
            executable: `bin/${artifact.executable}`,
          })}\n`,
        ),
      ]);
      if (spec.target === "darwin-arm64") await chmod(join(staging, "bin", artifact.executable), 0o755);
    } finally {
      await rm(extracted, { recursive: true, force: true });
    }
  }

  async #stageGrok(spec: RuntimeSpec, binary: string, staging: string): Promise<void> {
    const rawRepository = this.#lock.grok.repository.replace("github.com", "raw.githubusercontent.com");
    const [license, notices] = await Promise.all([
      this.#downloadSmallFile(
        `${rawRepository}/${this.#lock.grok.sourceCommit}/LICENSE`,
        this.#lock.grok.licenseSha256,
      ),
      this.#downloadSmallFile(
        `${rawRepository}/${this.#lock.grok.sourceCommit}/THIRD-PARTY-NOTICES`,
        this.#lock.grok.noticesSha256,
      ),
    ]);
    await mkdir(join(staging, "bin"), { recursive: true });
    await Promise.all([
      copyFile(binary, join(staging, "bin", spec.executableName)),
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
  }

  async #downloadSmallFile(url: string, expectedSha256: string): Promise<Uint8Array> {
    const response = await this.#fetch(url, { headers: { "User-Agent": "OpenBot-runtime-installer" } });
    if (!response.ok) throw new Error(`Runtime metadata download failed with HTTP ${response.status}.`);
    const value = await readSmallResponse(response);
    if (createHash("sha256").update(value).digest("hex") !== expectedSha256) {
      throw new Error("Runtime metadata failed its integrity check.");
    }
    return value;
  }

  async #fetchRuntime(spec: RuntimeSpec, signal: AbortSignal, offset: number, etag: string | null): Promise<Response> {
    return this.#fetch(spec.url, {
      signal,
      redirect: "follow",
      headers: {
        "User-Agent": "OpenBot-runtime-installer",
        ...(offset > 0 ? { Range: `bytes=${offset}-`, ...(etag ? { "If-Range": etag } : {}) } : {}),
      },
    });
  }

  async #requireDiskSpace(spec: RuntimeSpec): Promise<void> {
    const available = await this.#availableDiskBytes();
    const existing = await fileSize(this.#partialPath(spec));
    const required = Math.max(0, spec.downloadBytes - existing) + spec.installedBytes + FREE_SPACE_HEADROOM;
    if (available < required) throw new Error("There is not enough free disk space for this provider.");
  }

  async #handleDownloadFailure(provider: AgentProviderId, error: unknown): Promise<void> {
    if (this.#cancelled.has(provider)) return;
    if (this.#stopping && isAbortError(error)) return;
    const message = isAbortError(error)
      ? "Download stopped. Try again."
      : error instanceof Error
        ? error.message
        : "Download failed. Try again.";
    this.#setStatus(provider, {
      phase: "download-error",
      progress: null,
      message,
      version: this.#statuses[provider].version,
    });
  }

  #setStatus(provider: AgentProviderId, status: ProviderRuntimeStatus): void {
    this.#statuses[provider] = status;
    this.#revision += 1;
    this.emit("status", this.getStatus());
  }

  #providerRoot(provider: AgentProviderId): string {
    return join(this.#root, provider);
  }

  #installRoot(spec: RuntimeSpec): string {
    return join(this.#providerRoot(spec.provider), spec.target, spec.version);
  }

  #downloadRoot(): string {
    return join(this.#root, ".downloads");
  }

  #partialPath(spec: RuntimeSpec): string {
    return join(this.#downloadRoot(), `${spec.provider}-${spec.target}-${spec.version}.partial`);
  }

  #partialMetadataPath(spec: RuntimeSpec): string {
    return `${this.#partialPath(spec)}.json`;
  }

  async #removePartial(spec: RuntimeSpec): Promise<void> {
    await Promise.all([
      rm(this.#partialPath(spec), { force: true }),
      rm(this.#partialMetadataPath(spec), { force: true }),
    ]);
  }

  async #removeAbandonedStaging(): Promise<void> {
    for (const provider of PROVIDERS) {
      const root = this.#providerRoot(provider);
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name.startsWith(".installing-"))
          .map((entry) => rm(join(root, entry.name), { recursive: true, force: true })),
      );
    }
  }

  async #removeOldVersions(spec: RuntimeSpec): Promise<void> {
    const targetRoot = join(this.#providerRoot(spec.provider), spec.target);
    const entries = await readdir(targetRoot, { withFileTypes: true }).catch(() => []);
    const versions = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
    const keep = new Set([
      spec.version,
      this.#statuses[spec.provider].version,
      ...versions
        .filter((version) => version !== spec.version)
        .sort()
        .reverse()
        .slice(0, 1),
    ]);
    await Promise.all(
      versions
        .filter((version) => !keep.has(version))
        .map((version) => rm(join(targetRoot, version), { recursive: true, force: true })),
    );
  }
}

function runtimeTarget(platform: NodeJS.Platform, architecture: string): RuntimeTarget | null {
  if (platform === "darwin" && architecture === "arm64") return "darwin-arm64";
  if (platform === "win32" && architecture === "x64") return "win32-x64";
  return null;
}

function runtimeSpec(provider: AgentProviderId, target: RuntimeTarget, lock: AgentRuntimeLock): RuntimeSpec {
  if (provider === "codex") {
    const artifact = lock.codex.artifacts[target];
    return {
      provider,
      target,
      version: lock.codex.version,
      url: `${lock.codex.repository}/releases/download/${encodeURIComponent(lock.codex.tag)}/${artifact.asset}`,
      archiveSha256: artifact.assetSha256,
      downloadBytes: artifact.downloadBytes,
      installedBytes: artifact.installedBytes,
      executableName: target === "win32-x64" ? "codex.exe" : "codex",
    };
  }
  if (provider === "claude") {
    const artifact = lock.claude.artifacts[target];
    return {
      provider,
      target,
      version: lock.claude.version,
      url: `${lock.claude.registry}/${artifact.package}/-/${artifact.asset}`,
      archiveSha256: artifact.assetSha256,
      downloadBytes: artifact.downloadBytes,
      installedBytes: artifact.installedBytes,
      executableName: artifact.executable,
    };
  }
  const artifact = lock.grok.artifacts[target];
  return {
    provider,
    target,
    version: lock.grok.version,
    url: `${lock.grok.distribution}/${artifact.asset}`,
    archiveSha256: artifact.assetSha256,
    downloadBytes: artifact.downloadBytes,
    installedBytes: artifact.installedBytes,
    executableName: artifact.executable,
  };
}

async function verifyInstalledRuntime(root: string, spec: RuntimeSpec, lock: AgentRuntimeLock): Promise<void> {
  const executable = join(root, "bin", spec.executableName);
  await access(executable);
  if (spec.provider === "codex") {
    const manifest = JSON.parse(await readFile(join(root, "codex-package.json"), "utf8"));
    if (!isDynamicRecord(manifest) || manifest.version !== lock.codex.version) {
      throw new Error("Unexpected Codex runtime version.");
    }
    await Promise.all([
      access(join(root, "bin", spec.target === "win32-x64" ? "codex-code-mode-host.exe" : "codex-code-mode-host")),
      access(join(root, "codex-path", spec.target === "win32-x64" ? "rg.exe" : "rg")),
    ]);
  } else if (spec.provider === "claude") {
    const artifact = lock.claude.artifacts[spec.target];
    if ((await sha256File(executable)) !== artifact.binarySha256) throw new Error("Claude runtime checksum mismatch.");
    if ((await sha256File(join(root, "LICENSE.md"))) !== lock.claude.licenseSha256) {
      throw new Error("Claude license checksum mismatch.");
    }
  } else {
    if ((await sha256File(executable)) !== lock.grok.artifacts[spec.target].assetSha256) {
      throw new Error("Grok runtime checksum mismatch.");
    }
    if ((await sha256File(join(root, "LICENSE"))) !== lock.grok.licenseSha256) {
      throw new Error("Grok license checksum mismatch.");
    }
    if ((await sha256File(join(root, "THIRD-PARTY-NOTICES"))) !== lock.grok.noticesSha256) {
      throw new Error("Grok notices checksum mismatch.");
    }
  }
  const { stdout } = await execFileAsync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
  if (!stdout.includes(spec.version)) throw new Error("Provider runtime returned an unexpected version.");
}

async function streamResponse(
  response: Response,
  path: string,
  offset: number,
  signal: AbortSignal,
  onProgress: (received: number) => void,
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error("Runtime download returned no data.");
  const writer = createWriteStream(path, { flags: offset > 0 ? "a" : "w", mode: 0o600 });
  writer.on("error", () => undefined);
  const reader = body.getReader();
  let received = offset;
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const chunk = await reader.read();
      if (chunk.done) break;
      await new Promise<void>((resolveWrite, rejectWrite) => {
        writer.write(chunk.value, (error) => (error ? rejectWrite(error) : resolveWrite()));
      });
      received += chunk.value.byteLength;
      onProgress(received);
    }
    await new Promise<void>((resolveClose, rejectClose) => {
      writer.end(resolveClose);
      writer.once("error", rejectClose);
    });
  } catch (error) {
    writer.destroy();
    await finished(writer).catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

async function readPartialState(
  partialPath: string,
  metadataPath: string,
  spec: RuntimeSpec,
): Promise<{ offset: number; metadata: PartialMetadata | null }> {
  try {
    const [metadataValue, partial] = await Promise.all([readFile(metadataPath, "utf8"), stat(partialPath)]);
    const metadata = JSON.parse(metadataValue);
    if (
      !isDynamicRecord(metadata) ||
      !isString(metadata.url) ||
      (metadata.etag !== null && !isString(metadata.etag)) ||
      !isNumber(metadata.expectedBytes) ||
      metadata.url !== spec.url ||
      metadata.expectedBytes !== spec.downloadBytes ||
      partial.size <= 0 ||
      partial.size >= spec.downloadBytes
    ) {
      return { offset: 0, metadata: null };
    }
    return {
      offset: partial.size,
      metadata: { url: metadata.url, etag: metadata.etag, expectedBytes: metadata.expectedBytes },
    };
  } catch {
    return { offset: 0, metadata: null };
  }
}

function isValidPartialResponse(
  response: Response,
  offset: number,
  expectedBytes: number,
  previousEtag: string | null,
): boolean {
  if (response.status !== 206) return false;
  const responseEtag = response.headers.get("etag");
  if (previousEtag && responseEtag !== previousEtag) return false;
  const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/u);
  if (!range) return false;
  const start = Number(range[1]);
  const end = Number(range[2]);
  const total = Number(range[3]);
  return start === offset && end >= start && end < total && total === expectedBytes;
}

async function readSmallResponse(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("Runtime metadata download returned no data.");
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_METADATA_BYTES) throw new Error("Runtime metadata is too large.");
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const value = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return value;
}

async function assertSafeArchive(path: string, provider: "codex" | "claude"): Promise<void> {
  const [{ stdout: namesValue }, { stdout: detailsValue }] = await Promise.all([
    execFileAsync("tar", ["-tzf", path], { encoding: "utf8", maxBuffer: MAX_ARCHIVE_LIST_BYTES }),
    execFileAsync("tar", ["-tvzf", path], { encoding: "utf8", maxBuffer: MAX_ARCHIVE_LIST_BYTES }),
  ]);
  const names = namesValue.split(/\r?\n/u).filter(Boolean);
  const details = detailsValue.split(/\r?\n/u).filter(Boolean);
  if (details.some((line) => !["-", "d"].includes(line.trimStart().charAt(0)))) {
    throw new Error("The runtime archive contains a link or special file.");
  }
  for (const name of names) {
    if (name.includes("\0") || name.includes("\\")) throw new Error("The runtime archive contains an unsafe path.");
    const normalized = name.replace(/\/+$/u, "");
    const parts = normalized.split("/");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:/u.test(normalized) ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("The runtime archive contains an unsafe path.");
    }
    if (provider === "claude" && parts[0] !== "package") throw new Error("The Claude archive has an unexpected path.");
    if (
      provider === "codex" &&
      !["bin", "codex-package.json", "codex-path", "codex-resources"].includes(parts[0] ?? "")
    ) {
      throw new Error("The Codex archive has an unexpected path.");
    }
  }
}

async function extractArchive(archive: string, destination: string): Promise<void> {
  await execFileAsync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"], {
    encoding: "utf8",
    maxBuffer: MAX_ARCHIVE_LIST_BYTES,
  });
}

async function rejectNonRegularFiles(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new Error("The runtime contains a link or special file.");
      }
      if (entry.isDirectory()) await rejectNonRegularFiles(path);
    }),
  );
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function fileSize(path: string): Promise<number> {
  return stat(path)
    .then((value) => value.size)
    .catch(() => 0);
}

function emptyStatus(message: string | null = null): ProviderRuntimeStatus {
  return { phase: "not-downloaded", progress: null, message, version: null };
}

function readyStatus(version: string): ProviderRuntimeStatus {
  return { phase: "ready", progress: 100, message: null, version };
}

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function olderVersion(installed: string, target: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(installed) || !/^\d+\.\d+\.\d+$/.test(target)) return false;
  return installed.localeCompare(target, "en", { numeric: true }) < 0;
}
