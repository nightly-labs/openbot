import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, stat, statfs, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import {
  isManagedToolRuntime,
  MANAGED_RUNTIME_PROVIDERS,
  MANAGED_TOOL_RUNTIMES,
  type ManagedProviderId,
  type ManagedRuntimeId,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import lockValue from "../../native-runtime.lock.json";
import { type AgentRuntimeLock, parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import { type BundledProviderExecutables, configuredCliPath } from "../backend/cli";
import { sha256File } from "../backend/file-hash";
import { type McpToolRuntimes, NO_MCP_TOOL_RUNTIMES } from "../backend/mcp-provider-shapes";
import {
  type ArchiveDigest,
  bunxExecutableName,
  INSTALL_RECORD,
  providerRuntimeDescriptor,
  type RuntimeSpec,
  type RuntimeTarget,
} from "./provider-runtime-descriptors";
import { type BlockedVersions, fetchBlockedVersions, latestRelease } from "./provider-runtime-releases";

const execFileAsync = promisify(execFile);
const PROVIDERS = MANAGED_RUNTIME_PROVIDERS;
/**
 * Everything the store holds. Downloading, staging, verifying, sweeping and freeing disk are the
 * same work whether the pinned artifact is a provider CLI or the JavaScript runtime the MCP servers
 * need, so those paths walk this list; only the parts that mean "a provider" walk `PROVIDERS`.
 */
const RUNTIMES = [...MANAGED_RUNTIME_PROVIDERS, ...MANAGED_TOOL_RUNTIMES] as const;
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
 * `.installing-` is on the list for what it leaves, not for what this build writes. Released builds
 * carry the manager this one replaces, whose own sweep deletes every `.installing-` directory it
 * finds, whatever its age and whoever is filling it. They share this store, and their sweep cannot
 * be changed, so a stage this build makes is named out of its reach; the prefix stays here only to
 * collect what those builds abandon.
 *
 * A claim is not on the list. Removing one is how an instance takes a destination over, and the
 * sweep holds no claim itself, so it would be one more unsynchronised writer of the very path the
 * claim exists to serialise. `takeLock` clears an abandoned claim, and what it leaves behind while
 * it does carries the `.replaced-` prefix.
 */
const STAGING_PREFIXES = [".staging-", ".installing-", ".replaced-"];
/** How often a running app asks upstream for a newer provider CLI. A user can also ask at any time. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type PartialMetadata = { url: string; etag: string | null; expectedBytes: number };
interface ProviderRuntimeManagerEvents {
  status: [snapshot: ProviderRuntimeSnapshot];
  ready: [runtime: ManagedRuntimeId];
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
  updateRuntime?: (runtime: ManagedRuntimeId, install: () => Promise<string>) => Promise<void>;
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
  readonly #statuses: Record<ManagedRuntimeId, ProviderRuntimeStatus>;
  readonly #controllers = new Map<ManagedRuntimeId, AbortController>();
  readonly #tasks = new Map<ManagedRuntimeId, Promise<void>>();
  readonly #cancelled = new Set<ManagedRuntimeId>();
  /** Versions of provider CLIs the user installed, kept only to compare against the update target. */
  readonly #systemVersions = new Map<ManagedProviderId, string>();
  /** The latest upstream release of each provider CLI, as the last check found it. */
  readonly #latest = new Map<ManagedProviderId, RuntimeSpec>();
  /** What each running download installs, so a cancel removes the right partial file. */
  readonly #transfers = new Map<ManagedRuntimeId, RuntimeSpec>();
  readonly #updateRuntime: (runtime: ManagedRuntimeId, install: () => Promise<string>) => Promise<void>;
  #blocked: BlockedVersions = new Map();
  #check: Promise<void> | null = null;
  #checkTimer: NodeJS.Timeout | null = null;
  #revision = 0;
  #stopping = false;

  constructor(options: ProviderRuntimeManagerOptions) {
    super();
    this.#root = options.root;
    this.#downloads = options.downloadRoot ?? join(options.root, ".downloads");
    this.#updateRuntime =
      options.updateRuntime ??
      (async (_runtime, install) => {
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
      bun: emptyStatus(unsupportedMessage),
    };
  }

  async initialize(): Promise<ProviderRuntimeSnapshot> {
    await mkdir(this.#root, { recursive: true });
    await this.#removeAbandonedStaging();
    await Promise.all(RUNTIMES.map((runtime) => this.#inspect(runtime)));
    const target = this.#target;
    if (target) {
      // Settled, not all: collecting an old version is housekeeping, and a version another instance
      // still runs refuses to be removed on Windows. Neither may stop the app from starting.
      await Promise.allSettled(
        RUNTIMES.map((runtime) => this.#removeOldVersions(runtimeSpec(runtime, target, this.#lock))),
      );
    }
    return this.getStatus();
  }

  getStatus(): ProviderRuntimeSnapshot {
    // Split rather than widened: `providers` means "a provider CLI" to every renderer that draws a
    // card from it, and Bun must not become one.
    const { bun, ...providers } = structuredClone(this.#statuses);
    if (this.#target) {
      for (const provider of PROVIDERS) {
        const version = this.#targetSpec(provider, this.#target).version;
        // Agent status names a system fallback until the managed candidate is activated.
        const installed = this.#systemVersions.get(provider) ?? providers[provider].version;
        const offer = installed !== null && installed !== undefined && olderVersion(installed, version);
        providers[provider].availableVersion = offer && !configuredCliPath(provider) ? version : null;
      }
    }
    return { revision: this.#revision, providers, toolRuntimes: { bun } };
  }

  /**
   * Asks each provider's upstream for its latest release, and offers it where it is newer.
   *
   * Concurrent calls share one check. A source that does not answer keeps what the last check found,
   * so one unreachable registry does not take the offers of the others away. Rejects only when no
   * source answered, which is what a user who asked needs to hear.
   */
  async checkForUpdates(): Promise<ProviderRuntimeSnapshot> {
    const target = this.#target;
    if (!target) return this.getStatus();
    this.#check ??= this.#runCheck(target).finally(() => {
      this.#check = null;
    });
    await this.#check;
    return this.getStatus();
  }

  /** Checks now and then every hour, until `stop`. The caller starts it once the app is up. */
  startUpdateChecks(intervalMs = UPDATE_CHECK_INTERVAL_MS): void {
    if (this.#checkTimer || !this.#target || this.#stopping) return;
    const check = () => void this.checkForUpdates().catch(() => undefined);
    this.#checkTimer = setInterval(check, intervalMs);
    this.#checkTimer.unref();
    check();
  }

  async #runCheck(target: RuntimeTarget): Promise<void> {
    const blocked = fetchBlockedVersions(this.#fetch).catch(() => null);
    const releases = await Promise.allSettled(
      PROVIDERS.map(async (provider) => {
        const release = await latestRelease(provider, { target, lock: this.#lock, fetch: this.#fetch });
        this.#latest.set(provider, release);
      }),
    );
    this.#blocked = (await blocked) ?? this.#blocked;
    this.#revision += 1;
    this.emit("status", this.getStatus());
    if (releases.every((result) => result.status === "rejected")) {
      throw new Error("OpenBot could not reach the provider release sources. Check the connection and try again.");
    }
  }

  /**
   * The version an update installs: the latest upstream release, unless it is blocked or older than
   * the version this build carries. Bun is not a provider and stays on the lock.
   */
  #targetSpec(runtime: ManagedRuntimeId, target: RuntimeTarget): RuntimeSpec {
    const pinned = runtimeSpec(runtime, target, this.#lock);
    if (isManagedToolRuntime(runtime)) return pinned;
    const latest = this.#latest.get(runtime);
    if (!latest || this.#blocked.get(runtime)?.has(latest.version) || !olderVersion(pinned.version, latest.version)) {
      return pinned;
    }
    return latest;
  }

  /**
   * Records the version of a provider CLI the user installed, as the agent service resolved it.
   *
   * The manager does not own that install and never downloads for it. It decides which version is
   * current, though, so the comparison belongs here with the managed one rather than in the
   * renderer, which must not compare versions at all. Pass `null` when the provider went back to the
   * managed copy or resolved nothing.
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

  executablePath(runtime: ManagedRuntimeId): string | null {
    if (!this.#target) return null;
    const spec = runtimeSpec(runtime, this.#target, this.#lock);
    return join(
      this.#runtimeRoot(runtime),
      spec.target,
      this.#statuses[runtime].version ?? spec.version,
      "bin",
      spec.executableName,
    );
  }

  /**
   * Starts whatever tool runtime this machine is missing, and answers immediately.
   *
   * MCP is optional, so this is never something a user waits for or has to answer. A runtime that is
   * already installed starts nothing, and every reason `download` refuses -- an unsupported
   * platform, a download already running, the app closing -- is in the status a Settings reader can
   * see, so there is nothing here that only this call site could report.
   */
  ensureToolRuntimes(): void {
    for (const tool of MANAGED_TOOL_RUNTIMES) void this.download(tool).catch(() => undefined);
  }

  /**
   * Starts whatever tool runtime this machine is missing and waits until each one is ready.
   *
   * The connection test is the one place that waits: a first credential-based stdio plugin must
   * pass its test before it can be saved, and without a runtime the test answers `Command not
   * found` for a machine that only needs a download. Throws when a download fails, so the caller
   * decides whether the test still runs.
   */
  async ensureToolRuntimesReady(): Promise<void> {
    for (const tool of MANAGED_TOOL_RUNTIMES) await this.downloadAndWait(tool);
  }

  /**
   * What the MCP servers may use from the store, in the shape the resolution step takes.
   *
   * Only a runtime that is `ready` is offered. A path into a directory that does not exist would
   * turn "Bun is still downloading" into "Command not found: npx", which is the wrong sentence and
   * the wrong thing to do about it.
   *
   * The alias is how a catalog entry keeps working untouched. Bun decides what to do from the name
   * it was started under, so the staged `bunx` takes `-y <package>` exactly as `npx` does, and
   * nothing rewrites a stored command, the catalog, or the wire.
   */
  mcpToolRuntimes(): McpToolRuntimes {
    const executable = this.#target && this.#statuses.bun.phase === "ready" ? this.executablePath("bun") : null;
    if (!(executable && this.#target)) return NO_MCP_TOOL_RUNTIMES;
    const bin = dirname(executable);
    return { binDirectories: [bin], commandAliases: { npx: join(bin, bunxExecutableName(this.#target)) } };
  }

  async download(runtime: ManagedRuntimeId): Promise<ProviderRuntimeSnapshot> {
    if (!this.#target) throw new Error("Provider runtimes are not available on this platform.");
    if (this.#stopping) throw new Error("OpenBot is closing.");
    // Only a provider CLI has a path override; nothing points `OPENBOT_BUN_PATH` at a tool runtime.
    if (!isManagedToolRuntime(runtime) && configuredCliPath(runtime))
      throw new Error("Remove the explicit CLI path override before updating in OpenBot.");
    if (this.#tasks.has(runtime)) return this.getStatus();
    const spec = this.#targetSpec(runtime, this.#target);
    const current = this.#statuses[runtime];
    // A download goes only toward a newer version, never back to an older one. A failed update keeps
    // the version still installed, so its Retry follows the same rule: when the block list has taken
    // the newer version away, the Retry ends the error on the installed one instead.
    if (current.version && !olderVersion(current.version, spec.version)) {
      if (current.phase !== "ready") this.#setStatus(runtime, await this.#inspect(runtime));
      return this.getStatus();
    }

    const controller = new AbortController();
    this.#controllers.set(runtime, controller);
    this.#transfers.set(runtime, spec);
    this.#cancelled.delete(runtime);
    this.#setStatus(runtime, {
      phase: "downloading",
      progress: 0,
      message: null,
      version: this.#statuses[runtime].version,
    });
    // The task is registered without an await between it and the guard above, so a second request
    // for the same runtime finds it and joins it instead of starting a download of its own.
    const task = this.#updateProviderRuntime(spec, controller.signal)
      .catch((error: unknown) => {
        this.#controllers.delete(runtime);
        this.#tasks.delete(runtime);
        return this.#handleDownloadFailure(runtime, error);
      })
      .finally(() => {
        this.#controllers.delete(runtime);
        this.#tasks.delete(runtime);
        this.#transfers.delete(runtime);
        this.#cancelled.delete(runtime);
      });
    this.#tasks.set(runtime, task);
    return this.getStatus();
  }

  async downloadAndWait(runtime: ManagedRuntimeId): Promise<void> {
    await this.download(runtime);
    await this.#tasks.get(runtime);
    const status = this.#statuses[runtime];
    if (status.phase !== "ready") throw new Error(status.message ?? "The runtime update did not complete.");
  }

  async cancel(runtime: ManagedRuntimeId): Promise<ProviderRuntimeSnapshot> {
    if (this.#statuses[runtime].phase !== "downloading") return this.getStatus();
    const task = this.#tasks.get(runtime);
    const spec = this.#transfers.get(runtime);
    this.#cancelled.add(runtime);
    this.#controllers.get(runtime)?.abort();
    await task;
    if (spec) await this.#removePartial(spec);
    await this.#inspect(runtime);
    this.#setStatus(runtime, this.#statuses[runtime]);
    return this.getStatus();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    for (const controller of this.#controllers.values()) controller.abort();
    await Promise.allSettled(this.#tasks.values());
  }

  async #inspect(runtime: ManagedRuntimeId): Promise<ProviderRuntimeStatus> {
    if (!this.#target) return this.#statuses[runtime];
    const pinned = runtimeSpec(runtime, this.#target, this.#lock);
    const installed = await this.#newestInstalled(pinned);
    this.#statuses[runtime] = installed
      ? readyStatus(installed)
      : { ...emptyStatus(), version: await this.#previousVersion(pinned) };
    return this.#statuses[runtime];
  }

  /**
   * The newest version in the store that verifies, and is therefore the one to run.
   *
   * That is the pinned version, checked against the lock, or a newer upstream release, checked
   * against the record its install wrote. A directory with neither is an older pin this build has no
   * hashes for; `#previousVersion` still lends it out until an update replaces it.
   */
  async #newestInstalled(pinned: RuntimeSpec): Promise<string | null> {
    const targetRoot = dirname(this.#installRoot(pinned));
    const entries = await readdir(targetRoot, { withFileTypes: true }).catch(() => []);
    const versions = entries
      .filter((entry) => entry.isDirectory() && isVersion(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    for (const version of versions) {
      const spec = version === pinned.version ? pinned : recordedSpec(pinned, version);
      const installRoot = join(targetRoot, version);
      if (!(await this.#verifies(installRoot, spec))) continue;
      await this.#stampInUse(installRoot);
      return version;
    }
    return null;
  }

  /**
   * What the store on disk says about a provider, without recording it.
   *
   * An update reads the store after it holds the download slot, and must not overwrite the
   * "downloading" state it published to get there. Only `#inspect` records what this returns.
   */
  async #readStore(spec: RuntimeSpec): Promise<ProviderRuntimeStatus> {
    const installRoot = this.#installRoot(spec);
    if (await this.#verifies(installRoot, spec)) {
      await this.#stampInUse(installRoot);
      return readyStatus(spec.version);
    }
    return { ...emptyStatus(), version: await this.#previousVersion(spec) };
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
    this.#setStatus(spec.runtime, { phase: "downloading", progress: 0, message: null, version: installed.version });
    await this.#activate(spec, signal);
  }

  // Keep the last installed version available while its replacement is downloaded.
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
      // This is the CLI the agent service runs until the newer one arrives, so it is in use and
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
   * Hands the installed executable to the agent service, which swaps it into its running clients.
   *
   * A `null` signal means the bytes are in the store already, because a sibling instance put them
   * there: there is nothing to transfer, only the swap. An install this instance made and could not
   * activate is removed, so the rejected artifact is not selected on the next start; one a sibling
   * made is left where it is, because the sibling is using it. A transfer is not what decides that:
   * a sibling can commit the same version while this instance is still downloading it, and what is
   * then in the store is the sibling's install, adopted rather than written.
   */
  async #activate(spec: RuntimeSpec, signal: AbortSignal | null): Promise<void> {
    let installed = false;
    try {
      await this.#updateRuntime(spec.runtime, async () => {
        if (signal) {
          installed = await this.#runDownload(spec, signal);
          await this.#removePartial(spec);
        }
        return join(this.#installRoot(spec), "bin", spec.executableName);
      });
      this.#setStatus(spec.runtime, readyStatus(spec.version));
      this.emit("ready", spec.runtime);
    } catch (error) {
      if (installed) await rm(this.#installRoot(spec), { recursive: true, force: true });
      throw error;
    }
  }

  /** Answers whether this instance is the one that put the install in the store. */
  async #runDownload(spec: RuntimeSpec, signal: AbortSignal): Promise<boolean> {
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
      if (progress !== this.#statuses[spec.runtime].progress) {
        this.#setStatus(spec.runtime, {
          phase: "downloading",
          progress,
          message: null,
          version: this.#statuses[spec.runtime].version,
        });
      }
    });

    this.#setStatus(spec.runtime, {
      phase: "finishing",
      progress: null,
      message: null,
      version: this.#statuses[spec.runtime].version,
    });
    const downloaded = await stat(partialPath);
    if (downloaded.size !== spec.downloadBytes) {
      throw new Error("The runtime download has an unexpected size.");
    }
    // No digest is Grok's upstream release, which x.ai publishes no hash for and TLS alone vouches for.
    if (spec.archiveDigest && !(await digestMatches(partialPath, spec.archiveDigest))) {
      await this.#removePartial(spec);
      throw new Error("The runtime download failed its integrity check.");
    }

    return await this.#install(spec, partialPath);
  }

  /** Answers whether this instance committed the install, or adopted the one it found. */
  async #install(spec: RuntimeSpec, downloadedPath: string): Promise<boolean> {
    // Named for this attempt, so two instances installing the same version cannot share a directory
    // and the sweep can tell a live stage from an abandoned one by its age alone. The prefix is not
    // the one released builds sweep without looking at the age: see `STAGING_PREFIXES`.
    const staging = join(
      this.#runtimeRoot(spec.runtime),
      `.staging-${spec.target}-${spec.version}-${process.pid}-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(staging, { recursive: true });
    let committed = false;
    try {
      await providerRuntimeDescriptor(spec.runtime).stage({
        spec,
        downloadedPath,
        staging,
        lock: this.#lock,
        downloadSmallFile: (url, expectedSha256) => this.#downloadSmallFile(url, expectedSha256),
      });
      if (spec.source === "latest") await writeInstallRecord(staging, spec);
      await verifyInstalledRuntime(staging, spec, this.#lock);
      const destination = this.#installRoot(spec);
      await mkdir(dirname(destination), { recursive: true });
      committed = await this.#commit(staging, destination, spec);
      await verifyInstalledRuntime(destination, spec, this.#lock);
      return committed;
    } catch (error) {
      // Only what this instance put there. A directory it adopted belongs to the sibling that
      // installed it, and that sibling is entitled to keep running from it.
      if (committed) await this.#discardRejected(spec);
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Takes away an install this instance committed and could not then read back.
   *
   * A reading and a delete are two steps, and on a store the whole computer shares the path can
   * change between them: the reading that sent this instance here can fail because a sibling was
   * replacing the destination while it ran, and by the time a delete follows, the sibling's own
   * copy can be there. So nothing is read in place and nothing is deleted in place. What is there
   * is moved away first, which the filesystem grants to one instance at a time, and read where
   * nothing else can reach it: a runtime that verifies is a sibling's install and goes back where
   * the sibling left it. Only what does not verify is removed, and by then this instance is the
   * only one that can see it.
   */
  async #discardRejected(spec: RuntimeSpec): Promise<void> {
    const installRoot = this.#installRoot(spec);
    const aside = join(
      this.#runtimeRoot(spec.runtime),
      `.replaced-${spec.target}-${spec.version}-${randomBytes(4).toString("hex")}`,
    );
    if (!(await renameIfPresent(installRoot, aside))) return;
    if (await this.#verifies(aside, spec)) {
      if (await renameIfVacant(aside, installRoot)) return;
    }
    await rm(aside, { recursive: true, force: true }).catch(() => undefined);
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
    const lock = join(this.#runtimeRoot(spec.runtime), `.locking-${spec.target}-${spec.version}`);
    const claim = await takeLock(lock);
    if (!claim) return "moved";
    try {
      if (await this.#verifies(destination, spec)) return "adopted";
      // Beside the staging directories, not beside the version ones: that is where the sweep looks,
      // and `#removeOldVersions` reads everything in the target root as a version.
      const aside = join(
        this.#runtimeRoot(spec.runtime),
        `.replaced-${spec.target}-${spec.version}-${randomBytes(4).toString("hex")}`,
      );
      // The claim is read once more against the one thing that can have displaced it: an instance
      // recovering it as abandoned. Whoever holds the claim by now is the one entitled to move the
      // destination, and this instance stops before touching it rather than after.
      if (!(await holdsClaim(lock, claim))) return "moved";
      // Aside rather than deleted, because a sibling reading the atomic path must never find it
      // half removed, and gone already means an instance without this lock took it.
      if (!(await renameIfPresent(destination, aside))) return "moved";
      // Read once more, now that it is somewhere nothing else can change it. The claim says no
      // other instance may move this destination, and the reading above says this one was damaged;
      // both were true when they were read, and neither is a promise about the moment of the move.
      // What was moved is therefore examined rather than trusted: a runtime that verifies is an
      // install a sibling committed in between, so it goes back where the sibling left it and is
      // adopted. Nothing that verifies is ever replaced, whatever the claim said.
      if (await this.#verifies(aside, spec)) {
        if (await renameIfVacant(aside, destination)) return "adopted";
        await rm(aside, { recursive: true, force: true }).catch(() => undefined);
        return "moved";
      }
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

  async #downloadSmallFile(url: string, expectedSha256: string | null): Promise<Uint8Array> {
    const response = await this.#fetch(url, { headers: { "User-Agent": "OpenBot-runtime-installer" } });
    if (!response.ok) throw new Error(`Runtime metadata download failed with HTTP ${response.status}.`);
    const value = await readSmallResponse(response);
    if (expectedSha256 !== null && createHash("sha256").update(value).digest("hex") !== expectedSha256) {
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

  async #handleDownloadFailure(runtime: ManagedRuntimeId, error: unknown): Promise<void> {
    if (this.#cancelled.has(runtime)) return;
    if (this.#stopping && isAbortError(error)) return;
    const message = isAbortError(error)
      ? "Download stopped. Try again."
      : error instanceof Error
        ? redactText(error.message)
        : "Download failed. Try again.";
    this.#setStatus(runtime, {
      phase: "download-error",
      progress: null,
      message,
      version: this.#statuses[runtime].version,
    });
  }

  #setStatus(runtime: ManagedRuntimeId, status: ProviderRuntimeStatus): void {
    this.#statuses[runtime] = status;
    this.#revision += 1;
    this.emit("status", this.getStatus());
  }

  #runtimeRoot(runtime: ManagedRuntimeId): string {
    return join(this.#root, runtime);
  }

  #installRoot(spec: RuntimeSpec): string {
    return join(this.#runtimeRoot(spec.runtime), spec.target, spec.version);
  }

  #downloadRoot(): string {
    return this.#downloads;
  }

  #partialPath(spec: RuntimeSpec): string {
    return join(this.#downloadRoot(), `${spec.runtime}-${spec.target}-${spec.version}.partial`);
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
    for (const runtime of RUNTIMES) {
      const root = this.#runtimeRoot(runtime);
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
    const targetRoot = join(this.#runtimeRoot(spec.runtime), spec.target);
    const entries = await readdir(targetRoot, { withFileTypes: true }).catch(() => []);
    const versions = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
    const keep = new Set([
      spec.version,
      this.#statuses[spec.runtime].version,
      ...versions
        .filter((version) => version !== spec.version)
        .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
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
  if (platform === "linux" && architecture === "arm64") return "linux-arm64";
  if (platform === "win32" && architecture === "x64") return "win32-x64";
  return null;
}

function runtimeSpec(runtime: ManagedRuntimeId, target: RuntimeTarget, lock: AgentRuntimeLock): RuntimeSpec {
  return providerRuntimeDescriptor(runtime).spec(target, lock);
}

/**
 * The checks every provider runtime gets: the executable exists, its files match the lock or the
 * record written when it was installed, and the installed binary reports the version it should. The
 * last one is what catches a CLI that replaced itself after installation.
 */
async function verifyInstalledRuntime(root: string, spec: RuntimeSpec, lock: AgentRuntimeLock): Promise<void> {
  const descriptor = providerRuntimeDescriptor(spec.runtime);
  const executable = join(root, "bin", spec.executableName);
  await access(executable);
  if (spec.source === "lock") await descriptor.verify(root, spec, lock);
  else await verifyInstallRecord(root, spec);
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
 * A claim is a directory built away from the path and moved onto it: the filesystem refuses a move
 * onto a directory that has anything in it, on every platform and across users, and the claim it
 * carries is inside it before the move, so the path never exists without naming its owner. That is
 * what makes the age below evidence of anything -- a claim reads old only when the instance that
 * made it is gone, never because a live one is part-way through making it.
 *
 * A claim older than a staging directory is one a killed instance left behind, and age is the only
 * evidence available, the same reason the sweep uses it. Recovering it is itself a race two
 * instances could both enter by reading the same old timestamp, so it is recovered by moving it
 * away and reading who it names: the rename is atomic, so whatever it moved is this instance's
 * alone to look at, and only the claim whose age was read is the abandoned one. Anything else was
 * made in between, by an instance that recovered the path first, and this instance takes nothing.
 */
async function takeLock(lock: string): Promise<string | null> {
  const claim = `${process.pid}-${randomBytes(4).toString("hex")}`;
  if (await holdLock(lock, claim)) return claim;
  const abandoned = await abandonedClaim(lock);
  if (abandoned === null) return null;
  const aside = join(dirname(lock), `.replaced-claim-${randomBytes(4).toString("hex")}`);
  if (!(await renameIfPresent(lock, aside))) return null;
  const moved = await readClaim(aside);
  await rm(aside, { recursive: true, force: true }).catch(() => undefined);
  // The instance whose fresh claim this moved is shut out by `holdsClaim` before it touches the
  // destination, so the path is left to whoever takes it next, and this attempt is not it.
  if (moved !== abandoned) return null;
  return (await holdLock(lock, claim)) ? claim : null;
}

/**
 * The claim a lock old enough to be abandoned names, or `null` when no claim there is abandoned.
 *
 * The name is read before the age, and that order is the whole guarantee. A claim on the path can
 * only be replaced by a newer one, so an age read after the name can be old only if the directory
 * the name came from is the one the age describes, or one it already replaced. Reading the age
 * first would let the two come from different directories: the age of the abandoned claim, and the
 * name of the claim an instance made while recovering it, which is how two instances end up holding
 * the same path. Reading an older name than the path now has costs one attempt and nothing else.
 *
 * The empty string is a claim directory that names no one: nothing this manager makes, so either an
 * instance was killed between the two steps of an older build's acquisition, or the claim file was
 * lost. It is recovered like any other abandoned claim.
 */
async function abandonedClaim(lock: string): Promise<string | null> {
  const named = await readClaim(lock);
  const held = await stat(lock)
    .then((value) => value.mtimeMs)
    .catch(() => null);
  if (held === null || held > Date.now() - STALE_STAGING_MS) return null;
  return named;
}

/** Who a claim names, and the empty string when it names no one. */
async function readClaim(lock: string): Promise<string> {
  const held = await readFile(join(lock, "claim"), "utf8").catch(() => null);
  return held?.trim() ?? "";
}

/** Whether the claim on the path is still the one this attempt made. */
async function holdsClaim(lock: string, claim: string): Promise<boolean> {
  return (await readClaim(lock)) === claim;
}

/** Puts a claim on the path in one move, or reports that another instance is already there. */
async function holdLock(lock: string, claim: string): Promise<boolean> {
  // Under the swept prefix, so an instance killed between these two steps leaves nothing permanent.
  const staging = join(dirname(lock), `.replaced-claim-${randomBytes(4).toString("hex")}`);
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, "claim"), `${claim}\n`, { mode: 0o600 });
  if (await renameIfVacant(staging, lock)) return true;
  await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  return false;
}

/** Removes the claim only while it is still this attempt's. */
async function releaseLock(lock: string, claim: string): Promise<void> {
  if (!(await holdsClaim(lock, claim))) return;
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

/**
 * The spec of an upstream release already in the store. Only what verifying and running it reads is
 * real; the download fields are never used, because an installed version is not downloaded again.
 */
function recordedSpec(pinned: RuntimeSpec, version: string): RuntimeSpec {
  return { ...pinned, version, packageVersion: version, source: "latest", url: "", archiveDigest: null };
}

interface InstallRecord {
  layoutVersion: 1;
  runtime: ManagedRuntimeId;
  version: string;
  target: RuntimeTarget;
  files: Record<string, string>;
}

async function writeInstallRecord(root: string, spec: RuntimeSpec): Promise<void> {
  const files: Record<string, string> = {};
  for (const file of await installedFiles(root)) files[file] = await sha256File(join(root, file));
  const record: InstallRecord = {
    layoutVersion: 1,
    runtime: spec.runtime,
    version: spec.version,
    target: spec.target,
    files,
  };
  await writeFile(join(root, INSTALL_RECORD), `${JSON.stringify(record)}\n`);
}

/**
 * The install must hold exactly the files in the record, each with the hash it had when installed.
 * A file added later counts as much as a changed one: Codex runs its bundled `zsh`, and a new
 * release can bring files no list written today would name.
 */
async function verifyInstallRecord(root: string, spec: RuntimeSpec): Promise<void> {
  const record = JSON.parse(await readFile(join(root, INSTALL_RECORD), "utf8"));
  if (
    !isDynamicRecord(record) ||
    record.layoutVersion !== 1 ||
    record.runtime !== spec.runtime ||
    record.version !== spec.version ||
    record.target !== spec.target ||
    !isDynamicRecord(record.files)
  ) {
    throw new Error("The runtime install record does not match.");
  }
  const files = await installedFiles(root);
  if (files.length !== Object.keys(record.files).length) throw new Error("Provider runtime checksum mismatch.");
  for (const file of files) {
    const expected = record.files[file];
    if (!isString(expected) || (await sha256File(join(root, file))) !== expected) {
      throw new Error("Provider runtime checksum mismatch.");
    }
  }
}

/** Every file under `root` but the record, as `/`-separated paths. A link or special file fails. */
async function installedFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await installedFiles(root, path)));
    else if (!entry.isFile()) throw new Error("The runtime contains a link or special file.");
    else if (path !== INSTALL_RECORD) files.push(path);
  }
  return files;
}

async function digestMatches(path: string, digest: ArchiveDigest): Promise<boolean> {
  const hash = createHash(digest.algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex") === digest.hex;
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function olderVersion(installed: string, target: string): boolean {
  if (!isVersion(installed) || !isVersion(target)) return false;
  return installed.localeCompare(target, "en", { numeric: true }) < 0;
}
