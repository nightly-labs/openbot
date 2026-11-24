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
const DEFAULT_SERVER_NAME = "OpenBot";

// The packaged Linux server process: the host that the mobile app and openbot.run/app drive. There
// is no screen, so the desktop UI is never seen (see loadRenderer in main-window.ts).
export function isServerProcess(): boolean {
  return (
    process.platform === "linux" && (process.env.OPENBOT_SERVER === "1" || process.env.OPENBOT_HOSTED_SERVER === "1")
  );
}

export interface ServerModeEnvironment {
  controlSocketPath: string;
  setupPagePort: number | null;
}

export type ServerSetupAction = "status" | "login_start" | "login_verify" | "retry";

export function takeServerModeEnvironment(
  environment: NodeJS.ProcessEnv,
  isPackaged: boolean,
  platform: NodeJS.Platform,
): ServerModeEnvironment | null {
  if (!isPackaged || platform !== "linux" || environment.OPENBOT_SERVER !== "1") return null;
  if (environment.OPENBOT_HOSTED_SERVER === "1") return null;
  const runtimeDirectory = environment.XDG_RUNTIME_DIR?.trim() ?? "";
  if (!isAbsolute(runtimeDirectory)) return null;
  return {
    controlSocketPath: join(runtimeDirectory, CONTROL_SOCKET_FILE),
    setupPagePort: parseSetupPagePort(environment.OPENBOT_SETUP_PAGE_PORT),
  };
}

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
  host: Pick<
    HostService,
    "getStatus" | "configure" | "start" | "updateIdentity" | "getMobileConnectHost" | "refreshRegistration"
  >;
  memory: (Pick<ServerMemory, "level" | "sample"> & { turnLimit(): number | "unlimited" }) | null;
  onError: (message: string, error: unknown) => void;
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
  #publishError: string | null = null;
  #publishing: Deferred.Deferred<void> | null = null;

  constructor(options: ServerModeOptions) {
    this.#options = options;
  }

  readonly listen = Effect.fn("ServerMode.listen")(function* (this: ServerMode) {
    const path = this.#options.environment.controlSocketPath;
    const directory = yield* remoteCall(() => lstat(dirname(path)));
    const uid = this.#options.uid ?? process.getuid?.();
    if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o077) !== 0) {
      return yield* new RemoteWorkflowError({
        cause: new Error("The server runtime directory must be a private directory of the service user."),
      });
    }
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

  #setupRefusal(allowed: readonly CentralAuthState["status"][]): Effect.Effect<Answer> | null {
    const { centralAuth } = this.#options;
    const status = centralAuth.getState().status;
    if (status === "signed_in") return Effect.succeed(failure(409, "signed_in"));
    if (centralAuth.hasSession() || !allowed.includes(status)) return Effect.succeed(failure(409, `account_${status}`));
    return null;
  }

  #verifySetupLogin(challenge: string, code: string): Effect.Effect<Answer, RemoteWorkflowError> {
    const state = this.#options.centralAuth.getState();
    if (state.status === "code_sent" && state.challengeId !== challenge.trim()) {
      return Effect.succeed(failure(409, "challenge_replaced", sourceText("error.auth.codeNotVerified")));
    }
    return this.#verifyLogin(challenge, code, null);
  }

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
    if (this.#options.centralAuth.getState().status === "signed_in") return failure(409, "signed_in");
    if (name !== null) {
      const serverName = parseHostedServerName(name);
      if (!serverName) return nameFailure(name);
      this.#pendingName = serverName;
    }
    const state = yield* this.#options.centralAuth
      .verifyEmailCode(challenge.trim(), code.trim())
      .pipe(Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })));
    if (state.status === "signed_in") return this.#status();
    return issueFailure(state);
  });

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
    if (status !== "signed_out" && status !== "code_sent") return failure(409, `account_${status}`);
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
    return this.#status();
  });

  readonly #mobileConnect = Effect.fn("ServerMode.mobileConnect")(function* (
    this: ServerMode,
  ): Effect.fn.Return<Answer, RemoteWorkflowError> {
    const account = this.#options.centralAuth.getState();
    if (account.status !== "signed_in") return issueFailure(account);
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

async function readBody(request: IncomingMessage): Promise<URLSearchParams | null> {
  const body = await readBodyWithin(request, MAX_BODY_BYTES);
  return body === null ? null : new URLSearchParams(body.toString("utf8"));
}

function failure(status: number, error: string, message: string | null = null): Answer {
  return { status, lines: { error, message } };
}

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

function formatLines(lines: Answer["lines"]): string {
  return Object.entries(lines)
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/[\r\n]+/gu, " ")}\n`)
    .join("");
}
