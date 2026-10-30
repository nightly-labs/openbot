import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, rename, rm, stat, statfs, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import {
  type AgentProviderId,
  type AgentProviderRef,
  agentProviderDescriptor,
  isKeyOnlyProvider,
  isManagedToolRuntime,
  KEY_ONLY_PROVIDERS,
  MANAGED_RUNTIME_PROVIDERS,
  MANAGED_TOOL_RUNTIMES,
  type ManagedProviderId,
  type ManagedRuntimeId,
  type ProviderRuntimeDownload,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
  type RemovableRuntimes,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type LogValue, redactText, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Result, Scope, Stream } from "effect";
import lockValue from "../../native-runtime.lock.json";
import { type AgentRuntimeLock, parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import {
  type BundledProviderExecutables,
  compareReleases,
  configuredCliPath,
  isVersion,
  olderVersion,
  resolvePiCli,
} from "../backend/cli";
import { runCauseEffect } from "../backend/effect-boundary";
import { sha256File } from "../backend/file-hash";
import { type McpToolRuntimes, NO_MCP_TOOL_RUNTIMES } from "../backend/mcp-provider-shapes";
import { measureTree } from "../backend/storage-usage";
import {
  type ArchiveDigest,
  bunxExecutableName,
  INSTALL_RECORD,
  providerRuntimeDescriptor,
  type RuntimeSpec,
  type RuntimeTarget,
} from "./provider-runtime-descriptors";
import { ProviderRuntimeFailure, runtimeIO, runtimeSync } from "./provider-runtime-effects";
import {
  type BlockedVersions,
  fetchBlockedVersions,
  latestRelease,
  readLimitedBody,
} from "./provider-runtime-releases";

const execFileAsync = promisify(execFile);
const logger = createOpenBotLogger("provider-runtimes");
const PROVIDERS = MANAGED_RUNTIME_PROVIDERS;
/**
 * Everything the store holds. Downloading, staging, verifying, sweeping and freeing disk are the
 * same work whether the pinned artifact is a provider CLI or the JavaScript runtime the MCP servers
 * need, so those paths walk this list; only the parts that mean "a provider" walk `PROVIDERS`.
 */
const RUNTIMES = [...MANAGED_RUNTIME_PROVIDERS, ...MANAGED_TOOL_RUNTIMES] as const;
const FREE_SPACE_HEADROOM = 100_000_000;
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
/**
 * How long a version directory that this instance does not keep is left alone at start, for the same
 * reason: a sibling may still run it. A sibling stamps its versions on every update check, but at
 * start this instance cannot tell whether the computer has just woken, with every sibling's stamp
 * as old as the sleep. The update check collects with a much shorter window, once it knows.
 */
const VERSION_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
/**
 * How far the mtime that `utimes` writes may differ from the time this instance asked for, after the
 * round trip through seconds as a floating-point number.
 */
const OWN_STAMP_PRECISION_MS = 1;
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
 * How long a move waits, in turn, for a file in its source that another program still holds open.
 * About a second and a half, the same budget Node gives `rm` with `maxRetries: 5`.
 */
const HELD_SOURCE_WAITS_MS: readonly number[] = [100, 200, 400, 800];
/**
 * How long a commit keeps trying to move a stage that another program holds open. Windows Defender
 * can scan a new CLI for tens of seconds after its version check, and the move fails with `EPERM`
 * until the scan ends. Three passes of the wait in `renameIfVacant`, about 4.5 s, were too short
 * for that.
 */
const HELD_STAGE_WAIT_MS = 60_000;
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
/**
 * How many check intervals a version no instance stamped is kept by the update check. A check
 * uses it only one interval or more after the computer last started or woke, so every running
 * sibling has stamped its versions since.
 * Provider CLIs release every few days at 100-600 MB a copy, so each copy kept longer adds up.
 */
const AWAKE_RETENTION_CHECKS = 3;
/** How long a first install waits for the release check before it takes the pinned version. */
const RELEASE_CHECK_WAIT_MS = 10_000;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type PartialMetadata = { url: string; etag: string | null; expectedBytes: number };
/**
 * Where a download task was when it failed, for the log line. A failed update removes what it
 * installed, so this line is the only record of how far it got. `activate` is the swap into the
 * running provider, after the install verified.
 */
type RuntimeTaskStage = "prepare" | "download" | "verify" | "install" | "activate";
interface ProviderRuntimeManagerEvents {
  status: [snapshot: ProviderRuntimeSnapshot];
  ready: [runtime: ManagedRuntimeId];
}

export interface ProviderRuntimeManagerOptions {
  /** An off provider must not run even for a managed runtime version check. */
  isProviderOn?: (provider: AgentProviderId) => boolean;
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
  /** How long a commit waits for a stage that another program holds open. Tests shorten it. */
  heldStageWaitMs?: number;
  /** The waits, in turn, of one move whose source another program holds open. Tests shorten them. */
  heldSourceWaitsMs?: readonly number[];
  /**
   * `onWait` says that the update waits, before `install`, for the provider's turns to end. `signal`
   * aborts when the update is cancelled or the app stops, also while it waits.
   */
  updateRuntime?: (
    runtime: ManagedRuntimeId,
    install: () => Effect.Effect<string, ProviderRuntimeFailure>,
    signal: AbortSignal,
    onWait: () => void,
  ) => Effect.Effect<void, ProviderRuntimeFailure>;
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
  readonly #isProviderOn: (provider: AgentProviderId) => boolean;
  readonly #root: string;
  readonly #downloads: string;
  readonly #target: RuntimeTarget | null;
  readonly #fetch: Fetch;
  readonly #lock: AgentRuntimeLock;
  readonly #availableDiskBytes: () => Promise<number>;
  readonly #heldStageWaitMs: number;
  readonly #heldSourceWaitsMs: readonly number[];
  readonly #statuses: Record<ManagedRuntimeId, ProviderRuntimeStatus>;
  readonly #controllers = new Map<ManagedRuntimeId, AbortController>();
  readonly #tasks = new Map<ManagedRuntimeId, Fiber.Fiber<void, ProviderRuntimeFailure>>();
  readonly #cancelled = new Set<ManagedRuntimeId>();
  /** Versions of provider CLIs the user installed, kept only to compare against the update target. */
  readonly #systemVersions = new Map<ManagedProviderId, string>();
  /** The latest upstream release of each provider CLI, as the last check found it. */
  readonly #latest = new Map<ManagedProviderId, RuntimeSpec>();
  /** What each running download installs, so a cancel removes the right partial file. */
  readonly #transfers = new Map<ManagedRuntimeId, RuntimeSpec>();
  readonly #stages = new Map<ManagedRuntimeId, RuntimeTaskStage>();
  /**
   * Running removals of a provider's download, each with whether it removed every version it chose.
   * A download that starts meanwhile waits for one.
   */
  readonly #removals = new Map<ManagedProviderId, Fiber.Fiber<boolean>>();
  /**
   * When this instance last stamped each version directory. A stamp on disk no later than this one
   * is this instance's own, so no sibling has used the version since.
   */
  readonly #ownStamps = new Map<string, number>();
  readonly #updateRuntime: (
    runtime: ManagedRuntimeId,
    install: () => Effect.Effect<string, ProviderRuntimeFailure>,
    signal: AbortSignal,
    onWait: () => void,
  ) => Effect.Effect<void, ProviderRuntimeFailure>;
  #blocked: BlockedVersions = new Map();
  #check: Deferred.Deferred<void, ProviderRuntimeFailure> | null = null;
  readonly #scope = Scope.makeUnsafe();
  #checkTimer: NodeJS.Timeout | null = null;
  #checkIntervalMs = UPDATE_CHECK_INTERVAL_MS;
  #lastCheckAt: number | null = null;
  /** The first check after the start or after a sleep. */
  #awakeSince = 0;
  /** The window the last update check collected with. */
  #checkRetentionMs = VERSION_RETENTION_MS;
  #revision = 0;
  #stopping = false;
  /** Set by `startUpdateChecks` after an app upgrade; the first check spends it. */
  #updateInstalled = false;

  constructor(options: ProviderRuntimeManagerOptions) {
    super();
    this.#isProviderOn = options.isProviderOn ?? (() => true);
    this.#root = options.root;
    this.#downloads = options.downloadRoot ?? join(options.root, ".downloads");
    this.#updateRuntime = options.updateRuntime ?? ((_runtime, install) => install().pipe(Effect.asVoid));
    this.#target = runtimeTarget(options.platform ?? process.platform, options.architecture ?? process.arch);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#lock = options.lock ?? parseAgentRuntimeLock(lockValue);
    this.#availableDiskBytes =
      options.availableDiskBytes ??
      (async () => {
        const filesystem = await statfs(this.#root);
        return filesystem.bavail * filesystem.bsize;
      });
    this.#heldStageWaitMs = options.heldStageWaitMs ?? HELD_STAGE_WAIT_MS;
    this.#heldSourceWaitsMs = options.heldSourceWaitsMs ?? HELD_SOURCE_WAITS_MS;
    const unsupportedMessage = this.#target ? null : "This platform is not supported.";
    this.#statuses = {
      codex: emptyStatus(unsupportedMessage),
      claude: emptyStatus(unsupportedMessage),
      grok: emptyStatus(unsupportedMessage),
      opencode: emptyStatus(unsupportedMessage),
      antigravity: emptyStatus(unsupportedMessage),
      cursor: emptyStatus(unsupportedMessage),
      cline: emptyStatus(unsupportedMessage),
      pi: emptyStatus(unsupportedMessage),
      muse: emptyStatus(unsupportedMessage),
      bun: emptyStatus(unsupportedMessage),
    };
  }
  initialize(): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      yield* runtimeIO(async () => await mkdir(this.#root, { recursive: true }));
      yield* this.#removeAbandonedStagingEffect();
      yield* Effect.forEach(RUNTIMES, (runtime) => this.#inspectEffect(runtime), {
        concurrency: "unbounded",
        discard: true,
      });
      if (this.#target) yield* this.#collectVersionsEffect(this.#target, VERSION_RETENTION_MS);
      return this.getStatus();
    });
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
        // After an app upgrade the first check updates an installed CLI itself, so it is not offered
        // until that check has started its download.
        const automatic = this.#updateInstalled && this.#updatesInstalled(provider, this.#target);
        // A provider that is off offers no update, as the automatic update leaves it alone.
        providers[provider].availableVersion =
          offer && !configuredCliPath(provider) && !automatic && this.#isProviderOn(provider) ? version : null;
      }
    }
    return { revision: this.#revision, providers, toolRuntimes: { bun } };
  }
  checkForUpdates(): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      const target = this.#target;
      if (!target) return this.getStatus();
      if (this.#check) yield* Deferred.await(this.#check);
      else {
        const check = Deferred.makeUnsafe<void, ProviderRuntimeFailure>();
        this.#check = check;
        yield* this.#runCheck(target).pipe(
          Effect.onExit((exit) =>
            Effect.gen({ self: this }, function* () {
              yield* Deferred.done(check, exit);
              this.#check = null;
            }),
          ),
          Effect.uninterruptible,
        );
      }
      return this.getStatus();
    });
  }

  /**
   * Collects the old versions now, with the window the update check would use. The update check
   * collects the same versions on its own.
   */
  removeOldVersions(): Effect.Effect<void> {
    return this.#target ? this.#collectVersionsEffect(this.#target, this.#removalRetentionMs()) : Effect.void;
  }

  /**
   * What the Storage page can free now: the old versions, and the download of each provider that is
   * off or runs the CLI the user installed. A version that is both is counted once.
   */
  removableRuntimes(): Effect.Effect<RemovableRuntimes> {
    return Effect.gen({ self: this }, function* () {
      const target = this.#target;
      if (!target) return { bytes: 0, providers: [] };
      const old = yield* this.#oldVersionPathsEffect(target, Date.now() - this.#removalRetentionMs(), false);
      const downloads = yield* this.#removableDownloadsEffect(target);
      const paths = new Set([...old, ...downloads.flatMap((download) => download.paths)]);
      return { bytes: yield* measurePaths([...paths]), providers: downloads.map((download) => download.provider) };
    });
  }

  /**
   * Collects the old versions, then removes each download that `removableRuntimes` names now, with
   * the rules of `removeDownload`. One that fails does not stop the others; the failure names them.
   */
  removeRemovableRuntimes(): Effect.Effect<RemovableRuntimes, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<RemovableRuntimes, ProviderRuntimeFailure> {
      const target = this.#target;
      if (!target) return yield* this.removableRuntimes();
      yield* this.removeOldVersions();
      const downloads = yield* this.#removableDownloadsEffect(target);
      const failed = yield* Effect.forEach(
        downloads,
        ({ provider }) =>
          this.removeDownload(provider).pipe(
            Effect.as([]),
            Effect.catch((error) =>
              Effect.sync(() => {
                logger.warn("Provider runtime removal failed.", { runtime: provider, cause: logCause(error.cause) });
                return [provider];
              }),
            ),
          ),
        { concurrency: "unbounded" },
      );
      const providers = failed.flat();
      if (providers.length > 0)
        return yield* new ProviderRuntimeFailure({
          cause: new Error(
            sourceText("error.provider.removeDownloadsFailed", {
              providers: providers.map((provider) => agentProviderDescriptor(provider).displayName).join(", "),
            }),
          ),
        });
      return yield* this.removableRuntimes();
    });
  }

  /**
   * What `removeDownload` frees now. Nothing for a provider that is on, or whose CLI the user pointed
   * OpenBot at.
   */
  measureDownload(provider: ManagedProviderId): Effect.Effect<ProviderRuntimeDownload> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#target || this.#cliInUse(provider) || configuredCliPath(provider)) return { bytes: 0, versions: 0 };
      const paths = yield* this.#removableVersionPathsEffect(provider, this.#target);
      return { bytes: yield* measurePaths(paths), versions: paths.length };
    });
  }

  /**
   * The providers whose download the Storage page removes now, with the version directories of each:
   * those `removeDownload` takes, and none that downloads at this moment.
   */
  #removableDownloadsEffect(target: RuntimeTarget): Effect.Effect<{ provider: ManagedProviderId; paths: string[] }[]> {
    return Effect.forEach(
      MANAGED_RUNTIME_PROVIDERS,
      (provider) =>
        this.#tasks.has(provider) || this.#cliInUse(provider) || configuredCliPath(provider)
          ? Effect.succeed([])
          : this.#removableVersionPathsEffect(provider, target).pipe(
              Effect.map((paths) => (paths.length > 0 ? [{ provider, paths }] : [])),
            ),
      { concurrency: "unbounded" },
    ).pipe(Effect.map((downloads) => downloads.flat()));
  }

  /**
   * Removes every downloaded version of a provider CLI that is off, and this profile's partial
   * downloads of it. Accounts and sign-ins are not in the store and stay. Turning the provider on
   * later downloads the CLI again.
   *
   * The store is the computer's: a version that another instance stamped since this one last did,
   * or within the collection window, is kept, as the old-version collection keeps it.
   */
  removeDownload(provider: ManagedProviderId): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      const target = this.#target;
      if (!target)
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.runtimesUnsupported")),
        });
      if (this.#stopping)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
      if (configuredCliPath(provider))
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.cliOverride")) });
      if (this.#cliInUse(provider))
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.removeWhileOn")) });
      if (this.#tasks.has(provider))
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.removeWhileDownloading")),
        });
      let removal = this.#removals.get(provider);
      if (!removal) {
        // Registered without an await after the checks above, so a download that starts now waits.
        removal = yield* Effect.forkIn(
          this.#removeVersionsEffect(provider, target).pipe(
            Effect.ensuring(Effect.sync(() => this.#removals.delete(provider))),
          ),
          this.#scope,
        );
        this.#removals.set(provider, removal);
      }
      if (!(yield* Fiber.join(removal)))
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.removeIncomplete")) });
      return this.getStatus();
    });
  }

  /**
   * Whether this instance can run a runtime from the store. A provider that is off runs no CLI here,
   * except Pi, which the key-only providers run on. Neither does one that runs the CLI the user
   * installed: that CLI is as new as the copy, or the agent service would run the copy.
   */
  #cliInUse(runtime: ManagedRuntimeId): boolean {
    if (isManagedToolRuntime(runtime)) return true;
    if (this.#isProviderOn(runtime) && !this.#systemVersions.has(runtime)) return true;
    return runtime === "pi" && KEY_ONLY_PROVIDERS.some((provider) => this.#isProviderOn(provider));
  }

  /**
   * The last check's window while that check is less than one interval old. After that the
   * computer may have slept since, and a sibling's stamp may be as old as the sleep.
   */
  #removalRetentionMs(): number {
    return this.#lastCheckAt !== null && Date.now() - this.#lastCheckAt < this.#checkIntervalMs
      ? this.#checkRetentionMs
      : VERSION_RETENTION_MS;
  }

  /**
   * Checks now and then every hour, until `stop`. The caller starts it once the app is up.
   *
   * `updateInstalled` is for the first start after an app upgrade: the first check then updates
   * each managed provider CLI that has a newer version, with no offer to the user (#3164).
   */
  startUpdateChecks(options: { intervalMs?: number; updateInstalled?: boolean } = {}): void {
    if (this.#checkTimer || !this.#target || this.#stopping) return;
    this.#checkIntervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
    this.#updateInstalled = options.updateInstalled ?? false;
    const check = () => void runCauseEffect(this.checkForUpdates()).catch(() => undefined);
    this.#checkTimer = setInterval(check, this.#checkIntervalMs);
    this.#checkTimer.unref();
    check();
  }
  #runCheck(target: RuntimeTarget): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const [blocked, releases] = yield* Effect.all(
        [
          Effect.result(fetchBlockedVersions(this.#fetch)),
          Effect.forEach(
            PROVIDERS,
            (provider) =>
              Effect.result(
                latestRelease(provider, { target, lock: this.#lock, fetch: this.#fetch }).pipe(
                  Effect.tap((release) =>
                    Effect.sync(() => {
                      this.#latest.set(provider, release);
                    }),
                  ),
                ),
              ),
            { concurrency: "unbounded" },
          ),
        ],
        { concurrency: "unbounded" },
      );
      if (Result.isSuccess(blocked)) this.#blocked = blocked.success;
      if (this.#updateInstalled) {
        // Before offers show again, so the renderer sees these updates already downloading and
        // announces no offer for them. A download reports its own failure in its status.
        yield* Effect.forEach(
          this.#stopping ? [] : PROVIDERS.filter((provider) => this.#updatesInstalled(provider, target)),
          (provider) => Effect.ignore(this.#startDownload(provider, target)),
          { discard: true },
        );
        this.#updateInstalled = false;
      }
      this.#revision += 1;
      this.emit("status", this.getStatus());
      const now = Date.now();
      // Timer checks are one interval apart while the computer is awake, so a longer gap is a sleep.
      if (this.#lastCheckAt === null || now - this.#lastCheckAt > 1.5 * this.#checkIntervalMs) this.#awakeSince = now;
      this.#lastCheckAt = now;
      // Each sibling's timer fires within one interval of a wake. Until then its stamps can be as
      // old as the sleep, so the start window applies, also to a check the user starts at once.
      const awake = now - this.#awakeSince >= this.#checkIntervalMs;
      this.#checkRetentionMs = awake ? AWAKE_RETENTION_CHECKS * this.#checkIntervalMs : VERSION_RETENTION_MS;
      // Forked: the first collection after a long gap removes gigabytes, and a check the user asked
      // for answers without waiting for it.
      yield* Effect.forkIn(this.#collectVersionsEffect(target, this.#checkRetentionMs), this.#scope);
      if (releases.every(Result.isFailure))
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.releaseSourcesUnreachable")),
        });
    });
  }

  /**
   * Whether the update check after an app upgrade updates this provider CLI: OpenBot installed it
   * and a newer version exists. A CLI the user installed or pointed OpenBot at, and a provider that
   * is off, are left alone.
   */
  #updatesInstalled(provider: ManagedProviderId, target: RuntimeTarget): boolean {
    const { phase, version } = this.#statuses[provider];
    // A copy older than this build's pin reads as not downloaded, with its version.
    return (
      (phase === "ready" || phase === "not-downloaded") &&
      version !== null &&
      olderVersion(version, this.#targetSpec(provider, target).version) &&
      !this.#systemVersions.has(provider) &&
      !configuredCliPath(provider) &&
      this.#isProviderOn(provider)
    );
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
   * managed copy or resolved nothing. While a version is set, the copy in the store runs nothing here,
   * so `removeDownload` and the Storage page can remove it, and this instance does not stamp it.
   *
   * True when the provider runs its copy in the store again. The caller then runs
   * `providerUseChanged`, which stamps the copy, or reads the store again when a sibling collected it.
   */
  setSystemVersion(provider: ManagedProviderId, version: string | null): boolean {
    const previous = this.#systemVersions.get(provider) ?? null;
    if (previous === version) return false;
    if (version) this.#systemVersions.set(provider, version);
    else this.#systemVersions.delete(provider);
    this.#revision += 1;
    this.emit("status", this.getStatus());
    return previous !== null && version === null;
  }

  /** Sends the update offers again after the user turns a provider on or off. */
  providerUseChanged(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      // This instance does not stamp a provider that is off. A provider turned on stamps its version
      // at once, not at the next hourly check, so a sibling's collector keeps it from now on. When a
      // sibling collected that version meanwhile, the provider reads the store again.
      for (const provider of PROVIDERS) {
        const executable = this.executablePath(provider);
        if (!executable || !this.#cliInUse(provider) || this.#tasks.has(provider)) continue;
        if (yield* pathExists(executable)) {
          yield* this.#stampInUseEffect(provider, dirname(dirname(executable))).pipe(Effect.ignore);
        } else if (this.#statuses[provider].phase === "ready") {
          yield* this.#inspectEffect(provider).pipe(Effect.ignore);
        }
      }
      this.#revision += 1;
      this.emit("status", this.getStatus());
    });
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
  ensureToolRuntimes(): Effect.Effect<void> {
    return Effect.forEach(MANAGED_TOOL_RUNTIMES, (tool) => this.download(tool).pipe(Effect.ignore), { discard: true });
  }
  ensureToolRuntimesReady(): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      for (const tool of MANAGED_TOOL_RUNTIMES) yield* this.downloadAndWait(tool);
    });
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
  download(runtime: ManagedRuntimeId): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      if (!this.#target)
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.runtimesUnsupported")),
        });
      if (this.#stopping)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
      // Only a provider CLI has a path override; nothing points `OPENBOT_BUN_PATH` at a tool runtime.
      if (!isManagedToolRuntime(runtime) && configuredCliPath(runtime))
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.cliOverride")) });
      if (this.#tasks.has(runtime)) return this.getStatus();
      if (this.#check && !(isManagedToolRuntime(runtime) || this.#latest.has(runtime))) {
        yield* this.#awaitReleaseCheck(this.#check);
        if (this.#stopping)
          return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
        if (this.#tasks.has(runtime)) return this.getStatus();
      }
      return yield* this.#startDownload(runtime, this.#target);
    });
  }

  /**
   * Starts the download that `download` asks for, after its checks. The update check calls it
   * directly: `download` would wait for that same check to end.
   */
  #startDownload(
    runtime: ManagedRuntimeId,
    target: RuntimeTarget,
  ): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      const removal = isManagedToolRuntime(runtime) ? undefined : this.#removals.get(runtime);
      if (removal) yield* Fiber.join(removal);
      if (this.#tasks.has(runtime)) return this.getStatus();
      const spec = this.#targetSpec(runtime, target);
      const current = this.#statuses[runtime];
      // A download goes only toward a newer version, never back to an older one. A failed update keeps
      // the version still installed, so its Retry follows the same rule: when the block list has taken
      // the newer version away, the Retry ends the error on the installed one instead.
      if (current.version && !olderVersion(current.version, spec.version)) {
        if (current.phase !== "ready") this.#setStatus(runtime, yield* this.#inspectEffect(runtime));
        return this.getStatus();
      }

      const controller = new AbortController();
      this.#controllers.set(runtime, controller);
      this.#transfers.set(runtime, spec);
      this.#stages.set(runtime, "prepare");
      this.#cancelled.delete(runtime);
      this.#setStatus(runtime, {
        phase: "downloading",
        progress: 0,
        message: null,
        version: this.#statuses[runtime].version,
      });
      // The task is registered without an await between it and the guard above, so a second request
      // for the same runtime finds it and joins it instead of starting a download of its own.
      const task = yield* Effect.forkIn(
        this.#updateProviderRuntime(spec, controller.signal).pipe(
          Effect.catch((error) => {
            this.#controllers.delete(runtime);
            this.#tasks.delete(runtime);
            return this.#handleDownloadFailure(spec, error.cause);
          }),
          Effect.ensuring(
            Effect.sync(() => {
              this.#controllers.delete(runtime);
              this.#tasks.delete(runtime);
              this.#transfers.delete(runtime);
              this.#stages.delete(runtime);
              this.#cancelled.delete(runtime);
            }),
          ),
        ),
        this.#scope,
      );
      this.#tasks.set(runtime, task);
      return this.getStatus();
    });
  }

  /**
   * Waits for the running release check, so a first install gets the latest release, not the pin.
   *
   * The first install is on the onboarding screen, often seconds after launch, while the check that
   * `startUpdateChecks` began still waits for GitHub, npm and x.ai. A download that did not wait
   * would install the pinned version and offer the update a moment later. A check that fails, or
   * that takes longer than `RELEASE_CHECK_WAIT_MS`, leaves the pinned version, so a slow source
   * holds a first install back only that long. No check is started here: one that already failed
   * would fail again, and the hourly check or the user's own check finds the release later.
   */
  #awaitReleaseCheck(
    check: Deferred.Deferred<void, ProviderRuntimeFailure>,
  ): Effect.Effect<void, ProviderRuntimeFailure> {
    return Deferred.await(check).pipe(
      Effect.catch(() => Effect.void),
      Effect.timeoutOrElse({ duration: RELEASE_CHECK_WAIT_MS, orElse: () => Effect.void }),
    );
  }
  downloadAndWait(runtime: ManagedRuntimeId): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      yield* this.download(runtime);
      const task = this.#tasks.get(runtime);
      if (task) yield* Fiber.join(task);
      const status = this.#statuses[runtime];
      if (status.phase !== "ready")
        return yield* new ProviderRuntimeFailure({
          cause: new Error(status.message ?? sourceText("error.provider.runtimeUpdateIncomplete")),
        });
    });
  }
  /**
   * Installs the Pi CLI that a key-only provider such as DeepSeek runs on, and waits for it. Only the
   * Pi row has a Download button, so without this a saved key finds no CLI (#3273). A Pi that the
   * provider can already start, from OpenBot or from the user, is kept.
   */
  ensureKeyProviderCli(provider: AgentProviderRef): Effect.Effect<void, ProviderRuntimeFailure> {
    if (!isKeyOnlyProvider(provider)) return Effect.void;
    // A removal of Pi's download that runs now would take away the CLI that this finds.
    const removal = this.#removals.get("pi");
    return (removal ? Fiber.await(removal) : Effect.void).pipe(
      Effect.andThen(resolvePiCli({ bundledExecutable: this.executablePath("pi") })),
      Effect.asVoid,
      Effect.catch(() => this.downloadAndWait("pi")),
    );
  }
  /**
   * `ensureKeyProviderCli` without the wait, for a joined server's request, which ends before a
   * download does. True while that Pi download runs: the provider is checked again when Pi is ready.
   * False when Pi starts, or when no download runs for a Pi that cannot start.
   */
  startKeyProviderCli(provider: AgentProviderRef): Effect.Effect<boolean, ProviderRuntimeFailure> {
    if (!isKeyOnlyProvider(provider)) return Effect.succeed(false);
    return resolvePiCli({ bundledExecutable: this.executablePath("pi") }).pipe(
      Effect.as(false),
      Effect.catch(() =>
        this.download("pi").pipe(
          Effect.map((snapshot) => ["downloading", "finishing"].includes(snapshot.providers.pi.phase)),
        ),
      ),
    );
  }
  cancel(runtime: ManagedRuntimeId): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      if (this.#statuses[runtime].phase !== "downloading") return this.getStatus();
      const task = this.#tasks.get(runtime);
      const spec = this.#transfers.get(runtime);
      this.#cancelled.add(runtime);
      this.#controllers.get(runtime)?.abort();
      if (task) yield* Fiber.join(task);
      if (spec) yield* this.#removePartialEffect(spec);
      yield* this.#inspectEffect(runtime);
      this.#setStatus(runtime, this.#statuses[runtime]);
      return this.getStatus();
    });
  }
  stop(): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      this.#stopping = true;
      if (this.#checkTimer) clearInterval(this.#checkTimer);
      this.#checkTimer = null;
      for (const controller of this.#controllers.values()) controller.abort();
      yield* Effect.forEach(this.#tasks.values(), Fiber.await, { concurrency: "unbounded", discard: true });
      yield* Effect.forEach(this.#removals.values(), Fiber.await, { concurrency: "unbounded", discard: true });
      yield* Scope.close(this.#scope, Exit.void);
    });
  }

  #inspectEffect(runtime: ManagedRuntimeId): Effect.Effect<ProviderRuntimeStatus, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeStatus, ProviderRuntimeFailure> {
      if (!this.#target) return this.#statuses[runtime];
      const pinned = runtimeSpec(runtime, this.#target, this.#lock);
      const installed = yield* this.#newestInstalledEffect(pinned);
      this.#statuses[runtime] = installed
        ? readyStatus(installed)
        : { ...emptyStatus(), version: yield* this.#previousVersionEffect(pinned) };
      return this.#statuses[runtime];
    });
  }

  /**
   * The newest version in the store that verifies, and is therefore the one to run.
   *
   * That is the pinned version, checked against the lock, or a newer upstream release, checked
   * against the record its install wrote. A directory with neither is an older pin this build has no
   * hashes for; `#previousVersion` still lends it out until an update replaces it.
   */

  #newestInstalledEffect(pinned: RuntimeSpec): Effect.Effect<string | null, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<string | null, ProviderRuntimeFailure> {
      const targetRoot = dirname(this.#installRoot(pinned));
      const entries = yield* runtimeIO(async () => await readdir(targetRoot, { withFileTypes: true }).catch(() => []));
      const versions = entries
        .filter((entry) => entry.isDirectory() && isVersion(entry.name))
        .map((entry) => entry.name)
        // Of two builds that the release does not order, the pinned one comes first.
        .sort((a, b) => compareReleases(b, a) || Number(b === pinned.version) - Number(a === pinned.version));
      for (const version of versions) {
        const spec = version === pinned.version ? pinned : recordedSpec(pinned, version);
        const installRoot = join(targetRoot, version);
        if (!(yield* this.#verifiesUnlessUnchangedEffect(installRoot, spec))) continue;
        yield* this.#stampInUseEffect(pinned.runtime, installRoot);
        return version;
      }
      return null;
    });
  }

  /**
   * What the store on disk says about a provider, without recording it.
   *
   * An update reads the store after it holds the download slot, and must not overwrite the
   * "downloading" state it published to get there. Only `#inspect` records what this returns.
   */

  #readStoreEffect(spec: RuntimeSpec): Effect.Effect<ProviderRuntimeStatus, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeStatus, ProviderRuntimeFailure> {
      const installRoot = this.#installRoot(spec);
      if (yield* this.#verifiesEffect(installRoot, spec)) {
        yield* this.#stampInUseEffect(spec.runtime, installRoot);
        return readyStatus(spec.version);
      }
      return { ...emptyStatus(), version: yield* this.#previousVersionEffect(spec) };
    });
  }
  #updateProviderRuntime(spec: RuntimeSpec, signal: AbortSignal): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const installed = yield* this.#readStoreEffect(spec);
      if (installed.phase === "ready") {
        yield* this.#activateEffect(spec, signal, false);
        return;
      }
      if (this.#stopping)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
      yield* runtimeSync(() => signal.throwIfAborted());
      this.#setStatus(spec.runtime, { phase: "downloading", progress: 0, message: null, version: installed.version });
      yield* this.#activateEffect(spec, signal, true);
    });
  }

  // Keep the last installed version available while its replacement is downloaded.

  #previousVersionEffect(spec: RuntimeSpec): Effect.Effect<string | null, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<string | null, ProviderRuntimeFailure> {
      const targetRoot = dirname(this.#installRoot(spec));
      const version = yield* this.#workingBackupEffect(targetRoot, spec, spec.version);
      // This is the CLI the agent service runs until the newer one arrives, so it is in use and
      // the collector in every other instance has to leave it alone. A worktree that pins a newer
      // version would otherwise take it away while this one is running from it.
      if (version) yield* this.#stampInUseEffect(spec.runtime, join(targetRoot, version));
      return version;
    });
  }

  /** The newest version older than `version` whose executable is still there. */

  #workingBackupEffect(
    targetRoot: string,
    spec: RuntimeSpec,
    version: string,
  ): Effect.Effect<string | null, ProviderRuntimeFailure> {
    return Effect.gen(function* (): Effect.fn.Return<string | null, ProviderRuntimeFailure> {
      const entries = yield* runtimeIO(async () => await readdir(targetRoot, { withFileTypes: true }).catch(() => []));
      const versions = entries
        .filter((entry) => entry.isDirectory() && olderVersion(entry.name, version))
        .map((entry) => entry.name)
        .sort((a, b) => compareReleases(b, a));
      for (const candidate of versions) {
        const executable = yield* runtimeIO(
          async () => await stat(join(targetRoot, candidate, "bin", spec.executableName)).catch(() => null),
        );
        if (executable?.isFile()) return candidate;
      }
      return null;
    });
  }

  /** The one record a sibling instance can read: this version is in use, so keep it. */

  #stampInUseEffect(runtime: ManagedRuntimeId, installRoot: string): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      if (!this.#cliInUse(runtime)) return;
      const now = new Date();
      // Best effort -- a store on a read-only volume still works, it only ages.
      const stamped = yield* runtimeIO(async () =>
        utimes(installRoot, now, now).then(
          () => true,
          () => false,
        ),
      );
      if (stamped) this.#ownStamps.set(installRoot, now.getTime());
    });
  }

  /**
   * Hands the installed executable to the agent service, which swaps it into its running clients.
   *
   * No `download` means the bytes are in the store already, because a sibling instance put them
   * there: there is nothing to transfer, only the swap. An install this instance made and could not
   * activate is removed, so the rejected artifact is not selected on the next start; one a sibling
   * made is left where it is, because the sibling is using it. A transfer is not what decides that:
   * a sibling can commit the same version while this instance is still downloading it, and what is
   * then in the store is the sibling's install, adopted rather than written.
   */

  #activateEffect(
    spec: RuntimeSpec,
    signal: AbortSignal,
    download: boolean,
  ): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* () {
      let installed = false;
      const result = yield* Effect.result(
        this.#updateRuntime(
          spec.runtime,
          () =>
            Effect.gen({ self: this }, function* () {
              // The wait for the provider's turns, if there was one, is over.
              const status = this.#statuses[spec.runtime];
              if (status.message !== null) this.#setStatus(spec.runtime, { ...status, message: null });
              if (download) {
                installed = yield* this.#runDownloadEffect(spec, signal);
                yield* this.#removePartialEffect(spec);
              }
              this.#stages.set(spec.runtime, "activate");
              return join(this.#installRoot(spec), "bin", spec.executableName);
            }),
          signal,
          () =>
            this.#setStatus(spec.runtime, {
              ...this.#statuses[spec.runtime],
              message: sourceText("status.provider.updateWaiting"),
            }),
        ),
      );
      if (Result.isFailure(result)) {
        if (installed) yield* runtimeIO(() => rm(this.#installRoot(spec), { recursive: true, force: true }));
        return yield* result.failure;
      }
      // This instance runs the version now. Its stamp is also what lets `removeDownload` remove an
      // install it made itself: the install leaves the directory with a time no stamp recorded.
      yield* this.#stampInUseEffect(spec.runtime, this.#installRoot(spec));
      this.#setStatus(spec.runtime, readyStatus(spec.version));
      this.emit("ready", spec.runtime);
    });
  }

  /** Answers whether this instance is the one that put the install in the store. */

  #runDownloadEffect(spec: RuntimeSpec, signal: AbortSignal): Effect.Effect<boolean, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<boolean, ProviderRuntimeFailure, Scope.Scope> {
      this.#stages.set(spec.runtime, "download");
      yield* runtimeIO(async () => await mkdir(this.#downloadRoot(), { recursive: true }));
      yield* this.#requireDiskSpaceEffect(spec);
      const partialPath = this.#partialPath(spec);
      const metadataPath = this.#partialMetadataPath(spec);
      const previous = yield* readPartialState(partialPath, metadataPath, spec);
      // No digest is Grok's upstream release, which x.ai publishes no hash for and TLS alone vouches for.
      const digest = spec.archiveDigest;
      // An earlier attempt can get every byte and then fail while it stages them. A Retry installs
      // those bytes when they still verify, instead of downloading them again.
      if (previous.complete && digest) {
        this.#stages.set(spec.runtime, "verify");
        if (yield* digestMatches(partialPath, digest)) {
          this.#setFinishing(spec.runtime);
          return yield* this.#installEffect(spec, partialPath);
        }
        this.#stages.set(spec.runtime, "download");
      }
      let offset = previous.offset;
      let response = yield* Effect.acquireRelease(
        this.#fetchRuntimeEffect(spec, signal, offset, previous.metadata?.etag ?? null),
        releaseDownloadResponse,
      );
      if (
        offset > 0 &&
        !isValidPartialResponse(response, offset, spec.downloadBytes, previous.metadata?.etag ?? null)
      ) {
        yield* runtimeIO(async () => await response.body?.cancel().catch(() => undefined));
        yield* this.#removePartialEffect(spec);
        offset = 0;
        response = yield* Effect.acquireRelease(
          this.#fetchRuntimeEffect(spec, signal, 0, null),
          releaseDownloadResponse,
        );
      }
      if (!response.ok || (offset > 0 && response.status !== 206)) {
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.downloadHttp", { status: response.status })),
        });
      }
      if (!response.body)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.downloadNoData")) });

      const etag = response.headers.get("etag");
      yield* runtimeIO(
        async () =>
          await writeFile(
            metadataPath,
            `${JSON.stringify({ url: spec.url, etag, expectedBytes: spec.downloadBytes } satisfies PartialMetadata)}\n`,
            { mode: 0o600 },
          ),
      );
      yield* streamResponse(response, partialPath, offset, signal, (received) => {
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

      this.#setFinishing(spec.runtime);
      this.#stages.set(spec.runtime, "verify");
      const downloaded = yield* runtimeIO(async () => await stat(partialPath));
      if (downloaded.size !== spec.downloadBytes) {
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.downloadSize")) });
      }
      if (digest && !(yield* digestMatches(partialPath, digest))) {
        yield* this.#removePartialEffect(spec);
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.downloadIntegrity")) });
      }

      return yield* this.#installEffect(spec, partialPath);
    }).pipe(Effect.scoped);
  }

  /** Answers whether this instance committed the install, or adopted the one it found. */

  #installEffect(spec: RuntimeSpec, downloadedPath: string): Effect.Effect<boolean, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* () {
      this.#stages.set(spec.runtime, "install");
      const staging = join(
        this.#runtimeRoot(spec.runtime),
        `.staging-${spec.target}-${spec.version}-${process.pid}-${randomBytes(4).toString("hex")}`,
      );
      return yield* Effect.acquireUseRelease(
        runtimeIO(() => mkdir(staging, { recursive: true })),
        () =>
          Effect.gen({ self: this }, function* () {
            let committed = false;
            const result = yield* Effect.result(
              Effect.gen({ self: this }, function* () {
                yield* providerRuntimeDescriptor(spec.runtime).stage({
                  spec,
                  downloadedPath,
                  staging,
                  lock: this.#lock,
                  downloadSmallFile: (url, hash) => this.#downloadSmallFileEffect(url, hash),
                });
                if (spec.source === "latest") yield* writeInstallRecord(staging, spec);
                yield* verifyInstalledRuntime(staging, spec, this.#lock, this.#isProviderOn);
                const destination = this.#installRoot(spec);
                yield* runtimeIO(() => mkdir(dirname(destination), { recursive: true }));
                committed = yield* this.#commitEffect(staging, destination, spec);
                yield* verifyInstalledRuntime(destination, spec, this.#lock, this.#isProviderOn);
                return committed;
              }),
            );
            if (Result.isSuccess(result)) return result.success;
            // Only discard a runtime this instance committed, never a sibling's adopted install.
            if (committed) yield* this.#discardRejectedEffect(spec);
            return yield* result.failure;
          }),
        () =>
          runtimeIO(() => rm(staging, { recursive: true, force: true, maxRetries: 5 })).pipe(
            Effect.catch(() => Effect.void),
          ),
      );
    });
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

  #discardRejectedEffect(spec: RuntimeSpec): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const installRoot = this.#installRoot(spec);
      const aside = join(
        this.#runtimeRoot(spec.runtime),
        `.replaced-${spec.target}-${spec.version}-${randomBytes(4).toString("hex")}`,
      );
      if (!(yield* renameIfPresent(installRoot, aside))) return;
      if (yield* this.#verifiesEffect(aside, spec)) {
        if (yield* renameIfVacant(aside, installRoot, this.#heldSourceWaitsMs)) return;
      }
      yield* runtimeIO(async () => await rm(aside, { recursive: true, force: true }).catch(() => undefined));
    });
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

  #commitEffect(
    staging: string,
    destination: string,
    spec: RuntimeSpec,
  ): Effect.Effect<boolean, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<boolean, ProviderRuntimeFailure> {
      // Each pass reads the destination again, because a sibling can fill it or replace it between
      // any two steps below. Whatever it did, the next pass sees the result: a verified install is
      // adopted, and only what is still damaged is replaced.
      let held = false;
      let attempts = 0;
      const heldUntil = Date.now() + this.#heldStageWaitMs;
      while (attempts < COMMIT_ATTEMPTS) {
        if (yield* renameIfVacant(staging, destination, this.#heldSourceWaitsMs)) return true;
        // Still vacant: each refusal already waited in renameIfVacant. A held stage uses time,
        // not a replacement attempt, while Windows Defender can still have its files open.
        held = !(yield* pathExists(destination));
        if (held) {
          if (this.#stopping)
            return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
          if (Date.now() >= heldUntil) break;
          continue;
        }
        attempts += 1;
        if (yield* this.#verifiesEffect(destination, spec)) return false;
        const outcome = yield* this.#replaceUnderLockEffect(staging, destination, spec);
        if (outcome !== "moved") return outcome === "committed";
      }
      return yield* new ProviderRuntimeFailure({
        cause: new Error(sourceText(held ? "error.provider.runtimeFilesInUse" : "error.provider.runtimeReplacing")),
      });
    });
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

  #replaceUnderLockEffect(
    staging: string,
    destination: string,
    spec: RuntimeSpec,
  ): Effect.Effect<"committed" | "adopted" | "moved", ProviderRuntimeFailure> {
    const lock = join(this.#runtimeRoot(spec.runtime), `.locking-${spec.target}-${spec.version}`);
    return Effect.acquireUseRelease(
      takeLock(lock),
      (claim) =>
        Effect.gen({ self: this }, function* (): Effect.fn.Return<
          "committed" | "adopted" | "moved",
          ProviderRuntimeFailure
        > {
          if (!claim) return "moved";

          if (yield* this.#verifiesEffect(destination, spec)) return "adopted";
          // Beside the staging directories, not beside the version ones: that is where the sweep looks,
          // and `#removeOldVersions` reads everything in the target root as a version.
          const aside = join(
            this.#runtimeRoot(spec.runtime),
            `.replaced-${spec.target}-${spec.version}-${randomBytes(4).toString("hex")}`,
          );
          // The claim is read once more against the one thing that can have displaced it: an instance
          // recovering it as abandoned. Whoever holds the claim by now is the one entitled to move the
          // destination, and this instance stops before touching it rather than after.
          if (!(yield* holdsClaim(lock, claim))) return "moved";
          // Aside rather than deleted, because a sibling reading the atomic path must never find it
          // half removed, and gone already means an instance without this lock took it.
          if (!(yield* renameIfPresent(destination, aside))) return "moved";
          // Read once more, now that it is somewhere nothing else can change it. The claim says no
          // other instance may move this destination, and the reading above says this one was damaged;
          // both were true when they were read, and neither is a promise about the moment of the move.
          // What was moved is therefore examined rather than trusted: a runtime that verifies is an
          // install a sibling committed in between, so it goes back where the sibling left it and is
          // adopted. Nothing that verifies is ever replaced, whatever the claim said.
          if (yield* this.#verifiesEffect(aside, spec)) {
            if (yield* renameIfVacant(aside, destination, this.#heldSourceWaitsMs)) return "adopted";
            yield* runtimeIO(() => rm(aside, { recursive: true, force: true })).pipe(Effect.catch(() => Effect.void));
            return "moved";
          }
          const committed = yield* renameIfVacant(staging, destination, this.#heldSourceWaitsMs).pipe(
            Effect.ensuring(
              runtimeIO(() => rm(aside, { recursive: true, force: true })).pipe(Effect.catch(() => Effect.void)),
            ),
          );
          if (committed) return "committed";
          return "moved";
        }),
      (claim) => (claim ? releaseLock(lock, claim).pipe(Effect.orDie) : Effect.void),
    ).pipe(Effect.uninterruptible);
  }

  #verifiesEffect(installRoot: string, spec: RuntimeSpec): Effect.Effect<boolean, ProviderRuntimeFailure> {
    return verifyInstalledRuntime(installRoot, spec, this.#lock, this.#isProviderOn).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
  }

  #verifiesUnlessUnchangedEffect(installRoot: string, spec: RuntimeSpec): Effect.Effect<boolean> {
    return verifyChangedRuntime(installRoot, spec, this.#lock, this.#isProviderOn).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
  }

  #downloadSmallFileEffect(
    url: string,
    expectedSha256: string | null,
  ): Effect.Effect<Uint8Array, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* () {
      const controller = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (controller) => Effect.sync(() => controller.abort()),
      );
      const response = yield* runtimeIO((signal) =>
        this.#fetch(url, {
          headers: { "User-Agent": "OpenBot-runtime-installer" },
          signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(30_000)]),
        }),
      ).pipe(Effect.mapError(({ cause }) => requestFailure(url, cause)));
      if (!response.ok)
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.metadataHttp", { status: response.status })),
        });
      const value = yield* readLimitedBody(response, sourceText("error.provider.metadataTooLarge"));
      if (!value)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.metadataNoData")) });
      if (expectedSha256 !== null && createHash("sha256").update(value).digest("hex") !== expectedSha256) {
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.metadataIntegrity")) });
      }
      return value;
    }).pipe(Effect.scoped);
  }

  #fetchRuntimeEffect(
    spec: RuntimeSpec,
    signal: AbortSignal,
    offset: number,
    etag: string | null,
  ): Effect.Effect<Response, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<Response, ProviderRuntimeFailure> {
      return yield* runtimeIO((effectSignal) =>
        this.#fetch(spec.url, {
          signal: AbortSignal.any([signal, effectSignal]),
          redirect: "follow",
          headers: {
            "User-Agent": "OpenBot-runtime-installer",
            ...(offset > 0 ? { Range: `bytes=${offset}-`, ...(etag ? { "If-Range": etag } : {}) } : {}),
          },
        }),
      ).pipe(Effect.mapError(({ cause }) => requestFailure(spec.url, cause)));
    });
  }

  #requireDiskSpaceEffect(spec: RuntimeSpec): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      // Measured on the store, which is where the installed copy lands. The partial can be told to
      // live elsewhere; in practice both are under the user's home, on one volume.
      const available = yield* runtimeIO(async () => await this.#availableDiskBytes());
      const existing = yield* fileSize(this.#partialPath(spec));
      const required = Math.max(0, spec.downloadBytes - existing) + spec.installedBytes + FREE_SPACE_HEADROOM;
      if (available < required)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.diskSpace")) });
    });
  }
  #handleDownloadFailure(spec: RuntimeSpec, error: unknown): Effect.Effect<void, ProviderRuntimeFailure> {
    const runtime = spec.runtime;
    return Effect.sync(() => {
      if (this.#cancelled.has(runtime)) return;
      if (this.#stopping && isAbortError(error)) return;
      // The screen shows the reason only in the row, and a failed update removes what it installed.
      // A support report then has this line alone, in `logs/providers/providers.log`.
      if (!isAbortError(error))
        logger.warn("Provider runtime update failed.", {
          runtime,
          version: spec.version,
          installedVersion: this.#statuses[runtime].version,
          stage: this.#stages.get(runtime) ?? "prepare",
          cause: logCause(error),
        });
      // The row shows catalog text only. A system error names private paths; the log line keeps it.
      const message = isAbortError(error)
        ? sourceText("status.provider.downloadStopped")
        : error instanceof Error && matchingSourceKeys(error.message).length > 0
          ? redactText(error.message)
          : sourceText("status.provider.downloadFailed");
      this.#setStatus(runtime, {
        phase: "download-error",
        progress: null,
        message,
        version: this.#statuses[runtime].version,
      });
    });
  }

  #setFinishing(runtime: ManagedRuntimeId): void {
    this.#setStatus(runtime, {
      phase: "finishing",
      progress: null,
      message: null,
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

  #removePartialEffect(spec: RuntimeSpec): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.all(
      [
        runtimeIO(() => rm(this.#partialPath(spec), { force: true })),
        runtimeIO(() => rm(this.#partialMetadataPath(spec), { force: true })),
      ],
      { concurrency: "unbounded", discard: true },
    );
  }

  /**
   * Collects the working directories a crashed install left behind, and only those.
   *
   * Age is the whole test. A sibling instance may be part-way through staging the same version
   * right now, and removing its directory would fail its install for no reason.
   */

  #removeAbandonedStagingEffect(): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const stale = Date.now() - STALE_STAGING_MS;
      for (const runtime of RUNTIMES) {
        const root = this.#runtimeRoot(runtime);
        const entries = yield* runtimeIO(async () => await readdir(root, { withFileTypes: true }).catch(() => []));
        yield* Effect.forEach(
          entries.filter(
            (entry) => entry.isDirectory() && STAGING_PREFIXES.some((prefix) => entry.name.startsWith(prefix)),
          ),
          (entry) => removeStaleRuntimeDirectory(join(root, entry.name), stale),
          { concurrency: "unbounded", discard: true },
        );
      }
    });
  }

  /**
   * Stamps the versions this instance runs, so a sibling's collector keeps them, then collects the
   * versions no instance stamped within `retentionMs`. Runs at start, on every update check, and
   * when the user asks, so an update frees the version it replaced without a restart.
   */

  #collectVersionsEffect(target: RuntimeTarget, retentionMs: number): Effect.Effect<void> {
    const stale = Date.now() - retentionMs;
    return this.#oldVersionPathsEffect(target, stale, true).pipe(
      Effect.flatMap((paths) =>
        Effect.forEach(
          paths,
          (path) =>
            removeStaleRuntimeDirectory(path, stale).pipe(
              Effect.andThen(pathExists(path)),
              Effect.flatMap((kept) =>
                kept
                  ? Effect.void
                  : runtimeIO(() => rm(verificationRecordPath(path), { force: true })).pipe(Effect.ignore),
              ),
            ),
          { concurrency: "unbounded", discard: true },
        ),
      ),
      Effect.catch(() => Effect.void),
    );
  }

  /**
   * The version directories of every runtime that this instance does not keep and that no instance
   * stamped after `stale`. With `stamp`, the kept versions are stamped first.
   *
   * Settled per runtime: collecting an old version is housekeeping, and a version another instance
   * still runs refuses to be removed on Windows. Neither may stop the app from starting or a check
   * from finishing.
   */

  #oldVersionPathsEffect(target: RuntimeTarget, stale: number, stamp: boolean): Effect.Effect<string[]> {
    return Effect.forEach(
      RUNTIMES,
      (runtime) =>
        Effect.gen({ self: this }, function* () {
          const spec = runtimeSpec(runtime, target, this.#lock);
          const { phase, version } = this.#statuses[runtime];
          const targetRoot = dirname(this.#installRoot(spec));
          if (stamp && version) yield* this.#stampInUseEffect(runtime, join(targetRoot, version));
          // A verified version needs nothing to fall back on. The one it replaced is not stamped again,
          // so it stays only for the collection window and then goes, as any other old version does.
          const backup =
            version && phase !== "ready" ? yield* this.#workingBackupEffect(targetRoot, spec, version) : null;
          if (stamp && backup) yield* this.#stampInUseEffect(runtime, join(targetRoot, backup));
          return yield* this.#oldVersionsEffect(spec, backup, stale);
        }).pipe(Effect.catch(() => Effect.succeed([]))),
      { concurrency: "unbounded" },
    ).pipe(Effect.map((paths) => paths.flat()));
  }

  /**
   * The versions no one has any use for.
   *
   * This instance needs the version it runs and any newer one. Until the version it runs is verified,
   * it also needs one older version that still works, to fall back on; after that, the older one is
   * kept only while a stamp within `stale` says an instance ran it. An older pin is not kept for
   * itself: the store never goes back to it.
   *
   * Rank alone decided this when the store belonged to one profile. It is now the computer's, and
   * another instance -- the released app beside a development build, or a worktree whose lock pins
   * a different version -- may be running from a directory this build would remove. `#inspect`
   * stamps whatever it verifies on every start, and `#collectVersions` stamps it again on every
   * update check, so a version in use anywhere stays recent, and only a tree nothing has run since
   * `stale` is collected.
   */

  #oldVersionsEffect(
    spec: RuntimeSpec,
    backup: string | null,
    stale: number,
  ): Effect.Effect<string[], ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<string[], ProviderRuntimeFailure> {
      const targetRoot = join(this.#runtimeRoot(spec.runtime), spec.target);
      const entries = yield* runtimeIO(async () => await readdir(targetRoot, { withFileTypes: true }).catch(() => []));
      const versions = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
      const active = this.#statuses[spec.runtime].version;
      // With nothing that runs, the pin and the newest directory are all there is to start from.
      const keep = new Set(
        active
          ? [active, backup, ...versions.filter((version) => !olderVersion(version, active))]
          : [spec.version, ...versions.sort((a, b) => compareReleases(b, a)).slice(0, 1)],
      );
      const paths = versions.filter((version) => !keep.has(version)).map((version) => join(targetRoot, version));
      const modified = yield* Effect.forEach(
        paths,
        (path) =>
          runtimeIO(() => stat(path)).pipe(
            Effect.map((value) => value.mtimeMs),
            Effect.catch(() => Effect.succeed(Number.POSITIVE_INFINITY)),
          ),
        { concurrency: "unbounded" },
      );
      return paths.filter((_, index) => (modified[index] ?? Number.POSITIVE_INFINITY) <= stale);
    });
  }

  /** The version directories of a provider CLI that `removeDownload` may remove now. */

  #removableVersionPathsEffect(provider: ManagedProviderId, target: RuntimeTarget): Effect.Effect<string[]> {
    return Effect.gen({ self: this }, function* () {
      const targetRoot = join(this.#runtimeRoot(provider), target);
      const entries = yield* runtimeIO(async () => await readdir(targetRoot, { withFileTypes: true }).catch(() => []));
      const paths = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => join(targetRoot, entry.name));
      const kept = yield* Effect.forEach(paths, (path) => this.#stampedBySiblingEffect(path), {
        concurrency: "unbounded",
      });
      return paths.filter((_, index) => !kept[index]);
    }).pipe(Effect.catch(() => Effect.succeed([])));
  }

  /**
   * Whether another instance stamped a version directory within the collection window, after the
   * last stamp of this instance. The stamp is the directory's mtime, so a later stamp of this
   * instance hides an earlier one of a sibling; the sibling stamps it again on its next check.
   */

  #stampedBySiblingEffect(path: string): Effect.Effect<boolean> {
    const stale = Date.now() - this.#removalRetentionMs();
    const own = (this.#ownStamps.get(path) ?? Number.NEGATIVE_INFINITY) + OWN_STAMP_PRECISION_MS;
    return runtimeIO(() => stat(path)).pipe(
      Effect.map((value) => value.mtimeMs > Math.max(stale, own)),
      Effect.catch(() => Effect.succeed(true)),
    );
  }

  /**
   * Removes the versions `#removableVersionPathsEffect` chooses, and answers whether every one went.
   *
   * Each version is moved aside before it is deleted. A version that a program holds open refuses
   * the move on Windows and stays whole, and a deletion that stops part-way leaves only the moved
   * copy, which the staging sweep collects. Neither leaves a version directory without its files.
   */
  #removeVersionsEffect(provider: ManagedProviderId, target: RuntimeTarget): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const paths = yield* this.#removableVersionPathsEffect(provider, target);
      const removed = yield* Effect.forEach(
        paths,
        (path) =>
          Effect.gen({ self: this }, function* () {
            // Again just before the removal: a sibling may have stamped it since the listing.
            if (yield* this.#stampedBySiblingEffect(path)) return true;
            const aside = join(
              this.#runtimeRoot(provider),
              `.replaced-${target}-${basename(path)}-${randomBytes(4).toString("hex")}`,
            );
            if (!(yield* renameIfPresent(path, aside).pipe(Effect.orElseSucceed(() => null)))) {
              return !(yield* pathExists(path));
            }
            this.#ownStamps.delete(path);
            yield* runtimeIO(() => rm(verificationRecordPath(path), { force: true })).pipe(Effect.ignore);
            yield* runtimeIO(() => rm(aside, { recursive: true, force: true })).pipe(Effect.ignore);
            return true;
          }),
        { concurrency: "unbounded" },
      );
      const prefix = `${provider}-${target}-`;
      const downloads = yield* runtimeIO(async () => await readdir(this.#downloadRoot()).catch(() => []));
      yield* Effect.forEach(
        downloads.filter((name) => name.startsWith(prefix) && /\.partial(?:\.json)?$/u.test(name)),
        (name) => runtimeIO(() => rm(join(this.#downloadRoot(), name), { force: true })).pipe(Effect.ignore),
        { concurrency: "unbounded", discard: true },
      );
      const status = yield* this.#inspectEffect(provider).pipe(
        Effect.catch(() => Effect.succeed(this.#statuses[provider])),
      );
      this.#setStatus(provider, status);
      return removed.every(Boolean);
    }).pipe(Effect.catch(() => Effect.succeed(false)));
  }
}

export function runtimeTarget(platform: NodeJS.Platform, architecture: string): RuntimeTarget | null {
  if (platform === "darwin" && architecture === "arm64") return "darwin-arm64";
  if (platform === "darwin" && architecture === "x64") return "darwin-x64";
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
const verifyInstalledRuntime = Effect.fn("ProviderRuntime.verifyInstalledRuntime")(function* (
  root: string,
  spec: RuntimeSpec,
  lock: AgentRuntimeLock,
  isProviderOn: (provider: ManagedProviderId) => boolean,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  const descriptor = providerRuntimeDescriptor(spec.runtime);
  const executable = join(root, "bin", spec.executableName);
  yield* runtimeIO(() => access(executable));
  if (spec.source === "lock") yield* descriptor.verify(root, spec, lock);
  else yield* verifyInstallRecord(root, spec);
  if (!isManagedToolRuntime(spec.runtime) && !isProviderOn(spec.runtime)) return;
  const versionFile = descriptor.versionFile;
  const output = versionFile
    ? yield* runtimeIO(() => readFile(join(root, versionFile), "utf8"))
    : (yield* runtimeIO(() => execFileAsync(executable, ["--version"], { encoding: "utf8", windowsHide: true })))
        .stdout;
  if ((yield* runtimeSync(() => descriptor.parseVersion(output))) !== spec.version) {
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.unexpectedVersion")) });
  }
});

/** Bump when `verifyInstalledRuntime` checks something new, so a record from an older build is not trusted. */
const VERIFICATION_RECORD_LAYOUT = 1;

/**
 * `verifyInstalledRuntime`, skipped when no file of the version changed since it last passed.
 *
 * The full check reads and hashes every installed CLI, more than 2 GB with every provider on, and
 * runs each version command: about 1.5 s of every start, before the window could open. A pass writes
 * the size, times and inode of each file beside the version directory. A write to a file changes its
 * ctime, which no process without root can set back, so a changed, added or removed file runs the
 * full check again, and so does a lock or a check that is new. Like the install record, this guards
 * against a damaged or replaced install, not against a writer who can change the record as well.
 * The directory itself is left out: `#stampInUse` changes its times on every start.
 */
const verifyChangedRuntime = Effect.fn("ProviderRuntime.verifyChangedRuntime")(function* (
  root: string,
  spec: RuntimeSpec,
  lock: AgentRuntimeLock,
  isProviderOn: (provider: ManagedProviderId) => boolean,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  const recordPath = verificationRecordPath(root);
  const key = createHash("sha256")
    .update(JSON.stringify([VERIFICATION_RECORD_LAYOUT, spec, lock[spec.runtime]]))
    .digest("hex");
  // A tool runtime and a provider that is on also had their version checked; one that is off did not.
  const versionChecked = isManagedToolRuntime(spec.runtime) || isProviderOn(spec.runtime);
  const before = yield* runtimeFingerprint(root);
  const saved = yield* runtimeIO(() => readFile(recordPath, "utf8")).pipe(
    // A crash can leave the record empty or cut; `runtimeSync` makes that a failure, not a defect.
    Effect.flatMap((text) => runtimeSync(() => parseVerificationRecord(text))),
    Effect.catch(() => Effect.succeed(null)),
  );
  if (
    before !== null &&
    saved?.key === key &&
    (saved.versionChecked || !versionChecked) &&
    saved.files.join("\n") === before.join("\n")
  )
    return;
  yield* verifyInstalledRuntime(root, spec, lock, isProviderOn);
  // A file that changed while it was read is checked again on the next start.
  const after = before === null ? null : yield* runtimeFingerprint(root);
  if (after === null || after.join("\n") !== before?.join("\n")) return;
  const record = `${JSON.stringify({ key, versionChecked, files: after })}\n`;
  const staged = `${recordPath}.${process.pid}-${randomBytes(4).toString("hex")}`;
  // Best effort, as the stamp is: without a record the next start runs the full check.
  yield* runtimeIO(async () => {
    await writeFile(staged, record);
    await rename(staged, recordPath);
  }).pipe(Effect.catch(() => runtimeIO(() => rm(staged, { force: true })).pipe(Effect.ignore)));
});

/** Beside the version directory, so the install record's file count and the collector do not see it. */
function verificationRecordPath(root: string): string {
  return join(dirname(root), `.${basename(root)}.verified.json`);
}

function parseVerificationRecord(text: string): { key: string; versionChecked: boolean; files: string[] } | null {
  const value = JSON.parse(text);
  if (!isDynamicRecord(value) || !isString(value.key) || !isBoolean(value.versionChecked)) return null;
  const files = value.files;
  if (!Array.isArray(files) || !files.every(isString)) return null;
  return { key: value.key, versionChecked: value.versionChecked, files };
}

/** One line per file under `root`, sorted, or `null` when something there is not a plain file or folder. */
const runtimeFingerprint = Effect.fn("ProviderRuntime.runtimeFingerprint")(function* (
  root: string,
  prefix = "",
): Effect.fn.Return<string[] | null, ProviderRuntimeFailure> {
  const lines: string[] = [];
  const entries = yield* runtimeIO(() => readdir(join(root, prefix), { withFileTypes: true }));
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = yield* runtimeFingerprint(root, path);
      if (nested === null) return null;
      lines.push(...nested);
    } else if (entry.isFile()) {
      const info = yield* runtimeIO(() => lstat(join(root, path), { bigint: true }));
      lines.push([path, info.size, info.mtimeNs, info.ctimeNs, info.ino, info.dev].join("\0"));
    } else return null;
  }
  return lines.sort();
});

/**
 * Moves `from` onto `to`, or reports that something already occupies `to`.
 *
 * POSIX answers an occupied directory with `ENOTEMPTY` or `EEXIST`; Windows answers with `EEXIST`,
 * `EPERM` or `EACCES`, the last two also when a file inside it is open. Those two are also what
 * Windows answers when a file inside `from` is still open -- the staged CLI that its own version
 * check has just run, or an antivirus scan of it -- while `to` is vacant. Reading that as occupied
 * sent the commit looking for an install no one had made, and three empty looks ended in "another
 * instance is replacing it" on a computer with one instance. So `to` is looked at: present means
 * occupied, and absent means the source is held, which passes and is waited for. A source still
 * held after the wait answers `false` like an occupied one, so every caller keeps its own reading of
 * what is there; `#commit` is the one that tells the user which of the two it was.
 */
const renameIfVacant = Effect.fn("ProviderRuntime.renameIfVacant")(function* (
  from: string,
  to: string,
  waits: readonly number[] = HELD_SOURCE_WAITS_MS,
): Effect.fn.Return<boolean, ProviderRuntimeFailure> {
  for (let attempt = 0; ; attempt += 1) {
    const renamed = yield* Effect.result(runtimeIO(() => rename(from, to)));
    if (Result.isSuccess(renamed)) return true;
    const code = errorCode(renamed.failure.cause);
    if (code === "ENOTEMPTY" || code === "EEXIST") return false;
    if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") return yield* renamed.failure;
    const wait = waits[attempt];
    if (wait === undefined || (yield* pathExists(to))) return false;
    yield* Effect.sleep(wait);
  }
});
const pathExists = Effect.fn("ProviderRuntime.pathExists")((path: string) =>
  runtimeIO(() => access(path)).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  ),
);

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
const takeLock = Effect.fn("ProviderRuntime.takeLock")(function* (
  lock: string,
): Effect.fn.Return<string | null, ProviderRuntimeFailure> {
  const claim = `${process.pid}-${randomBytes(4).toString("hex")}`;
  if (yield* holdLock(lock, claim)) return claim;
  const abandoned = yield* abandonedClaim(lock);
  if (abandoned === null) return null;
  const aside = join(dirname(lock), `.replaced-claim-${randomBytes(4).toString("hex")}`);
  if (!(yield* renameIfPresent(lock, aside))) return null;
  const moved = yield* readClaim(aside);
  yield* runtimeIO(() => rm(aside, { recursive: true, force: true }).catch(() => undefined));
  // The instance whose fresh claim this moved is shut out by `holdsClaim` before it touches the
  // destination, so the path is left to whoever takes it next, and this attempt is not it.
  if (moved !== abandoned) return null;
  return (yield* holdLock(lock, claim)) ? claim : null;
});

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
const abandonedClaim = Effect.fn("ProviderRuntime.abandonedClaim")(function* (
  lock: string,
): Effect.fn.Return<string | null, ProviderRuntimeFailure> {
  const named = yield* readClaim(lock);
  const held = yield* runtimeIO(() =>
    stat(lock)
      .then((value) => value.mtimeMs)
      .catch(() => null),
  );
  if (held === null || held > Date.now() - STALE_STAGING_MS) return null;
  return named;
});

/** Who a claim names, and the empty string when it names no one. */
const readClaim = Effect.fn("ProviderRuntime.readClaim")(function* (
  lock: string,
): Effect.fn.Return<string, ProviderRuntimeFailure> {
  const held = yield* runtimeIO(() => readFile(join(lock, "claim"), "utf8").catch(() => null));
  return held?.trim() ?? "";
});

/** Whether the claim on the path is still the one this attempt made. */
const holdsClaim = Effect.fn("ProviderRuntime.holdsClaim")(function* (
  lock: string,
  claim: string,
): Effect.fn.Return<boolean, ProviderRuntimeFailure> {
  return (yield* readClaim(lock)) === claim;
});

/** Puts a claim on the path in one move, or reports that another instance is already there. */
const holdLock = Effect.fn("ProviderRuntime.holdLock")(function* (
  lock: string,
  claim: string,
): Effect.fn.Return<boolean, ProviderRuntimeFailure> {
  // Under the swept prefix, so an instance killed between these two steps leaves nothing permanent.
  const staging = join(dirname(lock), `.replaced-claim-${randomBytes(4).toString("hex")}`);
  yield* runtimeIO(() => mkdir(staging, { recursive: true }));
  yield* runtimeIO(() => writeFile(join(staging, "claim"), `${claim}\n`, { mode: 0o600 }));
  if (yield* renameIfVacant(staging, lock)) return true;
  yield* runtimeIO(() => rm(staging, { recursive: true, force: true }).catch(() => undefined));
  return false;
});

/** Removes the claim only while it is still this attempt's. */
const releaseLock = Effect.fn("ProviderRuntime.releaseLock")(function* (
  lock: string,
  claim: string,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  if (!(yield* holdsClaim(lock, claim))) return;
  yield* runtimeIO(() => rm(lock, { recursive: true, force: true }).catch(() => undefined));
});

/** Moves `from` onto `to`, or reports that another instance already took `from` away. */
const renameIfPresent = Effect.fn("ProviderRuntime.renameIfPresent")((from: string, to: string) =>
  runtimeIO(() => rename(from, to)).pipe(
    Effect.as(true),
    Effect.catch((error) => (errorCode(error.cause) === "ENOENT" ? Effect.succeed(false) : Effect.fail(error))),
  ),
);

function errorCode(error: unknown): string | null {
  return error instanceof Error && "code" in error && isString(error.code) ? error.code : null;
}

// The response belongs to the download even when status or metadata checks fail before a reader exists.
function releaseDownloadResponse(response: Response): Effect.Effect<void> {
  return runtimeIO(async () => {
    await response.body?.cancel();
  }).pipe(Effect.catch(() => Effect.void));
}

const streamResponse = Effect.fn("ProviderRuntime.streamResponse")(function* (
  response: Response,
  path: string,
  offset: number,
  signal: AbortSignal,
  onProgress: (received: number) => void,
) {
  const body = response.body;
  if (!body)
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.downloadNoData")) });
  yield* Effect.acquireUseRelease(
    Effect.sync(() => {
      const writer = createWriteStream(path, { flags: offset > 0 ? "a" : "w", mode: 0o600 });
      writer.on("error", () => undefined);
      return { writer, reader: body.getReader() };
    }),
    ({ writer, reader }) =>
      Effect.gen(function* () {
        let received = offset;
        while (true) {
          if (signal.aborted) return yield* new ProviderRuntimeFailure({ cause: abortError() });
          const chunk = yield* runtimeIO(() => reader.read());
          if (chunk.done) break;
          yield* Effect.callback<void, ProviderRuntimeFailure>((resume) => {
            writer.write(chunk.value, (error) =>
              resume(error ? Effect.fail(new ProviderRuntimeFailure({ cause: error })) : Effect.void),
            );
          });
          received += chunk.value.byteLength;
          onProgress(received);
        }
        yield* Effect.callback<void, ProviderRuntimeFailure>((resume) => {
          const onError = (cause: Error) => resume(Effect.fail(new ProviderRuntimeFailure({ cause })));
          writer.once("error", onError);
          writer.end(() => resume(Effect.void));
          return Effect.sync(() => {
            writer.off("error", onError);
          });
        });
      }),
    ({ writer, reader }) =>
      Effect.gen(function* () {
        writer.destroy();
        yield* runtimeIO(() => finished(writer)).pipe(Effect.catch(() => Effect.void));
        yield* runtimeIO(() => reader.cancel()).pipe(Effect.catch(() => Effect.void));
        reader.releaseLock();
      }),
  );
});

const readPartialState = Effect.fn("ProviderRuntime.readPartialState")(function* (
  partialPath: string,
  metadataPath: string,
  spec: RuntimeSpec,
): Effect.fn.Return<{ offset: number; metadata: PartialMetadata | null; complete: boolean }, ProviderRuntimeFailure> {
  const restart = { offset: 0, metadata: null, complete: false };
  const content = yield* Effect.result(
    Effect.all([runtimeIO(() => readFile(metadataPath, "utf8")), runtimeIO(() => stat(partialPath))], {
      concurrency: "unbounded",
    }),
  );
  if (Result.isFailure(content)) return restart;
  const [text, partial] = content.success;
  const decoded = yield* Effect.result(runtimeSync(() => JSON.parse(text)));
  if (Result.isFailure(decoded)) return restart;
  const metadata = decoded.success;
  if (
    !isDynamicRecord(metadata) ||
    !isString(metadata.url) ||
    (metadata.etag !== null && !isString(metadata.etag)) ||
    !isNumber(metadata.expectedBytes) ||
    metadata.url !== spec.url ||
    metadata.expectedBytes !== spec.downloadBytes ||
    partial.size <= 0 ||
    partial.size > spec.downloadBytes
  )
    return restart;
  // Every byte arrived and a later step failed. The caller checks the digest before it uses them.
  if (partial.size === spec.downloadBytes) return { ...restart, complete: true };
  return {
    offset: partial.size,
    metadata: { url: metadata.url, etag: metadata.etag, expectedBytes: metadata.expectedBytes },
    complete: false,
  };
});

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

const fileSize = Effect.fn("ProviderRuntime.fileSize")((path: string) =>
  runtimeIO(() => stat(path)).pipe(
    Effect.map((value) => value.size),
    Effect.catch(() => Effect.succeed(0)),
  ),
);

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
 * A failure as the log may keep it: the name, code and message of each cause, without a stack, and
 * with the home directory written as `~`. The logger redacts secrets again when it writes the line.
 */
function logCause(error: unknown, depth = 0): LogValue {
  if (!(error instanceof Error)) return withoutHome(JSON.stringify(toLogValue(error)) ?? "");
  return {
    name: error.name,
    code: errorCode(error),
    message: withoutHome(redactText(error.message)),
    ...(error.cause !== undefined && depth < 3 ? { cause: logCause(error.cause, depth + 1) } : {}),
  };
}

function withoutHome(text: string): string {
  const home = homedir();
  return home.length > 1 ? text.replaceAll(home, "~") : text;
}

/**
 * A request that got no answer rejects with a bare "fetch failed", and the reason (DNS, TLS, a reset)
 * is only on its `cause`. The failure names the URL and that reason, for the row and the log.
 * A cancel stays an abort, which is how a cancelled download is told apart.
 */
function requestFailure(url: string, error: unknown): ProviderRuntimeFailure {
  if (isAbortError(error)) return new ProviderRuntimeFailure({ cause: error });
  return new ProviderRuntimeFailure({
    cause: new Error(sourceText("error.provider.requestFailed", { url, reason: requestFailureReason(error) }), {
      cause: error,
    }),
  });
}

function requestFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const detail = error.cause;
  if (detail instanceof Error) return detail.message || errorCode(detail) || error.message;
  return error.message;
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

const writeInstallRecord = Effect.fn("ProviderRuntime.writeInstallRecord")(function* (
  root: string,
  spec: RuntimeSpec,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  const files: Record<string, string> = {};
  for (const file of yield* installedFiles(root))
    files[file] = yield* sha256File(join(root, file)).pipe(
      Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
    );
  const record: InstallRecord = {
    layoutVersion: 1,
    runtime: spec.runtime,
    version: spec.version,
    target: spec.target,
    files,
  };
  yield* runtimeIO(() => writeFile(join(root, INSTALL_RECORD), `${JSON.stringify(record)}\n`));
});

/**
 * The install must hold exactly the files in the record, each with the hash it had when installed.
 * A file added later counts as much as a changed one: Codex runs its bundled `zsh`, and a new
 * release can bring files no list written today would name.
 */
const verifyInstallRecord = Effect.fn("ProviderRuntime.verifyInstallRecord")(function* (
  root: string,
  spec: RuntimeSpec,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  const text = yield* runtimeIO(() => readFile(join(root, INSTALL_RECORD), "utf8"));
  const record = yield* runtimeSync(() => JSON.parse(text));
  if (
    !isDynamicRecord(record) ||
    record.layoutVersion !== 1 ||
    record.runtime !== spec.runtime ||
    record.version !== spec.version ||
    record.target !== spec.target ||
    !isDynamicRecord(record.files)
  ) {
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.installRecordMismatch")) });
  }
  const files = yield* installedFiles(root);
  if (files.length !== Object.keys(record.files).length)
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.runtimeChecksum")) });
  for (const file of files) {
    const expected = record.files[file];
    if (
      !isString(expected) ||
      (yield* sha256File(join(root, file)).pipe(
        Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
      )) !== expected
    ) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.runtimeChecksum")) });
    }
  }
});

