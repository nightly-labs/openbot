/**
 * A self-hosted server: the packaged Linux build that `install-server.sh` installs on a computer
 * with no screen. systemd starts it with `OPENBOT_SERVER=1` under a virtual display, and it is a
 * normal Remote host after its owner signs in.
 *
 * Nobody can use the window, so the `openbot` terminal command (`scripts/hosting/openbot`) talks to
 * this process over a Unix socket in the runtime directory that systemd makes for the service user
 * (mode 0700). Only that user and root can connect. Agents run as the same user and already have
 * full access to its files, so the socket gives them nothing new. The socket answers a closed list
 * of requests: status, the email-code sign-in, the server name and sign-out. It never sends the
 * session token or the sign-in code back.
 *
 * The protocol is HTTP with form bodies and `key=value` text lines, so the command needs only
 * `curl --unix-socket`.
 */

import { chmod, lstat, unlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { parseHostedServerName } from "@openbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { CentralAuthState } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import type { CentralAuthManager } from "./central-auth-manager";
import type { HostService } from "./host-service";
import { RemoteWorkflowError } from "./remote-service-effects";

const CONTROL_SOCKET_FILE = "control.sock";
const MAX_BODY_BYTES = 4096;
const MAX_EMAIL_LENGTH = 254;
/** The name of a server whose owner signed in without one. The same default as a mobile connect. */
const DEFAULT_SERVER_NAME = "OpenBot";

export interface ServerModeEnvironment {
  controlSocketPath: string;
}

/** Returns null unless this process is a self-hosted server that systemd started. */
export function takeServerModeEnvironment(
  environment: NodeJS.ProcessEnv,
  isPackaged: boolean,
  platform: NodeJS.Platform,
): ServerModeEnvironment | null {
  if (!isPackaged || platform !== "linux" || environment.OPENBOT_SERVER !== "1") return null;
  // A hosted server signs in with its claim, not from a terminal.
  if (environment.OPENBOT_HOSTED_SERVER === "1") return null;
  const runtimeDirectory = environment.XDG_RUNTIME_DIR?.trim() ?? "";
  if (!isAbsolute(runtimeDirectory)) return null;
  return { controlSocketPath: join(runtimeDirectory, CONTROL_SOCKET_FILE) };
}

export interface ServerModeOptions {
  environment: ServerModeEnvironment;
  version: string;
  centralAuth: Pick<CentralAuthManager, "getState" | "requestEmailCode" | "verifyEmailCode" | "logout">;
  host: Pick<HostService, "getStatus" | "configure" | "start" | "updateIdentity">;
  onError: (message: string, error: unknown) => void;
  /** Tests only. */
  uid?: number;
}

interface Answer {
  status: number;
  lines: Record<string, string | number | null>;
}

export class ServerMode {
  readonly #options: ServerModeOptions;
  readonly #sockets = new Set<Socket>();
  #server: Server | null = null;
  #pendingName: string | null = null;
  /** Why the last publish failed. Nobody reads the journal, so `status` shows it. */
  #publishError: string | null = null;
  #publishing: Deferred.Deferred<void> | null = null;

  constructor(options: ServerModeOptions) {
    this.#options = options;
  }

  /** Binds the control socket. It refuses a runtime directory that another user could enter. */
  async listen(): Promise<void> {
    const path = this.#options.environment.controlSocketPath;
    const directory = await lstat(dirname(path));
    const uid = this.#options.uid ?? process.getuid?.();
    if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o077) !== 0) {
      throw new Error("The server runtime directory must be a private directory of the service user.");
    }
    // A socket from the last run stays after a crash. Anything else at that path is not ours.
    const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing && !existing.isSocket()) throw new Error("The control socket path holds another file.");
    if (existing) await unlink(path);

    const server = createServer((request, response) => void this.#handle(request, response));
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.on("close", () => this.#sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.#server = server;
    await chmod(path, 0o600);
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * Names and starts the host of the signed-in account. The entry point calls this after each
   * sign-in and at the start, and the start retry calls it after a failure. Calls run one at a time,
   * so two callers never name two hosts.
   */
  readonly publish = Effect.fn("ServerMode.publish")(function* (this: ServerMode) {
    const previous = this.#publishing;
    const completed = Deferred.makeUnsafe<void>();
    this.#publishing = completed;
    return yield* Effect.gen({ self: this }, function* () {
      if (previous) yield* Deferred.await(previous);
      this.#publishError = null;
      if (this.#options.centralAuth.getState().status !== "signed_in") return;
      const { host } = this.#options;
      const serverName = this.#pendingName;
      // Only the owner supplies a name; it also renames the account's existing host.
      if (!host.getStatus().configured) yield* host.configure({ serverName: serverName ?? DEFAULT_SERVER_NAME });
      else if (serverName && host.getStatus().serverName !== serverName) yield* host.updateIdentity({ serverName });
      this.#pendingName = null;
      yield* host.start();
    }).pipe(
      Effect.tapError(({ cause }) =>
        Effect.sync(() => {
          this.#publishError = cause instanceof Error ? cause.message : sourceText("error.host.publishFailed");
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#publishing === completed) this.#publishing = null;
          Deferred.doneUnsafe(completed, Effect.void);
        }),
      ),
    );
  }, Effect.uninterruptible).bind(this);

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let answer: Answer;
    try {
      const body = await readBody(request);
      answer = body === null ? failure(413, "too_large") : await this.#route(request.method, request.url, body);
    } catch (error) {
      this.#options.onError("A server control request failed.", error);
      // The messages of the account and host services are the ones the app shows. They name no secret.
      answer = failure(400, "failed", error instanceof Error ? error.message : null);
    }
    response
      .writeHead(answer.status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
      .end(formatLines(answer.lines));
  }

  async #route(method: string | undefined, url: string | undefined, body: URLSearchParams): Promise<Answer> {
    const path = url?.split("?")[0] ?? "";
    const route = `${method ?? ""} ${path}`;
    switch (route) {
      case "GET /v1/status":
        return this.#status();
      case "POST /v1/login/start":
        return runCauseEffect(this.#startLogin(body.get("email") ?? "", body.get("name")));
      case "POST /v1/login/verify":
        return runCauseEffect(this.#verifyLogin(body.get("challenge") ?? "", body.get("code") ?? "", body.get("name")));
      case "POST /v1/name":
        return runCauseEffect(this.#rename(body.get("name") ?? ""));
      case "POST /v1/logout":
        await runCauseEffect(
          this.#options.centralAuth.logout().pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause }))),
        );
        return this.#status();
      default:
        return failure(404, "not_found");
    }
  }

  #status(): Answer {
    const account = this.#options.centralAuth.getState();
    const host = this.#options.host.getStatus();
    return {
      status: 200,
      lines: {
        version: this.#options.version,
        account: account.status,
        email: account.status === "signed_in" ? account.user.email : null,
        account_message: account.status === "error" ? account.issue.message : null,
        server: host.phase,
        server_name: host.serverName ?? this.#pendingName,
        server_message: this.#publishError ?? host.message,
      },
    };
  }

  readonly #startLogin = Effect.fn("ServerMode.startLogin")(function* (
    this: ServerMode,
    email: string,
    name: string | null,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    const normalized = email.trim();
    if (!normalized.includes("@") || normalized.length > MAX_EMAIL_LENGTH) return failure(400, "invalid_email");
    // The name is stored only at the code check. A check here refuses it before an email is sent.
    if (name !== null && !parseHostedServerName(name)) return nameFailure(name);
    if (this.#options.centralAuth.getState().status === "signed_in") return failure(409, "signed_in");
    const state = yield* this.#options.centralAuth
      .requestEmailCode(normalized)
      .pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })));
    if (state.status === "code_sent" && !state.issue) {
      return { status: 200, lines: { challenge: state.challengeId, expires_at: state.expiresAt } };
    }
    return issueFailure(state);
  });

  readonly #verifyLogin = Effect.fn("ServerMode.verifyLogin")(function* (
    this: ServerMode,
    challenge: string,
    code: string,
    name: string | null,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    if (!challenge.trim() || !code.trim()) return failure(400, "invalid_request");
    if (name !== null) {
      // The host refuses such a name only when it publishes, after the sign-in.
      const serverName = parseHostedServerName(name);
      if (!serverName) return nameFailure(name);
      this.#pendingName = serverName;
    }
    const state = yield* this.#options.centralAuth
      .verifyEmailCode(challenge.trim(), code.trim())
      .pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })));
    // The entry point publishes the host when the account change is applied. `status` shows it.
    if (state.status === "signed_in") return this.#status();
    return issueFailure(state);
  });

  readonly #rename = Effect.fn("ServerMode.rename")(function* (
    this: ServerMode,
    name: string,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    const serverName = parseHostedServerName(name);
    if (!serverName) return nameFailure(name);
    const { host } = this.#options;
    if (host.getStatus().configured) {
      yield* host.updateIdentity({ serverName });
    } else {
      this.#pendingName = serverName;
      yield* this.publish();
    }
    return this.#status();
  });
}

/** The form body, or null when it is larger than a control request can be. */
async function readBody(request: IncomingMessage): Promise<URLSearchParams | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(bytes);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function failure(status: number, error: string, message: string | null = null): Answer {
  return { status, lines: { error, message } };
}

/** The message of the team store for a name that it refuses. */
function nameFailure(name: string): Answer {
  const length = name.trim().length;
  const message =
    length < INPUT_LIMITS.serverNameMin || length > INPUT_LIMITS.serverName
      ? sourceText("error.team.serverNameLength", { min: INPUT_LIMITS.serverNameMin, max: INPUT_LIMITS.serverName })
      : sourceText("error.team.serverNameHostname");
  return failure(400, "invalid_name", message);
}

function issueFailure(state: CentralAuthState): Answer {
  if ((state.status === "code_sent" || state.status === "error") && state.issue) {
    return failure(state.status === "error" ? 502 : 400, state.issue.code, state.issue.message);
  }
  return failure(409, `account_${state.status}`);
}

/** One `key=value` line for each value. A value never breaks its line. */
function formatLines(lines: Answer["lines"]): string {
  return Object.entries(lines)
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/[\r\n]+/gu, " ")}\n`)
    .join("");
}
