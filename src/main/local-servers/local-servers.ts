import { type ChildProcess, type SpawnOptions, spawn as spawnProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import { type AgentSummary, isAgentSummary, LOCAL_SERVER_LIMIT, type ServerSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Deferred, Duration, Effect, Exit, Schema, Scope, Semaphore } from "effect";
import { causeHelpers } from "../../backend/effect-boundary";
import type { RemoteMemberRecord } from "../central-auth-records";
import {
  formatLocalServerCommand,
  LOCAL_SERVER_CONTROL_FD,
  LOCAL_SERVER_ENVIRONMENT,
  LOCAL_SERVER_MEMBERS_REQUEST,
  LOCAL_SERVER_OWNER_USERNAME,
  LOCAL_SERVER_READY_PREFIX,
  LOCAL_SERVER_WORKING_PREFIX,
  type LocalServerCommand,
  type LocalServerMarketplaceRequest,
  type LocalServerReady,
  parseLocalServerMarketplaceRequest,
} from "../local-server-child";
import type { LocalServerAttachInput, RemoteServerManager } from "../remote-server-manager";
import type { TokenCipher } from "../remote-server-store";
import { isLocalDevelopmentApi } from "../remote-server-urls";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { validateServerName } from "../team-store";
import { LocalServerRegistry, type StoredLocalServer } from "./local-server-registry";

export class LocalServerFailure extends Schema.TaggedError<LocalServerFailure>()("LocalServerFailure", {
  cause: Schema.Defect(),
}) {}

const { io: localIO, sync: localSync, rewrap: toLocalServerFailure } = causeHelpers(LocalServerFailure);

const READY_TIMEOUT = Duration.seconds(90);
const STOP_GRACE_MS = 6_000;
const RESTART_DELAY = Duration.seconds(5);
const RESTART_WINDOW_MS = 10 * 60_000;
const RESTART_LIMIT = 3;
const SESSION_RENEW_AFTER_MS = 7 * 24 * 60 * 60_000;
const SESSION_CHECK_INTERVAL = Duration.hours(1);
const PROVIDER_HOMES_FOLDER = "provider-homes";
const PROVIDER_HOME_VARIABLES = {
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
  grok: "GROK_HOME",
  gemini: "GEMINI_HOME",
} as const;

const pathExists = (path: string) =>
  localIO(() => stat(path)).pipe(
    Effect.as(true),
    Effect.catch(({ cause }) =>
      cause instanceof Error && "code" in cause && cause.code === "ENOENT"
        ? Effect.succeed(false)
        : Effect.fail(new LocalServerFailure({ cause })),
    ),
  );

const ownProviderHomes = Effect.fn("LocalServers.ownProviderHomes")(function* (userData: string) {
  const root = join(userData, PROVIDER_HOMES_FOLDER);
  const homes: Record<string, string> = {};
  if (!(yield* pathExists(root))) return homes;
  for (const [folder, variable] of Object.entries(PROVIDER_HOME_VARIABLES)) {
    const home = join(root, folder);
    yield* localIO(() => mkdir(home, { recursive: true, mode: 0o700 }));
    homes[variable] = home;
  }
  return homes;
});

function childEnvironment(
  entry: StoredLocalServer,
  agentRoot: string,
  runtimeRoot: string,
  secret: string,
  providerHomes: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "ELECTRON_RUN_AS_NODE" || name.startsWith("OPENBOT_DEV_")) continue;
    environment[name] = value;
  }
  Object.assign(environment, providerHomes);
  environment[LOCAL_SERVER_ENVIRONMENT.child] = "1";
  environment[LOCAL_SERVER_ENVIRONMENT.agentRoot] = agentRoot;
  environment[LOCAL_SERVER_ENVIRONMENT.runtimeRoot] = runtimeRoot;
  environment[LOCAL_SERVER_ENVIRONMENT.name] = entry.name;
  environment[LOCAL_SERVER_ENVIRONMENT.secret] = secret;
  return environment;
}

const readySchema = Schema.Struct({
  serverId: Schema.String,
  serverName: Schema.String,
  apiUrl: Schema.String,
  fingerprint: Schema.String,
  publicKey: Schema.String,
  ownerMemberId: Schema.String,
});
const decodeReady = Schema.decodeUnknownSync(readySchema);