/** Every file under `root` but the record, as `/`-separated paths. A link or special file fails. */
const installedFiles = Effect.fn("ProviderRuntime.installedFiles")(function* (
  root: string,
  prefix = "",
): Effect.fn.Return<string[], ProviderRuntimeFailure> {
  const files: string[] = [];
  for (const entry of yield* runtimeIO(() => readdir(join(root, prefix), { withFileTypes: true }))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(yield* installedFiles(root, path)));
    else if (!entry.isFile())
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.runtimeSpecialFile")) });
    else if (path !== INSTALL_RECORD) files.push(path);
  }
  return files;
});

const digestMatches = Effect.fn("ProviderRuntime.digestMatches")(function* (path: string, digest: ArchiveDigest) {
  const hash = createHash(digest.algorithm);
  yield* Effect.acquireUseRelease(
    Effect.sync(() => createReadStream(path)),
    (stream) =>
      Stream.fromAsyncIterable(stream, (cause) => new ProviderRuntimeFailure({ cause })).pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            hash.update(chunk);
          }),
        ),
      ),
    (stream) =>
      Effect.sync(() => {
        stream.destroy();
      }),
  );
  return hash.digest("hex") === digest.hex;
});

/** The total size of some directories. One that cannot be measured counts as empty. */
const measurePaths = Effect.fn("ProviderRuntime.measurePaths")(function* (paths: readonly string[]) {
  const sizes = yield* Effect.forEach(
    paths,
    (path) =>
      measureTree(path).pipe(
        Effect.map((size) => size.bytes),
        Effect.catch(() => Effect.succeed(0)),
      ),
    { concurrency: 4 },
  );
  return sizes.reduce((total, bytes) => total + bytes, 0);
});

const removeStaleRuntimeDirectory = Effect.fn("ProviderRuntime.removeStaleDirectory")(function* (
  path: string,
  stale: number,
) {
  const modified = yield* runtimeIO(() => stat(path)).pipe(
    Effect.map((value) => value.mtimeMs),
    Effect.catch(() => Effect.succeed(Number.POSITIVE_INFINITY)),
  );
  if (modified > stale) return;
  yield* runtimeIO(() => rm(path, { recursive: true, force: true })).pipe(Effect.catch(() => Effect.void));
});
