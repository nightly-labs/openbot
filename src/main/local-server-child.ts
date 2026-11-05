/**
 * A local server: a second OpenBot server on this computer, which the desktop app starts as a
 * headless child process of itself (`local-servers/local-servers.ts`). It has its own user data
 * directory and its own agent root, so its database, agents, chats and files stay apart from the
 * app's own server. It shows no window and listens only on the loopback Team API.
 *
 * The parent passes the server name and the owner password in the environment. The password is
 * removed from the environment here, before any agent or provider process starts, so that no child
 * of this process can read it.
 *
 * While the desktop app is signed in, it registers this server for its account and writes the
 * server's machine token to the control pipe. This process then also meets the owner's devices on
 * Signal, and sends their notifications, with that token. It keeps the token in memory only.
 *
 * The account directory needs an account session, which this process does not have. When it must read
 * its members, it writes a request line to stdout, and the desktop app writes the list to the control
 * pipe. After the desktop app changes a member, it writes the new list without a request.
 */

import { Socket } from "node:net";
import { isAbsolute } from "node:path";
import type { Readable } from "node:stream";
import { Deferred, Effect, Exit, Schema, Semaphore } from "effect";
import { decodeRemoteMembers, type RemoteMemberRecord } from "./central-auth-records";
import type { HostService } from "./host-service";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TeamStore } from "./team-store";

/** The username of the one member of a local server. The desktop app logs in as it. */
export const LOCAL_SERVER_OWNER_USERNAME = "owner";
/** The prefix of the one stdout line that tells the parent where the Team API listens. */
export const LOCAL_SERVER_READY_PREFIX = "OPENBOT_LOCAL_SERVER_READY ";
/** The stdout line that asks the parent for this server's account directory. It holds no data. */
export const LOCAL_SERVER_MEMBERS_REQUEST = "OPENBOT_LOCAL_SERVER_REQUEST members";
/** How long a read of the account directory waits for the parent's answer. */
const LOCAL_SERVER_MEMBERS_TIMEOUT_MS = 30_000;

/**
 * The pipe from the desktop app on Windows: there Electron replaces `process.stdin` with a stream that
 * only ends (#4868). On the other systems the pipe is standard input, which the processes that this
 * server starts do not inherit.
 */
export const LOCAL_SERVER_CONTROL_FD = 3;

/**
 * The pipe from the desktop app: its commands, and its end when the app stops. Null when the parent
 * gave no pipe, so that this process cannot know when the app stops.
 */
export function openLocalServerControl(
  platform: NodeJS.Platform,
  onFailure: (cause: unknown) => void,
): Readable | null {
  if (platform !== "win32") return process.stdin;
  try {
    return new Socket({ fd: LOCAL_SERVER_CONTROL_FD, readable: true, writable: false });
  } catch (error) {
    onFailure(error);
    return null;
  }
}

export const LOCAL_SERVER_ENVIRONMENT = {
  child: "OPENBOT_LOCAL_SERVER_CHILD",
  agentRoot: "OPENBOT_LOCAL_SERVER_ROOT",
  name: "OPENBOT_LOCAL_SERVER_NAME",
  secret: "OPENBOT_LOCAL_SERVER_SECRET",
  runtimeRoot: "OPENBOT_LOCAL_SERVER_RUNTIMES",
} as const;

export interface LocalServerChildEnvironment {
  /** The folder that holds the agents of this server, in place of `~/OpenBot`. */
  agentRoot: string;
  /** The name of the server when it is made. A rename later goes through the Team API. */
  serverName: string;
  ownerSecret: string;
  /** The provider CLI store of the desktop app. The servers of one computer share one copy of each CLI. */
  runtimeRoot: string | null;
}

export interface LocalServerReady {
  serverId: string;
  serverName: string;
  apiUrl: string;
  fingerprint: string;
  publicKey: string;
  /** The member that the account service records as the owner's membership when the parent registers this server. */
  ownerMemberId: string;
}