function parseReadyLine(line: string): LocalServerReady | null {
  if (!line.startsWith(LOCAL_SERVER_READY_PREFIX)) return null;
  try {
    const ready = decodeReady(JSON.parse(line.slice(LOCAL_SERVER_READY_PREFIX.length)));
    return isLocalDevelopmentApi(ready.apiUrl) ? ready : null;
  } catch {
    return null;
  }
}

function parseWorkingLine(line: string): AgentSummary[] | null {
  if (!line.startsWith(LOCAL_SERVER_WORKING_PREFIX)) return null;
  try {
    const value = JSON.parse(line.slice(LOCAL_SERVER_WORKING_PREFIX.length));
    return Array.isArray(value) ? value.filter(isAgentSummary).map((agent) => ({ ...agent, avatarUrl: null })) : null;
  } catch {
    return null;
  }
}

function controlPipe(child: ChildProcess, platform: NodeJS.Platform): Writable | null {
  const stream = platform === "win32" ? child.stdio[LOCAL_SERVER_CONTROL_FD] : child.stdin;
  return stream instanceof Writable ? stream : null;
}

function startFailure(): LocalServerFailure {
  return new LocalServerFailure({ cause: new Error(sourceText("error.remote.localServerNotStarted")) });
}

interface RunningChild {
  readonly child: ChildProcess;
  stopping: boolean;
}

interface LocalServerAccount {
  accountId(): string | null;
  register(input: {
    hostId: string;
    name: string;
    ownerMembershipId: string;
    devicePublicKey: string;
  }): Effect.Effect<void, RemoteWorkflowError>;
  credential(hostId: string): string | null;
  listMembers(hostId: string): Effect.Effect<RemoteMemberRecord[], RemoteWorkflowError>;
  remove(hostId: string): Effect.Effect<void, RemoteWorkflowError>;
  apiOrigin: string;
  requestAuthorized(path: string, init: RequestInit): Effect.Effect<unknown, RemoteWorkflowError>;
  downloadAuthorized(path: string): Effect.Effect<Uint8Array, RemoteWorkflowError>;
}

const MARKETPLACE_READS: ReadonlyArray<{ method: "GET" | "POST"; download: boolean; path: RegExp }> = [
  { method: "GET", download: false, path: /^\/v1\/marketplace\/agents\/[^/]+\/listing$/u },
  { method: "GET", download: true, path: /^\/v1\/marketplace\/agents\/[^/]+\/avatar$/u },
  { method: "GET", download: false, path: /^\/v1\/skills\/(?!mine$)[^/]+$/u },
  { method: "GET", download: true, path: /^\/v1\/skills\/[^/]+\/content$/u },
  { method: "GET", download: false, path: /^\/v1\/skills\/[^/]+\/versions\/[^/]+$/u },
  { method: "GET", download: true, path: /^\/v1\/skills\/[^/]+\/versions\/[^/]+\/content$/u },
  { method: "GET", download: false, path: /^\/v1\/agent-templates\/(?!mine$)[^/]+$/u },
  { method: "GET", download: true, path: /^\/v1\/agent-templates\/[^/]+\/avatar$/u },
  { method: "POST", download: false, path: /^\/v1\/marketplace\/agents\/[^/]+\/install$/u },
  { method: "POST", download: false, path: /^\/v1\/skills\/[^/]+\/install$/u },
];

const CONNECT_STARTS: ReadonlySet<string> = new Set(["/v2/slack/authorize", "/v2/discord/authorize"]);

const installReceiptSchema = Schema.Struct({ receiptId: Schema.String });
const decodeInstallReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(installReceiptSchema));
const connectStartSchema = Schema.Struct({
  hostId: Schema.String,
  hostNonce: Schema.String,
  hostPublicKey: Schema.String,
});
const decodeConnectStart = Schema.decodeUnknownSync(Schema.fromJsonString(connectStartSchema));

function allowedConnectStart(
  request: LocalServerMarketplaceRequest,
  path: string,
  hostId: string | null,
): { path: string; init: RequestInit } | null {
  if (hostId === null || request.method !== "POST" || request.download) return null;
  try {
    const body = decodeConnectStart(request.body);
    if (body.hostId.toLowerCase() !== hostId.toLowerCase()) return null;
    return {
      path,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: body.hostId, hostNonce: body.hostNonce, hostPublicKey: body.hostPublicKey }),
      },
    };
  } catch {
    return null;
  }
}

