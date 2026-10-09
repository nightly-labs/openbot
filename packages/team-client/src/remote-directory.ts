import { sha256 } from "@noble/hashes/sha2.js";
import {
  createInviteUrl,
  type InviteLinkOptions,
  inviteUseCount,
  isPermanentInvite,
  OPENBOT_CONTROL_PLANE_ORIGIN,
  OPENBOT_INVITE_ORIGIN,
  parseInviteUrl,
  selfHostedApiOrigin,
} from "@openbot/contracts/invite-links";
import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { decodeRemoteSession, decodeRemoteSessionTicket } from "@openbot/contracts/remote-control-plane";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import { bytesToBase64Url } from "./base64";
import { runTeamEffect } from "./effect-boundary";
import type { TeamClientFetch } from "./index";

export interface RemoteTeamHost {
  hostId: string;
  name: string;
  logoKey: string | null;
  devicePublicKey: string;
  membershipId: string;
  role: "owner" | "admin" | "member";
  /** The active members that the host's plan allows. An account server from before plans sends none. */
  memberLimit?: number;
}

export interface RemoteTeamMember {
  membershipId: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "revoked";
  avatarUrl?: string | null;
  /** Epoch milliseconds. */
  createdAt?: number;
}

export interface RemoteTeamInvite {
  inviteId: string;
  email: string | null;
  role: "admin" | "member";
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
  permanent: boolean;
  useCount: number;
}

export interface RemoteTeamBootstrap {
  sessionId: string;
  signalUrl: string;
  ticket: string;
}

export interface RemoteInvitePreview {
  hostId: string;
  hostName: string;
  role: "admin" | "member";
  expiresAt: number;
  emailBound: boolean;
  permanent: boolean;
  devicePublicKey: string | null;
}

export interface RemoteHostKeyStore {
  get(hostId: string): Promise<string | null>;
  set(hostId: string, publicKey: string): Promise<void>;
}

export function remoteHostFingerprint(publicKey: string): string {
  const digest = sha256(new TextEncoder().encode(publicKey));
  return bytesToBase64Url(digest);
}

export class RemoteDirectoryError extends Schema.TaggedError<RemoteDirectoryError>()("RemoteDirectoryError", {
  status: Schema.Number,
  message: Schema.String,
}) {
  constructor(status: number, message: string) {
    super({ status, message });
  }
}
class RemoteDirectoryOperationError extends Schema.TaggedError<RemoteDirectoryOperationError>()(
  "RemoteDirectoryOperationError",
  { message: Schema.String },
) {}
type DirectoryFailure = RemoteDirectoryError | RemoteDirectoryOperationError;
function directoryFailure(message: string): RemoteDirectoryOperationError {
  return new RemoteDirectoryOperationError({ message });
}
function directoryIO<A>(operation: () => Promise<A>): Effect.Effect<A, RemoteDirectoryOperationError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => directoryFailure(error instanceof Error ? error.message : String(error)),
  });
}
function directoryDecode<A>(decode: () => A): Effect.Effect<A, RemoteDirectoryOperationError> {
  return Effect.try({
    try: decode,
    catch: (error) => directoryFailure(error instanceof Error ? error.message : String(error)),
  });
}

export class RemoteTeamDirectoryClient {
  readonly #apiUrl: string;
  readonly #authentication: { kind: "bearer"; token: string } | { kind: "browser" };
  readonly #fetch: TeamClientFetch;
  readonly #hostKeys: RemoteHostKeyStore;
  readonly #pairedHost: MobileConnectHostBinding | undefined;
  readonly #inviteLinks: InviteLinkOptions;
  readonly #pinLock = Semaphore.makeUnsafe(1);

