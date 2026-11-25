import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  statfs,
  utimes,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import {
  type AgentProviderId,
  type AgentProviderRef,
  agentProviderDescriptor,
  type CustomProviderHarness,
  type InstallerProviderId,
  isKeyOnlyProvider,
  isManagedToolRuntime,
  KEY_ONLY_PROVIDERS,
  MANAGED_RUNTIME_PROVIDERS,
  MANAGED_TOOL_RUNTIMES,
  type ManagedProviderId,
  type ManagedRuntimeId,
  type McpServerConfig,
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
import { reportsMissingProcessorFeature, unsupportedKernelReason } from "../backend/agent-client";
import {
  type BundledProviderExecutables,
  compareReleases,
  configuredCliPath,
  isVersion,
  olderVersion,
  resolveOpencodeCli,
  resolvePiCli,
} from "../backend/cli";
import { runCauseEffect } from "../backend/effect-boundary";
import { sha256File } from "../backend/file-hash";
import { type McpToolRuntimes, NO_MCP_TOOL_RUNTIMES } from "../backend/mcp-provider-shapes";
import { measureTree } from "../backend/storage-usage";
import type { HermesInstaller } from "./hermes-installer";
import { isSafeLinkTarget } from "./provider-runtime-archive";
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
const RUNTIMES = [...MANAGED_RUNTIME_PROVIDERS, ...MANAGED_TOOL_RUNTIMES] as const;
const FREE_SPACE_HEADROOM = 100_000_000;
const DISK_FULL_OUTPUT = /no space left on device|not enough space on the disk/iu;
const STALE_STAGING_MS = 6 * 60 * 60 * 1000;
const VERSION_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const OWN_STAMP_PRECISION_MS = 1;
const COMMIT_ATTEMPTS = 3;
const DOWNLOAD_STALL_MS = 60_000;
const HELD_SOURCE_WAITS_MS: readonly number[] = [100, 200, 400, 800];
const HELD_STAGE_WAIT_MS = 60_000;
const STAGING_PREFIXES = [".staging-", ".installing-", ".replaced-"];
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const AWAKE_RETENTION_CHECKS = 3;
const RELEASE_CHECK_WAIT_MS = 10_000;

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type PartialMetadata = { url: string; etag: string | null; expectedBytes: number };
type RuntimeTaskStage = "prepare" | "download" | "verify" | "install" | "activate";
interface ProviderRuntimeManagerEvents {
  status: [snapshot: ProviderRuntimeSnapshot];
  ready: [runtime: ManagedRuntimeId];
}

export interface ProviderRuntimeManagerOptions {
  isProviderOn?: (provider: AgentProviderId) => boolean;
  root: string;
  downloadRoot?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  fetchImpl?: Fetch;
  lock?: AgentRuntimeLock;
  availableDiskBytes?: () => Promise<number>;
  heldStageWaitMs?: number;
  hermesInstaller?: HermesInstaller;
  heldSourceWaitsMs?: readonly number[];
  updateRuntime?: (
    runtime: ManagedRuntimeId,
    install: () => Effect.Effect<string, ProviderRuntimeFailure>,
    signal: AbortSignal,
    onWait: () => void,
  ) => Effect.Effect<void, ProviderRuntimeFailure>;
}

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
  #isCatalogNpxApp: (config: McpServerConfig) => boolean = () => false;
  readonly #fetch: Fetch;
  readonly #lock: AgentRuntimeLock;
  readonly #availableDiskBytes: () => Promise<number>;
  readonly #heldStageWaitMs: number;
  readonly #heldSourceWaitsMs: readonly number[];
  readonly #hermesInstaller: HermesInstaller | null;
  readonly #statuses: Record<ManagedRuntimeId, ProviderRuntimeStatus>;
  readonly #controllers = new Map<ManagedRuntimeId, AbortController>();
  readonly #tasks = new Map<ManagedRuntimeId, Fiber.Fiber<void, ProviderRuntimeFailure>>();
  readonly #cancelled = new Set<ManagedRuntimeId>();
  readonly #systemVersions = new Map<ManagedProviderId, string>();
  readonly #incompleteSystemClis = new Set<ManagedProviderId>();
  readonly #rejected = new Set<ManagedRuntimeId>();
  readonly #latest = new Map<ManagedProviderId, RuntimeSpec>();
  readonly #transfers = new Map<ManagedRuntimeId, RuntimeSpec>();
  readonly #stages = new Map<ManagedRuntimeId, RuntimeTaskStage>();
  readonly #removals = new Map<ManagedProviderId, Fiber.Fiber<boolean>>();
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
  #awakeSince = 0;
  #checkRetentionMs = VERSION_RETENTION_MS;
  #revision = 0;
  #stopping = false;
  readonly #declined = new Map<ManagedRuntimeId, string>();

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
    this.#hermesInstaller = options.hermesInstaller ?? null;
    this.#hermesInstaller?.on("status", () => {
      this.#revision += 1;
      this.emit("status", this.getStatus());
    });
    const unsupportedMessage = this.#target ? null : "This platform is not supported.";
    this.#statuses = {
      codex: emptyStatus(unsupportedMessage),
      claude: emptyStatus(unsupportedMessage),
      grok: emptyStatus(unsupportedMessage),
      opencode: emptyStatus(unsupportedMessage),
      antigravity: emptyStatus(unsupportedMessage),
      cursor: emptyStatus(unsupportedMessage),
      cline: emptyStatus(unsupportedMessage),
      kimi: emptyStatus(unsupportedMessage),
      pi: emptyStatus(unsupportedMessage),
      muse: emptyStatus(unsupportedMessage),
      devin: emptyStatus(unsupportedMessage),
      copilot: emptyStatus(unsupportedMessage),
      mistral: emptyStatus(unsupportedMessage),
      bun: emptyStatus(unsupportedMessage),
    };
  }
  initialize(): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      yield* runtimeIO(async () => await mkdir(this.#root, { recursive: true }));
      yield* this.#removeAbandonedStagingEffect();
      yield* Effect.forEach(RUNTIMES, (runtime) => this.#inspectEffect(runtime, true), {
        concurrency: "unbounded",
        discard: true,
      });
      if (this.#target) {
        const stale = Date.now() - VERSION_RETENTION_MS;
        const paths = yield* this.#oldVersionPathsEffect(this.#target, stale, true);
        yield* Effect.forkIn(this.#removeOldVersionPathsEffect(paths, stale), this.#scope);
      }
      return this.getStatus();
    });
  }

  getStatus(): ProviderRuntimeSnapshot {
    const { bun, ...providers } = structuredClone(this.#statuses);
    if (this.#target) {
      for (const provider of PROVIDERS) {
        const version = this.#targetSpec(provider, this.#target).version;
        const system = this.#systemVersions.get(provider);
        const copy = providers[provider].phase === "ready" ? providers[provider].version : null;
        const installed = system && copy && olderVersion(system, copy) ? copy : (system ?? providers[provider].version);
        const missingCopy = this.#incompleteSystemClis.has(provider) && copy === null;
        const offer =
          missingCopy || (installed !== null && installed !== undefined && olderVersion(installed, version));
        const automatic = this.#updatesAutomatically(provider, this.#target);
        providers[provider].availableVersion =
          offer && !configuredCliPath(provider) && !automatic && this.#isProviderOn(provider) ? version : null;
      }
    }
    const hermes = this.#hermesInstaller?.status();
    return {
      revision: this.#revision,
      providers: hermes ? { ...providers, hermes } : providers,
      toolRuntimes: { bun },
    };
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

  removeOldVersions(): Effect.Effect<void> {
    return this.#target ? this.#collectVersionsEffect(this.#target, this.#removalRetentionMs()) : Effect.void;
  }

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

  measureDownload(provider: ManagedProviderId): Effect.Effect<ProviderRuntimeDownload> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#target || this.#cliInUse(provider) || configuredCliPath(provider)) return { bytes: 0, versions: 0 };
      const paths = yield* this.#removableVersionPathsEffect(provider, this.#target);
      return { bytes: yield* measurePaths(paths), versions: paths.length };
    });
  }

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

  #cliInUse(runtime: ManagedRuntimeId): boolean {
    if (isManagedToolRuntime(runtime)) return true;
    if (this.#isProviderOn(runtime) && !this.#systemVersions.has(runtime)) return true;
    return runtime === "pi" && KEY_ONLY_PROVIDERS.some((provider) => this.#isProviderOn(provider));
  }

  #removalRetentionMs(): number {
    return this.#lastCheckAt !== null && Date.now() - this.#lastCheckAt < this.#checkIntervalMs
      ? this.#checkRetentionMs
      : VERSION_RETENTION_MS;
  }

  startUpdateChecks(options: { intervalMs?: number } = {}): void {
    if (this.#checkTimer || !this.#target || this.#stopping) return;
    this.#checkIntervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
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
      yield* this.#startAutomaticUpdates(target);
      yield* Effect.forEach(
        this.#stopping ? [] : PROVIDERS.filter((provider) => !this.#tasks.has(provider)),
        (provider) => this.#removeBlockedCopiesEffect(provider, target),
        { discard: true },
      );
      const repairs = PROVIDERS.filter(
        (provider) =>
          this.#rejected.has(provider) &&
          this.#statuses[provider].phase === "not-downloaded" &&
          this.#cliInUse(provider) &&
          !configuredCliPath(provider),
      );
      this.#rejected.clear();
      yield* Effect.forEach(
        this.#stopping ? [] : repairs,
        (provider) => Effect.ignore(this.#startDownload(provider, target)),
        { discard: true },
      );
      this.#revision += 1;
      this.emit("status", this.getStatus());
      const now = Date.now();
      if (this.#lastCheckAt === null || now - this.#lastCheckAt > 1.5 * this.#checkIntervalMs) this.#awakeSince = now;
      this.#lastCheckAt = now;
      const awake = now - this.#awakeSince >= this.#checkIntervalMs;
      this.#checkRetentionMs = awake ? AWAKE_RETENTION_CHECKS * this.#checkIntervalMs : VERSION_RETENTION_MS;
      yield* Effect.forkIn(this.#collectVersionsEffect(target, this.#checkRetentionMs), this.#scope);
      if (releases.every(Result.isFailure))
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.releaseSourcesUnreachable")),
        });
    });
  }

  #startAutomaticUpdates(target: RuntimeTarget): Effect.Effect<void> {
    return Effect.forEach(
      this.#stopping ? [] : PROVIDERS.filter((provider) => this.#updatesAutomatically(provider, target)),
      (provider) => Effect.ignore(this.#startDownload(provider, target)),
      { discard: true },
    );
  }

  #updatesAutomatically(provider: ManagedProviderId, target: RuntimeTarget): boolean {
    const { phase, version } = this.#statuses[provider];
    const offered = this.#targetSpec(provider, target).version;
    return (
      this.#checkTimer !== null &&
      this.#declined.get(provider) !== offered &&
      (phase === "ready" || phase === "not-downloaded") &&
      version !== null &&
      (olderVersion(version, offered) || (version !== offered && this.#isBlocked(provider, version))) &&
      !this.#systemVersions.has(provider) &&
      !configuredCliPath(provider) &&
      this.#isProviderOn(provider)
    );
  }

  #isBlocked(runtime: ManagedRuntimeId, version: string): boolean {
    return !isManagedToolRuntime(runtime) && (this.#blocked.get(runtime)?.has(version) ?? false);
  }

  #removeBlockedCopiesEffect(runtime: ManagedRuntimeId, target: RuntimeTarget): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const targetRoot = dirname(this.#installRoot(runtimeSpec(runtime, target, this.#lock)));
      const versions = yield* runtimeIO(async () => await readdir(targetRoot).catch(() => []));
      const blocked = versions.filter(
        (version) => version !== this.#statuses[runtime].version && this.#isBlocked(runtime, version),
      );
      const unused = yield* Effect.forEach(blocked, (version) => {
        const path = join(targetRoot, version);
        return this.#stampedBySiblingEffect(path).pipe(Effect.map((inUse) => (inUse ? [] : [path])));
      });
      yield* this.#removeOldVersionPathsEffect(unused.flat(), Number.POSITIVE_INFINITY);
    }).pipe(Effect.catch(() => Effect.void));
  }

  #targetSpec(runtime: ManagedRuntimeId, target: RuntimeTarget): RuntimeSpec {
    const pinned = runtimeSpec(runtime, target, this.#lock);
    if (isManagedToolRuntime(runtime)) return pinned;
    const latest = this.#latest.get(runtime);
    if (!latest || this.#blocked.get(runtime)?.has(latest.version) || !olderVersion(pinned.version, latest.version)) {
      return pinned;
    }
    return latest;
  }

  setSystemVersion(provider: ManagedProviderId, version: string | null, incomplete = false): boolean {
    const previous = this.#systemVersions.get(provider) ?? null;
    const flagged = Boolean(version) && incomplete;
    if (previous === version && flagged === this.#incompleteSystemClis.has(provider)) return false;
    if (flagged) this.#incompleteSystemClis.add(provider);
    else this.#incompleteSystemClis.delete(provider);
    if (version) this.#systemVersions.set(provider, version);
    else this.#systemVersions.delete(provider);
    if (version && !flagged) this.#clearFailureCoveredBySystemCli(provider, version);
    this.#revision += 1;
    this.emit("status", this.getStatus());
    return previous !== null && version === null;
  }

  #clearFailureCoveredBySystemCli(provider: ManagedProviderId, systemVersion: string): void {
    const target = this.#target;
    if (!target || this.#stopping || this.#tasks.has(provider)) return;
    if (this.#statuses[provider].phase !== "download-error") return;
    if (olderVersion(systemVersion, this.#targetSpec(provider, target).version)) return;
    const reinspect = Effect.gen({ self: this }, function* () {
      if (this.#tasks.has(provider) || this.#statuses[provider].phase !== "download-error") return;
      this.#setStatus(provider, yield* this.#inspectEffect(provider));
    }).pipe(Effect.ignore);
    void runCauseEffect(Effect.forkIn(reinspect, this.#scope)).catch(() => undefined);
  }

  providerUseChanged(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      for (const provider of PROVIDERS) {
        const executable = this.executablePath(provider);
        if (!executable || !this.#cliInUse(provider) || this.#tasks.has(provider)) continue;
        if (yield* pathExists(executable)) {
          yield* this.#stampInUseEffect(provider, dirname(dirname(executable))).pipe(Effect.ignore);
        } else if (this.#statuses[provider].phase === "ready") {
          yield* this.#inspectEffect(provider).pipe(Effect.ignore);
        }
      }
      const target = this.#target;
      const check = this.#check;
      if (target && check) {
        yield* Effect.forkIn(
          this.#awaitReleaseCheck(check).pipe(Effect.andThen(this.#startAutomaticUpdates(target))),
          this.#scope,
        );
      } else if (target) yield* this.#startAutomaticUpdates(target);
      this.#revision += 1;
      this.emit("status", this.getStatus());
    });
  }

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

  ensureToolRuntimes(): Effect.Effect<void> {
    return Effect.forEach(MANAGED_TOOL_RUNTIMES, (tool) => this.download(tool).pipe(Effect.ignore), { discard: true });
  }
  ensureToolRuntimesReady(): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      for (const tool of MANAGED_TOOL_RUNTIMES) yield* this.downloadAndWait(tool);
    });
  }

  mcpToolRuntimes(): McpToolRuntimes {
    const target = this.#target;
    if (!target) return NO_MCP_TOOL_RUNTIMES;
    const executable = this.#statuses.bun.phase === "ready" ? this.executablePath("bun") : null;
    const bunx = executable ? join(dirname(executable), bunxExecutableName(target)) : null;
    const isCatalogNpxApp = this.#isCatalogNpxApp;
    const catalogCommand: McpToolRuntimes["catalogCommand"] = (config) => {
      if (!isCatalogNpxApp(config)) return null;
      return bunx ? { command: bunx, args: ["--bun"] } : "pending";
    };
    if (!(executable && bunx)) return { ...NO_MCP_TOOL_RUNTIMES, catalogCommand };
    return { binDirectories: [dirname(executable)], commandAliases: { npx: bunx }, catalogCommand };
  }

  setCatalogNpxApps(isCatalogNpxApp: (config: McpServerConfig) => boolean): void {
    this.#isCatalogNpxApp = isCatalogNpxApp;
  }
  download(
    runtime: ManagedRuntimeId | InstallerProviderId,
  ): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      if (runtime === "hermes") {
        if (!this.#hermesInstaller)
          return yield* new ProviderRuntimeFailure({
            cause: new Error(sourceText("error.provider.runtimesUnsupported")),
          });
        yield* this.#hermesInstaller.install();
        return this.getStatus();
      }
      if (!this.#target)
        return yield* new ProviderRuntimeFailure({
          cause: new Error(sourceText("error.provider.runtimesUnsupported")),
        });
      if (this.#stopping)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
      if (!isManagedToolRuntime(runtime) && configuredCliPath(runtime))
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.cliOverride")) });
      if (this.#tasks.has(runtime)) return this.getStatus();
      if (!(isManagedToolRuntime(runtime) || this.#latest.has(runtime))) {
        if (this.#check) yield* this.#awaitReleaseCheck(this.#check);
        else if (this.#checkTimer && this.#statuses[runtime].version === null)
          yield* this.#findLatestRelease(runtime, this.#target);
        if (this.#stopping)
          return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
        if (this.#tasks.has(runtime)) return this.getStatus();
      }
      return yield* this.#startDownload(runtime, this.#target);
    });
  }

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
      if (
        current.version &&
        !olderVersion(current.version, spec.version) &&
        !(current.version !== spec.version && this.#isBlocked(runtime, current.version))
      ) {
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

  #awaitReleaseCheck(
    check: Deferred.Deferred<void, ProviderRuntimeFailure>,
  ): Effect.Effect<void, ProviderRuntimeFailure> {
    return Deferred.await(check).pipe(
      Effect.catch(() => Effect.void),
      Effect.timeoutOrElse({ duration: RELEASE_CHECK_WAIT_MS, orElse: () => Effect.void }),
    );
  }
  #findLatestRelease(provider: ManagedProviderId, target: RuntimeTarget): Effect.Effect<void> {
    const lookups = [
      fetchBlockedVersions(this.#fetch).pipe(
        Effect.tap((blocked) =>
          Effect.sync(() => {
            this.#blocked = blocked;
          }),
        ),
      ),
      latestRelease(provider, { target, lock: this.#lock, fetch: this.#fetch }).pipe(
        Effect.tap((release) => Effect.sync(() => this.#latest.set(provider, release))),
      ),
    ];
    return Effect.forEach(lookups, (lookup) => Effect.ignore(lookup), { concurrency: "unbounded", discard: true }).pipe(
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
  ensureKeyProviderCli(provider: AgentProviderRef): Effect.Effect<void, ProviderRuntimeFailure> {
    if (!isKeyOnlyProvider(provider)) return Effect.void;
    const removal = this.#removals.get("pi");
    return (removal ? Fiber.await(removal) : Effect.void).pipe(
      Effect.andThen(resolvePiCli({ bundledExecutable: this.executablePath("pi") })),
      Effect.asVoid,
      Effect.catch(() => this.downloadAndWait("pi")),
    );
  }
  startKeyProviderCli(provider: AgentProviderRef): Effect.Effect<boolean, ProviderRuntimeFailure> {
    if (!isKeyOnlyProvider(provider)) return Effect.succeed(false);
    return this.#startMissingCli("pi");
  }
  startCustomProviderHarness(harness: CustomProviderHarness): Effect.Effect<void> {
    if (!this.#isProviderOn(harness)) return Effect.void;
    return this.#startMissingCli(harness).pipe(Effect.ignore, Effect.forkIn(this.#scope), Effect.asVoid);
  }
  #startMissingCli(provider: CustomProviderHarness): Effect.Effect<boolean, ProviderRuntimeFailure> {
    const resolveCli = provider === "pi" ? resolvePiCli : resolveOpencodeCli;
    return Effect.suspend(() => {
      const removal = this.#removals.get(provider);
      return removal ? Fiber.await(removal) : Effect.void;
    }).pipe(
      Effect.andThen(Effect.suspend(() => resolveCli({ bundledExecutable: this.executablePath(provider) }))),
      Effect.as(false),
      Effect.catch(() =>
        this.download(provider).pipe(
          Effect.map((snapshot) => ["downloading", "finishing"].includes(snapshot.providers[provider].phase)),
        ),
      ),
    );
  }
  cancel(
    runtime: ManagedRuntimeId | InstallerProviderId,
  ): Effect.Effect<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeSnapshot, ProviderRuntimeFailure> {
      if (runtime === "hermes") {
        if (this.#hermesInstaller) yield* this.#hermesInstaller.cancel();
        return this.getStatus();
      }
      if (this.#statuses[runtime].phase !== "downloading") return this.getStatus();
      const task = this.#tasks.get(runtime);
      const spec = this.#transfers.get(runtime);
      this.#cancelled.add(runtime);
      if (spec) this.#declined.set(runtime, spec.version);
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
      if (this.#hermesInstaller) yield* this.#hermesInstaller.stop();
      yield* Effect.forEach(this.#tasks.values(), Fiber.await, { concurrency: "unbounded", discard: true });
      yield* Effect.forEach(this.#removals.values(), Fiber.await, { concurrency: "unbounded", discard: true });
      yield* Scope.close(this.#scope, Exit.void);
    });
  }

  #inspectEffect(
    runtime: ManagedRuntimeId,
    atStart = false,
  ): Effect.Effect<ProviderRuntimeStatus, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<ProviderRuntimeStatus, ProviderRuntimeFailure> {
      if (!this.#target) return this.#statuses[runtime];
      const pinned = runtimeSpec(runtime, this.#target, this.#lock);
      const { installed, rejected } = yield* this.#newestInstalledEffect(pinned);
      if (atStart && !installed && rejected) this.#rejected.add(runtime);
      this.#statuses[runtime] = installed
        ? readyStatus(installed)
        : { ...emptyStatus(), version: yield* this.#previousVersionEffect(pinned) };
      return this.#statuses[runtime];
    });
  }

  #newestInstalledEffect(
    pinned: RuntimeSpec,
  ): Effect.Effect<{ installed: string | null; rejected: boolean }, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      { installed: string | null; rejected: boolean },
      ProviderRuntimeFailure
    > {
      const targetRoot = dirname(this.#installRoot(pinned));
      const entries = yield* runtimeIO(async () => await readdir(targetRoot, { withFileTypes: true }).catch(() => []));
      const versions = entries
        .filter((entry) => entry.isDirectory() && isVersion(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => compareReleases(b, a) || Number(b === pinned.version) - Number(a === pinned.version));
      let rejected = false;
      for (const version of versions) {
        const spec = version === pinned.version ? pinned : recordedSpec(pinned, version);
        const installRoot = join(targetRoot, version);
        const failure = yield* verifyChangedRuntime(installRoot, spec, this.#lock, this.#isProviderOn).pipe(
          Effect.as(null),
          Effect.catch((error) => Effect.succeed(error)),
        );
        if (failure) {
          const checkable =
            version === pinned.version ||
            (!olderVersion(version, pinned.version) && (yield* pathExists(join(installRoot, INSTALL_RECORD))));
          if (checkable) {
            rejected = true;
            logger.warn("Provider runtime check failed.", {
              runtime: pinned.runtime,
              version,
              cause: logCause(failure.cause),
            });
          }
          continue;
        }
        yield* this.#stampInUseEffect(pinned.runtime, installRoot);
        return { installed: version, rejected };
      }
      return { installed: null, rejected };
    });
  }

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
      const previous = this.#statuses[spec.runtime].version;
      const installed = yield* this.#readStoreEffect(spec);
      if (installed.phase !== "ready") {
        if (this.#stopping)
          return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.closing")) });
        yield* runtimeSync(() => signal.throwIfAborted());
        this.#setStatus(spec.runtime, { phase: "downloading", progress: 0, message: null, version: installed.version });
      }
      yield* this.#activateEffect(spec, signal, installed.phase !== "ready");
      if (previous && previous !== spec.version && this.#isBlocked(spec.runtime, previous))
        yield* this.#removeBlockedCopiesEffect(spec.runtime, spec.target);
    });
  }

  #previousVersionEffect(spec: RuntimeSpec): Effect.Effect<string | null, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<string | null, ProviderRuntimeFailure> {
      const targetRoot = dirname(this.#installRoot(spec));
      const version = yield* this.#workingBackupEffect(targetRoot, spec, spec.version);
      if (version) yield* this.#stampInUseEffect(spec.runtime, join(targetRoot, version));
      return version;
    });
  }

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
      const names = [spec.executableName, ...(providerRuntimeDescriptor(spec.runtime).legacyExecutableNames ?? [])];
      for (const candidate of versions) {
        for (const name of names) {
          const executable = yield* runtimeIO(
            async () => await stat(join(targetRoot, candidate, "bin", name)).catch(() => null),
          );
          if (executable?.isFile()) return candidate;
        }
      }
      return null;
    });
  }

  #stampInUseEffect(runtime: ManagedRuntimeId, installRoot: string): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
      if (!this.#cliInUse(runtime)) return;
      const now = new Date();
      const stamped = yield* runtimeIO(async () =>
        utimes(installRoot, now, now).then(
          () => true,
          () => false,
        ),
      );
      if (stamped) this.#ownStamps.set(installRoot, now.getTime());
    });
  }

  #activateEffect(
    spec: RuntimeSpec,
    signal: AbortSignal,
    download: boolean,
  ): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* () {
      let installed = false;
      const result = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          if (download) installed = yield* this.#runDownloadEffect(spec, signal);
          yield* this.#updateRuntime(
            spec.runtime,
            () =>
              Effect.sync(() => {
                const status = this.#statuses[spec.runtime];
                if (download) this.#setFinishing(spec.runtime);
                else if (status.message !== null) this.#setStatus(spec.runtime, { ...status, message: null });
                this.#stages.set(spec.runtime, "activate");
                return join(this.#installRoot(spec), "bin", spec.executableName);
              }),
            signal,
            () => {
              const status = this.#statuses[spec.runtime];
              this.#setStatus(spec.runtime, {
                ...status,
                ...(download ? { phase: "downloading" as const, progress: 100 } : {}),
                message: sourceText("status.provider.updateWaiting"),
              });
            },
          );
        }),
      );
      if (Result.isFailure(result)) {
        if (installed && !this.#stopping) {
          const installRoot = this.#installRoot(spec);
          if (signal.aborted || (yield* this.#workingBackupEffect(dirname(installRoot), spec, spec.version)))
            yield* runtimeIO(() => rm(installRoot, { recursive: true, force: true }));
          else yield* this.#removeRuntimePartialsEffect(spec.runtime, spec.target);
        }
        return yield* result.failure;
      }
      if (download) yield* this.#removeRuntimePartialsEffect(spec.runtime, spec.target);
      yield* this.#stampInUseEffect(spec.runtime, this.#installRoot(spec));
      this.#setStatus(spec.runtime, readyStatus(spec.version));
      this.emit("ready", spec.runtime);
    });
  }

  #runDownloadEffect(spec: RuntimeSpec, signal: AbortSignal): Effect.Effect<boolean, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<boolean, ProviderRuntimeFailure, Scope.Scope> {
      this.#stages.set(spec.runtime, "download");
      yield* runtimeIO(async () => await mkdir(this.#downloadRoot(), { recursive: true }));
      yield* this.#requireDiskSpaceEffect(spec);
      const partialPath = this.#partialPath(spec);
      const metadataPath = this.#partialMetadataPath(spec);
      const previous = yield* readPartialState(partialPath, metadataPath, spec);
      const digest = spec.archiveDigest;
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
    }).pipe(Effect.scoped, Effect.mapError(diskFullFailure));
  }

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

  #commitEffect(
    staging: string,
    destination: string,
    spec: RuntimeSpec,
  ): Effect.Effect<boolean, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<boolean, ProviderRuntimeFailure> {
      let held = false;
      let attempts = 0;
      const heldUntil = Date.now() + this.#heldStageWaitMs;
      while (attempts < COMMIT_ATTEMPTS) {
        if (yield* renameIfVacant(staging, destination, this.#heldSourceWaitsMs)) return true;
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
          const aside = join(
            this.#runtimeRoot(spec.runtime),
            `.replaced-${spec.target}-${spec.version}-${randomBytes(4).toString("hex")}`,
          );
          if (!(yield* holdsClaim(lock, claim))) return "moved";
          if (!(yield* renameIfPresent(destination, aside))) return "moved";
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
      ).pipe(
        Effect.mapError(({ cause }) => requestFailure(spec.url, cause)),
        failWhenStalled,
      );
    });
  }

  #requireDiskSpaceEffect(spec: RuntimeSpec): Effect.Effect<void, ProviderRuntimeFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, ProviderRuntimeFailure> {
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
      if (!isAbortError(error))
        logger.warn("Provider runtime update failed.", {
          runtime,
          version: spec.version,
          installedVersion: this.#statuses[runtime].version,
          stage: this.#stages.get(runtime) ?? "prepare",
          cause: logCause(error),
        });
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

  #removeRuntimePartialsEffect(runtime: ManagedRuntimeId, target: RuntimeTarget): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const prefix = `${runtime}-${target}-`;
      const downloads = yield* runtimeIO(async () => await readdir(this.#downloadRoot()).catch(() => []));
      yield* Effect.forEach(
        downloads.filter((name) => name.startsWith(prefix) && /\.partial(?:\.json)?$/u.test(name)),
        (name) => runtimeIO(() => rm(join(this.#downloadRoot(), name), { force: true })).pipe(Effect.ignore),
        { concurrency: "unbounded", discard: true },
      );
    }).pipe(Effect.ignore);
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

  #collectVersionsEffect(target: RuntimeTarget, retentionMs: number): Effect.Effect<void> {
    const stale = Date.now() - retentionMs;
    return this.#oldVersionPathsEffect(target, stale, true).pipe(
      Effect.flatMap((paths) => this.#removeOldVersionPathsEffect(paths, stale)),
    );
  }

  #removeOldVersionPathsEffect(paths: readonly string[], stale: number): Effect.Effect<void> {
    return Effect.forEach(
      paths,
      (path) =>
        removeStaleRuntimeDirectory(path, stale).pipe(
          Effect.andThen(pathExists(path)),
          Effect.flatMap((kept) =>
            kept ? Effect.void : runtimeIO(() => rm(verificationRecordPath(path), { force: true })).pipe(Effect.ignore),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    ).pipe(Effect.catch(() => Effect.void));
  }

  #oldVersionPathsEffect(target: RuntimeTarget, stale: number, stamp: boolean): Effect.Effect<string[]> {
    return Effect.forEach(
      RUNTIMES,
      (runtime) =>
        Effect.gen({ self: this }, function* () {
          const spec = runtimeSpec(runtime, target, this.#lock);
          const { phase, version } = this.#statuses[runtime];
          const targetRoot = dirname(this.#installRoot(spec));
          if (stamp && version) yield* this.#stampInUseEffect(runtime, join(targetRoot, version));
          const backup =
            version && phase !== "ready" ? yield* this.#workingBackupEffect(targetRoot, spec, version) : null;
          if (stamp && backup) yield* this.#stampInUseEffect(runtime, join(targetRoot, backup));
          return yield* this.#oldVersionsEffect(spec, backup, stale);
        }).pipe(Effect.catch(() => Effect.succeed([]))),
      { concurrency: "unbounded" },
    ).pipe(Effect.map((paths) => paths.flat()));
  }

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

  #stampedBySiblingEffect(path: string): Effect.Effect<boolean> {
    const stale = Date.now() - this.#removalRetentionMs();
    const own = (this.#ownStamps.get(path) ?? Number.NEGATIVE_INFINITY) + OWN_STAMP_PRECISION_MS;
    return runtimeIO(() => stat(path)).pipe(
      Effect.map((value) => value.mtimeMs > Math.max(stale, own)),
      Effect.catch(() => Effect.succeed(true)),
    );
  }

  #removeVersionsEffect(provider: ManagedProviderId, target: RuntimeTarget): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const paths = yield* this.#removableVersionPathsEffect(provider, target);
      const removed = yield* Effect.forEach(
        paths,
        (path) =>
          Effect.gen({ self: this }, function* () {
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
      yield* this.#removeRuntimePartialsEffect(provider, target);
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
    : (yield* runtimeIO(() =>
        execFileAsync(executable, ["--version"], {
          encoding: "utf8",
          env: { ...process.env, ...descriptor.versionEnvironment },
          windowsHide: true,
        }),
      ).pipe(
        Effect.mapError((failure) =>
          windowsBlockedFailure(spec.runtime, unsupportedProcessorFailure(spec.runtime, failure)),
        ),
      )).stdout;
  if ((yield* runtimeSync(() => descriptor.parseVersion(output))) !== spec.version) {
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.unexpectedVersion")) });
  }
});

function unsupportedProcessorFailure(
  runtime: ManagedRuntimeId,
  failure: ProviderRuntimeFailure,
): ProviderRuntimeFailure {
  const { cause } = failure;
  if (
    isManagedToolRuntime(runtime) ||
    !(cause instanceof Error) ||
    !("stderr" in cause) ||
    typeof cause.stderr !== "string"
  )
    return failure;
  const kernel = unsupportedKernelReason(cause.stderr);
  if (kernel) return new ProviderRuntimeFailure({ cause: new Error(sourceText(kernel), { cause }) });
  const illegalInstruction = "signal" in cause && cause.signal === "SIGILL";
  if (!illegalInstruction && !reportsMissingProcessorFeature(cause.stderr, false)) return failure;
  return new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.cpuUnsupported"), { cause }) });
}

function windowsBlockedFailure(runtime: ManagedRuntimeId, failure: ProviderRuntimeFailure): ProviderRuntimeFailure {
  const { cause } = failure;
  if (
    process.platform !== "win32" ||
    isManagedToolRuntime(runtime) ||
    !(cause instanceof Error) ||
    errorCode(cause) !== "UNKNOWN" ||
    !("syscall" in cause) ||
    typeof cause.syscall !== "string" ||
    !cause.syscall.startsWith("spawn")
  )
    return failure;
  return new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.windowsBlocked"), { cause }) });
}

function diskFullFailure(failure: ProviderRuntimeFailure): ProviderRuntimeFailure {
  const { cause } = failure;
  const diskFull = (error: unknown, depth: number): boolean =>
    error instanceof Error &&
    (errorCode(error) === "ENOSPC" ||
      errorCode(error) === "EDQUOT" ||
      DISK_FULL_OUTPUT.test(error.message) ||
      ("stderr" in error && typeof error.stderr === "string" && DISK_FULL_OUTPUT.test(error.stderr)) ||
      (depth < 3 && diskFull(error.cause, depth + 1)));
  if (!diskFull(cause, 0)) return failure;
  return new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.diskSpace"), { cause }) });
}

const VERIFICATION_RECORD_LAYOUT = 1;

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
  const versionChecked = isManagedToolRuntime(spec.runtime) || isProviderOn(spec.runtime);
  const before = yield* runtimeFingerprint(root);
  const saved = yield* runtimeIO(() => readFile(recordPath, "utf8")).pipe(
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
  const after = before === null ? null : yield* runtimeFingerprint(root);
  if (after === null || after.join("\n") !== before?.join("\n")) return;
  const record = `${JSON.stringify({ key, versionChecked, files: after })}\n`;
  const staged = `${recordPath}.${process.pid}-${randomBytes(4).toString("hex")}`;
  yield* runtimeIO(async () => {
    await writeFile(staged, record);
    await rename(staged, recordPath);
  }).pipe(Effect.catch(() => runtimeIO(() => rm(staged, { force: true })).pipe(Effect.ignore)));
});

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
    } else if (entry.isSymbolicLink()) {
      const info = yield* runtimeIO(() => lstat(join(root, path), { bigint: true }));
      const target = yield* runtimeIO(() => readlink(join(root, path)));
      lines.push([path, "link", target, info.ctimeNs, info.ino, info.dev].join("\0"));
    } else return null;
  }
  return lines.sort();
});

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
  if (moved !== abandoned) return null;
  return (yield* holdLock(lock, claim)) ? claim : null;
});

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