function allowedMarketplaceRead(
  request: LocalServerMarketplaceRequest,
  apiOrigin: string,
  hostId: string | null,
): { path: string; init: RequestInit } | null {
  let url: URL;
  try {
    url = new URL(request.path, apiOrigin);
  } catch {
    return null;
  }
  if (url.origin !== apiOrigin || url.pathname.includes("%")) return null;
  if (CONNECT_STARTS.has(url.pathname))
    return url.search === "" ? allowedConnectStart(request, url.pathname, hostId) : null;
  const allowed = MARKETPLACE_READS.some(
    (read) => read.method === request.method && read.download === request.download && read.path.test(url.pathname),
  );
  if (!allowed) return null;
  const path = `${url.pathname}${url.search}`;
  if (request.method === "GET") return request.body === undefined ? { path, init: { method: "GET" } } : null;
  try {
    const { receiptId } = decodeInstallReceipt(request.body);
    return {
      path,
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiptId }) },
    };
  } catch {
    return null;
  }
}

export interface LocalServerListing {
  serverId: string;
  name: string;
  published: boolean;
}

export interface LocalServersOptions {
  registryPath: string;
  userDataRoot: string;
  agentRoot: string;
  runtimeRoot: string;
  cipher: TokenCipher;
  remoteServers: Pick<
    RemoteServerManager,
    "setThisComputerServers" | "setRegisteredThisComputerServers" | "attachLocalServer" | "detachLocalServer"
  >;
  account: LocalServerAccount;
  command: { executable: string; args: readonly string[] };
  trash: (path: string) => Promise<void>;
  log: { info: (message: string) => void; warn: (message: string, detail?: unknown) => void };
  platform: NodeJS.Platform;
  spawn?: SpawnChild;
}

export type SpawnChild = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export function sandboxArguments(argv: readonly string[]): string[] {
  const end = argv.indexOf("--");
  return (end === -1 ? argv : argv.slice(0, end)).includes("--no-sandbox") ? ["--no-sandbox"] : [];
}

export class LocalServers {
  readonly #options: LocalServersOptions;
  readonly #registry: LocalServerRegistry;
  readonly #spawn: SpawnChild;
  readonly #scope = Scope.makeUnsafe("parallel");
  readonly #running = new Map<string, RunningChild>();
  readonly #exits = new Map<string, number[]>();
  readonly #restartPending = new Set<string>();
  readonly #starts = new Map<string, Deferred.Deferred<ServerSummary, LocalServerFailure>>();
  readonly #working = new Map<string, AgentSummary[]>();
  readonly #ready = new Map<string, LocalServerReady>();
  readonly #published = new Set<string>();
  #publishedAccountId: string | null = null;
  readonly #memberReads = new Map<string, boolean>();
  readonly #accountSteps = Semaphore.makeUnsafe(1);
  #stopped = false;

  constructor(options: LocalServersOptions) {
    this.#options = options;
    this.#registry = new LocalServerRegistry(options.registryPath);
    this.#spawn = options.spawn ?? spawnProcess;
  }