  constructor(
    input: {
      apiUrl: string;
      fetch: TeamClientFetch;
      hostKeys?: RemoteHostKeyStore;
      pairedHost?: MobileConnectHostBinding;
      /** A development client passes `allowLocalDevelopmentApiUrl` to use a local account service. */
      inviteLinks?: InviteLinkOptions;
    } & ({ token: string; authentication?: never } | { token?: never; authentication: { kind: "browser" } }),
  ) {
    this.#apiUrl = input.apiUrl;
    if (!input.authentication && !input.token) throw new Error(sourceText("error.remote.accountAuthRequired"));
    this.#authentication = input.authentication ?? { kind: "bearer", token: input.token ?? "" };
    this.#fetch = input.fetch;
    this.#pairedHost = input.pairedHost;
    // A self-hosted account service accepts invitations that name it. `previewInvite` still refuses
    // an invitation for any other service.
    this.#inviteLinks = { selfHostedApiOrigin: selfHostedApiOrigin(input.apiUrl), ...input.inviteLinks };
    const keys = new Map<string, string>();
    this.#hostKeys = input.hostKeys ?? {
      get: async (hostId) => keys.get(hostId) ?? null,
      set: async (hostId, key) => {
        keys.set(hostId, key);
      },
    };
  }

  listHosts(): Effect.Effect<RemoteTeamHost[], DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<RemoteTeamHost[], DirectoryFailure> {
      const value = yield* this.#request("/v2/remote/hosts/");
      if (!isDynamicRecord(value) || !Array.isArray(value.hosts))
        return yield* directoryFailure("The server list is invalid.");
      const hosts = yield* Effect.all(
        value.hosts.map((candidate) =>
          Effect.gen({ self: this }, function* (): Effect.fn.Return<RemoteTeamHost[], DirectoryFailure> {
            if (!isDynamicRecord(candidate) || !isString(candidate.devicePublicKey) || !candidate.devicePublicKey)
              return [];
            const memberLimit = candidate.memberLimit;
            if (
              (memberLimit !== undefined &&
                (!isNumber(memberLimit) || !Number.isSafeInteger(memberLimit) || memberLimit < 1)) ||
              !isString(candidate.hostId) ||
              !isString(candidate.name) ||
              (candidate.logoKey !== null && !isString(candidate.logoKey)) ||
              !isString(candidate.membershipId) ||
              (candidate.role !== "owner" && candidate.role !== "admin" && candidate.role !== "member")
            ) {
              return yield* directoryFailure("A server record is invalid.");
            }
            const hostId = candidate.hostId;
            const pinnedKey = yield* directoryIO(() => this.#hostKeys.get(hostId));
            if (pinnedKey && remoteHostFingerprint(candidate.devicePublicKey) !== remoteHostFingerprint(pinnedKey)) {
              return yield* directoryFailure(sourceText("error.remote.serverIdentityChanged"));
            }
            return [
              {
                hostId: candidate.hostId,
                name: candidate.name,
                logoKey: candidate.logoKey,
                devicePublicKey: pinnedKey ?? candidate.devicePublicKey,
                membershipId: candidate.membershipId,
                role: candidate.role,
                ...(memberLimit === undefined ? {} : { memberLimit }),
              },
            ];
          }),
        ),
        { concurrency: "unbounded" },
      );
      const directory = hosts.flat();
      if (this.#pairedHost) {
        const paired = directory.find((host) => host.hostId === this.#pairedHost?.hostId);
        if (paired && remoteHostFingerprint(paired.devicePublicKey) !== this.#pairedHost.fingerprint) {
          return yield* directoryFailure(sourceText("error.remote.pairedIdentityChanged"));
        }
        if (paired) yield* this.#pinHostKey(paired.hostId, paired.devicePublicKey);
      }
      return directory;
    });
  }

  listMembers(hostId: string): Effect.Effect<RemoteTeamMember[], DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<RemoteTeamMember[], DirectoryFailure> {
      const value = yield* this.#request(`/v2/remote/hosts/${encodeURIComponent(hostId)}/members/`);
      if (!isDynamicRecord(value) || !Array.isArray(value.members))
        return yield* directoryFailure("The member list is invalid.");
      const members = value.members;
      return yield* directoryDecode(() => members.map(decodeMember));
    });
  }

  listInvites(hostId: string): Effect.Effect<RemoteTeamInvite[], DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<RemoteTeamInvite[], DirectoryFailure> {
      const value = yield* this.#request(`/v2/remote/hosts/${encodeURIComponent(hostId)}/invites`);
      if (!isDynamicRecord(value) || !Array.isArray(value.invites))
        return yield* directoryFailure("The invitation list is invalid.");
      const invites = value.invites;
      return yield* directoryDecode(() => invites.map(decodeInvite));
    });
  }

  createInvite(
    host: { hostId: string; devicePublicKey: string },
    input: { role: "admin" | "member"; email?: string; permanent?: boolean },
  ): Effect.Effect<{ inviteId: string; inviteUrl: string; expiresAt: number }, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      { inviteId: string; inviteUrl: string; expiresAt: number },
      DirectoryFailure
    > {
      if (input.permanent && input.email)
        return yield* directoryFailure(sourceText("error.remote.permanentInviteNoEmail"));
      // Validate the URL before creating an invitation.
      const payload = {
        apiUrl: yield* directoryDecode(() => this.#inviteApiUrl()),
        serverId: host.hostId,
        fingerprint: remoteHostFingerprint(host.devicePublicKey),
        token: "x".repeat(32),
      };
      yield* directoryDecode(() => createInviteUrl(payload, this.#inviteLinks));
      // The account service cannot email links for a self-hosted service.
      if (input.email && selfHostedApiOrigin(payload.apiUrl))
        return yield* directoryFailure(sourceText("error.remote.selfHostedInviteNoEmail"));
      const value = yield* this.#request(`/v2/remote/hosts/${encodeURIComponent(host.hostId)}/invites`, {
        method: "POST",
        body: input,
      });
      if (!isDynamicRecord(value) || !isString(value.inviteId) || !isString(value.token) || !isNumber(value.expiresAt))
        return yield* directoryFailure("The invitation is invalid.");
      const token = value.token;
      return {
        inviteId: value.inviteId,
        inviteUrl: yield* directoryDecode(() => createInviteUrl({ ...payload, token }, this.#inviteLinks)),
        expiresAt: value.expiresAt,
      };
    });
  }

  sendInviteEmail(
    host: { hostId: string; devicePublicKey: string; name: string },
    input: { role: "admin" | "member"; email: string },
  ): Effect.Effect<{ inviteId: string; inviteUrl: string; expiresAt: number }, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      { inviteId: string; inviteUrl: string; expiresAt: number },
      DirectoryFailure
    > {
      const invite = yield* this.createInvite(host, input);
      yield* this.#request("/v1/team-invitations/email", {
        method: "POST",
        body: { ...input, serverName: host.name, inviteUrl: invite.inviteUrl },
      }).pipe(
        Effect.catch((error) =>
          this.revokeInvite(invite.inviteId).pipe(
            Effect.catch(() => Effect.void),
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
      return invite;
    });
  }

  revokeInvite(inviteId: string): Effect.Effect<void, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, DirectoryFailure> {
      yield* this.#request(`/v2/remote/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
    });
  }

  updateMember(
    hostId: string,
    membershipId: string,
    role: "admin" | "member",
    reactivate = false,
  ): Effect.Effect<void, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, DirectoryFailure> {
      yield* this.#request(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/members/${encodeURIComponent(membershipId)}`,
        {
          method: "PATCH",
          body: { role, ...(reactivate ? { reactivate: true } : {}) },
        },
      );
    });
  }

  leaveHost(hostId: string, membershipId: string): Effect.Effect<void, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, DirectoryFailure> {
      yield* this.#request(
        `/v2/remote/hosts/${encodeURIComponent(hostId)}/members/${encodeURIComponent(membershipId)}`,
        {
          method: "DELETE",
        },
      );
      // Keep the identity pin: leaving a team must not silently trust a substituted key on rejoin.
    });
  }

  /**
   * Removes a host that this account owns from the account service, for all of its members. The host
   * can be offline. A refused retry for a host that the list no longer has is a removal that already
   * happened, as when the first answer was lost.
   */
  removeOwnedHost(hostId: string): Effect.Effect<void, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, DirectoryFailure> {
      yield* this.#request(`/v2/remote/hosts/${encodeURIComponent(hostId)}/`, { method: "DELETE" }).pipe(
        Effect.catch((error) =>
          error instanceof RemoteDirectoryError && (error.status === 403 || error.status === 404)
            ? this.listHosts().pipe(
                Effect.flatMap((hosts) =>
                  hosts.some((host) => host.hostId === hostId) ? Effect.fail(error) : Effect.void,
                ),
              )
            : Effect.fail(error),
        ),
      );
    });
  }

  createBootstrap(
    hostId: string,
    clientPublicKey: string,
    existingSessionId: string | null = null,
  ): Effect.Effect<RemoteTeamBootstrap, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<RemoteTeamBootstrap, DirectoryFailure> {
      if (existingSessionId) {
        const existing = yield* this.#ticket(existingSessionId, clientPublicKey).pipe(
          Effect.catch((error) =>
            error instanceof RemoteDirectoryError && (error.status === 403 || error.status === 404)
              ? Effect.succeed(null)
              : Effect.fail(error),
          ),
        );
        if (existing) return existing;
      }
      const value = yield* this.#request("/v2/remote/sessions/", { method: "POST", body: { hostId } });
      const session = yield* directoryDecode(() => decodeRemoteSession(value));
      return yield* this.#ticket(session.sessionId, clientPublicKey).pipe(
        Effect.catch((error) =>
          this.endSession(session.sessionId).pipe(
            Effect.catch(() => Effect.void),
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
    });
  }

  /**
   * The account service an invitation names. The public website serves the same Worker as
   * `api.openbot.run`, but an invitation must name `api.openbot.run`: the desktop and mobile apps
   * accept only that address.
   */
  #inviteApiUrl(): string {
    const url = new URL(this.#apiUrl);
    return this.#authentication.kind === "browser" && url.origin === OPENBOT_INVITE_ORIGIN
      ? new URL(OPENBOT_CONTROL_PLANE_ORIGIN).toString()
      : url.toString();
  }

  endSession(sessionId: string): Effect.Effect<void, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, DirectoryFailure> {
      yield* this.#request(`/v2/remote/sessions/${encodeURIComponent(sessionId)}/end`, { method: "POST" });
    });
  }

  previewInvite(inviteUrl: string): Effect.Effect<RemoteInvitePreview, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<RemoteInvitePreview, DirectoryFailure> {
      const invite = yield* directoryDecode(() => parseInviteUrl(inviteUrl, this.#inviteLinks));
      const inviteOrigin = new URL(invite.apiUrl).origin;
      const origin = new URL(this.#apiUrl).origin;
      // These production origins serve the same account Worker. Requests still use this client's origin.
      const publicWebsiteInvite =
        this.#authentication.kind === "browser" &&
        origin === "https://openbot.run" &&
        inviteOrigin === "https://api.openbot.run";
      if (inviteOrigin !== origin && !publicWebsiteInvite) {
        return yield* directoryFailure(sourceText("error.remote.inviteOtherService"));
      }
      const value = yield* this.#request("/v2/remote/invites/preview", {
        method: "POST",
        body: { token: invite.token },
        authenticated: false,
      });
      const preview = yield* directoryDecode(() => decodeInvitePreview(value, invite.serverId));
      if (!preview.devicePublicKey || remoteHostFingerprint(preview.devicePublicKey) !== invite.fingerprint) {
        return yield* directoryFailure(sourceText("error.remote.inviteFingerprintMismatch"));
      }
      return preview;
    });
  }

  acceptInvite(inviteUrl: string): Effect.Effect<RemoteTeamHost, DirectoryFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<RemoteTeamHost, DirectoryFailure> {
      const invite = yield* directoryDecode(() => parseInviteUrl(inviteUrl, this.#inviteLinks));
      const preview = yield* this.previewInvite(inviteUrl);
      if (!preview.devicePublicKey) return yield* directoryFailure(sourceText("error.remote.inviteHostKeyMissing"));
      // Save the pin before consuming the one-use token, including across app restarts.
      yield* this.#pinHostKey(invite.serverId, preview.devicePublicKey);
      const accepted = yield* this.#request("/v2/remote/invites/accept", {
        method: "POST",
        body: { token: invite.token },
      });
      if (
        !isDynamicRecord(accepted) ||
        accepted.hostId !== invite.serverId ||
        !isString(accepted.membershipId) ||
        !accepted.membershipId ||
        accepted.role !== preview.role
      )
        return yield* directoryFailure("The account service returned an invalid invitation acceptance.");
      return {
        hostId: invite.serverId,
        name: preview.hostName,
        logoKey: null,
        devicePublicKey: preview.devicePublicKey,
        membershipId: accepted.membershipId,
        role: preview.role,
      };
    });
  }

  #pinHostKey(hostId: string, publicKey: string): Effect.Effect<void, DirectoryFailure> {
    return this.#pinLock.withPermit(
      Effect.gen({ self: this }, function* () {
        const pinned = yield* directoryIO(() => this.#hostKeys.get(hostId));
        if (pinned && remoteHostFingerprint(pinned) !== remoteHostFingerprint(publicKey)) {
          return yield* directoryFailure(sourceText("error.remote.inviteKeyConflict"));
        }
        yield* directoryIO(() => this.#hostKeys.set(hostId, publicKey));
      }),
    );
  }

  #ticket(sessionId: string, clientPublicKey: string): Effect.Effect<RemoteTeamBootstrap, DirectoryFailure> {
    return Effect.gen({ self: this }, function* () {
      const value = yield* this.#request(`/v2/remote/sessions/${encodeURIComponent(sessionId)}/ticket`, {
        method: "POST",
        body: { clientPublicKey },
      });
      const ticket = yield* directoryDecode(() => decodeRemoteSessionTicket(value));
      return { sessionId, signalUrl: ticket.signalUrl, ticket: ticket.ticket };
    });
  }

  #request(
    path: string,
    options: { method?: string; body?: object; authenticated?: boolean } = {},
  ): Effect.Effect<unknown, DirectoryFailure> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        return { controller, timer };
      }),
      ({ controller }) =>
        Effect.gen({ self: this }, function* () {
          const browser = this.#authentication.kind === "browser";
          const response = yield* Effect.tryPromise({
            try: () =>
              this.#fetch(new URL(browser ? `/api/browser${path}` : path, this.#apiUrl), {
                ...(browser ? { credentials: "same-origin" as const } : {}),
                method: options.method ?? "GET",
                headers: {
                  ...(this.#authentication.kind === "bearer" && options.authenticated !== false
                    ? { Authorization: `Bearer ${this.#authentication.token}` }
                    : {}),
                  ...(browser
                    ? { "X-OpenBot-Browser": "1", "Content-Type": "application/json" }
                    : options.body
                      ? { "Content-Type": "application/json" }
                      : {}),
                },
                ...(options.body || (browser && options.method === "POST")
                  ? { body: JSON.stringify(options.body ?? {}) }
                  : {}),
                signal: controller.signal,
              }),
            catch: (error) => directoryFailure(error instanceof Error ? error.message : String(error)),
          });
          const value = yield* directoryIO(() => response.json()).pipe(Effect.catch(() => Effect.succeed(null)));
          if (!response.ok) return yield* new RemoteDirectoryError(response.status, errorMessage(value));
          return value;
        }),
      ({ controller, timer }) =>
        Effect.sync(() => {
          clearTimeout(timer);
          controller.abort();
        }),
    );
  }
}