/**
 * A line that the parent writes to the control pipe. `publish` gives the machine token of this server's
 * registration; `unpublish` follows a sign-out of the desktop app. No other process sees the token.
 * `members` is this server's account directory; `members-unavailable` answers a request that the parent
 * could not read, for example while it is signed out.
 */
const localServerCommandSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("publish"), machineToken: Schema.String }),
  Schema.Struct({ type: Schema.Literal("unpublish") }),
  Schema.Struct({ type: Schema.Literal("members"), members: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("members-unavailable") }),
]);
export type LocalServerCommand = typeof localServerCommandSchema.Type;
type ParsedLocalServerCommand =
  | Exclude<LocalServerCommand, { type: "members" }>
  | { type: "members"; members: RemoteMemberRecord[] };
const decodeLocalServerCommand = Schema.decodeUnknownSync(localServerCommandSchema);

export function formatLocalServerCommand(command: LocalServerCommand): string {
  return `${JSON.stringify(command)}\n`;
}

export function formatLocalServerMembersRequest(): string {
  return `${LOCAL_SERVER_MEMBERS_REQUEST}\n`;
}

/** Null for a line that is not a command, so a stray line does nothing. */
function parseLocalServerCommand(line: string): ParsedLocalServerCommand | null {
  try {
    const command = decodeLocalServerCommand(JSON.parse(line));
    return command.type === "members" ? { type: "members", members: decodeRemoteMembers(command) } : command;
  } catch {
    return null;
  }
}

function membersUnavailable(): RemoteWorkflowError {
  return new RemoteWorkflowError({ cause: new Error("The desktop app did not read the account directory.") });
}

/**
 * This server's account directory, read through the parent. Requests that wait at the same time share
 * one answer.
 */
export class LocalServerMembers {
  readonly #request: () => void;
  #pending: Deferred.Deferred<RemoteMemberRecord[], RemoteWorkflowError> | null = null;

  constructor(request: () => void) {
    this.#request = request;
  }

  readonly list = Effect.fn("LocalServerMembers.list")(function* (
    this: LocalServerMembers,
  ): Effect.fn.Return<RemoteMemberRecord[], RemoteWorkflowError> {
    let pending = this.#pending;
    if (!pending) {
      pending = Deferred.makeUnsafe<RemoteMemberRecord[], RemoteWorkflowError>();
      this.#pending = pending;
      this.#request();
    }
    const current = pending;
    return yield* Deferred.await(current).pipe(
      Effect.timeoutOrElse({
        duration: LOCAL_SERVER_MEMBERS_TIMEOUT_MS,
        orElse: () => Effect.fail(membersUnavailable()),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#pending === current) this.#pending = null;
        }),
      ),
    );
  }).bind(this);

  /** Gives the parent's answer to the waiting requests. False when no request waits for it. */
  answer(members: RemoteMemberRecord[] | null): boolean {
    const pending = this.#pending;
    if (!pending) return false;
    this.#pending = null;
    Deferred.doneUnsafe(pending, members ? Exit.succeed(members) : Exit.fail(membersUnavailable()));
    return true;
  }
}

/** How this server meets the owner's devices once the parent registered it. */
interface LocalServerPublisher {
  publish(machineToken: string): Effect.Effect<void, RemoteWorkflowError>;
  unpublish(): Effect.Effect<void, RemoteWorkflowError>;
}

/**
 * Returns null unless the desktop app started this process as a local server. An explicit
 * `--user-data-dir` is required, so that a stray variable cannot make the normal app open its own
 * profile without a window.
 */