  workingAgents(): AgentSummary[] {
    return [...this.#working.values()].flat();
  }

  pids(): ReadonlySet<number> {
    const pids = new Set<number>();
    for (const { child } of this.#running.values()) if (child.pid !== undefined) pids.add(child.pid);
    return pids;
  }

  list(): { servers: LocalServerListing[]; limit: number } {
    return {
      servers: this.#registry.servers.flatMap((entry) =>
        entry.serverId
          ? [
              {
                serverId: entry.serverId,
                name: this.#ready.get(entry.id)?.serverName ?? entry.name,
                published: this.#published.has(entry.id),
              },
            ]
          : [],
      ),
      limit: LOCAL_SERVER_LIMIT,
    };
  }

  readonly accountChanged = Effect.fn("LocalServers.accountChanged")(
    function* (this: LocalServers) {
      if (this.#stopped) return;
      const accountId = this.#options.account.accountId();
      if (this.#publishedAccountId !== null && this.#publishedAccountId !== accountId) {
        for (const id of this.#published) this.#send(id, { type: "unpublish" });
        this.#published.clear();
        this.#publishedAccountId = null;
        this.#announcePublished();
      }
      if (accountId === null) return;
      yield* this.#removeDeletedHosts();
      for (const entry of this.#registry.servers) {
        const running = this.#running.get(entry.id);
        if (running && !this.#published.has(entry.id)) yield* this.#publishUnlocked(entry, running);
      }
    },
    (operation) => this.#accountSteps.withPermit(operation),
  );

  readonly load = Effect.fn("LocalServers.load")(function* (this: LocalServers) {
    yield* this.#registry
      .load()
      .pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => this.#options.log.warn("The list of servers on this computer is not readable.", cause)),
        ),
      );
    this.#announce();
  });

  readonly initialize = Effect.fn("LocalServers.initialize")(function* (this: LocalServers) {
    for (const entry of this.#registry.servers) {
      if (entry.serverId)
        yield* this.#options.remoteServers
          .detachLocalServer(entry.serverId, false)
          .pipe(Effect.catch(() => Effect.void));
    }
    for (const entry of this.#registry.servers) this.#startInBackground(entry);
  });

  readonly startStopped = Effect.fn("LocalServers.startStopped")(function* (
    this: LocalServers,
    serverId: string,
  ): Effect.fn.Return<ServerSummary | null, LocalServerFailure> {
    const entry = this.#registry.findByServerId(serverId);
    if (!entry) return null;
    if (!this.#running.has(entry.id)) this.#exits.delete(entry.id);
    return yield* this.#startIfStopped(entry);
  });

  readonly create = Effect.fn("LocalServers.create")(function* (
    this: LocalServers,
    name: string,
    from: "desktop" | "device" = "desktop",
  ): Effect.fn.Return<ServerSummary, LocalServerFailure> {
    const serverName = name.trim();
    yield* localSync(() => validateServerName(serverName));
    if (this.#registry.servers.length >= LOCAL_SERVER_LIMIT)
      return yield* new LocalServerFailure({
        cause: new Error(sourceText("error.remote.localServerLimit", { limit: LOCAL_SERVER_LIMIT })),
      });
    const secret = randomBytes(32).toString("base64url");
    const entry: StoredLocalServer = {
      id: randomUUID(),
      name: serverName,
      createdAt: new Date().toISOString(),
      encryptedSecret: yield* localSync(() => this.#options.cipher.encrypt(secret).toString("base64")),
      serverId: null,
      fingerprint: null,
      publicKey: null,
    };
    yield* this.#registry.add(entry, LOCAL_SERVER_LIMIT).pipe(toLocalServerFailure);
    return yield* localIO(() =>
      mkdir(join(this.#paths(entry).userData, PROVIDER_HOMES_FOLDER), { recursive: true, mode: 0o700 }),
    ).pipe(
      Effect.andThen(this.#start(entry, from === "device")),
      Effect.tapError(() =>
        this.#forget(entry).pipe(
          Effect.catch(({ cause }) =>
            Effect.sync(() => this.#options.log.warn("A server that did not start could not be removed.", cause)),
          ),
        ),
      ),
    );
  });

  readonly restart = Effect.fn("LocalServers.restart")(function* (this: LocalServers, serverId: string) {
    const entry = yield* this.#entry(serverId);
    yield* this.#stopChild(entry);
    this.#exits.delete(entry.id);
    yield* this.#start(entry);
  });

  readonly delete = Effect.fn("LocalServers.delete")(function* (
    this: LocalServers,
    serverId: string,
    from: "desktop" | "device" = "desktop",
  ) {
    const entry = this.#registry.findByServerId(serverId);
    if (from === "desktop" || !this.#registry.removedHostIds.includes(serverId) || entry)
      yield* this.#forget(yield* this.#entry(serverId), from === "desktop");
    if (from === "desktop") return;
    yield* this.#accountSteps.withPermit(this.#removeDeletedHosts());
    if (this.#registry.removedHostIds.includes(serverId))
      return yield* new LocalServerFailure({
        cause: new Error(sourceText("error.remote.localServerAccountRemovalFailed")),
      });
  });

  readonly stop = Effect.fn("LocalServers.stop")(function* (this: LocalServers) {
    this.#stopped = true;
    yield* Scope.close(this.#scope, Exit.void);
    yield* Effect.forEach(this.#registry.servers, (entry) => this.#stopChild(entry), {
      concurrency: "unbounded",
      discard: true,
    });
  });

  #entry(serverId: string): Effect.Effect<StoredLocalServer, LocalServerFailure> {
    return Effect.suspend(() => {
      const entry = this.#registry.findByServerId(serverId);
      return entry
        ? Effect.succeed(entry)
        : Effect.fail(new LocalServerFailure({ cause: new Error(sourceText("error.remote.localServerNotFound")) }));
    });
  }

  #paths(entry: StoredLocalServer): { userData: string; agentRoot: string } {
    return { userData: join(this.#options.userDataRoot, entry.id), agentRoot: join(this.#options.agentRoot, entry.id) };
  }

  #announce(): void {
    this.#options.remoteServers.setThisComputerServers([
      ...this.#registry.servers.flatMap((entry) => (entry.serverId ? [entry.serverId] : [])),
      ...this.#registry.removedHostIds,
    ]);
  }

  #announcePublished(): void {
    this.#options.remoteServers.setRegisteredThisComputerServers(
      this.#registry.servers.flatMap((entry) =>
        entry.serverId && this.#published.has(entry.id) ? [entry.serverId] : [],
      ),
    );
  }

  sendMembers(serverId: string): void {
    const entry = this.#registry.findByServerId(serverId);
    if (entry) this.#readMembers(entry.id);
  }

  #readMembers(id: string): void {
    if (this.#memberReads.has(id)) {
      this.#memberReads.set(id, true);
      return;
    }
    const ready = this.#ready.get(id);
    const running = this.#running.get(id);
    if (!ready || !running || !this.#published.has(id)) {
      this.#send(id, { type: "members-unavailable" });
      return;
    }
    this.#memberReads.set(id, false);
    Effect.runFork(
      Effect.forkIn(
        this.#options.account.listMembers(ready.serverId).pipe(
          Effect.map((members): LocalServerCommand => ({ type: "members", members })),
          Effect.catch(({ cause }) =>
            Effect.sync((): LocalServerCommand => {
              this.#options.log.warn("The members of a server on this computer did not load.", cause);
              return { type: "members-unavailable" };
            }),
          ),
          Effect.flatMap((command) =>
            Effect.sync(() => {
              if (this.#running.get(id) === running) this.#send(id, command);
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              const again = this.#memberReads.get(id) === true;
              this.#memberReads.delete(id);
              if (again) this.#readMembers(id);
            }),
          ),
        ),
        this.#scope,
        { startImmediately: true },
      ),
    );
  }

  #readMarketplace(id: string, running: RunningChild, request: LocalServerMarketplaceRequest): void {
    const read = allowedMarketplaceRead(
      request,
      this.#options.account.apiOrigin,
      this.#ready.get(id)?.serverId ?? null,
    );
    if (!read)
      this.#options.log.warn("A server on this computer asked for an account read that is not allowed.", {
        method: request.method,
        path: request.path,
      });
    const answer: Effect.Effect<LocalServerCommand, RemoteWorkflowError> = !read
      ? Effect.succeed({ type: "marketplace", id: request.id, error: sourceText("error.team.requestFailed") })
      : request.download
        ? this.#options.account.downloadAuthorized(read.path).pipe(
            Effect.map(
              (bytes): LocalServerCommand => ({
                type: "marketplace",
                id: request.id,
                bytes: Buffer.from(bytes).toString("base64"),
              }),
            ),
          )
        : this.#options.account
            .requestAuthorized(read.path, read.init)
            .pipe(Effect.map((value): LocalServerCommand => ({ type: "marketplace", id: request.id, value })));
    Effect.runFork(
      Effect.forkIn(
        answer.pipe(
          Effect.catch(({ cause }) =>
            Effect.succeed<LocalServerCommand>({
              type: "marketplace",
              id: request.id,
              error: cause instanceof Error ? cause.message : sourceText("error.team.requestFailed"),
            }),
          ),
          Effect.flatMap((command) =>
            Effect.sync(() => {
              if (this.#running.get(id) === running) this.#send(id, command);
            }),
          ),
        ),
        this.#scope,
        { startImmediately: true },
      ),
    );
  }

  #send(id: string, command: LocalServerCommand): void {
    const running = this.#running.get(id);
    const control = running && !running.stopping ? controlPipe(running.child, this.#options.platform) : null;
    if (!control?.writable) return;
    control.write(formatLocalServerCommand(command));
  }

  readonly #publishUnlocked = Effect.fn("LocalServers.publish")(function* (
    this: LocalServers,
    entry: StoredLocalServer,
    running: RunningChild,
  ) {
    const accountId = this.#options.account.accountId();
    const ready = this.#ready.get(entry.id);
    if (accountId === null || !ready || this.#stopped) return;
    yield* this.#options.account
      .register({
        hostId: ready.serverId,
        name: ready.serverName,
        ownerMembershipId: ready.ownerMemberId,
        devicePublicKey: ready.publicKey,
      })
      .pipe(
        Effect.andThen(
          Effect.sync(() => {
            const machineToken = this.#options.account.credential(ready.serverId);
            if (
              !machineToken ||
              this.#options.account.accountId() !== accountId ||
              this.#running.get(entry.id) !== running
            )
              return;
            registerSecretValue(machineToken);
            this.#send(entry.id, { type: "publish", machineToken });
            this.#published.add(entry.id);
            this.#publishedAccountId = accountId;
            this.#announcePublished();
          }),
        ),
        Effect.catch(({ cause }) =>
          Effect.sync(() =>
            this.#options.log.warn("A server on this computer was not registered for the account.", cause),
          ),
        ),
      );
  });

