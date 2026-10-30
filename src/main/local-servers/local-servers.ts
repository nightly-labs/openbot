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

import { type ChildProcess, type SpawnOptions, spawn as spawnProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { LOCAL_SERVER_LIMIT, type ServerSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Deferred, Duration, Effect, Exit, Schema, Scope } from "effect";
import { causeHelpers } from "../../backend/effect-boundary";
import {
  LOCAL_SERVER_ENVIRONMENT,
  LOCAL_SERVER_OWNER_USERNAME,
  LOCAL_SERVER_READY_PREFIX,
  type LocalServerReady,
} from "../local-server-child";
import type { LocalServerAttachInput, RemoteServerManager } from "../remote-server-manager";
import type { TokenCipher } from "../remote-server-store";
import { isLocalDevelopmentApi } from "../remote-server-urls";
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

interface RunningChild {
  readonly child: ChildProcess;
  /** Set before this process ends the child, so that its exit does not start it again. */
  stopping: boolean;
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
    for (const entry of this.#registry.servers) {
      if (entry.serverId)
        yield* this.#options.remoteServers
          .detachLocalServer(entry.serverId, false)
          .pipe(Effect.catch(() => Effect.void));
    }
    for (const entry of this.#registry.servers) this.#background(this.#start(entry, false));
  });

  readonly create = Effect.fn("LocalServers.create")(function* (
    this: LocalServers,
    name: string,
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
    return yield* this.#start(entry, true).pipe(
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
    const entry = yield* this.#entry(serverId);
    yield* this.#stopChild(entry);
    this.#exits.delete(entry.id);
    yield* this.#start(entry, false);
  });

  /** Moves the server's database, agents and files to the Trash. */
  readonly delete = Effect.fn("LocalServers.delete")(function* (this: LocalServers, serverId: string) {
    const entry = yield* this.#entry(serverId);
    yield* this.#forget(entry);
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
    this.#options.remoteServers.setThisComputerServers(
      this.#registry.servers.flatMap((entry) => (entry.serverId ? [entry.serverId] : [])),
    );
  }

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
  ): Effect.fn.Return<ServerSummary, LocalServerFailure> {
    if (this.#stopped) return yield* startFailure();
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
          // Nothing is written to standard input. It stays open only so that it closes when OpenBot ends.
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
    if (this.#running.get(entry.id) === running) this.#running.delete(entry.id);
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
      if (this.#running.get(entry.id) === running) this.#running.delete(entry.id);
    }
    if (only && this.#running.has(entry.id)) return;
    const serverId = this.#registry.find(entry.id)?.serverId;
    if (serverId)
      yield* this.#options.remoteServers.detachLocalServer(serverId, false).pipe(Effect.catch(() => Effect.void));
  });

  /** Stops the server, moves its folders to the Trash, and removes it from both lists. */
  readonly #forget = Effect.fn("LocalServers.forget")(function* (this: LocalServers, entry: StoredLocalServer) {
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
    const serverId = this.#registry.find(entry.id)?.serverId;
    yield* this.#registry.remove(entry.id).pipe(toLocalServerFailure);
    this.#exits.delete(entry.id);
    if (serverId) yield* this.#options.remoteServers.detachLocalServer(serverId, true).pipe(toLocalServerFailure);
    this.#announce();
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
