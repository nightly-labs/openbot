import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { companySignInErrorKey } from "@openbot/contracts/company-sign-in";
import { CREDIT_MEDIA_HOST_HEADER, CREDIT_MEDIA_HOST_TOKEN_HEADER } from "@openbot/contracts/credit-media";
import type { HostKeyHandover } from "@openbot/contracts/host-key-handover";
import { parseHostedServerClaim } from "@openbot/contracts/hosted-servers";
import type {
  AvatarColor,
  AvatarImageInput,
  CentralAuthIssue,
  CentralAuthState,
  CentralAuthUser,
  CompanySignInScimToken,
  CompanySignInSettings,
  MobileConnectedDevice,
  MobileConnectLink,
  MobileConnectTicket,
} from "@openbot/contracts/ipc";
import {
  decodeCompanySignInScimToken,
  decodeCompanySignInSettings,
  isSignalHomeId,
  type TestCompanySignInInput,
  type TestCompanySignInResult,
} from "@openbot/contracts/ipc";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import {
  createMobileConnectUrl,
  isMobileConnectHostBinding,
  type MobileConnectHostBinding,
} from "@openbot/contracts/mobile-connect";
import {
  type AcceptedOwnerTransfer,
  decodeAcceptedOwnerTransfer,
  decodeIncomingOwnerTransfers,
  decodeOwnerTransfer,
  decodePendingOwnerTransfer,
  type OwnerTransfer,
} from "@openbot/contracts/owner-transfer";
import {
  decodeRemoteSession,
  decodeRemoteSessionTicket,
  type RemoteSession,
  type RemoteSessionTicket,
} from "@openbot/contracts/remote-control-plane";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  GITHUB_REPOSITORY_NAME_PATTERN,
  type GitHubRouteRepository,
} from "@openbot/contracts/signal-protocol/github-route";
import { TELEGRAM_LINK_CODE_PATTERN } from "@openbot/contracts/signal-protocol/telegram-route";
import {
  REMOTE_TICKET_AUDIENCE,
  type RemoteMemberRole,
  type RemoteTicketClaims,
} from "@openbot/contracts/signal-protocol/ticket";
import { WATCH_TICKET_AUDIENCE, type WatchTicketClaims } from "@openbot/contracts/signal-protocol/watch-relay";
import type { ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { inviteEmailRateLimitedText, parseRetryAfterSeconds } from "@openbot/team-client/remote-directory";
import { referenceFrom, safeReference } from "@openbot/user-errors";
import { Deferred, Duration, Effect, Exit, type Layer, Result, Schema, Semaphore } from "effect";
import { createLocalJWKSet, type JWTPayload, jwtVerify } from "jose";
import { z } from "zod";
import { runCauseEffect } from "../backend/effect-boundary";
import { isMissingFileError } from "../backend/file-errors";
import { authCall, authDecode, CentralAuthOperationError, CentralAuthTransport } from "./central-auth-effects";
import {
  decodeAcceptedRemoteInvite,
  decodeCentralAuthUser,
  decodeCreatedRemoteInvite,
  decodeEmailChallenge,
  decodeMobileConnectedDevices,
  decodeMobileConnectLinkResponse,
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
import { awaitCompanySignIn, type CompanySignInBrowser, CompanySignInBrowserError } from "./company-sign-in-browser";
import type { NotificationRelayRequest } from "./push-notifications";
import type { WatchWidgetPush } from "./watch-widget-push";

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
  keyringChanged?: () => boolean;
  fetch?: AuthFetcher;
  startupRetryWindowMs?: number;
  startupRequestTimeoutMs?: number;
  startupRetryDelaysMs?: readonly number[];
  emailCodeRequestTimeoutMs?: number;
  companySignInBrowser?: CompanySignInBrowser | null;
  confirmSessionAtStart?: boolean;
}

interface StoredMobileConnectLink {
  host: MobileConnectHostBinding;
  token: string;
  createdAt: number;
}

const MOBILE_CONNECT_LINK_TOKEN = /^[A-Za-z0-9_-]{32,128}$/u;

const logger = createOpenBotLogger("central-auth");

type StoredSessionStage = "read" | "decrypt" | "decode" | "encrypt" | "write";

function decodeLinkedRoute(
  value: unknown,
  label: string,
  field: "teams" | "chats",
): { ticket: string; ids: string[] | null } {
  const record = decodeRecord(value, label);
  const ids = record[field];
  return { ticket: requiredString(record, "ticket"), ids: Array.isArray(ids) && ids.every(isString) ? ids : null };
}

function storedSessionFailure(stage: StoredSessionStage, error: unknown) {
  const code = isDynamicRecord(error) && isString(error.code) ? error.code : null;
  return { stage, error: error instanceof Error ? error.name : typeof error, code };
}

interface EmailCodeRequest {
  email: string;
  idempotencyKey: string;
  pending: Deferred.Deferred<CentralAuthState, CentralAuthOperationError> | null;
}

const TELEGRAM_BOT_USERNAME = /^[A-Za-z0-9_]{5,32}$/u;

const STARTUP_RETRY_WINDOW_MS = 30_000;
const STARTUP_REQUEST_TIMEOUT_MS = 3_000;
const STARTUP_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;
const UNAVAILABLE_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 60_000] as const;
const MAX_UNAVAILABLE_RETRY_AFTER_SECONDS = 60 * 60;
const EMAIL_CODE_REQUEST_TIMEOUT_MS = 35_000;
const HOST_CREDENTIAL_REVOKE_TIMEOUT_MS = 5_000;
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

export type RemoteConnectionBootstrap = RemoteSessionTicket;

export type RelayCaller = { kind: "server"; hostId: string } | { kind: "personal" };

export interface RemoteHostTicketHome {
  readonly failedSignalUrl?: string;
  readonly preferredSignalHome?: string | null;
}

export interface RemoteSignalHomeEntry {
  readonly id: string;
  readonly url: string;
}

