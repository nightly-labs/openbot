/**
 * A self-hosted server: the packaged Linux build that `install-server.sh` installs on a computer
 * with no screen. systemd starts it with `OPENBOT_SERVER=1` under a virtual display, and it is a
 * normal Remote host after its owner signs in.
 *
 * Nobody can use the window, so the `openbot` terminal command (`scripts/hosting/openbot`) talks to
 * this process over a Unix socket in the runtime directory that systemd makes for the service user
 * (mode 0700). Only that user and root can connect. Agents run as the same user and already have
 * full access to its files, so the socket gives them nothing new. The socket answers a closed list
 * of requests: status, the email-code sign-in, the sign-in with an operator's one-time claim, the
 * server name, sign-out and a Mobile Connect code. It never sends the session token, the sign-in code
 * or the claim back. The Mobile Connect code signs one phone
 * in to the account of the server; the account service lets it work for one sign-in, for two minutes.
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
import QRCode from "qrcode";
import { runCauseEffect } from "../backend/effect-boundary";
import type { CentralAuthManager } from "./central-auth-manager";
import type { HostService } from "./host-service";
import { readBodyWithin } from "./http-body";
import { createHostedMobileConnect } from "./mobile-connect-host";
import { RemoteWorkflowError, remoteCall, toRemoteWorkflowError } from "./remote-service-effects";
import type { ServerMemory } from "./server-memory";

const CONTROL_SOCKET_FILE = "control.sock";
const MAX_BODY_BYTES = 4096;
const MAX_EMAIL_LENGTH = 254;
/** The name of a server whose owner signed in without one. The same default as a mobile connect. */
const DEFAULT_SERVER_NAME = "OpenBot";

export interface ServerModeEnvironment {
  controlSocketPath: string;
  /**
   * The TCP port of the setup page (`OPENBOT_SETUP_PAGE_PORT`), or null. Only a container starts the
   * page: its port is reachable only through the network of the container (src/main/server-setup-page.ts).
   */
  setupPagePort: number | null;
}

/** The requests of the setup page: status and the email-code sign-in. Nothing else. */
export type ServerSetupAction = "status" | "login_start" | "login_verify" | "retry";

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
  return {
    controlSocketPath: join(runtimeDirectory, CONTROL_SOCKET_FILE),
    setupPagePort: parseSetupPagePort(environment.OPENBOT_SETUP_PAGE_PORT),
  };
}

/** A port from 1024 to 65535, else null. A value that is not valid starts no page. */
function parseSetupPagePort(value: string | undefined): number | null {
  const text = value?.trim() ?? "";
  if (!/^[0-9]{4,5}$/u.test(text)) return null;
  const port = Number(text);
  return port >= 1024 && port <= 65535 ? port : null;
}

export interface ServerModeOptions {
  environment: ServerModeEnvironment;
  version: string;
  centralAuth: Pick<
    CentralAuthManager,
    | "getState"
    | "requestEmailCode"
    | "cancelCompanySignIn"
    | "verifyEmailCode"
    | "hasSession"
    | "retry"
    | "canPersistSession"
    | "redeemServerClaim"
    | "logout"
    | "createMobileConnect"
  >;
  host: Pick<HostService, "getStatus" | "configure" | "start" | "updateIdentity" | "getMobileConnectHost">;
  /** The memory guard, so that `status` shows the memory ceiling and the turn limit. */
  memory: (Pick<ServerMemory, "level" | "sample"> & { turnLimit(): number | "unlimited" }) | null;
  onError: (message: string, error: unknown) => void;
  /** Tests only. */
  uid?: number;
}