const readClaim = Effect.fn("ProviderRuntime.readClaim")(function* (
  lock: string,
): Effect.fn.Return<string, ProviderRuntimeFailure> {
  const held = yield* runtimeIO(() => readFile(join(lock, "claim"), "utf8").catch(() => null));
  return held?.trim() ?? "";
});

const holdsClaim = Effect.fn("ProviderRuntime.holdsClaim")(function* (
  lock: string,
  claim: string,
): Effect.fn.Return<boolean, ProviderRuntimeFailure> {
  return (yield* readClaim(lock)) === claim;
});

const holdLock = Effect.fn("ProviderRuntime.holdLock")(function* (
  lock: string,
  claim: string,
): Effect.fn.Return<boolean, ProviderRuntimeFailure> {
  const staging = join(dirname(lock), `.replaced-claim-${randomBytes(4).toString("hex")}`);
  yield* runtimeIO(() => mkdir(staging, { recursive: true }));
  yield* runtimeIO(() => writeFile(join(staging, "claim"), `${claim}\n`, { mode: 0o600 }));
  if (yield* renameIfVacant(staging, lock)) return true;
  yield* runtimeIO(() => rm(staging, { recursive: true, force: true }).catch(() => undefined));
  return false;
});

const releaseLock = Effect.fn("ProviderRuntime.releaseLock")(function* (
  lock: string,
  claim: string,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  if (!(yield* holdsClaim(lock, claim))) return;
  yield* runtimeIO(() => rm(lock, { recursive: true, force: true }).catch(() => undefined));
});

