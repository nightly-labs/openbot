import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, stat, statfs, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
/**
 * How long a leftover staging or replaced directory is left alone.
 *
 * The store is shared by every profile on this computer, so a sweep cannot assume the only writer
 * is this process: a sibling instance may be part-way through a 144 MB install. Age is the test,
 * not the pid on the name -- pids are reused, `kill(pid, 0)` across users answers `EPERM`, and
 * Windows does not agree with either. Six hours is far beyond any install and still collects what
 * a crashed instance left behind.
 */
const STALE_STAGING_MS = 6 * 60 * 60 * 1000;
/** How long an unused version directory is kept, for the same reason: a sibling may still run it. */
const VERSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * How many times a commit re-reads a destination another instance is replacing.
 *
 * Each pass ends in one of three ways - this instance committed, it adopted what is there, or the
 * destination moved under it - and only the third goes round again. Three is enough for the moves a
 * sibling makes for one version; a store that keeps answering that way is broken, not busy, and
 * failing says so rather than looping.
 */
const COMMIT_ATTEMPTS = 3;
/**
 * What the sweep collects by age beside the version directories.
 *
 * A claim is not on the list. Removing one is how an instance takes a destination over, and the
 * sweep holds no claim itself, so it would be one more unsynchronised writer of the very path the
 * claim exists to serialise. `takeLock` clears an abandoned claim, and what it leaves behind while
 * it does carries the `.replaced-` prefix.
 */
const STAGING_PREFIXES = [".installing-", ".replaced-"];

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type PartialMetadata = { url: string; etag: string | null; expectedBytes: number };
interface ProviderRuntimeManagerEvents {
  status: [snapshot: ProviderRuntimeSnapshot];
  ready: [provider: ManagedProviderId];
}

export interface ProviderRuntimeManagerOptions {
  /** The installed runtimes, shared by every profile on this computer. See `providerRuntimeRoot`. */
  root: string;
  /**
   * Where partial downloads are written, `<root>/.downloads` by default.
   *
   * The caller points this inside the profile so two instances cannot append to one `.partial`:
   * `createWriteStream` in append mode would interleave their bytes, and the result passes neither
   * the size nor the checksum test. Resume therefore stays what it always was -- same profile, same
   * file, across restarts -- while the expensive installed tree is what the computer shares.
   */
  downloadRoot?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  fetchImpl?: Fetch;
  lock?: AgentRuntimeLock;
  availableDiskBytes?: () => Promise<number>;
  updateRuntime?: (provider: ManagedProviderId, install: () => Promise<string>) => Promise<void>;
}

/**
 * Where the downloaded provider CLIs live: one store for the whole computer, not one per profile.
 *
 * `appData/OpenBot` is exactly what Electron gives the packaged app as `userData` on macOS, Windows
 * and Linux, so this is the path released builds already use and nothing has to be migrated. What
 * it changes is development, where every renderer port and every `--isolated` worktree gets a
 * profile of its own: each one used to start with an empty store, resolve the user's own CLI
 * instead, and offer -- and download -- the pinned copy again.
 *
 * An explicit `--user-data-dir` is the exception. That switch is asked for so a profile is
 * self-contained: automation and packaged smoke checks delete one directory to get a clean machine,
 * and two isolated runs must not reach into each other.
 */
export function providerRuntimeRoot(input: { appData: string; userDataOverride: string }): string {
  const override = input.userDataOverride.trim();
  if (override) return join(resolve(override), "provider-runtimes");
  return join(input.appData, "OpenBot", "provider-runtimes");
}