export interface ServerModeAnswer {
  status: number;
  lines: Record<string, string | number | null>;
}
type Answer = ServerModeAnswer;

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
  readonly listen = Effect.fn("ServerMode.listen")(function* (this: ServerMode) {
    const path = this.#options.environment.controlSocketPath;
    const directory = yield* remoteCall(() => lstat(dirname(path)));
    const uid = this.#options.uid ?? process.getuid?.();
    if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o077) !== 0) {
      return yield* new RemoteWorkflowError({
        cause: new Error("The server runtime directory must be a private directory of the service user."),
      });
    }
    // A socket from the last run stays after a crash. Anything else at that path is not ours.
    const existing = yield* remoteCall(() =>
      lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    );
    if (existing && !existing.isSocket()) {
      return yield* new RemoteWorkflowError({ cause: new Error("The control socket path holds another file.") });
    }
    if (existing) yield* remoteCall(() => unlink(path));

    const server = createServer((request, response) => void this.#handle(request, response));
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.on("close", () => this.#sockets.delete(socket));
    });
    yield* remoteCall(
      () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(path, () => {
            server.removeListener("error", reject);
            resolve();
          });
        }),
    );
    this.#server = server;
    yield* remoteCall(() => chmod(path, 0o600));
  }).bind(this);

  readonly close = Effect.fn("ServerMode.close")(function* (this: ServerMode) {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    yield* Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
    });
  }).bind(this);

  /**
   * Names and starts the host of the signed-in account. The entry point calls this after each
   * sign-in and at the start, and the start retry calls it after a failure. Calls run one at a time,
   * so two callers never name two hosts.
   */
  readonly publish = Effect.fn("ServerMode.publish")(
    function* (this: ServerMode, automatic = false) {
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
        yield* host.start(automatic);
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
    },
    (operation, _automatic?: boolean) => Effect.uninterruptible(operation),
  ).bind(this);

  /**
   * A request of the setup page. The page has no sign-out, claim, rename or Mobile Connect: another
   * program on the network of the container can reach its port, and these change a signed-in server
   * or give access to the account. The server gets its name in Server Settings of the app.
   */
  readonly setupRequest = (
    action: ServerSetupAction,
    body: URLSearchParams,
  ): Effect.Effect<ServerModeAnswer, RemoteWorkflowError> => {
    switch (action) {
      case "status":
        return Effect.sync(() => this.#status());
      case "login_start":
        return Effect.suspend(
          () => this.#setupRefusal(["signed_out", "code_sent"]) ?? this.#startLogin(body.get("email") ?? "", null),
        );
      case "login_verify":
        return Effect.suspend(
          () =>
            this.#setupRefusal(["code_sent"]) ??
            this.#verifySetupLogin(body.get("challenge") ?? "", body.get("code") ?? ""),
        );
      case "retry":
        return this.#retrySetup();
    }
  };

  /**
   * A sign-in of the setup page starts only on a server with no session. A session that the account
   * service could not confirm at the start (state `error` or `loading`) is still the owner's session:
   * a code of another account would replace it, and a wrong code would remove it.
   */
  #setupRefusal(allowed: readonly CentralAuthState["status"][]): Effect.Effect<Answer> | null {
    const { centralAuth } = this.#options;
    const status = centralAuth.getState().status;
    if (status === "signed_in") return Effect.succeed(failure(409, "signed_in"));
    if (centralAuth.hasSession() || !allowed.includes(status)) return Effect.succeed(failure(409, `account_${status}`));
    return null;
  }

  /**
   * The page signs in only with the challenge of the current sign-in. Another program on the network
   * cannot complete an older challenge of its own after the owner asked for a code.
   */
  #verifySetupLogin(challenge: string, code: string): Effect.Effect<Answer, RemoteWorkflowError> {
    const state = this.#options.centralAuth.getState();
    if (state.status === "code_sent" && state.challengeId !== challenge.trim()) {
      return Effect.succeed(failure(409, "challenge_replaced", sourceText("error.auth.codeNotVerified")));
    }
    return this.#verifyLogin(challenge, code, null);
  }

  /** The retry of the account screen: it starts the account again, as the app does. Only after an error. */
  #retrySetup(): Effect.Effect<Answer, RemoteWorkflowError> {
    return Effect.suspend(() => {
      const { centralAuth } = this.#options;
      if (centralAuth.getState().status !== "error") return Effect.sync(() => this.#status());
      return centralAuth.retry().pipe(
        Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
        Effect.map(() => this.#status()),
      );
    });
  }

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
      case "POST /v1/login/claim":
        return runCauseEffect(this.#claimLogin(body.get("claim") ?? "", body.get("name")));
      case "POST /v1/name":
        return runCauseEffect(this.#rename(body.get("name") ?? ""));
      case "POST /v1/mobile-connect":
        return runCauseEffect(this.#mobileConnect());
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
        account_issue: account.status === "error" ? account.issue.code : null,
        account_message: account.status === "error" ? account.issue.message : null,
        server: host.phase,
        server_name: host.serverName ?? this.#pendingName,
        server_message: this.#publishError ?? host.message,
        ...this.#memoryLines(),
      },
    };
  }

  #memoryLines(): Answer["lines"] {
    const memory = this.#options.memory;
    const sample = memory?.sample();
    if (!memory || !sample) return {};
    return {
      memory_level: memory.level(),
      memory_limit: sample.total,
      memory_available: sample.available,
      turn_limit: memory.turnLimit(),
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
      return {
        status: 200,
        lines: { challenge: state.challengeId, expires_at: state.expiresAt, resend_at: state.resendAvailableAt },
      };
    }
    // A server has no browser for the company provider. The owner signs in with another email.
    if (state.status === "company_sign_in") {
      yield* this.#options.centralAuth.cancelCompanySignIn();
      return failure(409, "company_sign_in_required");
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
    // A code of another account would replace the session. A wrong code would remove the stored session.
    if (this.#options.centralAuth.getState().status === "signed_in") return failure(409, "signed_in");
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

  /** Signs in with a one-time claim that an operator made for the owner's email. */
  readonly #claimLogin = Effect.fn("ServerMode.claimLogin")(function* (
    this: ServerMode,
    claim: string,
    name: string | null,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    if (!claim.trim()) return failure(400, "invalid_request");
    let serverName: string | null = null;
    if (name !== null) {
      serverName = parseHostedServerName(name);
      if (!serverName) return nameFailure(name);
    }
    const { centralAuth } = this.#options;
    const status = centralAuth.getState().status;
    if (status === "signed_in") return failure(409, "signed_in");
    // Another state can hold a stored session, which a failed claim would remove.
    if (status !== "signed_out" && status !== "code_sent") return failure(409, `account_${status}`);
    // The claim works once. A session that is not stored would end at the next start.
    if (!centralAuth.canPersistSession()) return failure(409, "session_not_storable");
    const previousName = this.#pendingName;
    if (serverName) this.#pendingName = serverName;
    const issue = yield* centralAuth
      .redeemServerClaim(claim.trim())
      .pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })));
    if (issue) {
      this.#pendingName = previousName;
      return failure(issue.code === "server_claim_invalid" ? 400 : 502, issue.code, issue.message);
    }
    // The entry point publishes the host when the account change is applied. `status` shows it.
    return this.#status();
  });

  /**
   * A Mobile Connect code as a QR code for a terminal, in base64 because an answer line holds no line
   * break. The terminal has no other way to show the code to a phone.
   */
  readonly #mobileConnect = Effect.fn("ServerMode.mobileConnect")(function* (
    this: ServerMode,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    const account = this.#options.centralAuth.getState();
    if (account.status !== "signed_in") return issueFailure(account);
    // A publish that runs now can give the host its name. The code binds the host that it publishes.
    yield* this.publish();
    const ticket = yield* createHostedMobileConnect(this.#options).pipe(toRemoteWorkflowError);
    const qr = yield* remoteCall(() => QRCode.toString(ticket.qrData, { type: "terminal", small: true }));
    return { status: 200, lines: { qr: Buffer.from(qr).toString("base64"), expires_at: ticket.expiresAt } };
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
  const body = await readBodyWithin(request, MAX_BODY_BYTES);
  return body === null ? null : new URLSearchParams(body.toString("utf8"));
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
    const answer = failure(state.status === "error" ? 502 : 400, state.issue.code, state.issue.message);
    return { ...answer, lines: { ...answer.lines, retry_after: state.issue.retryAfterSeconds ?? null } };
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