  readonly #removeDeletedHosts = Effect.fn("LocalServers.removeDeletedHosts")(function* (this: LocalServers) {
    for (const hostId of this.#registry.removedHostIds) {
      const removed = yield* this.#options.account.remove(hostId).pipe(
        Effect.as(true),
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            this.#options.log.warn("A deleted server on this computer was not removed from the account.", cause);
            return false;
          }),
        ),
      );
      if (removed)
        yield* this.#registry.forgetRemovedHost(hostId).pipe(
          Effect.tap(() => Effect.sync(() => this.#announce())),
          Effect.catch(({ cause }) =>
            Effect.sync(() => this.#options.log.warn("The list of servers on this computer was not saved.", cause)),
          ),
        );
    }
  });

  #background(operation: Effect.Effect<unknown, LocalServerFailure>): void {
    Effect.runFork(
      Effect.forkIn(
        operation.pipe(
          Effect.catch(({ cause }) =>
            Effect.sync(() => this.#options.log.warn("A server on this computer did not start.", cause)),
          ),
        ),
        this.#scope,
        { startImmediately: true },
      ),
    );
  }

  readonly #start = Effect.fn("LocalServers.start")(function* (
    this: LocalServers,
    entry: StoredLocalServer,
    awaitRegistration = false,
  ): Effect.fn.Return<ServerSummary, LocalServerFailure> {
    if (this.#stopped) return yield* startFailure();
    const secret = yield* localSync(() => this.#options.cipher.decrypt(Buffer.from(entry.encryptedSecret, "base64")));
    registerSecretValue(secret);
    const paths = this.#paths(entry);
    yield* localIO(() => mkdir(paths.userData, { recursive: true, mode: 0o700 }));
    yield* localIO(() => mkdir(paths.agentRoot, { recursive: true }));
    const providerHomes = yield* ownProviderHomes(paths.userData);

    const child = yield* localSync(() =>
      this.#spawn(
        this.#options.command.executable,
        [...this.#options.command.args, `--user-data-dir=${paths.userData}`],
        {
          env: childEnvironment(entry, paths.agentRoot, this.#options.runtimeRoot, secret, providerHomes),
          stdio: this.#options.platform === "win32" ? ["ignore", "pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      ),
    );
    const running: RunningChild = { child, stopping: false };
    this.#running.set(entry.id, running);
    const ready = Deferred.makeUnsafe<LocalServerReady, LocalServerFailure>();
    if (child.stdout)
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (line === LOCAL_SERVER_MEMBERS_REQUEST) {
          this.#readMembers(entry.id);
          return;
        }
        const marketplace = parseLocalServerMarketplaceRequest(line);
        if (marketplace) {
          this.#readMarketplace(entry.id, running, marketplace);
          return;
        }
        const working = parseWorkingLine(line);
        if (working) {
          if (this.#running.get(entry.id) === running) this.#working.set(entry.id, working);
          return;
        }
        const value = parseReadyLine(line);
        if (value) Deferred.doneUnsafe(ready, Exit.succeed(value));
      });
    child.stderr?.resume();
    const control = controlPipe(child, this.#options.platform);
    control?.on("error", () => undefined);
    if (control instanceof Readable && control.readable) control.resume();
    child.once("error", (error: Error) => {
      this.#options.log.warn("A server process on this computer reported an error.", error);
      Deferred.doneUnsafe(ready, Exit.fail(startFailure()));
    });
    child.once("exit", (code, signal) => {
      Deferred.doneUnsafe(ready, Exit.fail(startFailure()));
      this.#exited(entry, running, code, signal);
    });

    return yield* Effect.gen({ self: this }, function* () {
      const value = yield* Deferred.await(ready).pipe(
        Effect.timeoutOrElse({ duration: READY_TIMEOUT, orElse: () => Effect.fail(startFailure()) }),
      );
      const pinned = yield* this.#pin(entry, value);
      this.#announce();
      const attach: LocalServerAttachInput = {
        serverId: value.serverId,
        apiUrl: value.apiUrl,
        fingerprint: pinned.fingerprint,
        publicKey: pinned.publicKey,
        username: LOCAL_SERVER_OWNER_USERNAME,
        password: secret,
      };
      const summary = yield* this.#options.remoteServers.attachLocalServer(attach).pipe(toLocalServerFailure);
      this.#options.log.info(`A server on this computer started (pid ${child.pid ?? "unknown"}).`);
      this.#ready.set(entry.id, value);
      const register = this.#accountSteps.withPermit(this.#publishUnlocked(entry, running));
      if (awaitRegistration) yield* register;
      else this.#background(register);
      this.#background(this.#renewSession(entry, running, attach));
      return summary;
    }).pipe(Effect.tapError(() => this.#stopChild(entry, running)));
  });

  readonly #pin = Effect.fn("LocalServers.pin")(function* (
    this: LocalServers,
    entry: StoredLocalServer,
    ready: LocalServerReady,
  ): Effect.fn.Return<{ fingerprint: string; publicKey: string }, LocalServerFailure> {
    const current = this.#registry.find(entry.id) ?? entry;
    if (current.serverId === null || current.fingerprint === null || current.publicKey === null) {
      yield* this.#registry
        .update(entry.id, { serverId: ready.serverId, fingerprint: ready.fingerprint, publicKey: ready.publicKey })
        .pipe(toLocalServerFailure);
      return { fingerprint: ready.fingerprint, publicKey: ready.publicKey };
    }
    if (
      current.serverId !== ready.serverId ||
      current.fingerprint !== ready.fingerprint ||
      current.publicKey !== ready.publicKey
    )
      return yield* new LocalServerFailure({ cause: new Error(sourceText("error.remote.identityNotVerified")) });
    return { fingerprint: current.fingerprint, publicKey: current.publicKey };
  });

  #exited(entry: StoredLocalServer, running: RunningChild, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#running.get(entry.id) === running) {
      this.#running.delete(entry.id);
      this.#working.delete(entry.id);
      this.#published.delete(entry.id);
      this.#announcePublished();
    }
    if (running.stopping || this.#stopped) return;
    this.#options.log.warn(`A server on this computer stopped (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
    const serverId = this.#registry.find(entry.id)?.serverId;
    if (serverId)
      this.#background(this.#options.remoteServers.detachLocalServer(serverId, false).pipe(toLocalServerFailure));
    this.#scheduleRestart(entry);
  }

  #startInBackground(entry: StoredLocalServer): void {
    this.#background(
      this.#startIfStopped(entry).pipe(Effect.tapError(() => Effect.sync(() => this.#scheduleRestart(entry)))),
    );
  }

  #scheduleRestart(entry: StoredLocalServer): void {
    if (this.#stopped || this.#restartPending.has(entry.id)) return;
    const now = Date.now();
    const exits = (this.#exits.get(entry.id) ?? []).filter((time) => now - time < RESTART_WINDOW_MS);
    exits.push(now);
    this.#exits.set(entry.id, exits);
    if (exits.length > RESTART_LIMIT) return;
    this.#restartPending.add(entry.id);
    this.#background(
      Effect.sleep(RESTART_DELAY).pipe(
        Effect.andThen(
          Effect.sync(() => {
            this.#restartPending.delete(entry.id);
            const current = this.#registry.find(entry.id);
            if (current) this.#startInBackground(current);
          }),
        ),
      ),
    );
  }

  #startIfStopped(entry: StoredLocalServer): Effect.Effect<ServerSummary | null, LocalServerFailure> {
    return Effect.suspend(() => {
      const pending = this.#starts.get(entry.id);
      if (pending) return Deferred.await(pending);
      if (this.#running.has(entry.id)) return Effect.succeed(null);
      const done = Deferred.makeUnsafe<ServerSummary, LocalServerFailure>();
      this.#starts.set(entry.id, done);
      return this.#start(entry).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (this.#starts.get(entry.id) === done) this.#starts.delete(entry.id);
            Deferred.doneUnsafe(done, exit);
          }),
        ),
      );
    });
  }

  readonly #renewSession = Effect.fn("LocalServers.renewSession")(function* (
    this: LocalServers,
    entry: StoredLocalServer,
    running: RunningChild,
    attach: LocalServerAttachInput,
  ) {
    let loggedInAt = Date.now();
    yield* Effect.sleep(SESSION_CHECK_INTERVAL);
    while (this.#running.get(entry.id) === running) {
      if (Date.now() - loggedInAt >= SESSION_RENEW_AFTER_MS)
        yield* this.#options.remoteServers.attachLocalServer(attach).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              loggedInAt = Date.now();
            }),
          ),
          Effect.catch(({ cause }) =>
            Effect.sync(() => this.#options.log.warn("A server on this computer did not renew its session.", cause)),
          ),
        );
      yield* Effect.sleep(SESSION_CHECK_INTERVAL);
    }
  });

  readonly #stopChild = Effect.fn("LocalServers.stopChild")(function* (
    this: LocalServers,
    entry: StoredLocalServer,
    only?: RunningChild,
  ) {
    const running = only ?? this.#running.get(entry.id);
    if (running) {
      if (only?.stopping) return;
      running.stopping = true;
      yield* terminate(running.child, this.#options.platform);
      if (this.#running.get(entry.id) === running) {
        this.#running.delete(entry.id);
        this.#published.delete(entry.id);
        this.#announcePublished();
      }
    }
    if (only && this.#running.has(entry.id)) return;
    const serverId = this.#registry.find(entry.id)?.serverId;
    if (serverId)
      yield* this.#options.remoteServers.detachLocalServer(serverId, false).pipe(Effect.catch(() => Effect.void));
  });

  readonly #forget = Effect.fn("LocalServers.forget")(function* (
    this: LocalServers,
    entry: StoredLocalServer,
    removeFromAccount = true,
  ) {
    yield* this.#stopChild(entry);
    const paths = this.#paths(entry);
    for (const path of [paths.userData, paths.agentRoot]) {
      if (yield* pathExists(path)) yield* localIO(() => this.#options.trash(path));
    }
    const serverId = this.#registry.find(entry.id)?.serverId ?? null;
    yield* this.#registry.remove(entry.id, serverId).pipe(toLocalServerFailure);
    this.#exits.delete(entry.id);
    this.#ready.delete(entry.id);
    if (serverId) yield* this.#options.remoteServers.detachLocalServer(serverId, true).pipe(toLocalServerFailure);
    this.#announce();
    if (removeFromAccount && this.#options.account.accountId() !== null)
      this.#background(this.#accountSteps.withPermit(this.#removeDeletedHosts()));
  });
}

function terminate(child: ChildProcess, platform: NodeJS.Platform): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void);
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resume(Effect.void);
    });
    const control = controlPipe(child, platform);
    control?.end(() => control.destroy());
    if (platform !== "win32") child.kill("SIGTERM");
  });
}