export class ProviderRuntimeManager extends EventEmitter<ProviderRuntimeManagerEvents> {
  readonly #root: string;
  readonly #downloads: string;
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
    this.#downloads = options.downloadRoot ?? join(options.root, ".downloads");
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
      // Settled, not all: collecting an old version is housekeeping, and a version another instance
      // still runs refuses to be removed on Windows. Neither may stop the app from starting.
      await Promise.allSettled(
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
    // The task is registered without an await between it and the guard above, so a second request
    // for the same provider finds it and joins it instead of starting a download of its own.
    const task = this.#updateProviderRuntime(spec, controller.signal)
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

  async #inspect(provider: ManagedProviderId): Promise<ProviderRuntimeStatus> {
    if (!this.#target) return this.#statuses[provider];
    const spec = runtimeSpec(provider, this.#target, this.#lock);
    this.#statuses[provider] = await this.#readStore(spec);
    return this.#statuses[provider];
  }

  /**
   * What the store on disk says about a provider, without recording it.
   *
   * An update reads the store after it holds the download slot, and must not overwrite the
   * "downloading" state it published to get there. Only `#inspect` records what this returns.
   */
  async #readStore(spec: RuntimeSpec): Promise<ProviderRuntimeStatus> {
    const installRoot = this.#installRoot(spec);
    try {
      await verifyInstalledRuntime(installRoot, spec, this.#lock);
      await this.#stampInUse(installRoot);
      return readyStatus(spec.version);
    } catch {
      return { ...emptyStatus(), version: await this.#previousVersion(spec) };
    }
  }

  /**
   * One update, from the single look at the shared store to the activation that ends it.
   *
   * A sibling instance may have installed this version while the offer sat on screen. That is a
   * reason to skip the transfer, not the activation: the agent service still runs the old CLI, and
   * a status of `ready` without the swap leaves the offer on screen with no way to answer it.
   */
  async #updateProviderRuntime(spec: RuntimeSpec, signal: AbortSignal): Promise<void> {
    const installed = await this.#readStore(spec);
    if (installed.phase === "ready") {
      await this.#activate(spec, null);
      return;
    }
    if (this.#stopping) throw new Error("OpenBot is closing.");
    signal.throwIfAborted();
    this.#setStatus(spec.provider, { phase: "downloading", progress: 0, message: null, version: installed.version });
    await this.#activate(spec, signal);
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
      if (!executable?.isFile()) continue;
      // This is the CLI the agent service runs until the pinned one arrives, so it is in use and
      // the collector in every other instance has to leave it alone. A worktree that pins a newer
      // version would otherwise take it away while this one is running from it.
      await this.#stampInUse(join(targetRoot, version));
      return version;
    }
    return null;
  }

  /** The one record a sibling instance can read: this version is in use, so keep it. */
  async #stampInUse(installRoot: string): Promise<void> {
    const now = new Date();
    // Best effort -- a store on a read-only volume still works, it only ages.
    await utimes(installRoot, now, now).catch(() => undefined);
  }

  /**
   * Hands the pinned executable to the agent service, which swaps it into its running clients.
   *
   * A `null` signal means the bytes are in the store already, because a sibling instance put them
   * there: there is nothing to transfer, only the swap. An install this instance made and could not
   * activate is removed, so the rejected artifact is not selected on the next start; one a sibling
   * made is left where it is, because the sibling is using it.
   */
  async #activate(spec: RuntimeSpec, signal: AbortSignal | null): Promise<void> {
    let installed = false;
    try {
      await this.#updateRuntime(spec.provider, async () => {
        if (signal) {
          await this.#runDownload(spec, signal);
          installed = true;
          await this.#removePartial(spec);
        }
        return join(this.#installRoot(spec), "bin", spec.executableName);
      });
      this.#setStatus(spec.provider, readyStatus(spec.version));
      this.emit("ready", spec.provider);
    } catch (error) {
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
    // Named for this attempt, so two instances installing the same version cannot share a directory
    // and the sweep can tell a live stage from an abandoned one by its age alone.
    const staging = join(
      this.#providerRoot(spec.provider),
      `.installing-${spec.target}-${spec.version}-${process.pid}-${randomBytes(4).toString("hex")}`,
    );
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
      committed = await this.#commit(staging, destination, spec);
      await verifyInstalledRuntime(destination, spec, this.#lock);
    } catch (error) {
      // Only what this instance put there. A directory it adopted belongs to the sibling that
      // installed it, and that sibling is entitled to keep running from it.
      if (committed) await rm(this.#installRoot(spec), { recursive: true, force: true });
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Moves a verified stage into place, and returns whether this instance is the one that put it
   * there.
   *
   * On a store the whole computer shares, the destination can appear between the check and the
   * move. Deleting it first -- what this used to do -- would take away the directory a sibling had
   * just committed and may already be running, and on Windows would fail outright while that binary
   * is open. So the rename comes first and an occupied destination is examined: a version pinned by
   * the lock has one set of bytes, checked twice over by then, so a destination that verifies is
   * the same install and is adopted rather than replaced. Only one that does not verify is moved
   * aside, and aside rather than deleted, because a sibling reading the atomic path must never find
   * it half removed.
   */
  async #commit(staging: string, destination: string, spec: RuntimeSpec): Promise<boolean> {
    // Each pass reads the destination again, because a sibling can fill it or replace it between
    // any two steps below. Whatever it did, the next pass sees the result: a verified install is
    // adopted, and only what is still damaged is replaced.
    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
      if (await renameIfVacant(staging, destination)) return true;
      if (await this.#verifies(destination, spec)) return false;
      const outcome = await this.#replaceUnderLock(staging, destination, spec);
      if (outcome !== "moved") return outcome === "committed";
    }
    throw new Error("The runtime could not be installed because another instance is replacing it.");
  }

  /**
   * Replaces a damaged destination, while this instance alone is allowed to.
   *
   * Two instances that both read the same damaged directory would otherwise both replace it, and
   * the second would take away the install the first had just committed and may already be running.
   * The lock makes the read and the move one step: whoever holds it reads the destination again,
   * and a destination that verifies by then is a sibling's install, which is adopted, never moved.
   * Answers `moved` when the path changed under this instance or the lock is held elsewhere -- both
   * mean read it again.
   */
  async #replaceUnderLock(
    staging: string,
    destination: string,
    spec: RuntimeSpec,
  ): Promise<"committed" | "adopted" | "moved"> {
    const lock = join(this.#providerRoot(spec.provider), `.locking-${spec.target}-${spec.version}`);
    const claim = await takeLock(lock);
    if (!claim) return "moved";
    try {
      if (await this.#verifies(destination, spec)) return "adopted";
      // Beside the staging directories, not beside the version ones: that is where the sweep looks,
      // and `#removeOldVersions` reads everything in the target root as a version.
      const aside = join(
        this.#providerRoot(spec.provider),
        `.replaced-${spec.target}-${spec.version}-${randomBytes(4).toString("hex")}`,
      );
      // Aside rather than deleted, because a sibling reading the atomic path must never find it
      // half removed, and gone already means an instance without this lock took it.
      if (!(await renameIfPresent(destination, aside))) return "moved";
      try {
        if (await renameIfVacant(staging, destination)) return "committed";
      } finally {
        await rm(aside, { recursive: true, force: true }).catch(() => undefined);
      }
      return "moved";
    } finally {
      await releaseLock(lock, claim);
    }
  }

  async #verifies(installRoot: string, spec: RuntimeSpec): Promise<boolean> {
    return await verifyInstalledRuntime(installRoot, spec, this.#lock).then(
      () => true,
      () => false,
    );
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
    // Measured on the store, which is where the installed copy lands. The partial can be told to
    // live elsewhere; in practice both are under the user's home, on one volume.
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
    return this.#downloads;
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

  /**
   * Collects the working directories a crashed install left behind, and only those.
   *
   * Age is the whole test. A sibling instance may be part-way through staging the same version
   * right now, and removing its directory would fail its install for no reason.
   */
  async #removeAbandonedStaging(): Promise<void> {
    const stale = Date.now() - STALE_STAGING_MS;
    for (const provider of PROVIDERS) {
      const root = this.#providerRoot(provider);
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && STAGING_PREFIXES.some((prefix) => entry.name.startsWith(prefix)))
          .map(async (entry) => {
            const path = join(root, entry.name);
            const modified = await stat(path)
              .then((value) => value.mtimeMs)
              .catch(() => Number.POSITIVE_INFINITY);
            if (modified > stale) return;
            await rm(path, { recursive: true, force: true }).catch(() => undefined);
          }),
      );
    }
  }

