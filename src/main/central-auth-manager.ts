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
import { createLocalJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { isMissingFileError } from "../backend/file-errors";
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
  promise: Promise<CentralAuthState> | null;
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
  #state: CentralAuthState = { status: "loading" };
  #sessionToken: string | null = null;
  readonly #teamHostTokens = new Map<string, string>();
  #sessionWriteChain: Promise<void> = Promise.resolve();
  /** The account the stored host credentials were issued to, or none while signed out. */
  #sessionAccountId: string | null = null;
  #remoteTicketJwks: Promise<z.infer<typeof remoteTicketJwksSchema>> | null = null;
  #initializationPromise: Promise<CentralAuthState> | null = null;
  #emailCodeRequest: EmailCodeRequest | null = null;
  #profileRefreshPromise: Promise<CentralAuthState> | null = null;
  #profileRefreshGeneration = 0;

  constructor(options: CentralAuthManagerOptions) {
    super();
    this.#options = {
      ...options,
      mobileConnectApiUrl: options.mobileConnectApiUrl ?? options.apiUrl,
      canPersist: options.canPersist ?? (() => true),
      fetch: options.fetch ?? fetch,
      startupRetryWindowMs: options.startupRetryWindowMs ?? STARTUP_RETRY_WINDOW_MS,
      startupRequestTimeoutMs: options.startupRequestTimeoutMs ?? STARTUP_REQUEST_TIMEOUT_MS,
      startupRetryDelaysMs: options.startupRetryDelaysMs ?? STARTUP_RETRY_DELAYS_MS,
      emailCodeRequestTimeoutMs: options.emailCodeRequestTimeoutMs ?? EMAIL_CODE_REQUEST_TIMEOUT_MS,
    };
  }

  getState(): CentralAuthState {
    return structuredClone(this.#state);
  }

  stopProfileRefresh(): void {
    this.#profileRefreshGeneration += 1;
  }

  refreshProfile(): Promise<CentralAuthState> {
    if (this.#profileRefreshPromise) return this.#profileRefreshPromise;
    const state = this.#state;
    const token = this.#sessionToken;
    const generation = this.#profileRefreshGeneration;
    if (state.status !== "signed_in" || !token) return Promise.resolve(this.getState());
    const pending = this.#authorizedRequest("/v1/me", { method: "GET" }, decodeCentralAuthUser)
      .then((user) => {
        if (this.#state !== state || this.#sessionToken !== token || generation !== this.#profileRefreshGeneration) {
          return this.getState();
        }
        if (user.id !== state.user.id) throw new Error("The account service returned an invalid user.");
        const resolved = this.#resolveUserAvatar(user);
        if (
          resolved.name === state.user.name &&
          resolved.email === state.user.email &&
          resolved.avatarUrl === state.user.avatarUrl
        ) {
          return this.getState();
        }
        return this.#setState({ status: "signed_in", user: resolved });
      })
      // Background refresh must not replace a usable profile with a loading/error screen.
      .catch(() => this.getState())
      .finally(() => {
        this.#profileRefreshPromise = null;
      });
    this.#profileRefreshPromise = pending;
    return pending;
  }

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
  ): Promise<T> {
    return this.#authorizedRequest(path, init, decoder, timeoutMs);
  }

  async downloadAuthorized(path: string, timeoutMs = 30_000): Promise<Uint8Array> {
    if (!this.#sessionToken) throw new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired"));
    const response = await this.#options.fetch(new URL(path, this.#options.apiUrl), {
      headers: { Authorization: `Bearer ${this.#sessionToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw await AuthApiError.fromResponse(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async createTeamAuthTicket(serverId: string): Promise<string> {
    const result = await this.#authorizedRequest(
      "/v1/team-auth/ticket",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId }),
      },
      decodeTicketResponse,
    );
    if (!result.ticket || !Number.isFinite(result.expiresAt)) {
      throw new Error("The account service returned an invalid team ticket.");
    }
    return result.ticket;
  }

  async createMobileConnect(host: MobileConnectHostBinding): Promise<MobileConnectTicket> {
    const result = await this.#authorizedRequest(
      "/v1/mobile-auth/ticket",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host }),
      },
      decodeTicketResponse,
    );
    if (!result.ticket || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) {
      throw new Error("The account service returned an invalid Mobile Connect ticket.");
    }
    return {
      qrData: createMobileConnectUrl({ apiUrl: this.#options.mobileConnectApiUrl, ticket: result.ticket, host }),
      expiresAt: result.expiresAt,
    };
  }

  async listMobileConnectedDevices(): Promise<MobileConnectedDevice[]> {
    const result = await this.#authorizedRequest(
      "/v1/mobile-auth/devices",
      { method: "GET" },
      decodeMobileConnectedDevices,
    );
    return result.devices;
  }

  async listAccountSessions() {
    const result = await this.#authorizedRequest(
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
  }

  async revokeAccountSession(sessionId: string): Promise<void> {
    await this.#authorizedRequest(
      `/v1/mobile-auth/devices/${encodeURIComponent(sessionId)}?includeDesktop=true`,
      { method: "DELETE" },
      () => undefined,
    );
  }

  async revokeMobileConnectedDevice(sessionId: string): Promise<void> {
    await this.#authorizedRequest(
      `/v1/mobile-auth/devices/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
      () => undefined,
    );
  }

  async registerRemoteHost(input: {
    hostId: string;
    name: string;
    ownerMembershipId: string;
    devicePublicKey?: string | null;
  }): Promise<RegisteredRemoteHost> {
    const sessionToken = this.#sessionToken;
    const storedMachineToken = this.#teamHostTokens.get(input.hostId.toLowerCase());
    const result = await this.#authorizedRequest(
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
      throw new Error(sourceText("error.auth.accountChangedDuringRegister"));
    }
    if (result.machineToken) this.#teamHostTokens.set(input.hostId.toLowerCase(), result.machineToken);
    await this.#writeStoredSession();
    return result;
  }

  issueRemoteHostTicket(hostId: string): Promise<RemoteConnectionBootstrap> {
    const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
    if (!machineToken) throw new Error(sourceText("error.auth.hostCredentialUnavailable"));
    return this.#request(
      `/v2/remote/hosts/${encodeURIComponent(hostId)}/ticket`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineToken }) },
      decodeRemoteSessionTicket,
    );
  }

  /**
   * Sends one Live Activity update through the account service to Apple. The host sealed the
   * content with keys that only the phone has, so the service forwards bytes it cannot read.
   * Returns `gone` when Apple refused the token.
   */
  async sendLiveActivityPush(hostId: string, push: LiveActivityRelayPush): Promise<"sent" | "gone"> {
    const machineToken = this.#teamHostTokens.get(hostId.toLowerCase());
    if (!machineToken) throw new Error(sourceText("error.auth.hostCredentialUnavailable"));
    try {
      await this.#request(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/live-activity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, ...push }),
        },
        () => undefined,
      );
      return "sent";
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 410) return "gone";
      throw error;
    }
  }

  async startRemoteSession(hostId: string): Promise<RemoteSession> {
    return this.#authorizedRequest(
      "/v2/remote/sessions/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostId }) },
      decodeRemoteSession,
    );
  }

  listRemoteHosts(): Promise<RemoteHostSummary[]> {
    return this.#authorizedRequest("/v2/remote/hosts/", { method: "GET" }, decodeRemoteHosts);
  }

  issueRemoteSessionTicket(sessionId: string, clientPublicKey: string): Promise<RemoteConnectionBootstrap> {
    return this.#authorizedRequest(
      `/v2/remote/sessions/${encodeURIComponent(sessionId)}/ticket`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientPublicKey }),
      },
      decodeRemoteSessionTicket,
    );
  }

  async verifyRemoteSessionTicket(ticket: string): Promise<VerifiedRemoteSessionTicket> {
    const verify = async () => {
      if (!this.#remoteTicketJwks) this.#remoteTicketJwks = this.#fetchRemoteTicketJwks();
      const jwks = await this.#remoteTicketJwks;
      return jwtVerify(ticket, createLocalJWKSet(jwks), {
        audience: REMOTE_TICKET_AUDIENCE,
        algorithms: ["ES256"],
      });
    };
    let payload: Awaited<ReturnType<typeof verify>>["payload"];
    try {
      ({ payload } = await verify());
    } catch (error) {
      if (!isDynamicRecord(error) || error.code !== "ERR_JWKS_NO_MATCHING_KEY") throw error;
      this.#remoteTicketJwks = null;
      ({ payload } = await verify());
    }
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
      throw new Error("The remote session ticket has invalid claims.");
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
  }

  async #fetchRemoteTicketJwks(): Promise<z.infer<typeof remoteTicketJwksSchema>> {
    const response = await this.#options.fetch(new URL("/.well-known/jwks.json", this.#options.apiUrl), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw await AuthApiError.fromResponse(response);
    return remoteTicketJwksSchema.parse(await response.json());
  }

  endRemoteSession(sessionId: string): Promise<void> {
    return this.#authorizedRequest(
      `/v2/remote/sessions/${encodeURIComponent(sessionId)}/end`,
      { method: "POST" },
      decodeVoid,
    );
  }

  createRemoteInvite(
    hostId: string,
    input: { role: "admin" | "member"; email?: string; permanent?: boolean },
  ): Promise<{ inviteId: string; token: string; expiresAt: number; permanent: boolean; useCount: number }> {
    return this.#authorizedRequest(
      `/v2/remote/hosts/${encodeURIComponent(hostId)}/invites`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
      decodeCreatedRemoteInvite,
    );
  }

  listRemoteInvites(hostId: string): Promise<RemoteInviteRecord[]> {
    return this.#authorizedRequest(
      `/v2/remote/hosts/${encodeURIComponent(hostId)}/invites`,
      { method: "GET" },
      decodeRemoteInvites,
    );
  }

  previewRemoteInvite(token: string): Promise<RemoteInvitePreview> {
    return this.#request(
      "/v2/remote/invites/preview",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) },
      decodeRemoteInvitePreview,
    );
  }

  acceptRemoteInvite(token: string): Promise<{ hostId: string; membershipId: string; role: "admin" | "member" }> {
    return this.#authorizedRequest(
      "/v2/remote/invites/accept",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) },
      decodeAcceptedRemoteInvite,
    );
  }

  revokeRemoteInvite(inviteId: string): Promise<void> {
    return this.#authorizedRequest(
      `/v2/remote/invites/${encodeURIComponent(inviteId)}`,
      { method: "DELETE" },
      decodeVoid,
    );
  }

  async listRemoteMembers(hostId: string): Promise<RemoteMemberRecord[]> {
    const members = await this.#authorizedRequest(
      `/v2/remote/hosts/${encodeURIComponent(hostId)}/members/`,
      { method: "GET" },
      decodeRemoteMembers,
    );
    return members.map((member) => ({
      ...member,
      avatarUrl: member.avatarUrl ? this.resolveApiUrl(member.avatarUrl) : null,
    }));
  }

  updateRemoteMember(
    hostId: string,
    membershipId: string,
    role: "admin" | "member",
    reactivate = false,
  ): Promise<void> {
    return this.#authorizedRequest(
      `/v2/remote/hosts/${encodeURIComponent(hostId)}/members/${encodeURIComponent(membershipId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, ...(reactivate ? { reactivate: true } : {}) }),
      },
      decodeVoid,
    );
  }

  removeRemoteMember(hostId: string, membershipId: string): Promise<void> {
    return this.#authorizedRequest(
      `/v2/remote/hosts/${encodeURIComponent(hostId)}/members/${encodeURIComponent(membershipId)}`,
      { method: "DELETE" },
      decodeVoid,
    );
  }

  async updateRemoteHostLogo(
    hostId: string,
    image: AvatarImageInput | null,
    version?: string | null,
  ): Promise<string | null> {
    if (image === null) {
      await this.#authorizedRequest(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/logo`,
        { method: "DELETE" },
        decodeVoid,
      );
      return null;
    }
    return this.#authorizedRequest(
      `/v2/remote/hosts/${encodeURIComponent(hostId)}/logo`,
      {
        method: "PUT",
        headers: { "Content-Type": image.mimeType, ...(version ? { "OpenBot-Logo-Version": version } : {}) },
        body: Buffer.from(image.bytes),
      },
      (value) => requiredString(decodeRecord(value, "remote host logo"), "logoKey"),
    );
  }

  async downloadRemoteHostLogo(hostId: string, version: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    if (!this.#sessionToken) throw new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired"));
    const url = new URL(`/v2/remote/hosts/${encodeURIComponent(hostId)}/logo`, this.#options.apiUrl);
    url.searchParams.set("v", version);
    const response = await this.#options.fetch(url, {
      headers: { Authorization: `Bearer ${this.#sessionToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await AuthApiError.fromResponse(response);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "application/octet-stream",
    };
  }

  async redeemTeamAuthTicket(ticket: string, serverId: string): Promise<CentralAuthUser | null> {
    if (!ticket) return null;
    try {
      const user = await this.#request(
        "/v1/team-auth/redeem",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket, serverId }),
        },
        decodeCentralAuthUser,
      );
      return this.#resolveUserAvatar(user);
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) return null;
      throw error;
    }
  }

  sendTeamInviteEmail(input: {
    email: string;
    serverName: string;
    inviteUrl: string;
    role: "admin" | "member";
  }): Promise<void> {
    return this.#authorizedRequest(
      "/v1/team-invitations/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      decodeVoid,
    );
  }

  initialize(): Promise<CentralAuthState> {
    if (this.#initializationPromise) return this.#initializationPromise;
    const pending = this.#initialize().catch((error) => this.#setInitializationError(error));
    this.#initializationPromise = pending;
    void pending.then(() => {
      if (this.#initializationPromise === pending) this.#initializationPromise = null;
    });
    return pending;
  }

  retry(): Promise<CentralAuthState> {
    return this.initialize();
  }

  async #initialize(): Promise<CentralAuthState> {
    this.#setState({ status: "loading" });
    if (this.#options.canPersist()) {
      try {
        const encrypted = Buffer.from(await readFile(this.#options.storagePath, "utf8"), "base64");
        this.#restoreStoredSession(this.#options.decrypt(encrypted));
      } catch (error) {
        if (!isMissingFileError(error)) {
          await this.#clearStoredSession();
        }
      }
    } else {
      await rm(this.#options.storagePath, { force: true });
    }
    if (!this.#sessionToken) {
      await this.#startupRequest("/health/live", { method: "GET" }, decodeRecordHealth);
      return this.#setState({ status: "signed_out" });
    }
    try {
      const user = await this.#startupRequest("/v1/me", { method: "GET" }, decodeCentralAuthUser, this.#sessionToken);
      return this.#setState({ status: "signed_in", user: this.#resolveUserAvatar(user) });
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        await this.#clearStoredSession();
        return this.#setState({ status: "signed_out" });
      }
      throw error;
    }
  }

  requestEmailCode(email: string): Promise<CentralAuthState> {
    const normalizedEmail = email.trim().toLowerCase();
    const existingRequest = this.#emailCodeRequest;
    if (existingRequest?.email === normalizedEmail && existingRequest.promise) return existingRequest.promise;

    const request: EmailCodeRequest =
      existingRequest?.email === normalizedEmail
        ? existingRequest
        : { email: normalizedEmail, idempotencyKey: randomUUID(), promise: null };
    this.#emailCodeRequest = request;
    const pending = this.#performEmailCodeRequest(request);
    request.promise = pending;
    return pending;
  }

  async #performEmailCodeRequest(request: EmailCodeRequest): Promise<CentralAuthState> {
    const existingChallenge = this.#state.status === "code_sent" ? this.#state : null;
    if (existingChallenge) {
      this.#setState({ ...existingChallenge, issue: undefined });
    } else {
      this.#setState({ status: "signing_in" });
    }
    try {
      const result = await this.#request(
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
        throw new Error("The account service returned an invalid sign-in challenge.");
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
    } catch (error) {
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
    } finally {
      if (this.#emailCodeRequest === request) request.promise = null;
    }
  }

  async verifyEmailCode(challengeId: string, code: string): Promise<CentralAuthState> {
    const challenge = this.#state.status === "code_sent" ? this.#state : null;
    if (challenge) this.#setState({ ...challenge, issue: undefined });
    let sessionApplied = false;
    try {
      const session = await this.#request(
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
      await this.#writeStoredSession();
      return this.#setState({
        status: "signed_in",
        user: this.#resolveUserAvatar(session.user),
      });
    } catch (error) {
      // A wrong code or a failed request for a challenge leaves the stored session as it was: the
      // user can still be signed in to another account, or have a session that only a startup
      // check failed on.
      if (sessionApplied || !challenge) await this.#clearStoredSession();
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
    }
  }

  /** False when the session can live only in memory, so it would be lost at the next start. */
  canPersistSession(): boolean {
    return this.#options.canPersist();
  }

  /**
   * Signs a new hosted server in with the claim that the account server put in its VM.
   * The result names the host ID that the account server reserved for this account.
   */
  async redeemHostedServerClaim(claim: string): Promise<{ hostId: string; name: string; user: CentralAuthUser }> {
    const redeemed = await this.#request(
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
    try {
      await this.#writeStoredSession({ required: true });
    } catch (error) {
      this.#sessionToken = previousToken;
      throw error;
    }
    const user = this.#resolveUserAvatar(redeemed.user);
    this.#setState({ status: "signed_in", user });
    return { hostId: redeemed.hostId, name: redeemed.name, user };
  }

  async logout(): Promise<CentralAuthState> {
    this.#emailCodeRequest = null;
    if (this.#sessionToken) {
      try {
        await this.#authorizedRequest("/v1/auth/logout", { method: "POST" }, decodeVoid);
      } catch {
        // Local logout must still remove the session from this device.
      }
    }
    await this.#clearStoredSession();
    return this.#setState({ status: "signed_out" });
  }

  async updateAvatar(image: AvatarImageInput | null): Promise<CentralAuthState> {
    const sessionToken = this.#sessionToken;
    if (!sessionToken) throw new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired"));
    const user = image
      ? await this.#authorizedRequest(
          "/v1/me/avatar",
          {
            method: "PUT",
            headers: { "Content-Type": image.mimeType },
            body: Buffer.from(image.bytes),
          },
          decodeCentralAuthUser,
        )
      : await this.#authorizedRequest(
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
  }

  async updateName(name: string): Promise<CentralAuthState> {
    const sessionToken = this.#sessionToken;
    if (!sessionToken) throw new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired"));
    const user = await this.#authorizedRequest(
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
  }

  async #request<T>(path: string, init: RequestInit, decoder: (value: unknown) => T, timeoutMs = 10_000): Promise<T> {
    const response = await this.#options.fetch(new URL(path, this.#options.apiUrl), {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw await AuthApiError.fromResponse(response);
    return decoder(response.status === 204 ? undefined : await response.json());
  }

  async #startupRequest<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    sessionToken?: string,
  ): Promise<T> {
    const deadline = Date.now() + this.#options.startupRetryWindowMs;
    let retryIndex = 0;
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error(sourceText("error.auth.serviceUnavailable"));
      try {
        return await this.#request(
          path,
          {
            ...init,
            headers: sessionToken ? { ...init.headers, Authorization: `Bearer ${sessionToken}` } : init.headers,
          },
          decoder,
          Math.max(1, Math.min(this.#options.startupRequestTimeoutMs, remainingMs)),
        );
      } catch (error) {
        if (!isTransientStartupError(error)) throw error;
        const delayMs = Math.min(
          this.#options.startupRetryDelaysMs[Math.min(retryIndex, this.#options.startupRetryDelaysMs.length - 1)] ?? 0,
          Math.max(0, deadline - Date.now()),
        );
        if (delayMs <= 0) throw error;
        await delay(delayMs);
        retryIndex += 1;
      }
    }
  }

  #authorizedRequest<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs?: number,
  ): Promise<T> {
    if (!this.#sessionToken) throw new AuthApiError(401, "unauthorized", sourceText("error.auth.signInRequired"));
    return this.#request(
      path,
      {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.#sessionToken}` },
      },
      decoder,
      timeoutMs,
    );
  }

  #resolveUserAvatar(user: CentralAuthUser): CentralAuthUser {
    return {
      ...user,
      avatarUrl: user.avatarUrl ? new URL(user.avatarUrl, this.#options.apiUrl).toString() : null,
    };
  }

  #writeStoredSession(options: { required?: boolean } = {}): Promise<void> {
    // Serialized: two writes racing inside their filesystem awaits would let the earlier
    // one rename its snapshot over the later one, restoring a session the user has left.
    this.#sessionWriteChain = this.#sessionWriteChain.then(
      () => this.#writeStoredSessionNow(options.required === true),
      () => this.#writeStoredSessionNow(options.required === true),
    );
    return this.#sessionWriteChain;
  }

  async #writeStoredSessionNow(required: boolean): Promise<void> {
    if (!this.#sessionToken) return;
    if (!this.#options.canPersist()) {
      await rm(this.#options.storagePath, { force: true });
      if (required) throw new Error("The session could not be stored.");
      return;
    }
    const temporaryPath = `${this.#options.storagePath}.${randomUUID()}.tmp`;
    try {
      const value = JSON.stringify({
        version: 2,
        sessionToken: this.#sessionToken,
        teamHostTokens: Object.fromEntries(this.#teamHostTokens),
      });
      const encrypted = this.#options.encrypt(value).toString("base64");
      await mkdir(dirname(this.#options.storagePath), { recursive: true });
      await writeFile(temporaryPath, encrypted, { mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.#options.storagePath);
    } catch (error) {
      await Promise.allSettled([rm(this.#options.storagePath, { force: true }), rm(temporaryPath, { force: true })]);
      if (required) throw error;
    } finally {
      await Promise.allSettled([rm(temporaryPath, { force: true })]);
    }
  }

  async #clearStoredSession(): Promise<void> {
    this.#sessionToken = null;
    this.#sessionAccountId = null;
    this.#teamHostTokens.clear();
    // Through the same chain as the writes, so a write already in flight cannot put the
    // file back after it is removed.
    this.#sessionWriteChain = this.#sessionWriteChain.then(
      () => rm(this.#options.storagePath, { force: true }),
      () => rm(this.#options.storagePath, { force: true }),
    );
    await this.#sessionWriteChain;
  }

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

class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }

  static async fromResponse(response: Response): Promise<AuthApiError> {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("Retry-After"));
    try {
      const value = await response.json();
      if (!isDynamicRecord(value) || !isDynamicRecord(value.error)) {
        throw new Error("Invalid error response.");
      }
      if (isString(value.error.code) && isString(value.error.message)) {
        return new AuthApiError(response.status, value.error.code, value.error.message, retryAfterSeconds);
      }
    } catch {
      // Use a generic error when the server did not return the API error shape.
    }
    return new AuthApiError(
      response.status,
      "auth_api_error",
      sourceText("error.auth.serviceError"),
      retryAfterSeconds,
    );
  }
}

function centralAuthIssue(error: unknown, fallbackCode: string, fallbackMessage: string): CentralAuthIssue {
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
  if (error instanceof AuthApiError) {
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

function isTransientStartupError(error: unknown): boolean {
  return !(error instanceof AuthApiError) || error.status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