function decodeRemoteSignalHomes(value: unknown): RemoteSignalHomeEntry[] {
  const homes = decodeRecord(value, "Signal homes").homes;
  if (!Array.isArray(homes)) throw new Error("Invalid Signal homes.");
  return homes.map((home) => {
    const entry = decodeRecord(home, "Signal home");
    const id = requiredString(entry, "id");
    const url = requiredString(entry, "url");
    if (!isSignalHomeId(id) || !/^wss?:/u.test(url)) throw new Error("Invalid Signal home.");
    return { id, url };
  });
}

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
  #storedSessionToken: string | null = null;
  #sessionUser: { token: string; user: CentralAuthUser } | null = null;
  #storedUserJson: string | null = null;
  readonly #teamHostTokens = new Map<string, string>();
  #mobileConnectLink: StoredMobileConnectLink | null = null;
  #sessionWrites = Semaphore.makeUnsafe(1);
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
  #companySignInCancel: Deferred.Deferred<void> | null = null;
  #companySignInTestCancel: Deferred.Deferred<void> | null = null;
  #unavailableRetryTimer: ReturnType<typeof setTimeout> | null = null;
  #unavailableRetryFailures = 0;
  #disposed = false;

  constructor(options: CentralAuthManagerOptions) {
    super();
    const fetcher = detectBlockingNetwork(options.fetch ?? fetch, options.apiUrl);
    this.#transport = CentralAuthTransport.layer(fetcher);
    this.#options = {
      ...options,
      mobileConnectApiUrl: options.mobileConnectApiUrl ?? options.apiUrl,
      canPersist: options.canPersist ?? (() => true),
      keyringChanged: options.keyringChanged ?? (() => false),
      fetch: fetcher,
      startupRetryWindowMs: options.startupRetryWindowMs ?? STARTUP_RETRY_WINDOW_MS,
      startupRequestTimeoutMs: options.startupRequestTimeoutMs ?? STARTUP_REQUEST_TIMEOUT_MS,
      startupRetryDelaysMs: options.startupRetryDelaysMs ?? STARTUP_RETRY_DELAYS_MS,
      emailCodeRequestTimeoutMs: options.emailCodeRequestTimeoutMs ?? EMAIL_CODE_REQUEST_TIMEOUT_MS,
      companySignInBrowser: options.companySignInBrowser ?? null,
      confirmSessionAtStart: options.confirmSessionAtStart ?? false,
    };
  }

  readonly #pending = new Set<Deferred.Deferred<void>>();
  readonly dispose = Effect.fn("CentralAuth.dispose")(function* (this: CentralAuthManager) {
    this.#disposed = true;
    this.#cancelUnavailableRetry();
    this.stopProfileRefresh();
    this.#endCompanySignIn();
    this.#endCompanySignInTest();
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
        resolved.avatarUrl === state.user.avatarUrl &&
        resolved.analyticsEnabled === state.user.analyticsEnabled &&
        resolved.chatColor === state.user.chatColor
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
      const requestedAt = Date.now();
      const result = yield* this.#authorizedRequestEffect(
        "/v1/mobile-auth/ticket",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host }),
        },
        (value, response) => ({ ...decodeTicketResponse(value), serverDate: response.headers.get("Date") }),
      );
      const receivedAt = Date.now();
      const expiresAt = result.expiresAt - serverClockOffsetMs(result.serverDate, requestedAt, receivedAt);
      if (!result.ticket || !Number.isFinite(expiresAt) || expiresAt <= receivedAt) {
        return yield* new CentralAuthOperationError({
          cause: new Error("The account service returned an invalid Mobile Connect ticket."),
        });
      }
      return {
        qrData: createMobileConnectUrl({ apiUrl: this.#options.mobileConnectApiUrl, ticket: result.ticket, host }),
        expiresAt,
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly cancelMobileConnect = Effect.fn("CentralAuth.cancelMobileConnect")(
    function* (
      this: CentralAuthManager,
      host: MobileConnectHostBinding | null,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      if (!host) return;
      yield* this.#authorizedRequestEffect(
        `/v1/mobile-auth/ticket?host=${encodeURIComponent(host.hostId)}`,
        { method: "DELETE" },
        () => undefined,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  getMobileConnectLink(host: MobileConnectHostBinding | null): MobileConnectLink | null {
    const stored = this.#mobileConnectLink;
    if (
      !stored ||
      !host ||
      this.#state.status !== "signed_in" ||
      stored.host.hostId !== host.hostId ||
      stored.host.fingerprint !== host.fingerprint
    )
      return null;
    return this.#mobileConnectLinkView(stored);
  }

  readonly createMobileConnectLink = Effect.fn("CentralAuth.createMobileConnectLink")(
    function* (
      this: CentralAuthManager,
      host: MobileConnectHostBinding,
    ): Effect.fn.Return<MobileConnectLink, CentralAuthOperationError, CentralAuthTransport> {
      const sessionToken = this.#sessionToken;
      const result = yield* this.#authorizedRequestEffect(
        "/v1/mobile-auth/link",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host }),
        },
        decodeMobileConnectLinkResponse,
      );
      if (!MOBILE_CONNECT_LINK_TOKEN.test(result.link) || !Number.isFinite(result.createdAt)) {
        return yield* new CentralAuthOperationError({
          cause: new Error("The account service returned an invalid Mobile Connect link."),
        });
      }
      const stored = { host, token: result.link, createdAt: result.createdAt };
      if (this.#sessionToken === sessionToken) {
        this.#mobileConnectLink = stored;
        yield* this.#writeStoredSession();
      }
      return this.#mobileConnectLinkView(stored);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly revokeMobileConnectLink = Effect.fn("CentralAuth.revokeMobileConnectLink")(
    function* (
      this: CentralAuthManager,
      host: MobileConnectHostBinding | null,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      const hostId = this.#mobileConnectLink?.host.hostId ?? host?.hostId;
      if (!hostId) return;
      yield* this.#authorizedRequestEffect(
        `/v1/mobile-auth/link?host=${encodeURIComponent(hostId)}`,
        { method: "DELETE" },
        () => undefined,
      );
      if (this.#mobileConnectLink?.host.hostId !== hostId) return;
      this.#mobileConnectLink = null;
      yield* this.#writeStoredSession();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  #mobileConnectLinkView(stored: StoredMobileConnectLink): MobileConnectLink {
    return {
      url: createMobileConnectUrl({
        apiUrl: this.#options.mobileConnectApiUrl,
        ticket: stored.token,
        host: stored.host,
      }),
      createdAt: stored.createdAt,
    };
  }

  readonly listMobileConnectedDevices = Effect.fn("CentralAuth.listMobileConnectedDevices")(
    function* (
      this: CentralAuthManager,
      host: MobileConnectHostBinding | null,
    ): Effect.fn.Return<MobileConnectedDevice[], CentralAuthOperationError, CentralAuthTransport> {
      if (!host) return [];
      const result = yield* this.#authorizedRequestEffect(
        `/v1/mobile-auth/devices?host=${encodeURIComponent(host.hostId)}`,
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
                  hostedServer: z.boolean().exactOptional(),
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
        automatic?: boolean;
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

  readonly handOverRemoteHostKey = Effect.fn("CentralAuth.handOverRemoteHostKey")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      handover: HostKeyHandover,
    ): Effect.fn.Return<"accepted" | "refused", CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
      if (!machineToken) {
        const hosts = yield* this.#authorizedRequestEffect("/v2/remote/hosts/", { method: "GET" }, decodeRemoteHosts);
        const host = hosts.find((entry) => entry.hostId.toLowerCase() === hostId.toLowerCase());
        return host?.devicePublicKey === handover.publicKey ? "accepted" : "refused";
      }
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/key-handover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, handover }),
        },
        () => undefined,
      ).pipe(
        Effect.as("accepted" as const),
        Effect.catch(({ cause: error }) =>
          isFinalClientError(error)
            ? Effect.succeed("refused" as const)
            : Effect.fail(new CentralAuthOperationError({ cause: error })),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  useHostCredential(hostId: string, machineToken: string | null): void {
    if (machineToken === null) this.#teamHostTokens.delete(hostId.toLowerCase());
    else this.#teamHostTokens.set(hostId.toLowerCase(), machineToken);
  }

  hostSiteCredential(hostId: string): { hostId: string; machineToken: string } | null {
    const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
    return machineToken ? { hostId, machineToken } : null;
  }

  #hostHeaders(hostId: string, init: HeadersInit | undefined) {
    return this.#hostMachineToken(hostId).pipe(
      Effect.map((machineToken) => {
        const headers = new Headers(init);
        headers.set(CREDIT_MEDIA_HOST_HEADER, hostId);
        headers.set(CREDIT_MEDIA_HOST_TOKEN_HEADER, machineToken);
        return headers;
      }),
    );
  }

  requestAsHost<T>(
    hostId: string,
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs?: number,
  ): Effect.Effect<T, CentralAuthOperationError> {
    return this.#owned(
      this.#hostHeaders(hostId, init.headers).pipe(
        Effect.flatMap((headers) => this.#requestEffect(path, { ...init, headers }, decoder, timeoutMs)),
      ),
    );
  }

  readonly relayFetch = Effect.fn("CentralAuth.relayFetch")(
    function* (
      this: CentralAuthManager,
      caller: RelayCaller,
      path: string,
      init: RequestInit,
    ): Effect.fn.Return<Response, CentralAuthOperationError, CentralAuthTransport> {
      const headers = yield* this.#relayHeaders(caller, init.headers);
      return yield* CentralAuthTransport.use((transport) =>
        transport.fetch(new URL(path, this.#options.apiUrl), { ...init, headers, redirect: "error" }),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  #relayHeaders(caller: RelayCaller, init: HeadersInit | undefined) {
    if (caller.kind === "server") return this.#hostHeaders(caller.hostId, init);
    const token = this.#sessionToken;
    if (!token)
      return Effect.fail(
        new CentralAuthOperationError({
          cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
        }),
      );
    const headers = new Headers(init);
    headers.set("Authorization", `Bearer ${token}`);
    return Effect.succeed(headers);
  }

  readonly downloadAsHost = Effect.fn("CentralAuth.downloadAsHost")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      path: string,
      timeoutMs = 30_000,
    ): Effect.fn.Return<Uint8Array, CentralAuthOperationError, CentralAuthTransport> {
      const headers = yield* this.#hostHeaders(hostId, undefined);
      const response = yield* CentralAuthTransport.use((transport) =>
        transport.fetch(new URL(path, this.#options.apiUrl), { headers, signal: AbortSignal.timeout(timeoutMs) }),
      );
      if (!response.ok)
        return yield* new CentralAuthOperationError({
          cause: yield* AuthApiError.fromResponseEffect(response),
        });
      return new Uint8Array(yield* authCall(() => response.arrayBuffer()));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #hostMachineToken = Effect.fn("CentralAuth.hostMachineToken")(function* (
    this: CentralAuthManager,
    hostId: string,
  ): Effect.fn.Return<string, CentralAuthOperationError> {
    const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
    if (!machineToken)
      return yield* new CentralAuthOperationError({
        cause: new Error(sourceText("error.auth.hostCredentialUnavailable")),
      });
    return machineToken;
  });

  readonly issueRemoteHostTicket = Effect.fn("CentralAuth.issueRemoteHostTicket")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      home?: RemoteHostTicketHome,
    ): Effect.fn.Return<RemoteConnectionBootstrap, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      const body = home
        ? {
            machineToken,
            signalHome: true,
            ...(home.failedSignalUrl === undefined ? {} : { failedSignalUrl: home.failedSignalUrl }),
            ...(home.preferredSignalHome ? { preferredSignalHome: home.preferredSignalHome } : {}),
          }
        : // `false` keeps the stored home: the host peer of this build still connects to it.
          { machineToken, signalHome: false };
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/ticket`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        decodeRemoteSessionTicket,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly listRemoteSignalHomes = Effect.fn("CentralAuth.listRemoteSignalHomes")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<RemoteSignalHomeEntry[], CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/signal-homes`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
        decodeRemoteSignalHomes,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly issueWebhookRoute = Effect.fn("CentralAuth.issueWebhookRoute")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<string, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/webhook-route`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
        (value) => requiredString(decodeRecord(value, "Webhook route"), "ticket"),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly issueGitHubRoute = Effect.fn("CentralAuth.issueGitHubRoute")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      githubToken: string,
      repositories: readonly string[],
    ): Effect.fn.Return<GitHubRouteTicket, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/github-route`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, githubToken, repositories }),
        },
        decodeGitHubRouteTicket,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly registerWebhookRoute = Effect.fn("CentralAuth.registerWebhookRoute")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      routeId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/webhook-routes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, routeId }),
        },
        (value) => {
          requiredString(decodeRecord(value, "Webhook route"), "routeId");
        },
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly revokeWebhookRoute = Effect.fn("CentralAuth.revokeWebhookRoute")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      routeId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/webhook-routes`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, routeId }),
        },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly issueSlackRoute = Effect.fn("CentralAuth.issueSlackRoute")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<{ ticket: string; ids: string[] | null }, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/slack-route`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
        (value) => decodeLinkedRoute(value, "Slack route", "teams"),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly unlinkSlackWorkspace = Effect.fn("CentralAuth.unlinkSlackWorkspace")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      teamId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
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

  readonly issueDiscordRoute = Effect.fn("CentralAuth.issueDiscordRoute")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<string, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/discord-route`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
        (value) => requiredString(decodeRecord(value, "Discord route"), "ticket"),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly unlinkDiscordGuild = Effect.fn("CentralAuth.unlinkDiscordGuild")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      guildId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/discord-disconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, guildId }),
        },
        () => undefined,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly issueTelegramRoute = Effect.fn("CentralAuth.issueTelegramRoute")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<{ ticket: string; ids: string[] | null }, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/telegram-route`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
        (value) => decodeLinkedRoute(value, "Telegram route", "chats"),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly createTelegramLink = Effect.fn("CentralAuth.createTelegramLink")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<{ botUsername: string; code: string }, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/telegram-link`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
        (value) => {
          const record = decodeRecord(value, "Telegram link");
          const botUsername = requiredString(record, "botUsername");
          const code = requiredString(record, "code");
          if (!TELEGRAM_BOT_USERNAME.test(botUsername) || !TELEGRAM_LINK_CODE_PATTERN.test(code))
            throw new Error("The Telegram link is invalid.");
          return { botUsername, code };
        },
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly unlinkTelegramChat = Effect.fn("CentralAuth.unlinkTelegramChat")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      chatId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/telegram-disconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, chatId }),
        },
        () => undefined,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly sendLiveActivityPush = Effect.fn("CentralAuth.sendLiveActivityPush")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      push: LiveActivityRelayPush,
    ): Effect.fn.Return<"sent" | "gone", CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
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

  readonly sendWatchWidgetPush = Effect.fn("CentralAuth.sendWatchWidgetPush")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      push: WatchWidgetPush,
    ): Effect.fn.Return<"sent" | "gone", CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/widget-push`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, token: push.token, environment: push.environment }),
        },
        () => undefined,
      ).pipe(
        Effect.as("sent" as const),
        Effect.catch(({ cause: error }) =>
          error instanceof AuthApiError && error.status === 410
            ? Effect.succeed("gone" as const)
            : Effect.fail(new CentralAuthOperationError({ cause: error })),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly sendPushNotification = Effect.fn("CentralAuth.sendPushNotification")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      request: NotificationRelayRequest,
    ): Effect.fn.Return<"sent" | "gone", CentralAuthOperationError, CentralAuthTransport> {
      const machineToken = yield* this.#hostMachineToken(hostId);
      const route = request.platform === "android" ? "android-notification" : "notification";
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/${route}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, ...request.push }),
        },
        () => undefined,
      ).pipe(
        Effect.as("sent" as const),
        Effect.catch(({ cause: error }) =>
          error instanceof AuthApiError && error.status === 410
            ? Effect.succeed("gone" as const)
            : Effect.fail(new CentralAuthOperationError({ cause: error })),
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
      const payload = yield* this.#verifyTicketJwt(ticket, REMOTE_TICKET_AUDIENCE);
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

  readonly verifyWatchTicket = Effect.fn("CentralAuth.verifyWatchTicket")(
    function* (
      this: CentralAuthManager,
      ticket: string,
    ): Effect.fn.Return<WatchTicketClaims, CentralAuthOperationError, CentralAuthTransport> {
      const payload = yield* this.#verifyTicketJwt(ticket, WATCH_TICKET_AUDIENCE);
      if (
        payload.aud !== WATCH_TICKET_AUDIENCE ||
        !isString(payload.jti) ||
        !isString(payload.watchSessionId) ||
        !isString(payload.hostId) ||
        !isString(payload.userId) ||
        !isString(payload.membershipId) ||
        (payload.role !== "owner" && payload.role !== "admin" && payload.role !== "member") ||
        !isNumber(payload.authEpoch) ||
        !Number.isInteger(payload.authEpoch) ||
        !isString(payload.clientPublicKey) ||
        (payload.signal !== undefined && !isString(payload.signal)) ||
        !isNumber(payload.iat) ||
        !isNumber(payload.exp)
      ) {
        return yield* new CentralAuthOperationError({
          cause: new Error("The watch ticket has invalid claims."),
        });
      }
      return {
        aud: WATCH_TICKET_AUDIENCE,
        jti: payload.jti,
        watchSessionId: payload.watchSessionId,
        hostId: payload.hostId,
        userId: payload.userId,
        membershipId: payload.membershipId,
        role: payload.role,
        authEpoch: payload.authEpoch,
        clientPublicKey: payload.clientPublicKey,
        ...(isString(payload.signal) ? { signal: payload.signal } : {}),
        iat: payload.iat,
        exp: payload.exp,
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #verifyTicketJwt = Effect.fn("CentralAuth.verifyTicketJwt")(function* (
    this: CentralAuthManager,
    ticket: string,
    audience: string,
  ): Effect.fn.Return<JWTPayload, CentralAuthOperationError, CentralAuthTransport> {
    const verify = Effect.gen({ self: this }, function* () {
      if (!this.#remoteTicketJwks)
        this.#remoteTicketJwks = yield* this.#fetchRemoteTicketJwks().pipe(
          Effect.cachedWithTTL((exit) => (Exit.isSuccess(exit) ? Duration.infinity : 0)),
        );
      const jwks = yield* this.#remoteTicketJwks;
      const keySet = yield* authDecode(() => createLocalJWKSet(jwks));
      return yield* authCall(() => jwtVerify(ticket, keySet, { audience, algorithms: ["ES256"] }));
    });
    const { payload } = yield* verify.pipe(
      Effect.catch((failure) => {
        const error = failure.cause;
        if (!isDynamicRecord(error) || error.code !== "ERR_JWKS_NO_MATCHING_KEY") return Effect.fail(failure);
        this.#remoteTicketJwks = null;
        return verify;
      }),
    );
    return payload;
  });

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

  readonly removeOwnedRemoteHost = Effect.fn("CentralAuth.removeOwnedRemoteHost")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/`,
        { method: "DELETE" },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly setRemoteHostHidden = Effect.fn("CentralAuth.setRemoteHostHidden")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      hidden: boolean,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/hidden`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden }) },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly pendingOwnerTransfer = Effect.fn("CentralAuth.pendingOwnerTransfer")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<OwnerTransfer | null, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/owner-transfer`,
        { method: "GET" },
        decodePendingOwnerTransfer,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly startOwnerTransfer = Effect.fn("CentralAuth.startOwnerTransfer")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      email: string,
    ): Effect.fn.Return<OwnerTransfer, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/owner-transfer`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) },
        decodeOwnerTransfer,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly cancelOwnerTransfer = Effect.fn("CentralAuth.cancelOwnerTransfer")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/owner-transfer`,
        { method: "DELETE" },
        decodeVoid,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly incomingOwnerTransfers = Effect.fn("CentralAuth.incomingOwnerTransfers")(
    function* (
      this: CentralAuthManager,
    ): Effect.fn.Return<OwnerTransfer[], CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        "/v2/remote/owner-transfers/",
        { method: "GET" },
        decodeIncomingOwnerTransfers,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly acceptOwnerTransfer = Effect.fn("CentralAuth.acceptOwnerTransfer")(
    function* (
      this: CentralAuthManager,
      transferId: string,
    ): Effect.fn.Return<AcceptedOwnerTransfer, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/owner-transfers/${encodeURIComponent(transferId)}/accept`,
        { method: "POST" },
        decodeAcceptedOwnerTransfer,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly declineOwnerTransfer = Effect.fn("CentralAuth.declineOwnerTransfer")(
    function* (
      this: CentralAuthManager,
      transferId: string,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `/v2/remote/owner-transfers/${encodeURIComponent(transferId)}/decline`,
        { method: "POST" },
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

  readonly updateRemoteHostAppearance = Effect.fn("CentralAuth.updateRemoteHostAppearance")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      appearance: ServerAppearance | null,
    ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
      yield* this.#authorizedRequestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/appearance`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appearance }),
        },
        (value) => {
          decodeRecord(value, "remote host appearance");
        },
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
      ).pipe(Effect.mapError(inviteEmailFailure));
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly initialize = Effect.fn("CentralAuth.initializeAdmission")(
    function* (this: CentralAuthManager) {
      if (this.#initialization) return yield* Deferred.await(this.#initialization);
      const pending = Deferred.makeUnsafe<CentralAuthState, CentralAuthOperationError>();
      this.#initialization = pending;
      this.#cancelUnavailableRetry();
      return yield* this.#initialize().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            this.#unavailableRetryFailures = 0;
          }),
        ),
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

  #cancelUnavailableRetry(): void {
    if (this.#unavailableRetryTimer) clearTimeout(this.#unavailableRetryTimer);
    this.#unavailableRetryTimer = null;
  }

  #scheduleUnavailableRetry(error?: unknown): void {
    this.#cancelUnavailableRetry();
    if (this.#disposed) return;
    const delays = UNAVAILABLE_RETRY_DELAYS_MS;
    const retryAfterMs =
      error instanceof AuthApiError
        ? Math.min(error.retryAfterSeconds ?? 0, MAX_UNAVAILABLE_RETRY_AFTER_SECONDS) * 1_000
        : 0;
    const delayMs = Math.max(delays[Math.min(this.#unavailableRetryFailures, delays.length - 1)] ?? 0, retryAfterMs);
    this.#unavailableRetryFailures += 1;
    this.#unavailableRetryTimer = setTimeout(
      () => {
        this.#unavailableRetryTimer = null;
        void runCauseEffect(this.#owned(this.#unavailableRetryEffect())).catch((error) =>
          logger.warn("The account service retry failed.", toLogValue(error)),
        );
      },
      Math.round(delayMs * (0.75 + Math.random() * 0.5)),
    );
    this.#unavailableRetryTimer.unref?.();
  }

  #isUnavailable(): boolean {
    return this.#state.status === "error" && this.#state.issue.code === "auth_api_unavailable";
  }

  readonly #unavailableRetryEffect = Effect.fn("CentralAuth.unavailableRetry")(function* (
    this: CentralAuthManager,
  ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
    if (this.#disposed || this.#initialization || !this.#isUnavailable()) return;
    const sessionToken = this.#sessionToken;
    const timeoutMs = this.#options.startupRequestTimeoutMs;
    const request: Effect.Effect<unknown, CentralAuthOperationError, CentralAuthTransport> = sessionToken
      ? this.#requestEffect(
          "/v1/me",
          { method: "GET", headers: { Authorization: `Bearer ${sessionToken}` } },
          decodeCentralAuthUser,
          timeoutMs,
        )
      : this.#requestEffect("/health/live", { method: "GET" }, decodeRecordHealth, timeoutMs);
    const probe = yield* Effect.result(request);
    if (this.#disposed || this.#initialization || !this.#isUnavailable()) return;
    if (Result.isFailure(probe)) {
      const error = probe.failure.cause;
      if (error instanceof NetworkBlockedError || isTransientStartupError(error)) {
        this.#scheduleUnavailableRetry(error);
        return;
      }
    }
    yield* this.initialize();
  });

  readonly #initialize = Effect.fn("CentralAuth.initialize")(function* (
    this: CentralAuthManager,
  ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
    this.#setState({ status: "loading" });
    let keyringChanged = false;
    if (this.#options.canPersist()) {
      let stage: StoredSessionStage = "read";
      const attempt4 = yield* Effect.gen({ self: this }, function* () {
        const encrypted = Buffer.from(yield* authCall(() => readFile(this.#options.storagePath, "utf8")), "base64");
        stage = "decrypt";
        const value = yield* authDecode(() => this.#options.decrypt(encrypted));
        stage = "decode";
        yield* authDecode(() => this.#restoreStoredSession(value));
        this.#storedSessionToken = this.#sessionToken;
      }).pipe(Effect.result);
      if (Result.isFailure(attempt4)) {
        const error = attempt4.failure.cause;
        if (!isMissingFileError(error)) {
          this.#forgetSession();
          const failure = storedSessionFailure(stage, error);
          logger.warn("The stored account session could not be restored.", failure);
          keyringChanged = failure.stage === "decrypt" && this.#options.keyringChanged();
        }
      }
    } else {
      logger.warn("The stored account session was not read: secure storage is unavailable.");
    }
    if (!this.#sessionToken) {
      yield* this.#startupRequestEffect("/health/live", { method: "GET" }, decodeRecordHealth);
      return this.#setState(
        keyringChanged ? { status: "signed_out", reason: "keyring_changed" } : { status: "signed_out" },
      );
    }
    const sessionToken = this.#sessionToken;
    const storedUser = this.#sessionUser?.token === sessionToken ? this.#sessionUser.user : null;
    if (storedUser && !this.#options.confirmSessionAtStart) {
      const state = this.#setState({ status: "signed_in", user: storedUser });
      Effect.runFork(this.#owned(this.#confirmRestoredSession(sessionToken)).pipe(Effect.ignore));
      return state;
    }
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

  readonly #confirmRestoredSession = Effect.fn("CentralAuth.confirmRestoredSession")(function* (
    this: CentralAuthManager,
    sessionToken: string,
  ): Effect.fn.Return<void, never, CentralAuthTransport> {
    const answer = yield* this.#startupRequestEffect(
      "/v1/me",
      { method: "GET" },
      decodeCentralAuthUser,
      sessionToken,
    ).pipe(Effect.result);
    if (this.#disposed || this.#sessionToken !== sessionToken) return;
    if (Result.isFailure(answer)) {
      const error = answer.failure.cause;
      if (error instanceof AuthApiError && error.status === 401) {
        yield* this.#endRevokedSession(sessionToken, true);
        return;
      }
      logger.warn("The account service did not confirm the stored session.", toLogValue(error));
      return;
    }
    if (this.#state.status !== "signed_in") return;
    const user = this.#resolveUserAvatar(answer.success);
    if (JSON.stringify(user) !== JSON.stringify(this.#state.user)) this.#setState({ status: "signed_in", user });
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
      const { issue: _previousIssue, ...challenge } = existingChallenge;
      this.#setState(challenge);
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
            if (error instanceof AuthApiError && error.code === "company_sign_in_required") {
              if (this.#emailCodeRequest === request) this.#emailCodeRequest = null;
              return this.#startCompanySignIn(request.email);
            }
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
      referralCode?: string,
    ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
      const challenge = this.#state.status === "code_sent" ? this.#state : null;
      if (challenge) {
        const { issue: _previousIssue, ...pendingChallenge } = challenge;
        this.#setState(pendingChallenge);
      }
      let sessionApplied = false;
      return yield* Effect.gen({ self: this }, function* () {
        const session = yield* this.#requestEffect(
          "/v1/auth/email/verify",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId, code, ...(referralCode ? { referralCode } : {}) }),
          },
          decodeSessionResponse,
        );
        if (this.#sessionAccountId !== null && this.#sessionAccountId !== session.user.id) {
          this.#teamHostTokens.clear();
        }
        this.#sessionToken = session.sessionToken;
        this.#mobileConnectLink = null;
        sessionApplied = true;
        yield* this.#writeStoredSession();
        return this.#setState({
          status: "signed_in",
          user: this.#resolveUserAvatar(session.user),
        });
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.gen({ self: this }, function* () {
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

  openCompanySignIn(): Effect.Effect<CentralAuthState> {
    return Effect.sync(() =>
      this.#state.status === "company_sign_in" ? this.#startCompanySignIn(this.#state.email) : this.getState(),
    );
  }

  cancelCompanySignIn(): Effect.Effect<CentralAuthState> {
    return Effect.sync(() => {
      this.#endCompanySignIn();
      if (this.#state.status !== "company_sign_in") return this.getState();
      return this.#setState({ status: "signed_out" });
    });
  }

  #endCompanySignIn(): void {
    if (this.#companySignInCancel) Deferred.doneUnsafe(this.#companySignInCancel, Effect.void);
    this.#companySignInCancel = null;
  }

  #endCompanySignInTest(): void {
    if (this.#companySignInTestCancel) Deferred.doneUnsafe(this.#companySignInTestCancel, Effect.void);
    this.#companySignInTestCancel = null;
  }

  #startCompanySignIn(email: string): CentralAuthState {
    this.#endCompanySignIn();
    const browser = this.#options.companySignInBrowser;
    if (!browser) {
      return this.#setState({
        status: "company_sign_in",
        email,
        issue: { code: "company_sign_in_unavailable", message: sourceText("error.auth.companySignInUnavailable") },
      });
    }
    const cancel = Deferred.makeUnsafe<void>();
    this.#companySignInCancel = cancel;
    const state = this.#setState({ status: "company_sign_in", email });
    Effect.runFork(this.#owned(this.#runCompanySignIn(browser, email, cancel)));
    return state;
  }

  readonly #runCompanySignIn = Effect.fn("CentralAuth.runCompanySignIn")(function* (
    this: CentralAuthManager,
    browser: CompanySignInBrowser,
    email: string,
    cancel: Deferred.Deferred<void>,
  ): Effect.fn.Return<void, never, CentralAuthTransport> {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const signedIn = yield* Effect.gen({ self: this }, function* () {
      const params = yield* awaitCompanySignIn(browser, cancel, (returnTo, clientState) =>
        this.#requestEffect(
          "/v1/auth/company/start",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, returnTo, clientState, clientChallenge: challenge }),
          },
          decodeAuthorizationUrl,
        ),
      );
      const code = params.get("code");
      if (!code) return yield* new CompanySignInBrowserError({ code: "company_sign_in_failed" });
      const session = yield* this.#requestEffect(
        "/v1/auth/company/exchange",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, codeVerifier: verifier }),
        },
        decodeSessionResponse,
      );
      if (this.#companySignInCancel !== cancel) {
        yield* this.#requestEffect(
          "/v1/auth/logout",
          { method: "POST", headers: { Authorization: `Bearer ${session.sessionToken}` } },
          decodeVoid,
        ).pipe(Effect.catch(() => Effect.void));
        return;
      }
      this.#companySignInCancel = null;
      yield* this.#applyClaimedSession(session);
    }).pipe(Effect.result);
    if (Result.isSuccess(signedIn) || this.#companySignInCancel !== cancel) return;
    const failure = signedIn.failure;
    if (failure instanceof CompanySignInBrowserError && failure.code === "cancelled") return;
    this.#companySignInCancel = null;
    this.#setState({ status: "company_sign_in", email, issue: companySignInIssue(failure) });
  });

  readonly companySignInSettings = Effect.fn("CentralAuth.companySignInSettings")(
    function* (this: CentralAuthManager, hostId: string) {
      return yield* this.#authorizedRequestEffect(
        companySignInPath(hostId),
        { method: "GET" },
        decodeCompanySignInSettings,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly testCompanySignIn = Effect.fn("CentralAuth.testCompanySignIn")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      input: Omit<TestCompanySignInInput, "serverId">,
    ): Effect.fn.Return<TestCompanySignInResult, CentralAuthOperationError, CentralAuthTransport> {
      const browser = this.#options.companySignInBrowser;
      if (!browser) {
        return yield* new CentralAuthOperationError({
          cause: companySignInError("company_sign_in_unavailable"),
        });
      }
      this.#endCompanySignInTest();
      const cancel = Deferred.makeUnsafe<void>();
      this.#companySignInTestCancel = cancel;
      const params = yield* awaitCompanySignIn(browser, cancel, (returnTo, clientState) =>
        this.#authorizedRequestEffect(
          `${companySignInPath(hostId)}/test`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...input, returnTo, clientState }),
          },
          decodeAuthorizationUrl,
        ),
      ).pipe(
        Effect.catchTag("CompanySignInBrowserError", (error) =>
          Effect.fail(new CentralAuthOperationError({ cause: companySignInError(error.code) })),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#companySignInTestCancel === cancel) this.#companySignInTestCancel = null;
          }),
        ),
      );
      const email = params.get("email");
      if (params.get("status") !== "passed" || !email) {
        return yield* new CentralAuthOperationError({ cause: companySignInError("company_sign_in_failed") });
      }
      return { email };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  cancelCompanySignInTest(): Effect.Effect<void> {
    return Effect.sync(() => this.#endCompanySignInTest());
  }

  readonly setCompanySignInEnabled = Effect.fn("CentralAuth.setCompanySignInEnabled")(
    function* (this: CentralAuthManager, hostId: string, enabled: boolean) {
      yield* this.#authorizedRequestEffect(
        companySignInPath(hostId),
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) },
        decodeVoid,
      );
      return yield* this.#authorizedRequestEffect(
        companySignInPath(hostId),
        { method: "GET" },
        decodeCompanySignInSettings,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly removeCompanySignIn = Effect.fn("CentralAuth.removeCompanySignIn")(
    function* (this: CentralAuthManager, hostId: string) {
      yield* this.#authorizedRequestEffect(companySignInPath(hostId), { method: "DELETE" }, decodeVoid);
      return yield* this.#authorizedRequestEffect(
        companySignInPath(hostId),
        { method: "GET" },
        decodeCompanySignInSettings,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly createCompanySignInScimToken = Effect.fn("CentralAuth.createCompanySignInScimToken")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<CompanySignInScimToken, CentralAuthOperationError, CentralAuthTransport> {
      return yield* this.#authorizedRequestEffect(
        `${companySignInPath(hostId)}/scim-token`,
        { method: "POST" },
        decodeCompanySignInScimToken,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly revokeCompanySignInScimToken = Effect.fn("CentralAuth.revokeCompanySignInScimToken")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<CompanySignInSettings, CentralAuthOperationError, CentralAuthTransport> {
      yield* this.#authorizedRequestEffect(`${companySignInPath(hostId)}/scim-token`, { method: "DELETE" }, decodeVoid);
      return yield* this.#authorizedRequestEffect(
        companySignInPath(hostId),
        { method: "GET" },
        decodeCompanySignInSettings,
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  hasSession(): boolean {
    return this.#sessionToken !== null;
  }

  canPersistSession(): boolean {
    return this.#options.canPersist();
  }

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
      const user = yield* this.#applyClaimedSession(redeemed);
      return { hostId: redeemed.hostId, name: redeemed.name, user };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly redeemServerClaim = Effect.fn("CentralAuth.redeemServerClaim")(
    function* (
      this: CentralAuthManager,
      claim: string,
    ): Effect.fn.Return<CentralAuthIssue | null, never, CentralAuthTransport> {
      return yield* Effect.gen({ self: this }, function* () {
        const session = yield* this.#requestEffect(
          "/v2/server-claims/redeem",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim }) },
          decodeSessionResponse,
        );
        yield* this.#applyClaimedSession(session);
        return null;
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.succeed(centralAuthIssue(error, "server_claim_failed", sourceText("error.auth.serviceError"))),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly requestTransferredOwnerSession = Effect.fn("CentralAuth.requestTransferredOwnerSession")(
    function* (
      this: CentralAuthManager,
      hostId: string,
    ): Effect.fn.Return<
      { sessionToken: string; user: CentralAuthUser } | null,
      CentralAuthOperationError,
      CentralAuthTransport
    > {
      const machineToken = yield* this.#hostMachineToken(hostId);
      const previousSessionToken = this.#sessionToken;
      return yield* this.#requestEffect(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/owner-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, ...(previousSessionToken ? { previousSessionToken } : {}) }),
        },
        decodeSessionResponse,
      ).pipe(
        Effect.catch((error) =>
          error.cause instanceof AuthApiError && error.cause.status === 404 ? Effect.succeed(null) : Effect.fail(error),
        ),
      );
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly applyTransferredOwnerSession = Effect.fn("CentralAuth.applyTransferredOwnerSession")(
    function* (
      this: CentralAuthManager,
      hostId: string,
      session: { sessionToken: string; user: CentralAuthUser },
    ): Effect.fn.Return<CentralAuthUser, CentralAuthOperationError, CentralAuthTransport> {
      const hostKey = hostId.toLowerCase();
      const machineToken = this.#teamHostTokens.get(hostKey);
      const previousHostTokens = new Map(this.#teamHostTokens);
      const previousToken = this.#sessionToken;
      const previousMobileConnectLink = this.#mobileConnectLink;
      this.#teamHostTokens.clear();
      if (machineToken) this.#teamHostTokens.set(hostKey, machineToken);
      this.#sessionToken = session.sessionToken;
      this.#mobileConnectLink = null;
      const stored = yield* this.#writeStoredSession({ required: true }).pipe(Effect.result);
      if (Result.isFailure(stored)) {
        this.#teamHostTokens.clear();
        for (const [key, token] of previousHostTokens) this.#teamHostTokens.set(key, token);
        this.#sessionToken = previousToken;
        this.#mobileConnectLink = previousMobileConnectLink;
        return yield* new CentralAuthOperationError({ cause: stored.failure.cause });
      }
      const user = this.#resolveUserAvatar(session.user);
      this.#setState({ status: "signed_in", user });
      return user;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #applyClaimedSession = Effect.fn("CentralAuth.applyClaimedSession")(function* (
    this: CentralAuthManager,
    session: { sessionToken: string; user: CentralAuthUser },
  ): Effect.fn.Return<CentralAuthUser, CentralAuthOperationError, CentralAuthTransport> {
    if (this.#sessionAccountId !== null && this.#sessionAccountId !== session.user.id) {
      this.#teamHostTokens.clear();
    }
    const previousToken = this.#sessionToken;
    const previousMobileConnectLink = this.#mobileConnectLink;
    this.#sessionToken = session.sessionToken;
    this.#mobileConnectLink = null;
    const stored = yield* this.#writeStoredSession({ required: true }).pipe(Effect.result);
    if (Result.isFailure(stored)) {
      this.#sessionToken = previousToken;
      this.#mobileConnectLink = previousMobileConnectLink;
      return yield* new CentralAuthOperationError({ cause: stored.failure.cause });
    }
    const user = this.#resolveUserAvatar(session.user);
    this.#setState({ status: "signed_in", user });
    return user;
  });

  readonly logout = Effect.fn("CentralAuth.logout")(
    function* (
      this: CentralAuthManager,
    ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
      this.#emailCodeRequest = null;
      this.#endCompanySignIn();
      this.#endCompanySignInTest();
      if (this.#sessionToken) {
        yield* this.#revokeHostCredentials(this.#sessionToken);
        const attempt8 = yield* Effect.gen({ self: this }, function* () {
          yield* this.#authorizedRequestEffect("/v1/auth/logout", { method: "POST" }, decodeVoid);
        }).pipe(Effect.result);
        if (Result.isFailure(attempt8)) {
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

  readonly updateAnalytics = Effect.fn("CentralAuth.updateAnalytics")(
    function* (
      this: CentralAuthManager,
      enabled: boolean,
      ageMs: number,
    ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
      const sessionToken = this.#sessionToken;
      if (!sessionToken)
        return yield* new CentralAuthOperationError({
          cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
        });
      const user = yield* this.#authorizedRequestEffect(
        "/v1/me/analytics",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled, ageMs }),
        },
        decodeCentralAuthUser,
      );
      if (this.#sessionToken !== sessionToken || this.#state.status !== "signed_in") return this.getState();
      return this.#setState({
        status: "signed_in",
        user: { ...this.#state.user, analyticsEnabled: user.analyticsEnabled ?? null },
      });
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly updateChatColor = Effect.fn("CentralAuth.updateChatColor")(
    function* (
      this: CentralAuthManager,
      chatColor: AvatarColor | null,
    ): Effect.fn.Return<CentralAuthState, CentralAuthOperationError, CentralAuthTransport> {
      const sessionToken = this.#sessionToken;
      if (!sessionToken)
        return yield* new CentralAuthOperationError({
          cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
        });
      const user = yield* this.#authorizedRequestEffect(
        "/v1/me/chat-color",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatColor }),
        },
        decodeCentralAuthUser,
      ).pipe(
        Effect.mapError((error) =>
          error.cause instanceof AuthApiError && error.cause.status === 404
            ? new CentralAuthOperationError({
                cause: new AuthApiError(404, "chat_color_unavailable", sourceText("error.auth.chatColorUnavailable")),
              })
            : error,
        ),
      );
      if (this.#sessionToken !== sessionToken || this.#state.status !== "signed_in") return this.getState();
      return this.#setState({
        status: "signed_in",
        user: { ...this.#state.user, chatColor: user.chatColor ?? null },
      });
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly #requestEffect = Effect.fn("CentralAuth.request")(function* <T>(
    this: CentralAuthManager,
    path: string,
    init: RequestInit,
    decoder: (value: unknown, response: Response) => T,
    timeoutMs = 10_000,
  ): Effect.fn.Return<T, CentralAuthOperationError, CentralAuthTransport> {
    const deadline = AbortSignal.timeout(timeoutMs);
    const response = yield* CentralAuthTransport.use((transport) =>
      transport.fetch(new URL(path, this.#options.apiUrl), {
        ...init,
        signal: deadline,
      }),
    );
    if (!response.ok)
      return yield* new CentralAuthOperationError({
        cause: yield* AuthApiError.fromResponseEffect(response),
      });
    const value =
      response.status === 204
        ? undefined
        : yield* authCall(() => response.json()).pipe(
            Effect.mapError((failure) =>
              deadline.aborted ? new CentralAuthOperationError({ cause: deadline.reason }) : failure,
            ),
          );
    return yield* authDecode(() => decoder(value, response));
  });

  readonly #startupRequestEffect = Effect.fn("CentralAuth.startupRequest")(function* <T>(
    this: CentralAuthManager,
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    sessionToken?: string,
  ): Effect.fn.Return<T, CentralAuthOperationError, CentralAuthTransport> {
    let deadline = Date.now() + this.#options.startupRetryWindowMs;
    const excludeBlockedTime = (startedAt: number, expectedMs: number) => {
      deadline += Math.max(0, Date.now() - startedAt - expectedMs);
    };
    let retryIndex = 0;
    let lastFailure: CentralAuthOperationError | null = null;
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0)
        return yield* lastFailure ??
          new CentralAuthOperationError({ cause: new Error(sourceText("error.auth.serviceUnavailable")) });
      const timeoutMs = Math.max(1, Math.min(this.#options.startupRequestTimeoutMs, remainingMs));
      const startedAt = Date.now();
      const result = yield* this.#requestEffect(
        path,
        {
          ...init,
          ...(sessionToken ? { headers: { ...init.headers, Authorization: `Bearer ${sessionToken}` } } : {}),
        },
        decoder,
        timeoutMs,
      ).pipe(Effect.result);
      if (Result.isSuccess(result)) return result.success;
      excludeBlockedTime(startedAt, timeoutMs);
      lastFailure = result.failure;
      const error = result.failure.cause;
      if (!isTransientStartupError(error)) return yield* result.failure;
      const delayMs = Math.min(
        this.#options.startupRetryDelaysMs[Math.min(retryIndex, this.#options.startupRetryDelaysMs.length - 1)] ?? 0,
        Math.max(0, deadline - Date.now()),
      );
      if (delayMs <= 0) return yield* result.failure;
      const sleptAt = Date.now();
      yield* Effect.sleep(delayMs);
      excludeBlockedTime(sleptAt, delayMs);
      retryIndex += 1;
    }
  });

  readonly #authorizedRequestEffect = Effect.fn("CentralAuth.authorizedRequest")(function* <T>(
    this: CentralAuthManager,
    path: string,
    init: RequestInit,
    decoder: (value: unknown, response: Response) => T,
    timeoutMs?: number,
  ): Effect.fn.Return<T, CentralAuthOperationError, CentralAuthTransport> {
    if (!this.#sessionToken)
      return yield* new CentralAuthOperationError({
        cause: new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired")),
      });
    const sessionToken = this.#sessionToken;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${sessionToken}`);
    return yield* this.#requestEffect(path, { ...init, headers }, decoder, timeoutMs).pipe(
      Effect.tapError(({ cause }) =>
        cause instanceof AuthApiError && cause.status === 401 && path !== "/v1/auth/logout"
          ? this.#endRevokedSession(sessionToken, path === "/v1/me")
          : Effect.void,
      ),
    );
  });

  #endRevokedSession(sessionToken: string, confirmed: boolean) {
    return Effect.gen({ self: this }, function* () {
      if (!confirmed) {
        const check = yield* this.#requestEffect(
          "/v1/me",
          { method: "GET", headers: { Authorization: `Bearer ${sessionToken}` } },
          decodeCentralAuthUser,
        ).pipe(Effect.result);
        if (
          Result.isSuccess(check) ||
          !(check.failure.cause instanceof AuthApiError) ||
          check.failure.cause.status !== 401
        )
          return;
      }
      if (this.#sessionToken !== sessionToken) return;
      logger.warn("The account service ended the session. This device is signed out.");
      this.#endCompanySignInTest();
      yield* this.#clearStoredSessionEffect();
      if (this.#state.status === "signed_in") this.#setState({ status: "signed_out" });
    }).pipe(Effect.catch(() => Effect.void));
  }

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
    const sessionToken = this.#sessionToken;
    if (!sessionToken) return;
    if (!this.#options.canPersist()) {
      logger.warn("The account session was not stored: secure storage is unavailable.");
      if (!required) return yield* this.#removeOtherStoredSession(sessionToken);
      yield* authCall(() => rm(this.#options.storagePath, { force: true }));
      this.#storedSessionToken = null;
      return yield* new CentralAuthOperationError({ cause: new Error("The session could not be stored.") });
    }
    const temporaryPath = `${this.#options.storagePath}.${randomUUID()}.tmp`;
    let stage: StoredSessionStage = "encrypt";
    yield* Effect.gen({ self: this }, function* () {
      const user = this.#sessionUser?.token === sessionToken ? this.#sessionUser.user : null;
      const value = JSON.stringify({
        version: 2,
        sessionToken,
        teamHostTokens: Object.fromEntries(this.#teamHostTokens),
        ...(this.#mobileConnectLink ? { mobileConnectLink: this.#mobileConnectLink } : {}),
        ...(user ? { user } : {}),
      });
      const encrypted = yield* authDecode(() => this.#options.encrypt(value).toString("base64"));
      stage = "write";
      yield* authCall(() => mkdir(dirname(this.#options.storagePath), { recursive: true }));
      yield* authCall(() => writeFile(temporaryPath, encrypted, { mode: 0o600 }));
      yield* authCall(() => chmod(temporaryPath, 0o600));
      yield* authCall(() => rename(temporaryPath, this.#options.storagePath));
      this.#storedSessionToken = sessionToken;
      this.#storedUserJson = user ? JSON.stringify(user) : null;
    }).pipe(
      Effect.catch((failure) => {
        logger.warn("The account session was not stored.", storedSessionFailure(stage, failure.cause));
        return required ? Effect.fail(failure) : this.#removeOtherStoredSession(sessionToken);
      }),
      Effect.ensuring(authCall(() => rm(temporaryPath, { force: true })).pipe(Effect.catch(() => Effect.void))),
    );
  });

  readonly #clearStoredSessionEffect = Effect.fn("CentralAuth.clearStoredSession")(function* (
    this: CentralAuthManager,
  ): Effect.fn.Return<void, CentralAuthOperationError, CentralAuthTransport> {
    this.#forgetSession();
    yield* this.#sessionWrites
      .withPermit(authCall(() => rm(this.#options.storagePath, { force: true })))
      .pipe(Effect.uninterruptible);
    this.#storedSessionToken = null;
    this.#storedUserJson = null;
  });

  #removeOtherStoredSession(sessionToken: string) {
    return Effect.gen({ self: this }, function* () {
      if (this.#storedSessionToken === sessionToken) return;
      yield* authCall(() => rm(this.#options.storagePath, { force: true }));
      this.#storedSessionToken = null;
    });
  }

  #revokeHostCredentials(sessionToken: string) {
    return Effect.forEach(
      [...this.#teamHostTokens],
      ([hostId, machineToken]) =>
        this.#requestEffect(
          `/v2/remote/hosts/${encodeURIComponent(hostId)}/revoke-credential`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ machineToken }),
          },
          decodeVoid,
          HOST_CREDENTIAL_REVOKE_TIMEOUT_MS,
        ).pipe(Effect.ignore),
      { concurrency: "unbounded", discard: true },
    );
  }

  #forgetSession(): void {
    this.#sessionToken = null;
    this.#sessionUser = null;
    this.#sessionAccountId = null;
    this.#teamHostTokens.clear();
    this.#mobileConnectLink = null;
  }

  #restoreStoredSession(value: string): void {
    this.#sessionUser = null;
    this.#storedUserJson = null;
    if (!value.trimStart().startsWith("{")) {
      this.#sessionToken = value;
      this.#teamHostTokens.clear();
      this.#mobileConnectLink = null;
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
    this.#mobileConnectLink = restoreMobileConnectLink(stored.mobileConnectLink);
    try {
      const user = decodeCentralAuthUser(stored.user);
      this.#sessionUser = { token: stored.sessionToken, user };
      this.#storedUserJson = JSON.stringify(user);
    } catch {
      this.#sessionUser = null;
    }
  }

  #setState(state: CentralAuthState): CentralAuthState {
    if (state.status === "signed_in") {
      this.#sessionAccountId = state.user.id;
      const sessionToken = this.#sessionToken;
      if (sessionToken) {
        this.#sessionUser = { token: sessionToken, user: state.user };
        if (JSON.stringify(state.user) !== this.#storedUserJson && !this.#disposed && this.#options.canPersist()) {
          Effect.runFork(this.#owned(this.#writeStoredSession()).pipe(Effect.ignore));
        }
      }
    }
    this.#state = state;
    const copy = this.getState();
    this.emit("changed", copy);
    return copy;
  }

  #setInitializationError(error: unknown): CentralAuthState {
    if (error instanceof NetworkBlockedError) {
      this.#scheduleUnavailableRetry();
      return this.#setState({ status: "error", issue: { code: "auth_api_unavailable", message: error.message } });
    }
    if (error instanceof AuthApiError && error.status < 500) {
      return this.#setState({ status: "error", issue: authApiIssue(error) });
    }
    const unavailable = serviceUnavailableText(error);
    this.#scheduleUnavailableRetry(error);
    return this.#setState({
      status: "error",
      issue: {
        code: "auth_api_unavailable",
        message: unavailable.message,
        ...(unavailable.reference === null ? {} : { reference: unavailable.reference }),
        ...(error instanceof AuthApiError && error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    });
  }
}

const HTTP_DATE_RESOLUTION_MS = 1_000;

function serverClockOffsetMs(dateHeader: string | null, requestedAt: number, receivedAt: number): number {
  const serverSecondStart = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  if (!Number.isFinite(serverSecondStart)) return 0;
  if (serverSecondStart > receivedAt) return serverSecondStart - receivedAt;
  const serverSecondEnd = serverSecondStart + HTTP_DATE_RESOLUTION_MS;
  if (serverSecondEnd < requestedAt) return serverSecondEnd - requestedAt;
  return 0;
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

export function isHostNotOnAccount(error: unknown): boolean {
  return error instanceof AuthApiError && (error.status === 403 || error.status === 404);
}

export function authApiRateLimit(error: unknown): { code: string; retryAfterSeconds: number | null } | null {
  if (!(error instanceof AuthApiError) || error.status !== 429) return null;
  return { code: error.code, retryAfterSeconds: error.retryAfterSeconds ?? null };
}

export function authApiErrorCode(error: unknown): string | null {
  return error instanceof AuthApiError ? error.code : null;
}

export function isFinalClientError(error: unknown): boolean {
  return (
    error instanceof AuthApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

class AuthApiError extends Schema.TaggedError<AuthApiError>()("AuthApiError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
  retryAfterSeconds: Schema.optional(Schema.Number),
  reference: Schema.NullOr(Schema.String),
}) {
  constructor(status: number, code: string, message: string, retryAfterSeconds?: number, reference?: string | null) {
    super({ status, code, message, retryAfterSeconds, reference: reference ?? null });
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
      return new AuthApiError(
        response.status,
        value.error.code,
        value.error.message,
        retryAfterSeconds,
        safeReference(value.error.reference),
      );
    }
    return new AuthApiError(
      response.status,
      "auth_api_error",
      sourceText("error.auth.serviceError"),
      retryAfterSeconds,
    );
  });
}

class NetworkBlockedError extends Error {}

const INTERCEPTED_TLS_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_CERT_AUTHORITY_INVALID",
  "ERR_CERT_COMMON_NAME_INVALID",
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
  if (error instanceof AuthApiError) return authApiIssue(error);
  return { code: fallbackCode, message: errorMessage(error, fallbackMessage) };
}

function authApiIssue(error: AuthApiError): CentralAuthIssue {
  const reference = error.reference ?? referenceFrom("auth", "http", error.status, error.code);
  return {
    code: error.code,
    message: error.message,
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
    ...(reference === null ? {} : { reference }),
  };
}

function serviceUnavailableText(error: unknown): { message: string; reference: string | null } {
  if (error instanceof AuthApiError) {
    return {
      message: sourceText("error.auth.serviceStatus", { status: error.status }),
      reference: error.reference ?? referenceFrom("auth", "http", error.status, error.code),
    };
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { message: sourceText("error.auth.serviceTimeout"), reference: "auth/timeout" };
  }
  if (error instanceof TypeError) {
    const cause = error.cause;
    const errno =
      isDynamicRecord(cause) && isString(cause.code) && /^E[A-Z0-9_]+$/u.test(cause.code) ? cause.code : null;
    return { message: sourceText("error.auth.serviceUnreachable"), reference: referenceFrom("auth", "network", errno) };
  }
  return { message: sourceText("error.auth.serviceUnavailable"), reference: "auth/unavailable" };
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

function companySignInPath(hostId: string): string {
  return `/v2/remote/hosts/${encodeURIComponent(hostId)}/company-sign-in`;
}

function decodeAuthorizationUrl(value: unknown): string {
  const url = new URL(requiredString(decodeRecord(value, "company sign-in page"), "authorizationUrl"));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid company sign-in page.");
  return url.toString();
}

function companySignInError(code: string): AuthApiError {
  return new AuthApiError(400, code, sourceText(companySignInErrorKey(code)));
}

function companySignInIssue(failure: CentralAuthOperationError | CompanySignInBrowserError): CentralAuthIssue {
  if (failure instanceof CompanySignInBrowserError) return authApiIssue(companySignInError(failure.code));
  return centralAuthIssue(failure.cause, "company_sign_in_failed", sourceText("error.auth.companySignInFailed"));
}

function isDefinitiveEmailCodeRequestFailure(error: unknown): boolean {
  if (!(error instanceof AuthApiError)) return false;
  return DEFINITIVE_EMAIL_CODE_REQUEST_FAILURES.has(error.code);
}

function inviteEmailFailure(error: CentralAuthOperationError): CentralAuthOperationError {
  const cause = error.cause;
  if (!(cause instanceof AuthApiError) || cause.code !== "email_delivery_rate_limited") return error;
  return new CentralAuthOperationError({
    cause: new AuthApiError(
      cause.status,
      cause.code,
      inviteEmailRateLimitedText(cause.retryAfterSeconds),
      cause.retryAfterSeconds,
      cause.reference,
    ),
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isTransientStartupError(error: unknown): boolean {
  if (error instanceof NetworkBlockedError) return false;
  return !(error instanceof AuthApiError) || error.status >= 500;
}

function restoreMobileConnectLink(value: unknown): StoredMobileConnectLink | null {
  if (!isDynamicRecord(value)) return null;
  const { host, token, createdAt } = value;
  if (!isMobileConnectHostBinding(host) || !isString(token) || !MOBILE_CONNECT_LINK_TOKEN.test(token)) return null;
  if (!isNumber(createdAt) || !Number.isFinite(createdAt)) return null;
  return { host: { hostId: host.hostId, fingerprint: host.fingerprint }, token, createdAt };
}

export interface GitHubRouteTicketRepository extends GitHubRouteRepository {
  fullName: string;
  events: boolean;
}

export interface GitHubRouteTicket {
  ticket: string;
  repositories: GitHubRouteTicketRepository[];
}

function decodeGitHubRouteTicket(value: unknown): GitHubRouteTicket {
  const record = decodeRecord(value, "GitHub route");
  const repositories = record.repositories;
  if (!Array.isArray(repositories)) throw new Error("The GitHub route has no repository list.");
  return {
    ticket: requiredString(record, "ticket"),
    repositories: repositories.map((repository) => {
      if (
        !isDynamicRecord(repository) ||
        !isNumber(repository.id) ||
        !isNumber(repository.installationId) ||
        !isString(repository.fullName) ||
        !GITHUB_REPOSITORY_NAME_PATTERN.test(repository.fullName) ||
        !isBoolean(repository.events)
      )
        throw new Error("The GitHub route has an invalid repository.");
      return {
        id: repository.id,
        installationId: repository.installationId,
        fullName: repository.fullName,
        events: repository.events,
      };
    }),
  };
}