  /**
   * Collects versions no one has any use for.
   *
   * Rank alone decided this when the store belonged to one profile. It is now the computer's, and
   * another instance -- the released app beside a development build, or a worktree whose lock pins
   * a different version -- may be running from a directory this build ranks last. `#inspect` stamps
   * whatever it verifies on every start, so a version in use anywhere stays recent, and only a tree
   * nothing has opened for a month is collected.
   */
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
    const stale = Date.now() - VERSION_RETENTION_MS;
    await Promise.all(
      versions
        .filter((version) => !keep.has(version))
        .map(async (version) => {
          const path = join(targetRoot, version);
          const modified = await stat(path)
            .then((value) => value.mtimeMs)
            .catch(() => Number.POSITIVE_INFINITY);
          if (modified > stale) return;
          // Caught, not thrown: a running binary refuses to be removed on Windows, and housekeeping
          // must never be what stops the app from starting.
          await rm(path, { recursive: true, force: true }).catch(() => undefined);
        }),
    );
  }
}

function runtimeTarget(platform: NodeJS.Platform, architecture: string): RuntimeTarget | null {
  if (platform === "darwin" && architecture === "arm64") return "darwin-arm64";
  if (platform === "linux" && architecture === "x64") return "linux-x64";
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

/**
 * Moves `from` onto `to`, or reports that something already occupies `to`.
 *
 * POSIX answers an occupied directory with `ENOTEMPTY` or `EEXIST`; Windows answers with `EEXIST`,
 * `EPERM` or `EACCES`, the last two also when a file inside it is open. Every one of them means the
 * same thing here -- the caller has to look at what is there -- and anything else is a real fault.
 */
async function renameIfVacant(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    if (isOccupiedError(error)) return false;
    throw error;
  }
}

