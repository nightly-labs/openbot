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
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Result, Scope, Stream } from "effect";
import lockValue from "../../native-runtime.lock.json";
import { type AgentRuntimeLock, parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import { type BundledProviderExecutables, configuredCliPath } from "../backend/cli";
import { runCauseEffect } from "../backend/effect-boundary";
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
/** How long a first install waits for the release check before it takes the pinned version. */
const RELEASE_CHECK_WAIT_MS = 10_000;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type PartialMetadata = { url: string; etag: string | null; expectedBytes: number };
interface ProviderRuntimeManagerEvents {
  status: [snapshot: ProviderRuntimeSnapshot];
  ready: [runtime: ManagedRuntimeId];
}

export interface ProviderRuntimeManagerOptions {
  /** An off provider must not run even for a managed runtime version check. */
  isProviderOn?: (provider: ManagedProviderId) => boolean;
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
  updateRuntime?: (
    runtime: ManagedRuntimeId,
    install: () => Effect.Effect<string, ProviderRuntimeFailure>,
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
  readonly #isProviderOn: (provider: ManagedProviderId) => boolean;
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
  readonly #updateRuntime: (
    runtime: ManagedRuntimeId,
    install: () => Effect.Effect<string, ProviderRuntimeFailure>,
  ) => Effect.Effect<void, ProviderRuntimeFailure>;
  #blocked: BlockedVersions = new Map();
  #check: Deferred.Deferred<void, ProviderRuntimeFailure> | null = null;
  readonly #scope = Scope.makeUnsafe();
  #checkTimer: NodeJS.Timeout | null = null;
  #revision = 0;
  #stopping = false;

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
      const target = this.#target;
      if (target) {
        // Settled, not all: collecting an old version is housekeeping, and a version another instance
        // still runs refuses to be removed on Windows. Neither may stop the app from starting.
        yield* Effect.forEach(
          RUNTIMES,
          (runtime) => Effect.result(this.#removeOldVersionsEffect(runtimeSpec(runtime, target, this.#lock))),
          { concurrency: "unbounded", discard: true },
        );
      }
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
        providers[provider].availableVersion = offer && !configuredCliPath(provider) ? version : null;
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

  /** Checks now and then every hour, until `stop`. The caller starts it once the app is up. */
  startUpdateChecks(intervalMs = UPDATE_CHECK_INTERVAL_MS): void {
    if (this.#checkTimer || !this.#target || this.#stopping) return;
    const check = () => void runCauseEffect(this.checkForUpdates()).catch(() => undefined);
    this.#checkTimer = setInterval(check, intervalMs);
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
      this.#revision += 1;
      this.emit("status", this.getStatus());
      if (releases.every(Result.isFailure))
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.releaseSourcesUnreachable")),
        });
    });
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
      const spec = this.#targetSpec(runtime, this.#target);
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
            return this.#handleDownloadFailure(runtime, error.cause);
          }),
          Effect.ensuring(
            Effect.sync(() => {
              this.#controllers.delete(runtime);
              this.#tasks.delete(runtime);
              this.#transfers.delete(runtime);
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
        if (!(yield* this.#verifiesEffect(installRoot, spec))) continue;
        yield* this.#stampInUseEffect(installRoot);
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
        yield* this.#stampInUseEffect(installRoot);
        return readyStatus(spec.version);
      }
      return { ...emptyStatus(), version: yield* this.#previousVersionEffect(spec) };
    });
  }
  #updateProviderRuntime(spec: RuntimeSpec, signal: AbortSignal): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const installed = yield* this.#readStoreEffect(spec);
      if (installed.phase === "ready") {
        yield* this.#activateEffect(spec, null);
        return;
      }
      if (this.#stopping)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
      yield* runtimeSync(() => signal.throwIfAborted());
      this.#setStatus(spec.runtime, { phase: "downloading", progress: 0, message: null, version: installed.version });
      yield* this.#activateEffect(spec, signal);
    });
  }

  // Keep the last installed version available while its replacement is downloaded.

  #previousVersionEffect(spec: RuntimeSpec): Effect.Effect<string | null, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<string | null, ProviderRuntimeFailure> {
      const targetRoot = dirname(this.#installRoot(spec));
      const entries = yield* runtimeIO(async () => await readdir(targetRoot, { withFileTypes: true }).catch(() => []));
      const versions = entries
        .filter((entry) => entry.isDirectory() && olderVersion(entry.name, spec.version))
        .map((entry) => entry.name)
        .sort((a, b) => compareReleases(b, a));
      for (const version of versions) {
        const executable = yield* runtimeIO(
          async () => await stat(join(targetRoot, version, "bin", spec.executableName)).catch(() => null),
        );
        if (!executable?.isFile()) continue;
        // This is the CLI the agent service runs until the newer one arrives, so it is in use and
        // the collector in every other instance has to leave it alone. A worktree that pins a newer
        // version would otherwise take it away while this one is running from it.
        yield* this.#stampInUseEffect(join(targetRoot, version));
        return version;
      }
      return null;
    });
  }

  /** The one record a sibling instance can read: this version is in use, so keep it. */

  #stampInUseEffect(installRoot: string): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const now = new Date();
      // Best effort -- a store on a read-only volume still works, it only ages.
      yield* runtimeIO(async () => await utimes(installRoot, now, now).catch(() => undefined));
    });
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

  #activateEffect(spec: RuntimeSpec, signal: AbortSignal | null): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* () {
      let installed = false;
      const result = yield* Effect.result(
        this.#updateRuntime(spec.runtime, () =>
          Effect.gen({ self: this }, function* () {
            if (signal) {
              installed = yield* this.#runDownloadEffect(spec, signal);
              yield* this.#removePartialEffect(spec);
            }
            return join(this.#installRoot(spec), "bin", spec.executableName);
          }),
        ),
      );
      if (Result.isFailure(result)) {
        if (installed) yield* runtimeIO(() => rm(this.#installRoot(spec), { recursive: true, force: true }));
        return yield* result.failure;
      }
      this.#setStatus(spec.runtime, readyStatus(spec.version));
      this.emit("ready", spec.runtime);
    });
  }

  /** Answers whether this instance is the one that put the install in the store. */

  #runDownloadEffect(spec: RuntimeSpec, signal: AbortSignal): Effect.Effect<boolean, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<boolean, ProviderRuntimeFailure, Scope.Scope> {
      yield* runtimeIO(async () => await mkdir(this.#downloadRoot(), { recursive: true }));
      yield* this.#requireDiskSpaceEffect(spec);
      const partialPath = this.#partialPath(spec);
      const metadataPath = this.#partialMetadataPath(spec);
      const previous = yield* readPartialState(partialPath, metadataPath, spec);
      // No digest is Grok's upstream release, which x.ai publishes no hash for and TLS alone vouches for.
      const digest = spec.archiveDigest;
      // An earlier attempt can get every byte and then fail while it stages them. A Retry installs
      // those bytes when they still verify, instead of downloading them again.
      if (previous.complete && digest && (yield* digestMatches(partialPath, digest))) {
        this.#setFinishing(spec.runtime);
        return yield* this.#installEffect(spec, partialPath);
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
  #handleDownloadFailure(runtime: ManagedRuntimeId, error: unknown): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.sync(() => {
      if (this.#cancelled.has(runtime)) return;
      if (this.#stopping && isAbortError(error)) return;
      // The screen shows the reason only in the row. A support report then has the log alone.
      if (!isAbortError(error)) logger.warn(`OpenBot could not install the ${runtime} runtime.`, toLogValue(error));
      const message = isAbortError(error)
        ? sourceText("status.provider.downloadStopped")
        : error instanceof Error
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
   * Collects versions no one has any use for.
   *
   * Rank alone decided this when the store belonged to one profile. It is now the computer's, and
   * another instance -- the released app beside a development build, or a worktree whose lock pins
   * a different version -- may be running from a directory this build ranks last. `#inspect` stamps
   * whatever it verifies on every start, so a version in use anywhere stays recent, and only a tree
   * nothing has opened for a month is collected.
   */

  #removeOldVersionsEffect(spec: RuntimeSpec): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const targetRoot = join(this.#runtimeRoot(spec.runtime), spec.target);
      const entries = yield* runtimeIO(async () => await readdir(targetRoot, { withFileTypes: true }).catch(() => []));
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
      yield* Effect.forEach(
        versions.filter((version) => !keep.has(version)),
        (version) => removeStaleRuntimeDirectory(join(targetRoot, version), stale),
        { concurrency: "unbounded", discard: true },
      );
    });
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

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:(?:-\d{2}-\d{2}-\d{2})?-[0-9a-f]{7,40})?$/u.test(value);
}

/**
 * A commit orders nothing, so two Cursor builds of the same date and time, or of the same date with
 * no time, are neither older nor newer.
 */
function olderVersion(installed: string, target: string): boolean {
  return isVersion(installed) && isVersion(target) && compareReleases(installed, target) < 0;
}

function compareReleases(a: string, b: string): number {
  const release = (version: string) => version.replace(/-[0-9a-f]{7,40}$/u, "").replaceAll("-", ".");
  return release(a).localeCompare(release(b), "en", { numeric: true });
}

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