function decodeInvitePreview(value: unknown, expectedHostId: string): RemoteInvitePreview {
  if (
    !isDynamicRecord(value) ||
    value.hostId !== expectedHostId ||
    !isString(value.hostName) ||
    (value.role !== "admin" && value.role !== "member") ||
    !isNumber(value.expiresAt) ||
    !isBoolean(value.emailBound) ||
    (value.devicePublicKey !== null && !isString(value.devicePublicKey))
  ) {
    throw new Error("The invitation preview is invalid.");
  }
  return {
    hostId: expectedHostId,
    hostName: value.hostName,
    role: value.role,
    expiresAt: value.expiresAt,
    emailBound: value.emailBound,
    permanent: isPermanentInvite(value.permanent, value.expiresAt),
    devicePublicKey: value.devicePublicKey,
  };
}

function errorMessage(value: unknown): string {
  if (isDynamicRecord(value)) {
    if (isString(value.error)) return value.error;
    if (isDynamicRecord(value.error) && isString(value.error.message)) return value.error.message;
  }
  return sourceText("error.remote.serviceRequestFailed");
}

function decodeMember(value: unknown): RemoteTeamMember {
  if (
    !isDynamicRecord(value) ||
    !isString(value.membershipId) ||
    !isString(value.email) ||
    (value.name !== null && !isString(value.name)) ||
    (value.role !== "owner" && value.role !== "admin" && value.role !== "member") ||
    (value.status !== "active" && value.status !== "revoked")
  )
    throw new Error("The member record is invalid.");
  return {
    membershipId: value.membershipId,
    email: value.email,
    name: value.name,
    role: value.role,
    status: value.status,
    ...(value.avatarUrl === null || isString(value.avatarUrl) ? { avatarUrl: value.avatarUrl } : {}),
    ...(isNumber(value.createdAt) ? { createdAt: value.createdAt } : {}),
  };
}

