import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import {
  MANAGED_RUNTIME_PROVIDERS,
  type ManagedProviderId,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import lockValue from "../../native-runtime.lock.json";
import { type AgentRuntimeLock, parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import { type BundledProviderExecutables, configuredCliPath } from "../backend/cli";
import { sha256File } from "./provider-runtime-archive";
import { providerRuntimeDescriptor, type RuntimeSpec, type RuntimeTarget } from "./provider-runtime-descriptors";

const execFileAsync = promisify(execFile);
const PROVIDERS = MANAGED_RUNTIME_PROVIDERS;
const FREE_SPACE_HEADROOM = 100_000_000;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type PartialMetadata = { url: string; etag: string | null; expectedBytes: number };
interface ProviderRuntimeManagerEvents {
  status: [snapshot: ProviderRuntimeSnapshot];
  ready: [provider: ManagedProviderId];
}

export interface ProviderRuntimeManagerOptions {
  root: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  fetchImpl?: Fetch;
  lock?: AgentRuntimeLock;
  availableDiskBytes?: () => Promise<number>;
  updateRuntime?: (provider: ManagedProviderId, install: () => Promise<string>) => Promise<void>;
}

export class ProviderRuntimeManager extends EventEmitter<ProviderRuntimeManagerEvents> {
  readonly #root: string;
  readonly #target: RuntimeTarget | null;
  readonly #fetch: Fetch;
  readonly #lock: AgentRuntimeLock;
  readonly #availableDiskBytes: () => Promise<number>;
  readonly #statuses: Record<ManagedProviderId, ProviderRuntimeStatus>;
  readonly #controllers = new Map<ManagedProviderId, AbortController>();
  readonly #tasks = new Map<ManagedProviderId, Promise<void>>();
  readonly #cancelled = new Set<ManagedProviderId>();
  /** Versions of provider CLIs the user installed, kept only to compare against the lock. */
  readonly #systemVersions = new Map<ManagedProviderId, string>();
  readonly #updateRuntime: (provider: ManagedProviderId, install: () => Promise<string>) => Promise<void>;
  #revision = 0;
  #stopping = false;

  constructor(options: ProviderRuntimeManagerOptions) {
    super();
    this.#root = options.root;
    this.#updateRuntime =
      options.updateRuntime ??
      (async (_provider, install) => {
        await install();
      });
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
      opencode: emptyStatus(unsupportedMessage),
    };
  }

  async initialize(): Promise<ProviderRuntimeSnapshot> {
    await mkdir(this.#root, { recursive: true });
    await this.#removeAbandonedStaging();
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
        // Agent status names a system fallback until the managed candidate is activated.
        const installed = this.#systemVersions.get(provider) ?? providers[provider].version;
        const offer = installed !== null && installed !== undefined && olderVersion(installed, version);
        providers[provider].availableVersion = offer && !configuredCliPath(provider) ? version : null;
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
  setSystemVersion(provider: ManagedProviderId, version: string | null): void {
    if ((this.#systemVersions.get(provider) ?? null) === version) return;
    if (version) this.#systemVersions.set(provider, version);
    else this.#systemVersions.delete(provider);
    this.#revision += 1;
    this.emit("status", this.getStatus());
  }

  /** The managed copy of every provider CLI, in the shape the agent service takes. */
  bundledExecutables(): BundledProviderExecutables {
    const executables: BundledProviderExecutables = {};
    for (const provider of PROVIDERS) executables[provider] = this.executablePath(provider);
    return executables;
  }

  executablePath(provider: ManagedProviderId): string | null {
    if (!this.#target) return null;
    const spec = runtimeSpec(provider, this.#target, this.#lock);
    return join(
      this.#providerRoot(provider),
      spec.target,
      this.#statuses[provider].version ?? spec.version,
      "bin",
      spec.executableName,
    );
  }

  async download(provider: ManagedProviderId): Promise<ProviderRuntimeSnapshot> {
    if (!this.#target) throw new Error("Provider runtimes are not available on this platform.");
    if (this.#stopping) throw new Error("OpenBot is closing.");
    if (configuredCliPath(provider))
      throw new Error("Remove the explicit CLI path override before updating in OpenBot.");
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
    const task = this.#updateManagedRuntime(spec, controller.signal)
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

  async downloadAndWait(provider: ManagedProviderId): Promise<void> {
    await this.download(provider);
    await this.#tasks.get(provider);
    const status = this.#statuses[provider];
    if (status.phase !== "ready") throw new Error(status.message ?? "The provider update did not complete.");
  }

  async cancel(provider: ManagedProviderId): Promise<ProviderRuntimeSnapshot> {
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

  async #inspect(provider: ManagedProviderId): Promise<void> {
    if (!this.#target) return;
    const spec = runtimeSpec(provider, this.#target, this.#lock);
    try {
      await verifyInstalledRuntime(this.#installRoot(spec), spec, this.#lock);
      this.#statuses[provider] = readyStatus(spec.version);
    } catch {
      this.#statuses[provider] = { ...emptyStatus(), version: await this.#previousVersion(spec) };
    }
  }

  // Keep the last installed version available while the pinned replacement is downloaded.
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

  async #updateManagedRuntime(spec: RuntimeSpec, signal: AbortSignal): Promise<void> {
    let installed = false;
    try {
      await this.#updateRuntime(spec.provider, async () => {
        await this.#runDownload(spec, signal);
        installed = true;
        await this.#removePartial(spec);
        return join(this.#installRoot(spec), "bin", spec.executableName);
      });
      this.#setStatus(spec.provider, readyStatus(spec.version));
      this.emit("ready", spec.provider);
    } catch (error) {
      // A failed activation must not select the rejected artifact on the next app start.
      if (installed) await rm(this.#installRoot(spec), { recursive: true, force: true });
      throw error;
    }
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
  }

  async #install(spec: RuntimeSpec, downloadedPath: string): Promise<void> {
    const staging = join(this.#providerRoot(spec.provider), `.installing-${spec.target}-${spec.version}`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    let committed = false;
    try {
      await providerRuntimeDescriptor(spec.provider).stage({
        spec,
        downloadedPath,
        staging,
        lock: this.#lock,
        downloadSmallFile: (url, expectedSha256) => this.#downloadSmallFile(url, expectedSha256),
      });
      await verifyInstalledRuntime(staging, spec, this.#lock);
      const destination = this.#installRoot(spec);
      await mkdir(dirname(destination), { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await rename(staging, destination);
      committed = true;
      await verifyInstalledRuntime(destination, spec, this.#lock);
    } catch (error) {
      if (committed) await rm(this.#installRoot(spec), { recursive: true, force: true });
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
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

  async #handleDownloadFailure(provider: ManagedProviderId, error: unknown): Promise<void> {
    if (this.#cancelled.has(provider)) return;
    if (this.#stopping && isAbortError(error)) return;
    const message = isAbortError(error)
      ? "Download stopped. Try again."
      : error instanceof Error
        ? redactText(error.message)
        : "Download failed. Try again.";
    this.#setStatus(provider, {
      phase: "download-error",
      progress: null,
      message,
      version: this.#statuses[provider].version,
    });
  }

  #setStatus(provider: ManagedProviderId, status: ProviderRuntimeStatus): void {
    this.#statuses[provider] = status;
    this.#revision += 1;
    this.emit("status", this.getStatus());
  }

  #providerRoot(provider: ManagedProviderId): string {
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

function runtimeSpec(provider: ManagedProviderId, target: RuntimeTarget, lock: AgentRuntimeLock): RuntimeSpec {
  return providerRuntimeDescriptor(provider).spec(target, lock);
}

/**
 * The checks every provider runtime gets: the executable exists, the descriptor's own checksums and
 * manifest pass, and the installed binary reports the version the lock pinned. The last one is what
 * catches a CLI that replaced itself after installation.
 */
async function verifyInstalledRuntime(root: string, spec: RuntimeSpec, lock: AgentRuntimeLock): Promise<void> {
  const descriptor = providerRuntimeDescriptor(spec.provider);
  const executable = join(root, "bin", spec.executableName);
  await access(executable);
  await descriptor.verify(root, spec, lock);
  const { stdout } = await execFileAsync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
  if (descriptor.parseVersion(stdout) !== spec.version) {
    throw new Error("Provider runtime returned an unexpected version.");
  }
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
