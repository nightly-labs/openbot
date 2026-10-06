import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseHostedServerClaim } from "@openbot/contracts/hosted-servers";
import type {
  AvatarImageInput,
  CentralAuthIssue,
  CentralAuthState,
  CentralAuthUser,
  MobileConnectedDevice,
  MobileConnectTicket,
} from "@openbot/contracts/ipc";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import { createMobileConnectUrl, type MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import {
  decodeRemoteSession,
  decodeRemoteSessionTicket,
  type RemoteSession,
  type RemoteSessionTicket,
} from "@openbot/contracts/remote-control-plane";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  REMOTE_TICKET_AUDIENCE,
  type RemoteMemberRole,
  type RemoteTicketClaims,
} from "@openbot/contracts/signal-protocol/ticket";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, type Layer, Result, Schema, Semaphore } from "effect";
import { createLocalJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { isMissingFileError } from "../backend/file-errors";
import { authCall, authDecode, CentralAuthOperationError, CentralAuthTransport } from "./central-auth-effects";
import {
  decodeAcceptedRemoteInvite,
  decodeCentralAuthUser,
  decodeCreatedRemoteInvite,
  decodeEmailChallenge,
  decodeMobileConnectedDevices,
  decodeRecordHealth,
  decodeRegisteredRemoteHost,
  decodeRemoteHosts,
  decodeRemoteInvitePreview,
  decodeRemoteInvites,
  decodeRemoteMembers,
  decodeSessionResponse,
  decodeTicketResponse,
  decodeVoid,
  type RegisteredRemoteHost,
  type RemoteHostSummary,
  type RemoteInvitePreview,
  type RemoteInviteRecord,
  type RemoteMemberRecord,
} from "./central-auth-records";

interface CentralAuthEvents {
  changed: [state: CentralAuthState];
}

type AuthFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface CentralAuthManagerOptions {
  apiUrl: string;
  mobileConnectApiUrl?: string;
  storagePath: string;
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
  canPersist?: () => boolean;
  fetch?: AuthFetcher;
  startupRetryWindowMs?: number;
  startupRequestTimeoutMs?: number;
  startupRetryDelaysMs?: readonly number[];
  emailCodeRequestTimeoutMs?: number;
}

interface EmailCodeRequest {
  email: string;
  idempotencyKey: string;
  pending: Deferred.Deferred<CentralAuthState, CentralAuthOperationError> | null;
}

const STARTUP_RETRY_WINDOW_MS = 30_000;
const STARTUP_REQUEST_TIMEOUT_MS = 3_000;
const STARTUP_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;
const EMAIL_CODE_REQUEST_TIMEOUT_MS = 35_000;
const RESEND_FALLBACK_DELAY_MS = 60_000;
const DEFINITIVE_EMAIL_CODE_REQUEST_FAILURES = new Set([
  "email_delivery_failed",
  "email_delivery_rate_limited",
  "idempotency_conflict",
  "idempotency_key_completed",
  "invalid_email",
  "invalid_idempotency_key",
  "sign_in_code_expired",
]);
const UNCERTAIN_EMAIL_CODE_REQUEST_FAILURES = new Set([
  "email_delivery_pending",
  "email_delivery_timeout",
  "email_delivery_unknown",
]);
const remoteTicketJwksSchema = z.object({
  keys: z.array(z.object({ kty: z.string() }).loose()).min(1),
});

// The account API answers the same shape for a host credential and for a member session, so both
// paths below decode it with the one function in `@openbot/contracts/remote-control-plane`.
export type RemoteConnectionBootstrap = RemoteSessionTicket;

// The claims this host reads off a client's ticket, derived from the contract the account API mints
// against. `clientPublicKey` is optional there because a host ticket carries none; a client that
// reached this check without one is rejected below, so it is required here.
export type VerifiedRemoteSessionTicket = Pick<
  RemoteTicketClaims,
  "sessionId" | "hostId" | "userId" | "membershipId" | "authEpoch" | "sessionExpiresAt"
> & {
  role: RemoteMemberRole;
  clientPublicKey: string;
};

export class CentralAuthManager extends EventEmitter<CentralAuthEvents> {
  readonly #options: Required<CentralAuthManagerOptions>;
  readonly #transport: Layer.Layer<CentralAuthTransport>;
  #state: CentralAuthState = { status: "loading" };
  #sessionToken: string | null = null;
  readonly #teamHostTokens = new Map<string, string>();
  #sessionWrites = Semaphore.makeUnsafe(1);
  /** The account the stored host credentials were issued to, or none while signed out. */
  #sessionAccountId: string | null = null;
  #remoteTicketJwks: Effect.Effect<
    z.infer<typeof remoteTicketJwksSchema>,
    CentralAuthOperationError,
    CentralAuthTransport
  > | null = null;
  #initialization: Deferred.Deferred<CentralAuthState, CentralAuthOperationError> | null = null;
  #emailCodeRequest: EmailCodeRequest | null = null;
  #profileRefresh: Deferred.Deferred<CentralAuthState, CentralAuthOperationError> | null = null;
  #profileRefreshGeneration = 0;

  constructor(options: CentralAuthManagerOptions) {
    super();
    const fetcher = detectBlockingNetwork(options.fetch ?? fetch, options.apiUrl);
    this.#transport = CentralAuthTransport.layer(fetcher);
    this.#options = {
      ...options,
      mobileConnectApiUrl: options.mobileConnectApiUrl ?? options.apiUrl,
      canPersist: options.canPersist ?? (() => true),
      fetch: fetcher,
      startupRetryWindowMs: options.startupRetryWindowMs ?? STARTUP_RETRY_WINDOW_MS,
      startupRequestTimeoutMs: options.startupRequestTimeoutMs ?? STARTUP_REQUEST_TIMEOUT_MS,
      startupRetryDelaysMs: options.startupRetryDelaysMs ?? STARTUP_RETRY_DELAYS_MS,
      emailCodeRequestTimeoutMs: options.emailCodeRequestTimeoutMs ?? EMAIL_CODE_REQUEST_TIMEOUT_MS,
    };
  }

  readonly #pending = new Set<Deferred.Deferred<void>>();
  readonly dispose = Effect.fn("CentralAuth.dispose")(function* (this: CentralAuthManager) {
    this.stopProfileRefresh();
    while (this.#pending.size) yield* Effect.forEach([...this.#pending], Deferred.await, { concurrency: "unbounded" });
    yield* this.#sessionWrites.withPermit(Effect.void);
  }).bind(this);
  #owned<A>(
    operation: Effect.Effect<A, CentralAuthOperationError, CentralAuthTransport>,
  ): Effect.Effect<A, CentralAuthOperationError> {
    return Effect.suspend(() => {
      const done = Deferred.makeUnsafe<void>();
      this.#pending.add(done);
      return operation.pipe(
        Effect.provide(this.#transport),
        Effect.ensuring(
          Effect.gen({ self: this }, function* () {
            this.#pending.delete(done);
            yield* Deferred.succeed(done, undefined);
          }),
        ),
      );
    });
  }

  getState(): CentralAuthState {
    return structuredClone(this.#state);
  }

  stopProfileRefresh(): void {
    this.#profileRefreshGeneration += 1;
  }

  readonly refreshProfile = Effect.fn("CentralAuth.refreshProfileAdmission")(
    function* (this: CentralAuthManager) {
      if (this.#profileRefresh) return yield* Deferred.await(this.#profileRefresh);
      const state = this.#state;
      const token = this.#sessionToken;
      const generation = this.#profileRefreshGeneration;
      if (state.status !== "signed_in" || !token) return this.getState();
      const pending = Deferred.makeUnsafe<CentralAuthState, CentralAuthOperationError>();
      this.#profileRefresh = pending;
      return yield* this.#refreshProfileWork(state, token, generation).pipe(
        Effect.onExit((exit) => Deferred.done(pending, exit)),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #refreshProfileWork = Effect.fn("CentralAuth.refreshProfile")(function* (
    this: CentralAuthManager,
    state: Extract<CentralAuthState, { status: "signed_in" }>,
    token: string,
    generation: number,
  ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
    return yield* Effect.gen({ self: this }, function* () {
      const user = yield* this.#authorizedRequestEffect("/v1/me", { method: "GET" }, decodeCentralAuthUser);
      if (this.#state !== state || this.#sessionToken !== token || generation !== this.#profileRefreshGeneration)
        return this.getState();
      if (user.id !== state.user.id)
        return yield* new CentralAuthOperationError({
          cause: new Error("The account service returned an invalid user."),
        });
      const resolved = yield* authDecode(() => this.#resolveUserAvatar(user));
      if (
        resolved.name === state.user.name &&
        resolved.email === state.user.email &&
        resolved.avatarUrl === state.user.avatarUrl
      )
        return this.getState();
      return this.#setState({ status: "signed_in", user: resolved });
    }).pipe(
      Effect.catch(() => Effect.sync(() => this.getState())),
      Effect.ensuring(
        Effect.sync(() => {
          this.#profileRefresh = null;
        }),
      ),
    );
  });

  getSignedInUser(): CentralAuthUser {
    if (this.#state.status !== "signed_in") {
      throw new AuthApiError(401, "unauthorized", sourceText("error.auth.signInFirst"));
    }
    return structuredClone(this.#state.user);
  }

  resolveApiUrl(path: string): string {
    return new URL(path, this.#options.apiUrl).toString();
  }

  requestAuthorized<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs?: number,
  ): Effect.Effect<T, CentralAuthOperationError> {
    return this.#owned(this.#authorizedRequestEffect(path, init, decoder, timeoutMs));
  }

  readonly downloadAuthorized = Effect.fn("CentralAuth.downloadAuthorized")(
    function* (
      this: CentralAuthManager,
      path: string,
      timeoutMs = 30_000,
    ): Effect.fn.Return<Uint8Array, CentralAuthOperationError, CentralAuthTransport> {
      if (!this.#sessionToken)
        return yield* new CentralAuthOperationError({
          cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
        });
      const response = yield* CentralAuthTransport.use((transport) =>
        transport.fetch(new URL(path, this.#options.apiUrl), {
          headers: { Authorization: `Bearer ${this.#sessionToken}` },
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      if (!response.ok)
        return yield* new CentralAuthOperationError({
          cause: yield* AuthApiError.fromResponseEffect(response),
        });
      return new Uint8Array(yield* authCall(() => response.arrayBuffer()));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly createTeamAuthTicket = Effect.fn("CentralAuth.createTeamAuthTicket")(
    function* (
      this: CentralAuthManager,
      serverId: string,
    ): Effect.fn.Return<string, CentralAuthOperationError, CentralAuthTransport> {
      const result = yield* this.#authorizedRequestEffect(
        "/v1/team-auth/ticket",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId }),
        },
        decodeTicketResponse,
      );
      if (!result.ticket || !Number.isFinite(result.expiresAt)) {
        return yield* new CentralAuthOperationError({
          cause: new Error("The account service returned an invalid team ticket."),
        });
      }
      return result.ticket;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly createMobileConnect = Effect.fn("CentralAuth.createMobileConnect")(
    function* (
      this: CentralAuthManager,
      host: MobileConnectHostBinding,
    ): Effect.fn.Return<MobileConnectTicket, CentralAuthOperationError, CentralAuthTransport> {
      const result = yield* this.#authorizedRequestEffect(
        "/v1/mobile-auth/ticket",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host }),
        },
        decodeTicketResponse,
      );
      if (!result.ticket || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) {
        return yield* new CentralAuthOperationError({
          cause: new Error("The account service returned an invalid Mobile Connect ticket."),
        });
      }
      return {
        qrData: createMobileConnectUrl({ apiUrl: this.#options.mobileConnectApiUrl, ticket: result.ticket, host }),
        expiresAt: result.expiresAt,
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly listMobileConnectedDevices = Effect.fn("CentralAuth.listMobileConnectedDevices")(
    function* (
      this: CentralAuthManager,
    ): Effect.fn.Return<MobileConnectedDevice[], CentralAuthOperationError, CentralAuthTransport> {
      const result = yield* this.#authorizedRequestEffect(
        "/v1/mobile-auth/devices",
        { method: "GET" },
        decodeMobileConnectedDevices,
      );
      return result.devices;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly listAccountSessions = Effect.fn("CentralAuth.listAccountSessions")(
    function* (this: CentralAuthManager) {
      const result = yield* this.#authorizedRequestEffect(
        "/v1/mobile-auth/devices?includeDesktop=true",
        { method: "GET" },
        (value) =>
          z
            .object({
              sessions: z.array(
                z.object({
                  sessionId: z.string().uuid(),
                  name: z.string(),
                  kind: z.enum(["desktop", "mobile"]),
                  current: z.boolean(),
                  connectedAt: z.number().finite(),
                  lastActiveAt: z.number().finite(),
                }),
              ),
            })
            .parse(value),
      );
      return result.sessions;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly revokeAccountSession = Effect.fn("CentralAuth.revokeAccountSession")(
    function* (
      this: CentralAuthManager,
      sessionId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      yield* this.#authorizedRequestEffect(
        `/v1/mobile-auth/devices/${encodeURIComponent(sessionId)}?includeDesktop=true`,
        { method: "DELETE" },
        () => undefined,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly revokeMobileConnectedDevice = Effect.fn("CentralAuth.revokeMobileConnectedDevice")(
    function* (
      this: CentralAuthManager,
      sessionId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      yield* this.#authorizedRequestEffect(
        `/v1/mobile-auth/devices/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
        () => undefined,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly registerRemoteHost = Effect.fn("CentralAuth.registerRemoteHost")(
    function* (
      this: CentralAuthManager,
      input: {
        hostId: string;
        name: string;
        ownerMembershipId: string;
        devicePublicKey?: string | null;
      },
    ): Effect.fn.Return<RegisteredRemoteHost, CentralAuthOperationError, CentralAuthTransport> {
      const sessionToken = this.#sessionToken;
      const storedMachineToken = this.#teamHostTokens.get(input.hostId.toLowerCase());
      const result = yield* this.#authorizedRequestEffect(
        "/v2/remote/hosts/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            rotateCredential: !storedMachineToken,
            ...(storedMachineToken ? { machineToken: storedMachineToken } : {}),
          }),
        },
        decodeRegisteredRemoteHost,
      );
      if (this.#sessionToken !== sessionToken) {
        // The credential belongs to the account that asked for it. Writing it now would file
        // it under whichever session is stored next, so the caller is told the registration
        // no longer applies instead.
        return yield* new CentralAuthOperationError({
          cause: new Error(sourceText("error.auth.accountChangedDuringRegister")),
        });
      }
      if (result.machineToken) this.#teamHostTokens.set(input.hostId.toLowerCase(), result.machineToken);
      yield* this.#writeStoredSession();
      return result;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /** The machine token of a registered host, so a site request can prove the server. Never log it. */
  hostSiteCredential(hostId: string): { hostId: string; machineToken: string } | null {
    const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
    return machineToken ? { hostId, machineToken } : null;
  }

  readonly issueRemoteHostTicket = Effect.fn("CentralAuth.issueRemoteHostTicket")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<RemoteConnectionBootstrap, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
      if (!machineToken)
        return yield* new CentralAuthOperationError({
          cause: new Error(sourceText("error.auth.hostCredentialUnavailable")),
        });
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/ticket`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
        decodeRemoteSessionTicket,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /**
   * The Slack route ticket of this host: the workspaces that the account service links to it, which
   * Signal routes to its `ingress` socket.
   */

  readonly issueSlackRoute = Effect.fn("CentralAuth.issueSlackRoute")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<string, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
      if (!machineToken)
        return yield* new CentralAuthOperationError({
          cause: new Error(sourceText("error.auth.hostCredentialUnavailable")),
        });
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/slack-route`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
        (value) => requiredString(decodeRecord(value, "Slack route"), "ticket"),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /** Unlinks a Slack workspace from this host, so Signal stops routing its events here. */

  readonly unlinkSlackWorkspace = Effect.fn("CentralAuth.unlinkSlackWorkspace")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      teamId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
      if (!machineToken)
        return yield* new CentralAuthOperationError({
          cause: new Error(sourceText("error.auth.hostCredentialUnavailable")),
        });
      yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/slack-disconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, teamId }),
        },
        () => undefined,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /**
   * Sends one Live Activity update through the account service to Apple. The host sealed the
   * content with keys that only the phone has, so the service forwards bytes it cannot read.
   * Returns `gone` when Apple refused the token.
   */

  readonly sendLiveActivityPush = Effect.fn("CentralAuth.sendLiveActivityPush")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      push: LiveActivityRelayPush,
    ): Effect.fn.Return<"sent" | "gone", CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
      if (!machineToken)
        return yield* new CentralAuthOperationError({
          cause: new Error(sourceText("error.auth.hostCredentialUnavailable")),
        });
      return yield* Effect.gen({ self: this }, function* (): Effect.fn.Return<
        "sent" | "gone",
        CentralAuthOperationError,
        CentralAuthTransport
      > {
        yield* this.#requestEffect(
          `/v2/remote/hosts/${encodeURIComponent(hostId)}/live-activity`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ machineToken, ...push }),
          },
          () => undefined,
        );
        return "sent";
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.gen({ self: this }, function* (): Effect.fn.Return<
            "sent" | "gone",
            CentralAuthOperationError,
            CentralAuthTransport
          > {
            if (error instanceof AuthApiError && error.status === 410) return "gone";
            return yield* new CentralAuthOperationError({ cause: error });
          }),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly startRemoteSession = Effect.fn("CentralAuth.startRemoteSession")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<RemoteSession, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        "/v2/remote/sessions/",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostId }) },
        decodeRemoteSession,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly listRemoteHosts = Effect.fn("CentralAuth.listRemoteHosts")(
    function* (
      this: CentralAuthManager,
    ): Effect.fn.Return<RemoteHostSummary[], CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect("/v2/remote/hosts/", { method: "GET" }, decodeRemoteHosts);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly issueRemoteSessionTicket = Effect.fn("CentralAuth.issueRemoteSessionTicket")(
    function* (
      this: CentralAuthManager,
      sessionId: string,
      clientPublicKey: string,
    ): Effect.fn.Return<RemoteConnectionBootstrap, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/sessions/${encodeURIComponent(sessionId)}/ticket`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientPublicKey }),
        },
        decodeRemoteSessionTicket,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly verifyRemoteSessionTicket = Effect.fn("CentralAuth.verifyRemoteSessionTicket")(
    function* (
      this: CentralAuthManager,
      ticket: string,
    ): Effect.fn.Return<VerifiedRemoteSessionTicket, CentralAuthOperationError, CentralAuthTransport> {
      const verify = Effect.gen({ self: this }, function* () {
        if (!this.#remoteTicketJwks) this.#remoteTicketJwks = yield* Effect.cached(this.#fetchRemoteTicketJwks());
        const jwks = yield* this.#remoteTicketJwks;
        const keySet = yield* authDecode(() => createLocalJWKSet(jwks));
        return yield* authCall(() =>
          jwtVerify(ticket, keySet, { audience: REMOTE_TICKET_AUDIENCE, algorithms: ["ES256"] }),
        );
      });
      const { payload } = yield* verify.pipe(
        Effect.catch((failure) => {
          const error = failure.cause;
          if (!isDynamicRecord(error) || error.code !== "ERR_JWKS_NO_MATCHING_KEY") return Effect.fail(failure);
          this.#remoteTicketJwks = null;
          return verify;
        }),
      );
      if (
        !isString(payload.sessionId) ||
        !isString(payload.hostId) ||
        !isString(payload.userId) ||
        !isString(payload.membershipId) ||
        (payload.role !== "owner" && payload.role !== "admin" && payload.role !== "member") ||
        !isNumber(payload.authEpoch) ||
        !Number.isInteger(payload.authEpoch) ||
        !isNumber(payload.sessionExpiresAt) ||
        !Number.isInteger(payload.sessionExpiresAt) ||
        !isString(payload.clientPublicKey)
      ) {
        return yield* new CentralAuthOperationError({
          cause: new Error("The remote session ticket has invalid claims."),
        });
      }
      return {
        sessionId: payload.sessionId,
        hostId: payload.hostId,
        userId: payload.userId,
        membershipId: payload.membershipId,
        role: payload.role,
        authEpoch: payload.authEpoch,
        sessionExpiresAt: payload.sessionExpiresAt,
        clientPublicKey: payload.clientPublicKey,
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #fetchRemoteTicketJwks = Effect.fn("CentralAuth.fetchRemoteTicketJwks")(function* (
    this: CentralAuthManager,
  ): Effect.fn.Return<z.infer<typeof remoteTicketJwksSchema>, CentralAuthOperationError, CentralAuthTransport> {
    const response = yield* CentralAuthTransport.use((transport) =>
      transport.fetch(new URL("/.well-known/jwks.json", this.#options.apiUrl), {
        signal: AbortSignal.timeout(10_000),
      }),
    );
    if (!response.ok)
      return yield* new CentralAuthOperationError({
        cause: yield* AuthApiError.fromResponseEffect(response),
      });
    const value = yield* authCall(() => response.json());
    return yield* authDecode(() => remoteTicketJwksSchema.parse(value));
  });

  readonly endRemoteSession = Effect.fn("CentralAuth.endRemoteSession")(
    function* (
      this: CentralAuthManager,
      sessionId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/sessions/${encodeURIComponent(sessionId)}/end`,
        { method: "POST" },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly createRemoteInvite = Effect.fn("CentralAuth.createRemoteInvite")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      input: { role: "admin" | "member"; email?: string; permanent?: boolean },
    ): Effect.fn.Return<
      { inviteId: string; token: string; expiresAt: number; permanent: boolean; useCount: number },
      CentralAuthOperationError,
      CentralAuthTransport
    > {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/invites`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
        decodeCreatedRemoteInvite,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly listRemoteInvites = Effect.fn("CentralAuth.listRemoteInvites")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<RemoteInviteRecord[], CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/invites`,
        { method: "GET" },
        decodeRemoteInvites,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly previewRemoteInvite = Effect.fn("CentralAuth.previewRemoteInvite")(
    function* (
      this: CentralAuthManager,
      token: string,
    ): Effect.fn.Return<RemoteInvitePreview, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#requestEffect(
        "/v2/remote/invites/preview",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) },
        decodeRemoteInvitePreview,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly acceptRemoteInvite = Effect.fn("CentralAuth.acceptRemoteInvite")(
    function* (
      this: CentralAuthManager,
      token: string,
    ): Effect.fn.Return<
      { hostId: string; membershipId: string; role: "admin" | "member" },
      CentralAuthOperationError,
      CentralAuthTransport
    > {
      return yield* this.#authorizedRequestEffect(
        "/v2/remote/invites/accept",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) },
        decodeAcceptedRemoteInvite,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly revokeRemoteInvite = Effect.fn("CentralAuth.revokeRemoteInvite")(
    function* (
      this: CentralAuthManager,
      inviteId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/invites/${encodeURIComponent(inviteId)}`,
        { method: "DELETE" },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly listRemoteMembers = Effect.fn("CentralAuth.listRemoteMembers")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<RemoteMemberRecord[], CentralAuthOperationError, CentralAuthTransport> {
      const members = yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/members/`,
        { method: "GET" },
        decodeRemoteMembers,
      );
      return members.map((member) => ({
        ...member,
        avatarUrl: member.avatarUrl ? this.resolveApiUrl(member.avatarUrl) : null,
      }));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly updateRemoteMember = Effect.fn("CentralAuth.updateRemoteMember")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      membershipId: string,
      role: "admin" | "member",
      reactivate = false,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/members/${encodeURIComponent(membershipId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, ...(reactivate ? { reactivate: true } : {}) }),
        },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly removeRemoteMember = Effect.fn("CentralAuth.removeRemoteMember")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      membershipId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/members/${encodeURIComponent(membershipId)}`,
        { method: "DELETE" },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly updateRemoteHostLogo = Effect.fn("CentralAuth.updateRemoteHostLogo")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      image: AvatarImageInput | null,
      version?: string | null,
    ): Effect.fn.Return<string | null, CentralAuthOperationError, CentralAuthTransport> {
      if (image === null) {
        yield* this.#authorizedRequestEffect(
          `/v2/remote/hosts/${encodeURIComponent(hostId)}/logo`,
          { method: "DELETE" },
          decodeVoid,
        );
        return null;
      }
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/logo`,
        {
          method: "PUT",
          headers: { "Content-Type": image.mimeType, ...(version ? { "OpenBot-Logo-Version": version } : {}) },
          body: Buffer.from(image.bytes),
        },
        (value) => requiredString(decodeRecord(value, "remote host logo"), "logoKey"),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly downloadRemoteHostLogo = Effect.fn("CentralAuth.downloadRemoteHostLogo")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      version: string,
    ): Effect.fn.Return<{ bytes: Uint8Array; mimeType: string }, CentralAuthOperationError, CentralAuthTransport> {
      if (!this.#sessionToken)
        return yield* new CentralAuthOperationError({
          cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
        });
      const url = new URL(`/v2/remote/hosts/${encodeURIComponent(hostId)}/logo`, this.#options.apiUrl);
      url.searchParams.set("v", version);
      const response = yield* CentralAuthTransport.use((transport) =>
        transport.fetch(url, {
          headers: { Authorization: `Bearer ${this.#sessionToken}` },
          signal: AbortSignal.timeout(30_000),
        }),
      );
      if (!response.ok)
        return yield* new CentralAuthOperationError({
          cause: yield* AuthApiError.fromResponseEffect(response),
        });
      return {
        bytes: new Uint8Array(yield* authCall(() => response.arrayBuffer())),
        mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "application/octet-stream",
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly redeemTeamAuthTicket = Effect.fn("CentralAuth.redeemTeamAuthTicket")(
    function* (
      this: CentralAuthManager,
      ticket: string,
      serverId: string,
    ): Effect.fn.Return<CentralAuthUser | null, CentralAuthOperationError, CentralAuthTransport> {
      if (!ticket) return null;
      return yield* Effect.gen({ self: this }, function* () {
        const user = yield* this.#requestEffect(
          "/v1/team-auth/redeem",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket, serverId }),
          },
          decodeCentralAuthUser,
        );
        return this.#resolveUserAvatar(user);
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.gen({ self: this }, function* () {
            if (error instanceof AuthApiError && error.status === 401) return null;
            return yield* new CentralAuthOperationError({ cause: error });
          }),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly sendTeamInviteEmail = Effect.fn("CentralAuth.sendTeamInviteEmail")(
    function* (
      this: CentralAuthManager,
      input: {
        email: string;
        serverName: string;
        inviteUrl: string;
        role: "admin" | "member";
      },
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        "/v1/team-invitations/email",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly initialize = Effect.fn("CentralAuth.initializeAdmission")(
    function* (this: CentralAuthManager) {
      if (this.#initialization) return yield* Deferred.await(this.#initialization);
      const pending = Deferred.makeUnsafe<CentralAuthState, CentralAuthOperationError>();
      this.#initialization = pending;
      return yield* this.#initialize().pipe(
        Effect.catch((error) => Effect.sync(() => this.#setInitializationError(error.cause))),
        Effect.onExit((exit) => Deferred.done(pending, exit)),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#initialization === pending) this.#initialization = null;
          }),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  retry() {
    return this.initialize();
  }

  readonly #initialize = Effect.fn("CentralAuth.initialize")(function* (
    this: CentralAuthManager,
  ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
    this.#setState({ status: "loading" });
    if (this.#options.canPersist()) {
      const attempt4 = yield* Effect.gen({ self: this }, function* () {
        const encrypted = Buffer.from(yield* authCall(() => readFile(this.#options.storagePath, "utf8")), "base64");
        yield* authDecode(() => this.#restoreStoredSession(this.#options.decrypt(encrypted)));
      }).pipe(Effect.result);
      if (Result.isFailure(attempt4)) {
        const error = attempt4.failure.cause;
        if (!isMissingFileError(error)) {
          yield* this.#clearStoredSessionEffect();
        }
      }
    } else {
      yield* authCall(() => rm(this.#options.storagePath, { force: true }));
    }
    if (!this.#sessionToken) {
      yield* this.#startupRequestEffect("/health/live", { method: "GET" }, decodeRecordHealth);
      return this.#setState({ status: "signed_out" });
    }
    const sessionToken = this.#sessionToken;
    return yield* Effect.gen({ self: this }, function* () {
      const user = yield* this.#startupRequestEffect("/v1/me", { method: "GET" }, decodeCentralAuthUser, sessionToken);
      return this.#setState({ status: "signed_in", user: this.#resolveUserAvatar(user) });
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.gen({ self: this }, function* () {
          if (error instanceof AuthApiError && error.status === 401) {
            yield* this.#clearStoredSessionEffect();
            return this.#setState({ status: "signed_out" });
          }
          return yield* new CentralAuthOperationError({ cause: error });
        }),
      ),
    );
  });

  readonly requestEmailCode = Effect.fn("CentralAuth.requestEmailCode")(
    function* (this: CentralAuthManager, email: string) {
      const normalizedEmail = email.trim().toLowerCase();
      const existingRequest = this.#emailCodeRequest;
      if (existingRequest?.email === normalizedEmail && existingRequest.pending)
        return yield* Deferred.await(existingRequest.pending);
      const request: EmailCodeRequest =
        existingRequest?.email === normalizedEmail
          ? existingRequest
          : { email: normalizedEmail, idempotencyKey: randomUUID(), pending: null };
      this.#emailCodeRequest = request;
      const pending = Deferred.makeUnsafe<CentralAuthState, CentralAuthOperationError>();
      request.pending = pending;
      return yield* this.#performEmailCodeRequest(request).pipe(Effect.onExit((exit) => Deferred.done(pending, exit)));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #performEmailCodeRequest = Effect.fn("CentralAuth.performEmailCodeRequest")(function* (
    this: CentralAuthManager,
    request: EmailCodeRequest,
  ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
    const existingChallenge = this.#state.status === "code_sent" ? this.#state : null;
    if (existingChallenge) {
      this.#setState({ ...existingChallenge, issue: undefined });
    } else {
      this.#setState({ status: "signing_in" });
    }
    return yield* Effect.gen({ self: this }, function* () {
      const result = yield* this.#requestEffect(
        "/v1/auth/email/start",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": request.idempotencyKey,
          },
          body: JSON.stringify({ email: request.email }),
        },
        decodeEmailChallenge,
        this.#options.emailCodeRequestTimeoutMs,
      );
      if (!result.challengeId || !Number.isFinite(result.expiresAt)) {
        return yield* new CentralAuthOperationError({
          cause: new Error("The account service returned an invalid sign-in challenge."),
        });
      }
      if (this.#emailCodeRequest === request) this.#emailCodeRequest = null;
      return this.#setState({
        status: "code_sent",
        challengeId: result.challengeId,
        email: request.email,
        expiresAt: result.expiresAt,
        resendAvailableAt: result.resendAt ?? Math.min(result.expiresAt, Date.now() + RESEND_FALLBACK_DELAY_MS),
        ...(result.developmentCode ? { developmentCode: result.developmentCode } : {}),
      });
    })
      .pipe(
        Effect.catch(({ cause: error }) =>
          Effect.sync(() => {
            if (isDefinitiveEmailCodeRequestFailure(error) && this.#emailCodeRequest === request) {
              this.#emailCodeRequest = null;
            }
            const issue = emailCodeRequestIssue(error);
            if (existingChallenge && !UNCERTAIN_EMAIL_CODE_REQUEST_FAILURES.has(issue.code)) {
              return this.#setState({ ...existingChallenge, issue });
            }
            return this.#setState({
              status: "error",
              issue,
            });
          }),
        ),
      )
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#emailCodeRequest === request) request.pending = null;
          }).pipe(Effect.orDie),
        ),
      );
  });

  readonly verifyEmailCode = Effect.fn("CentralAuth.verifyEmailCode")(
    function* (
      this: CentralAuthManager,
      challengeId: string,
      code: string,
    ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
      const challenge = this.#state.status === "code_sent" ? this.#state : null;
      if (challenge) this.#setState({ ...challenge, issue: undefined });
      let sessionApplied = false;
      return yield* Effect.gen({ self: this }, function* () {
        const session = yield* this.#requestEffect(
          "/v1/auth/email/verify",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId, code }),
          },
          decodeSessionResponse,
        );
        // Signing in as somebody else without signing out first. The host credentials belong
        // to the account that was issued them, and must not be filed under this session.
        if (this.#sessionAccountId !== null && this.#sessionAccountId !== session.user.id) {
          this.#teamHostTokens.clear();
        }
        this.#sessionToken = session.sessionToken;
        sessionApplied = true;
        yield* this.#writeStoredSession();
        return this.#setState({
          status: "signed_in",
          user: this.#resolveUserAvatar(session.user),
        });
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.gen({ self: this }, function* () {
            // A wrong code or a failed request for a challenge leaves the stored session as it was: the
            // user can still be signed in to another account, or have a session that only a startup
            // check failed on.
            if (sessionApplied || !challenge) yield* this.#clearStoredSessionEffect();
            if (challenge) {
              return this.#setState({
                ...challenge,
                issue: centralAuthIssue(error, "email_sign_in_failed", sourceText("error.auth.codeNotVerified")),
              });
            }
            return this.#setState({
              status: "error",
              issue: centralAuthIssue(error, "email_sign_in_failed", sourceText("error.auth.codeNotVerified")),
            });
          }),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /** False when the session can live only in memory, so it would be lost at the next start. */
  canPersistSession(): boolean {
    return this.#options.canPersist();
  }

  /**
   * Signs a new hosted server in with the claim that the account server put in its VM.
   * The result names the host ID that the account server reserved for this account.
   */

  readonly redeemHostedServerClaim = Effect.fn("CentralAuth.redeemHostedServerClaim")(
    function* (
      this: CentralAuthManager,
      claim: string,
    ): Effect.fn.Return<
      { hostId: string; name: string; user: CentralAuthUser },
      CentralAuthOperationError,
      CentralAuthTransport
    > {
      const redeemed = yield* this.#requestEffect(
        "/v2/hosting/claims/redeem",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim }) },
        (value) => {
          const parsed = parseHostedServerClaim(value);
          if (!parsed) throw new Error("Invalid hosted server claim.");
          return parsed;
        },
      );
      if (this.#sessionAccountId !== null && this.#sessionAccountId !== redeemed.user.id) {
        this.#teamHostTokens.clear();
      }
      const previousToken = this.#sessionToken;
      this.#sessionToken = redeemed.sessionToken;
      // The claim is spent. A session that is not stored ends at the next start, so a failed write fails
      // the redeem, and the session is not kept in memory. The start retry redeems the claim again in its
      // retry window.
      const attempt7 = yield* Effect.gen({ self: this }, function* () {
        yield* this.#writeStoredSession({ required: true });
      }).pipe(Effect.result);
      if (Result.isFailure(attempt7)) {
        const error = attempt7.failure.cause;
        this.#sessionToken = previousToken;
        return yield* new CentralAuthOperationError({ cause: error });
      }
      const user = this.#resolveUserAvatar(redeemed.user);
      this.#setState({ status: "signed_in", user });
      return { hostId: redeemed.hostId, name: redeemed.name, user };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly logout = Effect.fn("CentralAuth.logout")(
    function* (
      this: CentralAuthManager,
    ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
      this.#emailCodeRequest = null;
      if (this.#sessionToken) {
        const attempt8 = yield* Effect.gen({ self: this }, function* () {
          yield* this.#authorizedRequestEffect("/v1/auth/logout", { method: "POST" }, decodeVoid);
        }).pipe(Effect.result);
        if (Result.isFailure(attempt8)) {
          // Local logout must still remove the session from this device.
        }
      }
      yield* this.#clearStoredSessionEffect();
      return this.#setState({ status: "signed_out" });
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly updateAvatar = Effect.fn("CentralAuth.updateAvatar")(
    function* (
      this: CentralAuthManager,
      image: AvatarImageInput | null,
    ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
      const sessionToken = this.#sessionToken;
      if (!sessionToken)
        return yield* new CentralAuthOperationError({
          cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
        });
      const user = image
        ? yield* this.#authorizedRequestEffect(
            "/v1/me/avatar",
            {
              method: "PUT",
              headers: { "Content-Type": image.mimeType },
              body: Buffer.from(image.bytes),
            },
            decodeCentralAuthUser,
          )
        : yield* this.#authorizedRequestEffect(
            "/v1/me/avatar",
            {
              method: "DELETE",
            },
            decodeCentralAuthUser,
          );
      if (this.#sessionToken !== sessionToken || this.#state.status !== "signed_in") return this.getState();
      const resolvedUser = this.#resolveUserAvatar(user);
      return this.#setState({
        status: "signed_in",
        user: { ...this.#state.user, avatarUrl: resolvedUser.avatarUrl },
      });
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly updateName = Effect.fn("CentralAuth.updateName")(
    function* (
      this: CentralAuthManager,
      name: string,
    ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
      const sessionToken = this.#sessionToken;
      if (!sessionToken)
        return yield* new CentralAuthOperationError({
          cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
        });
      const user = yield* this.#authorizedRequestEffect(
        "/v1/me/profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
        decodeCentralAuthUser,
      );
      if (this.#sessionToken !== sessionToken || this.#state.status !== "signed_in") return this.getState();
      return this.#setState({
        status: "signed_in",
        user: { ...this.#state.user, name: user.name },
      });
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #requestEffect = Effect.fn("CentralAuth.request")(function* <T>(
    this: CentralAuthManager,
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs = 10_000,
  ): Effect.fn.Return<T, CentralAuthOperationError, CentralAuthTransport> {
    const response = yield* CentralAuthTransport.use((transport) =>
      transport.fetch(new URL(path, this.#options.apiUrl), {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
    if (!response.ok)
      return yield* new CentralAuthOperationError({
        cause: yield* AuthApiError.fromResponseEffect(response),
      });
    const value = response.status === 204 ? undefined : yield* authCall(() => response.json());
    return yield* authDecode(() => decoder(value));
  });

  readonly #startupRequestEffect = Effect.fn("CentralAuth.startupRequest")(function* <T>(
    this: CentralAuthManager,
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    sessionToken?: string,
  ): Effect.fn.Return<T, CentralAuthOperationError, CentralAuthTransport> {
    const deadline = Date.now() + this.#options.startupRetryWindowMs;
    let retryIndex = 0;
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0)
        return yield* new CentralAuthOperationError({ cause: new Error(sourceText("error.auth.serviceUnavailable")) });
      const result = yield* this.#requestEffect(
        path,
        {
          ...init,
          headers: sessionToken ? { ...init.headers, Authorization: `Bearer ${sessionToken}` } : init.headers,
        },
        decoder,
        Math.max(1, Math.min(this.#options.startupRequestTimeoutMs, remainingMs)),
      ).pipe(Effect.result);
      if (Result.isSuccess(result)) return result.success;
      const error = result.failure.cause;
      if (!isTransientStartupError(error)) return yield* result.failure;
      const delayMs = Math.min(
        this.#options.startupRetryDelaysMs[Math.min(retryIndex, this.#options.startupRetryDelaysMs.length - 1)] ?? 0,
        Math.max(0, deadline - Date.now()),
      );
      if (delayMs <= 0) return yield* result.failure;
      yield* Effect.sleep(delayMs);
      retryIndex += 1;
    }
  });

  readonly #authorizedRequestEffect = Effect.fn("CentralAuth.authorizedRequest")(function* <T>(
    this: CentralAuthManager,
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs?: number,
  ): Effect.fn.Return<T, CentralAuthOperationError, CentralAuthTransport> {
    if (!this.#sessionToken)
      return yield* new CentralAuthOperationError({
        cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
      });
    // A spread drops the entries of a `Headers` object, such as the hosting developer key.
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.#sessionToken}`);
    return yield* this.#requestEffect(path, { ...init, headers }, decoder, timeoutMs);
  });

  #resolveUserAvatar(user: CentralAuthUser): CentralAuthUser {
    return {
      ...user,
      avatarUrl: user.avatarUrl ? new URL(user.avatarUrl, this.#options.apiUrl).toString() : null,
    };
  }

  #writeStoredSession(options: { required?: boolean } = {}) {
    return this.#sessionWrites
      .withPermit(this.#writeStoredSessionNow(options.required === true))
      .pipe(Effect.uninterruptible);
  }

  readonly #writeStoredSessionNow = Effect.fn("CentralAuth.writeStoredSessionNow")(function* (
    this: CentralAuthManager,
    required: boolean,
  ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
    if (!this.#sessionToken) return;
    if (!this.#options.canPersist()) {
      yield* authCall(() => rm(this.#options.storagePath, { force: true }));
      if (required)
        return yield* new CentralAuthOperationError({ cause: new Error("The session could not be stored.") });
      return;
    }
    const temporaryPath = `${this.#options.storagePath}.${randomUUID()}.tmp`;
    yield* Effect.gen({ self: this }, function* () {
      const value = JSON.stringify({
        version: 2,
        sessionToken: this.#sessionToken,
        teamHostTokens: Object.fromEntries(this.#teamHostTokens),
      });
      const encrypted = yield* authDecode(() => this.#options.encrypt(value).toString("base64"));
      yield* authCall(() => mkdir(dirname(this.#options.storagePath), { recursive: true }));
      yield* authCall(() => writeFile(temporaryPath, encrypted, { mode: 0o600 }));
      yield* authCall(() => chmod(temporaryPath, 0o600));
      yield* authCall(() => rename(temporaryPath, this.#options.storagePath));
    }).pipe(
      Effect.catch((failure) =>
        Effect.gen({ self: this }, function* () {
          yield* Effect.all(
            [this.#options.storagePath, temporaryPath].map((path) =>
              authCall(() => rm(path, { force: true })).pipe(Effect.catch(() => Effect.void)),
            ),
            { concurrency: "unbounded" },
          );
          if (required) return yield* failure;
        }),
      ),
      Effect.ensuring(authCall(() => rm(temporaryPath, { force: true })).pipe(Effect.catch(() => Effect.void))),
    );
  });

  readonly #clearStoredSessionEffect = Effect.fn("CentralAuth.clearStoredSession")(function* (
    this: CentralAuthManager,
  ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
    this.#sessionToken = null;
    this.#sessionAccountId = null;
    this.#teamHostTokens.clear();
    // Through the same chain as the writes, so a write already in flight cannot put the
    // file back after it is removed.
    yield* this.#sessionWrites
      .withPermit(authCall(() => rm(this.#options.storagePath, { force: true })))
      .pipe(Effect.uninterruptible);
  });

  #restoreStoredSession(value: string): void {
    if (!value.trimStart().startsWith("{")) {
      this.#sessionToken = value;
      this.#teamHostTokens.clear();
      return;
    }
    const stored = JSON.parse(value);
    if (!isDynamicRecord(stored) || stored.version !== 2 || !isString(stored.sessionToken)) {
      throw new Error("Invalid protected account session.");
    }
    this.#sessionToken = stored.sessionToken;
    this.#teamHostTokens.clear();
    if (isDynamicRecord(stored.teamHostTokens)) {
      for (const [serverId, token] of Object.entries(stored.teamHostTokens)) {
        if (/^[0-9a-f-]{36}$/iu.test(serverId) && isString(token) && /^[A-Za-z0-9_-]{32,128}$/u.test(token)) {
          this.#teamHostTokens.set(serverId.toLowerCase(), token);
        }
      }
    }
  }

  #setState(state: CentralAuthState): CentralAuthState {
    // Held apart from the state, which passes through `code_sent` on the way to another
    // account: this is whose credentials the store is holding, until they are cleared.
    if (state.status === "signed_in") this.#sessionAccountId = state.user.id;
    this.#state = state;
    const copy = this.getState();
    this.emit("changed", copy);
    return copy;
  }

  #setInitializationError(error: unknown): CentralAuthState {
    if (error instanceof NetworkBlockedError) {
      return this.#setState({ status: "error", issue: { code: "auth_api_unavailable", message: error.message } });
    }
    const apiError = error instanceof AuthApiError ? error : null;
    const unavailable = !apiError || apiError.status >= 500;
    return this.#setState({
      status: "error",
      issue: {
        code: unavailable ? "auth_api_unavailable" : apiError.code,
        message: unavailable ? sourceText("error.auth.serviceUnavailable") : apiError.message,
        ...(apiError?.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: apiError.retryAfterSeconds }),
      },
    });
  }
}

export function readCentralAuthApiUrl(value: string | undefined, fallback = "http://127.0.0.1:3100"): string {
  const url = new URL(value ?? fallback);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.pathname !== "/") {
    throw new Error("OPENBOT_AUTH_API_URL must be HTTPS or an HTTP loopback origin.");
  }
  return url.origin;
}

export function readMobileConnectApiUrl(value: string | undefined, fallback: string): string {
  const apiUrl = value ?? fallback;
  createMobileConnectUrl({ apiUrl, ticket: "x".repeat(32) });
  return new URL(apiUrl).origin;
}

class AuthApiError extends Schema.TaggedError<AuthApiError>()("AuthApiError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
  retryAfterSeconds: Schema.optional(Schema.Number),
}) {
  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super({ status, code, message, retryAfterSeconds });
  }

  static readonly fromResponseEffect = Effect.fn("CentralAuth.decodeError")(function* (response: Response) {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("Retry-After"));
    const value = yield* authCall(() => response.json()).pipe(Effect.catch(() => Effect.succeed(null)));
    if (
      isDynamicRecord(value) &&
      isDynamicRecord(value.error) &&
      isString(value.error.code) &&
      isString(value.error.message)
    ) {
      return new AuthApiError(response.status, value.error.code, value.error.message, retryAfterSeconds);
    }
    return new AuthApiError(
      response.status,
      "auth_api_error",
      sourceText("error.auth.serviceError"),
      retryAfterSeconds,
    );
  });
}

// A company firewall or proxy answers in place of the account service: with an HTML block page, or
// by re-signing TLS with a root that this computer does not trust. Neither is the API's answer, so
// its status must not reach a handler, such as the 401 that clears the stored session.
class NetworkBlockedError extends Error {}

const INTERCEPTED_TLS_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function detectBlockingNetwork(fetcher: AuthFetcher, apiUrl: string): AuthFetcher {
  const blocked = () =>
    new NetworkBlockedError(sourceText("error.auth.networkBlocked", { host: new URL(apiUrl).host }));
  return async (input, init) => {
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch (error) {
      if (isInterceptedTlsError(error)) throw blocked();
      throw error;
    }
    if (isFilterPage(response)) {
      void response.body?.cancel().catch(() => undefined);
      throw blocked();
    }
    return response;
  };
}

// The account service answers with JSON or an image, never with HTML. Cloudflare's own error pages
// are HTML too, but they carry `cf-ray`. A self-hosted service behind nginx can send an HTML 404 or
// 413, so only the statuses that a filter uses for its block page count.
const FILTER_PAGE_STATUSES = new Set([200, 401, 403, 407, 451]);

function isFilterPage(response: Response): boolean {
  return (
    FILTER_PAGE_STATUSES.has(response.status) &&
    !response.headers.has("cf-ray") &&
    Boolean(response.headers.get("content-type")?.toLowerCase().startsWith("text/html"))
  );
}

function isInterceptedTlsError(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return isDynamicRecord(cause) && isString(cause.code) && INTERCEPTED_TLS_CODES.has(cause.code);
}

function centralAuthIssue(error: unknown, fallbackCode: string, fallbackMessage: string): CentralAuthIssue {
  if (error instanceof NetworkBlockedError) return { code: "network_blocked", message: error.message };
  if (error instanceof AuthApiError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
    };
  }
  return { code: fallbackCode, message: errorMessage(error, fallbackMessage) };
}

function emailCodeRequestIssue(error: unknown): CentralAuthIssue {
  if (error instanceof AuthApiError || error instanceof NetworkBlockedError) {
    return centralAuthIssue(error, "email_sign_in_start_failed", sourceText("error.auth.codeNotSent"));
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return {
      code: "email_delivery_timeout",
      message: sourceText("error.auth.deliveryTimeout"),
    };
  }
  if (error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")) {
    return {
      code: "email_delivery_unknown",
      message: sourceText("error.auth.deliveryInterrupted"),
    };
  }
  return {
    code: "email_delivery_unknown",
    message: sourceText("error.auth.deliveryUnknown"),
  };
}

function isDefinitiveEmailCodeRequestFailure(error: unknown): boolean {
  if (!(error instanceof AuthApiError)) return false;
  return DEFINITIVE_EMAIL_CODE_REQUEST_FAILURES.has(error.code);
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds > 0 ? seconds : undefined;
  }
  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) return undefined;
  const seconds = Math.ceil((retryAt - Date.now()) / 1_000);
  return seconds > 0 ? seconds : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// A block page gives the same answer on each attempt, so it is not transient.
function isTransientStartupError(error: unknown): boolean {
  if (error instanceof NetworkBlockedError) return false;
  return !(error instanceof AuthApiError) || error.status >= 500;
}