export function takeLocalServerChildEnvironment(
  environment: NodeJS.ProcessEnv,
  userDataDirectory: string,
): LocalServerChildEnvironment | null {
  const flag = environment[LOCAL_SERVER_ENVIRONMENT.child];
  const agentRoot = environment[LOCAL_SERVER_ENVIRONMENT.agentRoot]?.trim() ?? "";
  const serverName = environment[LOCAL_SERVER_ENVIRONMENT.name]?.trim() ?? "";
  const ownerSecret = environment[LOCAL_SERVER_ENVIRONMENT.secret] ?? "";
  const runtimeRoot = environment[LOCAL_SERVER_ENVIRONMENT.runtimeRoot]?.trim() ?? "";
  for (const name of Object.values(LOCAL_SERVER_ENVIRONMENT)) delete environment[name];
  if (flag !== "1" || !userDataDirectory || !isAbsolute(agentRoot) || !serverName || !ownerSecret) return null;
  return { agentRoot, serverName, ownerSecret, runtimeRoot: isAbsolute(runtimeRoot) ? runtimeRoot : null };
}

/** The ready line holds no secret: the parent knows the password, and the session is made later. */
export function formatLocalServerReady(ready: LocalServerReady): string {
  return `${LOCAL_SERVER_READY_PREFIX}${JSON.stringify(ready)}\n`;
}

export interface StartLocalServerChildOptions {
  environment: LocalServerChildEnvironment;
  teamStore: Pick<TeamStore, "configured" | "configure" | "getIdentity" | "getOwnerMemberId">;
  host: Pick<HostService, "startLoopbackOnly" | "applyAccountDirectory">;
  /** The reads of the account directory that wait for the parent. */
  members: Pick<LocalServerMembers, "answer">;
  writeReady: (line: string) => void;
  /** Calls `onLine` with each line of the control pipe. */
  readCommands: (onLine: (line: string) => void) => void;
  publisher: LocalServerPublisher;
  /** A failed command leaves the server on loopback only. The message names no secret. */
  warn: (message: string, cause: unknown) => void;
}

/**
 * Makes the owner at the first start, then starts the Team API on loopback only. The store keeps a
 * host with no account owner bound at the next start, so the identity keys stay the same.
 */
export const startLocalServerChild = Effect.fn("LocalServerChild.start")(function* ({
  environment,
  teamStore,
  host,
  writeReady,
  readCommands,
  publisher,
  members,
  warn,
}: StartLocalServerChildOptions) {
  if (!teamStore.configured)
    yield* teamStore.configure(environment.serverName, LOCAL_SERVER_OWNER_USERNAME, environment.ownerSecret);
  const status = yield* host.startLoopbackOnly();
  const identity = teamStore.getIdentity();
  const ownerMemberId = teamStore.getOwnerMemberId();
  // The parent waits for the ready line. An error ends this process now, so the parent does not wait
  // for its time limit.
  if (!identity || !status.apiUrl || !ownerMemberId)
    return yield* new RemoteWorkflowError({ cause: new Error("The local server has no identity or API address.") });
  // Before the ready line: the parent can write a command as soon as it reads that line. One command
  // runs at a time, in the order the parent wrote them.
  const commands = Semaphore.makeUnsafe(1);
  readCommands((line) => {
    const command = parseLocalServerCommand(line);
    if (!command) return;
    if (command.type === "members-unavailable") {
      members.answer(null);
      return;
    }
    if (command.type === "members") {
      // A list that no read waits for follows a member change on the desktop app.
      if (members.answer(command.members)) return;
      Effect.runFork(
        host
          .applyAccountDirectory(command.members)
          .pipe(
            Effect.catch((error) =>
              Effect.sync(() => warn("The server on this computer did not apply the account directory.", error.cause)),
            ),
          ),
      );
      return;
    }
    const run = command.type === "publish" ? publisher.publish(command.machineToken) : publisher.unpublish();
    Effect.runFork(
      commands.withPermit(
        run.pipe(
          Effect.catch((error) =>
            Effect.sync(() => warn(`The server on this computer did not ${command.type}.`, error.cause)),
          ),
        ),
      ),
    );
  });
  writeReady(
    formatLocalServerReady({
      serverId: identity.serverId,
      serverName: identity.serverName,
      apiUrl: status.apiUrl,
      fingerprint: identity.fingerprint,
      publicKey: identity.publicKey,
      ownerMemberId,
    }),
  );
});