/**
 * Claims the right to replace one destination, and answers with the claim, or `null` when another
 * instance holds it.
 *
 * `mkdir` without `recursive` is the claim: the filesystem answers `EEXIST` to everyone but the
 * first, on every platform and across users, with no daemon and nothing to clean up but a
 * directory. A claim older than a staging directory is one a killed instance left behind, and age
 * is the only evidence available -- the same reason the sweep uses it. Clearing that one is itself
 * a race two instances could both win by reading the same old timestamp, so it is cleared by moving
 * it away: whichever rename finds it still there is the only one that goes on to claim the path.
 */
async function takeLock(lock: string): Promise<string | null> {
  const claim = `${process.pid}-${randomBytes(4).toString("hex")}`;
  if (await holdLock(lock, claim)) return claim;
  const held = await stat(lock)
    .then((value) => value.mtimeMs)
    .catch(() => null);
  if (held !== null && held > Date.now() - STALE_STAGING_MS) return null;
  const abandoned = join(dirname(lock), `.replaced-claim-${randomBytes(4).toString("hex")}`);
  if (!(await renameIfPresent(lock, abandoned))) return null;
  await rm(abandoned, { recursive: true, force: true }).catch(() => undefined);
  return (await holdLock(lock, claim)) ? claim : null;
}

async function holdLock(lock: string, claim: string): Promise<boolean> {
  try {
    await mkdir(lock);
  } catch (error) {
    if (isOccupiedError(error)) return false;
    throw error;
  }
  // Written inside the claim, so the release can tell this attempt's claim from the one an instance
  // that recovered it made -- and so the directory's own age is the moment the claim was taken.
  await writeFile(join(lock, "claim"), `${claim}\n`, { mode: 0o600 });
  return true;
}

/** Removes the claim only while it is still this attempt's. */
async function releaseLock(lock: string, claim: string): Promise<void> {
  const held = await readFile(join(lock, "claim"), "utf8").catch(() => null);
  if (held?.trim() !== claim) return;
  await rm(lock, { recursive: true, force: true }).catch(() => undefined);
}

/** Moves `from` onto `to`, or reports that another instance already took `from` away. */
async function renameIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function isOccupiedError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error) || !isString(error.code)) return false;
  return ["ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(error.code);
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