const renameIfPresent = Effect.fn("ProviderRuntime.renameIfPresent")((from: string, to: string) =>
  runtimeIO(() => rename(from, to)).pipe(
    Effect.as(true),
    Effect.catch((error) => (errorCode(error.cause) === "ENOENT" ? Effect.succeed(false) : Effect.fail(error))),
  ),
);

function errorCode(error: unknown): string | null {
  return error instanceof Error && "code" in error && isString(error.code) ? error.code : null;
}

function releaseDownloadResponse(response: Response): Effect.Effect<void> {
  return runtimeIO(async () => {
    await response.body?.cancel();
  }).pipe(Effect.catch(() => Effect.void));
}

const failWhenStalled = <A>(step: Effect.Effect<A, ProviderRuntimeFailure>): Effect.Effect<A, ProviderRuntimeFailure> =>
  step.pipe(
    Effect.interruptible,
    Effect.timeoutOrElse({
      duration: DOWNLOAD_STALL_MS,
      orElse: () =>
        Effect.fail(new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.downloadStalled")) })),
    }),
  );

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
          const chunk = yield* runtimeIO(() => reader.read()).pipe(failWhenStalled);
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
    files[file.path] =
      file.link === null
        ? yield* sha256File(join(root, file.path)).pipe(
            Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
          )
        : `${INSTALL_RECORD_LINK}${file.link}`;
  const record: InstallRecord = {
    layoutVersion: 1,
    runtime: spec.runtime,
    version: spec.version,
    target: spec.target,
    files,
  };
  yield* runtimeIO(() => writeFile(join(root, INSTALL_RECORD), `${JSON.stringify(record)}\n`));
});

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
    const expected = record.files[file.path];
    if (
      !isString(expected) ||
      (file.link === null
        ? yield* sha256File(join(root, file.path)).pipe(
            Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
          )
        : `${INSTALL_RECORD_LINK}${file.link}`) !== expected
    ) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.runtimeChecksum")) });
    }
  }
});

const INSTALL_RECORD_LINK = "link:";

const installedFiles = Effect.fn("ProviderRuntime.installedFiles")(function* (
  root: string,
  prefix = "",
): Effect.fn.Return<{ path: string; link: string | null }[], ProviderRuntimeFailure> {
  const files: { path: string; link: string | null }[] = [];
  for (const entry of yield* runtimeIO(() => readdir(join(root, prefix), { withFileTypes: true }))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(yield* installedFiles(root, path)));
    else if (entry.isSymbolicLink()) {
      const link = yield* runtimeIO(() => readlink(join(root, path)));
      if (!isSafeLinkTarget(link))
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.runtimeSpecialFile")) });
      files.push({ path, link });
    } else if (!entry.isFile())
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.runtimeSpecialFile")) });
    else if (path !== INSTALL_RECORD) files.push({ path, link: null });
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