function decodeInvite(value: unknown): RemoteTeamInvite {
  if (
    !isDynamicRecord(value) ||
    !isString(value.inviteId) ||
    (value.email !== null && !isString(value.email)) ||
    (value.role !== "admin" && value.role !== "member") ||
    !isNumber(value.expiresAt) ||
    (value.usedAt !== null && !isNumber(value.usedAt)) ||
    (value.revokedAt !== null && !isNumber(value.revokedAt))
  )
    throw new Error("The invitation record is invalid.");
  return {
    inviteId: value.inviteId,
    email: value.email,
    role: value.role,
    expiresAt: value.expiresAt,
    usedAt: value.usedAt,
    revokedAt: value.revokedAt,
    permanent: isPermanentInvite(value.permanent, value.expiresAt),
    useCount: inviteUseCount(value.useCount),
  };
}

export const REMOTE_ACCOUNT_CHECK_INTERVAL_MS = 15 * 60_000;

/** The caller starts this watcher in the foreground and stops it on background entry. */
export function watchRemoteDirectory<E>(refresh: () => Effect.Effect<void, E>): () => void {
  const timer = setInterval(
    () => void runTeamEffect(refresh()).catch(() => undefined),
    REMOTE_ACCOUNT_CHECK_INTERVAL_MS,
  );
  return () => clearInterval(timer);
}

/** Refresh on demand or foreground entry; coalesce requests and rate-limit automatic retries. */
export function createRemoteDirectoryRefresh<E, R>(load: () => Effect.Effect<void, E, R>, now = Date.now) {
  let pending: Deferred.Deferred<void, E> | null = null;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  const refresh = Effect.fn("RemoteDirectory.refresh")(function* (force = false) {
    if (pending) return yield* Deferred.await(pending);
    if (!force && now() - lastAttempt < REMOTE_ACCOUNT_CHECK_INTERVAL_MS) return;
    lastAttempt = now();
    const operation = Deferred.makeUnsafe<void, E>();
    pending = operation;
    return yield* load().pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          yield* Deferred.done(operation, exit);
          if (pending === operation) pending = null;
        }),
      ),
    );
  });
  return {
    refresh,
    invalidate(): void {
      pending = null;
      lastAttempt = Number.NEGATIVE_INFINITY;
    },
  };
}
