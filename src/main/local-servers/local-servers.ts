// The servers on this computer: each one is OpenBot itself, started as a child process with its own
// user data directory and agent root (`local-server-child.ts`). The desktop app reaches each one
// over the loopback Team API, as it reaches a joined server, and logs in as its owner at each start.
//
// A child ends when its standard input closes, so it stops also when this process is killed. The
// supervisor starts a child again after it stops on its own, a few times only, so a child that cannot
// start does not use the computer's power in a loop.
//
// The owner password goes to the child in its environment, and the child removes it from there at
// once. No password or session token is written to a log.
//
// While the desktop app is signed in, each running server is registered for its account, with the
// child's key and owner member. The machine token of the registration goes to the child on its
// standard input, so the child meets the owner's devices on Signal and sends their notifications. A
// sign-out tells each child to stop that. A deleted server is removed from the account; until the
// account service confirms it, the registry keeps its id, so the directory sync does not list it.

import { type ChildProcess, type SpawnOptions, spawn as spawnProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { LOCAL_SERVER_LIMIT, type ServerSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Deferred, Duration, Effect, Exit, Schema, Scope, Semaphore } from "effect";
import { causeHelpers } from "../../backend/effect-boundary";
import {
  formatLocalServerCommand,
  LOCAL_SERVER_ENVIRONMENT,
  LOCAL_SERVER_OWNER_USERNAME,
  LOCAL_SERVER_READY_PREFIX,
  type LocalServerCommand,
  type LocalServerReady,
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

/** A first start makes the database and the identity keys, so it can take longer than a later one. */
const READY_TIMEOUT = Duration.seconds(90);
/** The child quits on its own when its standard input closes. After this it is killed. */
const STOP_GRACE_MS = 6_000;
const RESTART_DELAY = Duration.seconds(5);
const RESTART_WINDOW_MS = 10 * 60_000;
const RESTART_LIMIT = 3;
/** A team session lasts 30 days, and use does not extend it. The desktop logs in again well before. */
const SESSION_RENEW_AFTER_MS = 7 * 24 * 60 * 60_000;
const SESSION_CHECK_INTERVAL = Duration.hours(1);

/**
 * Variables that the child must not take from this process: they choose the Node mode, the profile,
 * the debugging port and the role of a development stack, and a child with them would open another
 * profile or take a port that this process holds.
 */
function childEnvironment(
  entry: StoredLocalServer,
  agentRoot: string,
  runtimeRoot: string,
  secret: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "ELECTRON_RUN_AS_NODE" || name.startsWith("OPENBOT_DEV_")) continue;
    environment[name] = value;
  }
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

/** Only a loopback address is accepted: the session token goes to it. */
function parseReadyLine(line: string): LocalServerReady | null {
  if (!line.startsWith(LOCAL_SERVER_READY_PREFIX)) return null;
  try {
    const ready = decodeReady(JSON.parse(line.slice(LOCAL_SERVER_READY_PREFIX.length)));
    return isLocalDevelopmentApi(ready.apiUrl) ? ready : null;
  } catch {
    return null;
  }
}

function startFailure(): LocalServerFailure {
  return new LocalServerFailure({ cause: new Error(sourceText("error.remote.localServerStartFailed")) });
}

/** A registry that cannot be read keeps its rows, so nothing may start, move, remove or change them. */
function readOnlyFailure(): LocalServerFailure {
  return new LocalServerFailure({ cause: new Error(sourceText("error.remote.localServersReadOnly")) });
}

interface RunningChild {
  readonly child: ChildProcess;
  /** Set before this process ends the child, so that its exit does not start it again. */
  stopping: boolean;
}

/** The account of the desktop app, for which each server is registered while it is signed in. */
interface LocalServerAccount {
  /** The signed-in account, or null. */
  accountId(): string | null;
  register(input: {
    hostId: string;
    name: string;
    ownerMembershipId: string;
    devicePublicKey: string;
  }): Effect.Effect<void, RemoteWorkflowError>;
  /** The machine token of a registered server. Never logged. */
  credential(hostId: string): string | null;
  /** Removes a deleted server. A server that the account service refuses for good counts as removed. */
  remove(hostId: string): Effect.Effect<void, RemoteWorkflowError>;
}

/** A server on this computer, as the owner's other devices see it (`local-servers-v1`). */
export interface LocalServerListing {
  serverId: string;
  name: string;
  /** Registered for the account, so the owner's devices list it. */
  published: boolean;
}

export interface LocalServersOptions {
  registryPath: string;
  /** One user data directory for each server, named by its id. */
  userDataRoot: string;
  /** One agent root for each server, named by its id: `~/OpenBot/Servers`. */
  agentRoot: string;
  /** The provider CLI store of this app. A child has its own user data, but not its own copy of each CLI. */
  runtimeRoot: string;
  cipher: TokenCipher;
  remoteServers: Pick<RemoteServerManager, "setThisComputerServers" | "attachLocalServer" | "detachLocalServer">;
  account: LocalServerAccount;
  /** This executable, and the app path when it is not packaged. */
  command: { executable: string; args: readonly string[] };
  /** Moves a folder to the Trash. A deleted server's data stays recoverable. */
  trash: (path: string) => Promise<void>;
  log: { info: (message: string) => void; warn: (message: string, detail?: unknown) => void };
  platform: NodeJS.Platform;
  spawn?: SpawnChild;
}

export type SpawnChild = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export class LocalServers {
  readonly #options: LocalServersOptions;
  readonly #registry: LocalServerRegistry;
  readonly #spawn: SpawnChild;
  readonly #scope = Scope.makeUnsafe("parallel");
  readonly #running = new Map<string, RunningChild>();
  /** The times each server stopped on its own, in the last `RESTART_WINDOW_MS`. */
  readonly #exits = new Map<string, number[]>();
  /** The last ready line of each running server, by registry id. */
  readonly #ready = new Map<string, LocalServerReady>();
  /** The registry ids of the children that have a machine token, and the account it belongs to. */
  readonly #published = new Set<string>();
  #publishedAccountId: string | null = null;
  /** One account step at a time, so a publish cannot reach a child after the unpublish of a sign-out. */
  readonly #accountSteps = Semaphore.makeUnsafe(1);
  #stopped = false;

  constructor(options: LocalServersOptions) {
    this.#options = options;
    this.#registry = new LocalServerRegistry(options.registryPath);
    this.#spawn = options.spawn ?? spawnProcess;
  }

  /** The process ids of the children, which the update install does not wait for. */
  pids(): ReadonlySet<number> {
    const pids = new Set<number>();
    for (const { child } of this.#running.values()) if (child.pid !== undefined) pids.add(child.pid);
    return pids;
  }

  /** `local-servers-v1`: the servers that started at least once, with the name of their last start. */
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

  /**
   * The desktop app signed in, signed out, or changed account. Each running server is registered for
   * the signed-in account, and a sign-out or another account tells each child to stop meeting devices.
   */
  readonly accountChanged = Effect.fn("LocalServers.accountChanged")(
    function* (this: LocalServers) {
      if (this.#stopped) return;
      const accountId = this.#options.account.accountId();
      if (this.#publishedAccountId !== null && this.#publishedAccountId !== accountId) {
        for (const id of this.#published) this.#send(id, { type: "unpublish" });
        this.#published.clear();
        this.#publishedAccountId = null;
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

  /** Before `remoteServers.initialize()`, so that the account's directory sync keeps these servers. */
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

  /**
   * After `remoteServers.initialize()` and before the event connections start. The entries that the
   * last run left are made safe first: a run that crashed left the old port and session in them.
   * Then every server starts, in the background.
   */
  readonly initialize = Effect.fn("LocalServers.initialize")(function* (this: LocalServers) {
    if (this.#registry.readOnly) {
      this.#options.log.warn(sourceText("error.remote.localServersReadOnly"));
      return;
    }
    for (const entry of this.#registry.servers) {
      if (entry.serverId)
        yield* this.#options.remoteServers
          .detachLocalServer(entry.serverId, false)
          .pipe(Effect.catch(() => Effect.void));
    }
    for (const entry of this.#registry.servers) this.#background(this.#start(entry, false));
  });

  /**
   * The desktop app's create opens the new server. A create from another device leaves the app as it is,
   * and answers after the registration, so the device finds the server in the account's list.
   */
  readonly create = Effect.fn("LocalServers.create")(function* (
    this: LocalServers,
    name: string,
    from: "desktop" | "device" = "desktop",
  ): Effect.fn.Return<ServerSummary, LocalServerFailure> {
    if (this.#registry.readOnly) return yield* readOnlyFailure();
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
    return yield* this.#start(entry, from === "desktop", from === "device").pipe(
      Effect.tapError(() =>
        // A server that never started holds nothing of the user's yet.
        this.#forget(entry).pipe(
          Effect.catch(({ cause }) =>
            Effect.sync(() => this.#options.log.warn("A server that did not start could not be removed.", cause)),
          ),
        ),
      ),
    );
  });

  /** Stops the server, then starts it again with a new port and a new session. */
  readonly restart = Effect.fn("LocalServers.restart")(function* (this: LocalServers, serverId: string) {
    if (this.#registry.readOnly) return yield* readOnlyFailure();
    const entry = yield* this.#entry(serverId);
    yield* this.#stopChild(entry);
    this.#exits.delete(entry.id);
    yield* this.#start(entry, false);
  });

  /**
   * Moves the server's database, agents and files to the Trash. A delete from another device answers after the account service removed the server, and fails when
   * it did not: the device would list the server again. The same delete again then repeats only the
   * account removal, because the server is already gone from this computer.
   */
  readonly delete = Effect.fn("LocalServers.delete")(function* (
    this: LocalServers,
    serverId: string,
    from: "desktop" | "device" = "desktop",
  ) {
    if (this.#registry.readOnly) return yield* readOnlyFailure();
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

  /** The remote server manager keeps these entries through the account's directory sync. */
  #announce(): void {
    this.#options.remoteServers.setThisComputerServers([
      ...this.#registry.servers.flatMap((entry) => (entry.serverId ? [entry.serverId] : [])),
      // A deleted server that the account service can still list must not come back as a joined server.
      ...this.#registry.removedHostIds,
    ]);
  }

  /** Writes one command to the child's standard input. A child that is gone gets nothing. */
  #send(id: string, command: LocalServerCommand): void {
    const running = this.#running.get(id);
    if (!running || running.stopping || !running.child.stdin?.writable) return;
    running.child.stdin.write(formatLocalServerCommand(command));
  }

  /** Registers a running server for the signed-in account and gives the child its machine token. */
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
            // The account or the child changed while the registration ran: the next account step or start publishes.
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
          }),
        ),
        Effect.catch(({ cause }) =>
          Effect.sync(() =>
            this.#options.log.warn("A server on this computer was not registered for the account.", cause),
          ),
        ),
      );
  });

  /** Removes the deleted servers from the account. One that fails stays for the next try. */
  readonly #removeDeletedHosts = Effect.fn("LocalServers.removeDeletedHosts")(function* (this: LocalServers) {
    if (this.#registry.readOnly) return;
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
    select: boolean,
    awaitRegistration = false,
  ): Effect.fn.Return<ServerSummary, LocalServerFailure> {
    if (this.#stopped) return yield* startFailure();
    if (this.#registry.readOnly) return yield* readOnlyFailure();
    const secret = yield* localSync(() => this.#options.cipher.decrypt(Buffer.from(entry.encryptedSecret, "base64")));
    registerSecretValue(secret);
    const paths = this.#paths(entry);
    yield* localIO(() => mkdir(paths.userData, { recursive: true, mode: 0o700 }));
    yield* localIO(() => mkdir(paths.agentRoot, { recursive: true }));

    const child = yield* localSync(() =>
      this.#spawn(
        this.#options.command.executable,
        [...this.#options.command.args, `--user-data-dir=${paths.userData}`],
        {
          env: childEnvironment(entry, paths.agentRoot, this.#options.runtimeRoot, secret),
          // Standard input carries only the account commands, and it closes when OpenBot ends.
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      ),
    );
    const running: RunningChild = { child, stopping: false };
    this.#running.set(entry.id, running);
    const ready = Deferred.makeUnsafe<LocalServerReady, LocalServerFailure>();
    // The child writes its own log file. Its output is read only for the ready line, and the rest is
    // read and dropped so that a full pipe cannot stop the child.
    if (child.stdout)
      createInterface({ input: child.stdout }).on("line", (line) => {
        const value = parseReadyLine(line);
        if (value) Deferred.doneUnsafe(ready, Exit.succeed(value));
      });
    child.stderr?.resume();
    // A command can reach a child that stopped before its exit event: the closed pipe then fails the
    // write. The exit handler deals with the child, so the write error is dropped.
    child.stdin?.on("error", () => undefined);
    child.once("error", (error: Error) => {
      Deferred.doneUnsafe(ready, Exit.fail(new LocalServerFailure({ cause: error })));
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
        select,
      };
      const summary = yield* this.#options.remoteServers.attachLocalServer(attach).pipe(toLocalServerFailure);
      this.#options.log.info(`A server on this computer started (pid ${child.pid ?? "unknown"}).`);
      this.#ready.set(entry.id, value);
      // The desktop app does not wait for the account service: the server runs already.
      const register = this.#accountSteps.withPermit(this.#publishUnlocked(entry, running));
      if (awaitRegistration) yield* register;
      else this.#background(register);
      this.#background(this.#renewSession(entry, running, { ...attach, select: false }));
      return summary;
    }).pipe(Effect.tapError(() => this.#stopChild(entry, running)));
  });

  /** The first start pins the identity. A later start must report the same one. */
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
      // The next child gets its machine token again when it starts.
      this.#published.delete(entry.id);
    }
    if (running.stopping || this.#stopped) return;
    this.#options.log.warn(`A server on this computer stopped (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
    const serverId = this.#registry.find(entry.id)?.serverId;
    if (serverId)
      this.#background(this.#options.remoteServers.detachLocalServer(serverId, false).pipe(toLocalServerFailure));
    const now = Date.now();
    const exits = (this.#exits.get(entry.id) ?? []).filter((time) => now - time < RESTART_WINDOW_MS);
    exits.push(now);
    this.#exits.set(entry.id, exits);
    if (exits.length > RESTART_LIMIT) return;
    this.#background(
      Effect.sleep(RESTART_DELAY).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            const current = this.#registry.find(entry.id);
            return current && !this.#running.has(entry.id) ? this.#start(current, false) : Effect.void;
          }),
        ),
      ),
    );
  }

  /**
   * The computer can run for longer than a session lasts: it sleeps, and the app does not quit. The
   * check uses the wall clock, because a timer does not count the time that the computer sleeps.
   */
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

  /**
   * Ends the child: its standard input closes, then a kill after the grace time. A failed start names
   * its own child in `only`: a restart can already have stopped it, or started a newer child that now
   * holds the entry.
   */
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
      }
    }
    if (only && this.#running.has(entry.id)) return;
    const serverId = this.#registry.find(entry.id)?.serverId;
    if (serverId)
      yield* this.#options.remoteServers.detachLocalServer(serverId, false).pipe(Effect.catch(() => Effect.void));
  });

  /** Stops the server, moves its folders to the Trash, and removes it from both lists. */
  readonly #forget = Effect.fn("LocalServers.forget")(function* (
    this: LocalServers,
    entry: StoredLocalServer,
    removeFromAccount = true,
  ) {
    if (this.#registry.readOnly) return yield* readOnlyFailure();
    yield* this.#stopChild(entry);
    const paths = this.#paths(entry);
    for (const path of [paths.userData, paths.agentRoot]) {
      const exists = yield* localIO(() => stat(path)).pipe(
        Effect.as(true),
        Effect.catch(({ cause }) =>
          cause instanceof Error && "code" in cause && cause.code === "ENOENT"
            ? Effect.succeed(false)
            : Effect.fail(new LocalServerFailure({ cause })),
        ),
      );
      if (exists) yield* localIO(() => this.#options.trash(path));
    }
    const serverId = this.#registry.find(entry.id)?.serverId ?? null;
    // The account service can list the server even when this app does not know that it was registered:
    // a registration from before a sign-out. The removal confirms either way.
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
    child.stdin?.end();
    // On Windows a signal ends the process at once, so the closed input is the only request there.
    if (platform !== "win32") child.kill("SIGTERM");
  });
}
