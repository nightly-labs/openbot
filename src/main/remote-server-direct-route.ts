// The direct Tailscale path to a joined WebRTC server, and the server list as the request client and
// the event stream see it while that path is in use.
//
// A host that offers `direct-endpoint-v1` tells its members an `https://<device>.<tailnet>.ts.net`
// address. When this computer's Tailscale can reach that device, a connection first tries it:
//
//   1. `verifyIdentity` at the address: the host signs a new challenge with the key pinned for this
//      server, the same Ed25519 key the WebRTC handshake checks. Nothing secret is sent before this.
//   2. One account ticket from the account service, sent to `/v1/auth/account` at the address. The
//      host checks it with the account service and answers a short session token (24 hours).
//
// Each step has a short deadline. A failure at any step leaves the server on WebRTC, as before, and
// the direct path is not tried again for a while. While the path is in use, this directory gives the
// request client and the event stream an HTTPS view of the server (its `apiUrl` is the tailnet address
// and its token is the direct session), so they use their released HTTPS arms unchanged. The remote
// screen and the browser view keep the WebRTC view: see `isWebRtcOnlyTeamPath`.
//
// With `sessions`, the token is also kept, encrypted, for the next run of this app. That run checks the
// pinned host key as before, then asks the host with the kept token (`checkSession`) and uses it: no
// ticket and no sign-in. A host that no longer accepts it (it restarted, or the session ended) answers
// 401, and the same attempt signs in once as above. Without `sessions` the token is in memory only.

import { isValidTailscaleDirectApiUrl } from "@openbot/contracts/invite-links";
import type { ServerCompatibility, ServerDirectRoute, ServerDirectRouteHint } from "@openbot/contracts/ipc";
import { decodeRecord } from "@openbot/contracts/ipc-decoding";
import { isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { StoredDirectSession } from "./remote-direct-session-store";
import type { RemoteServerDirectory, StoredRemoteServerView } from "./remote-server-store";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TailscaleLocalState } from "./tailscale-cli";
import { isWebRtcOnlyTeamPath } from "./team-api-direct-paths";

/** The whole direct attempt, identity check and sign-in together. WebRTC follows a slower one. */
export const DIRECT_ATTEMPT_TIMEOUT_MS = 4_000;
/** After a failed attempt, connections use WebRTC for this long before the direct path is tried again. */
export const DIRECT_RETRY_AFTER_MS = 5 * 60_000;
/** A session is renewed this long before it ends, with a new account ticket. */
export const DIRECT_REFRESH_MARGIN_MS = 10 * 60_000;
/** The client never keeps a direct session longer than this, whatever the host answers. */
const DIRECT_SESSION_MAXIMUM_MS = 24 * 60 * 60_000;

export type DirectRouteHint = ServerDirectRouteHint | null;
export type DirectRouteStatus = ServerDirectRoute;

export interface DirectSignIn {
  sessionToken: string;
  sessionExpiresAt: string | null;
}

/**
 * The direct sessions kept between runs, for the signed-in account. `principalId` is null when no
 * account is signed in: nothing is read or written then.
 */
export interface DirectSessionPersistence {
  principalId: () => string | null;
  read: (principalId: string, serverId: string) => Effect.Effect<StoredDirectSession | null>;
  write: (principalId: string, serverId: string, session: StoredDirectSession) => Effect.Effect<void>;
  remove: (serverId: string) => Effect.Effect<void>;
  clear: () => Effect.Effect<void>;
}

export interface RemoteDirectRoutesOptions {
  servers: RemoteServerDirectory;
  localTailscale: () => Effect.Effect<TailscaleLocalState>;
  /** `RemoteServerClient.verifyIdentity`: the pinned-key check at a bare address. */
  verifyIdentity: (
    apiUrl: string,
    serverId: string,
    fingerprint: string,
  ) => Effect.Effect<{ publicKey: string; compatibility: ServerCompatibility }, RemoteWorkflowError>;
  createTicket: (serverId: string) => Effect.Effect<string, RemoteWorkflowError>;
  signIn: (
    apiUrl: string,
    accountTicket: string,
    compatibility: ServerCompatibility,
  ) => Effect.Effect<DirectSignIn, RemoteWorkflowError>;
  /**
   * Asks the host whether it still accepts a kept token. "rejected" is its 401 or 403; any other
   * failure fails the attempt and keeps the token.
   */
  checkSession?: (
    apiUrl: string,
    token: string,
    compatibility: ServerCompatibility,
  ) => Effect.Effect<"valid" | "rejected", RemoteWorkflowError>;
  sessions?: DirectSessionPersistence;
  /** The negotiated HTTPS protocol of the direct address replaces the WebRTC one while it is in use. */
  setCompatibility: (serverId: string, compatibility: ServerCompatibility) => void;
  clearCompatibility: (serverId: string) => void;
  /** The session is close to its end. The owner reconnects, which signs in again. */
  onRefreshDue: (serverId: string) => void;
  now?: () => number;
  attemptTimeoutMs?: number;
}

interface ActiveRoute {
  readonly url: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly refresh: ReturnType<typeof setTimeout>;
}

export class RemoteDirectRoutes implements RemoteServerDirectory {
  readonly #options: RemoteDirectRoutesOptions;
  readonly #now: () => number;
  readonly #active = new Map<string, ActiveRoute>();
  readonly #retryAfter = new Map<string, number>();
  readonly #hints = new Map<string, DirectRouteHint>();
  /** Servers whose kept session must not be used, from the moment it was forgotten until it is removed. */
  readonly #forgotten = new Set<string>();
  /** The HTTPS view made for a stored server under one route, and the route of each view. */
  readonly #views = new WeakMap<StoredRemoteServerView, { route: ActiveRoute; view: StoredRemoteServerView }>();
  readonly #routes = new WeakMap<StoredRemoteServerView, ActiveRoute>();

  constructor(options: RemoteDirectRoutesOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  // The directory, as the request client and the event stream read it.

  get activeServerId(): string {
    return this.#options.servers.activeServerId;
  }

  get servers(): readonly StoredRemoteServerView[] {
    return this.#options.servers.servers.map((server) => this.#view(server));
  }

  /** `path` keeps a WebRTC-only route on WebRTC while the rest of the server is direct. */
  require(serverId: string, path?: string): StoredRemoteServerView {
    const server = this.#options.servers.require(serverId);
    return path !== undefined && isWebRtcOnlyTeamPath(path) ? server : this.#view(server);
  }

  find(serverId: string): StoredRemoteServerView | null {
    const server = this.#options.servers.find(serverId);
    return server ? this.#view(server) : null;
  }

  has(serverId: string): boolean {
    return this.#options.servers.has(serverId);
  }

  token(server: StoredRemoteServerView): string {
    const route = this.#routes.get(server);
    return route ? route.token : this.#options.servers.token(server);
  }

  // The direct path itself.

  isActive(serverId: string): boolean {
    return this.#active.has(serverId);
  }

  status(server: StoredRemoteServerView): DirectRouteStatus {
    return {
      offered: server.transport === "webrtc-v2" && server.directUrl !== undefined,
      enabled: server.directDisabled !== true,
      active: this.#active.has(server.id),
      hint: this.#active.has(server.id) ? null : (this.#hints.get(server.id) ?? null),
    };
  }

  /**
   * Tries the direct path once. True when requests and events can use it now. It never fails: every
   * failure means "use WebRTC", and the reason is kept for the server settings.
   */
  readonly tryActivate = Effect.fn("RemoteDirectRoutes.tryActivate")(function* (
    this: RemoteDirectRoutes,
    serverId: string,
  ): Effect.fn.Return<boolean> {
    if (this.#active.has(serverId)) return true;
    const server = this.#options.servers.find(serverId);
    const url = server?.directUrl;
    if (server?.transport !== "webrtc-v2" || !url || server.directDisabled) return false;
    if (!isValidTailscaleDirectApiUrl(url)) return false;
    if ((this.#retryAfter.get(serverId) ?? 0) > this.#now()) return false;
    const local = yield* this.#options.localTailscale();
    if (local.kind !== "connected") {
      this.#hints.set(serverId, "tailscale-unavailable");
      return false;
    }
    // The device must be one this computer's Tailscale lists: in the same tailnet, or shared into it.
    const hostname = new URL(url).hostname;
    if (local.dnsName !== hostname && !local.peerDnsNames.includes(hostname)) {
      this.#hints.set(serverId, "other-tailnet");
      return false;
    }
    // The account the attempt is for. A session is kept and used only for this account.
    const principalId = this.#options.sessions?.principalId() ?? null;
    const kept = yield* this.#keptSession(principalId, serverId, url);
    const attempt = yield* Effect.gen({ self: this }, function* () {
      const identity = yield* this.#options.verifyIdentity(url, server.id, server.fingerprint);
      // `verifyIdentity` checks the key against the pinned fingerprint. A pinned key is checked too.
      if (server.publicKey !== undefined && identity.publicKey !== server.publicKey)
        return yield* new RemoteWorkflowError({ cause: new Error("The direct address has another host key.") });
      // The kept token goes only to the address whose key was just checked.
      const checkSession = this.#options.checkSession;
      if (kept && checkSession) {
        const answer = yield* checkSession(url, kept.token, identity.compatibility);
        if (answer === "valid")
          return { token: kept.token, expiresAt: kept.expiresAt, kept: true, compatibility: identity.compatibility };
        yield* this.#forgetKept(serverId);
      }
      const ticket = yield* this.#options.createTicket(server.id);
      const session = yield* this.#options.signIn(url, ticket, identity.compatibility);
      return {
        token: session.sessionToken,
        expiresAt: this.#expiresAt(session.sessionExpiresAt),
        kept: false,
        compatibility: identity.compatibility,
      };
    }).pipe(
      Effect.timeoutOrElse({
        duration: this.#options.attemptTimeoutMs ?? DIRECT_ATTEMPT_TIMEOUT_MS,
        orElse: () => Effect.fail(new RemoteWorkflowError({ cause: new Error("The direct address did not answer.") })),
      }),
      Effect.result,
    );
    // The server can be removed, or the member can turn the path off, while the attempt runs.
    const current = this.#options.servers.find(serverId);
    // So can the account: a session of the previous account is not used for the next one.
    const accountChanged = principalId !== (this.#options.sessions?.principalId() ?? null);
    if (
      attempt._tag === "Failure" ||
      !current ||
      current.directUrl !== url ||
      current.directDisabled ||
      accountChanged
    ) {
      this.#retryAfter.set(serverId, this.#now() + DIRECT_RETRY_AFTER_MS);
      this.#hints.set(serverId, "failed");
      return false;
    }
    const { token, expiresAt } = attempt.success;
    const now = this.#now();
    const refresh = setTimeout(
      () => this.#options.onRefreshDue(serverId),
      Math.max(0, expiresAt - now - DIRECT_REFRESH_MARGIN_MS),
    );
    refresh.unref?.();
    this.#active.set(serverId, { url, token, expiresAt, refresh });
    this.#retryAfter.delete(serverId);
    this.#hints.delete(serverId);
    this.#options.setCompatibility(serverId, attempt.success.compatibility);
    // A new session is kept for the next run. A failed write only means a new sign-in then.
    if (!attempt.success.kept && principalId !== null && this.#options.sessions)
      yield* this.#options.sessions.write(principalId, serverId, { url, token, expiresAt });
    return true;
  });

  /**
   * Stops using the direct path. `retryLater` keeps the next connections on WebRTC for a while, after
   * the address stopped answering; a session that only ended does not.
   */
  deactivate(serverId: string, retryLater: boolean): void {
    const route = this.#active.get(serverId);
    if (!route) return;
    clearTimeout(route.refresh);
    this.#active.delete(serverId);
    this.#options.clearCompatibility(serverId);
    if (retryLater) {
      this.#retryAfter.set(serverId, this.#now() + DIRECT_RETRY_AFTER_MS);
      this.#hints.set(serverId, "failed");
    }
  }

  /**
   * Removes the kept session of one server, such as when the host no longer accepts it, the member
   * turns the direct path off, the server is removed or its address changes.
   */
  forgetSession(serverId: string): Effect.Effect<void> {
    if (this.#options.sessions) this.#forgotten.add(serverId);
    return this.#forgetKept(serverId);
  }

  /** Removes every kept session, such as at sign-out or when another account signs in. */
  forgetAllSessions(): Effect.Effect<void> {
    const sessions = this.#options.sessions;
    if (!sessions) return Effect.void;
    for (const server of this.#options.servers.servers) this.#forgotten.add(server.id);
    return sessions.clear().pipe(Effect.ensuring(Effect.sync(() => this.#forgotten.clear())));
  }

  /** The member asked for this server again: the next connection may try the direct path at once. */
  clearRetry(serverId: string): void {
    this.#retryAfter.delete(serverId);
  }

  forget(serverId: string): void {
    const route = this.#active.get(serverId);
    if (route) clearTimeout(route.refresh);
    this.#active.delete(serverId);
    this.#retryAfter.delete(serverId);
    this.#hints.delete(serverId);
  }

  clear(): void {
    for (const route of this.#active.values()) clearTimeout(route.refresh);
    this.#active.clear();
    this.#retryAfter.clear();
    this.#hints.clear();
  }

  /**
   * The kept session that this attempt can use: of this account, for this address, and not close to
   * its end. Another one is removed. A session close to its end is renewed with a new sign-in.
   */
  #keptSession(principalId: string | null, serverId: string, url: string): Effect.Effect<StoredDirectSession | null> {
    const sessions = this.#options.sessions;
    if (!sessions || principalId === null || !this.#options.checkSession) return Effect.succeed(null);
    return Effect.gen({ self: this }, function* () {
      const kept = yield* sessions.read(principalId, serverId);
      const forgotten = this.#forgotten.delete(serverId);
      if (!kept) return null;
      if (!forgotten && kept.url === url && kept.expiresAt - this.#now() > DIRECT_REFRESH_MARGIN_MS) return kept;
      yield* sessions.remove(serverId);
      return null;
    });
  }

  #forgetKept(serverId: string): Effect.Effect<void> {
    const sessions = this.#options.sessions;
    if (!sessions) return Effect.void;
    // The flag only covers the time until the removal is done.
    return sessions.remove(serverId).pipe(Effect.ensuring(Effect.sync(() => this.#forgotten.delete(serverId))));
  }

  /** When the client ends a new session: the host's answer, never later than 24 hours. */
  #expiresAt(answer: string | null): number {
    const answered = answer ? Date.parse(answer) : Number.NaN;
    return Math.min(
      Number.isFinite(answered) ? answered : Number.POSITIVE_INFINITY,
      this.#now() + DIRECT_SESSION_MAXIMUM_MS,
    );
  }

  #view(server: StoredRemoteServerView): StoredRemoteServerView {
    const route = this.#active.get(server.id);
    if (!route) return server;
    const cached = this.#views.get(server);
    if (cached?.route === route) return cached.view;
    // An HTTPS server for the released HTTPS arms: no `transport`, and the tailnet address.
    const { transport: _transport, ...rest } = server;
    const view: StoredRemoteServerView = { ...rest, apiUrl: `${route.url}/` };
    this.#views.set(server, { route, view });
    this.#routes.set(view, route);
    return view;
  }
}

/** The account sign-in answer at the direct address: the token, and when the host ends it. */
export function decodeDirectSignIn(value: unknown): DirectSignIn {
  const record = decodeRecord(value, "direct sign-in");
  if (!isString(record.sessionToken) || !record.sessionToken || record.sessionToken.length > 512)
    throw new Error("Invalid direct session.");
  return {
    sessionToken: record.sessionToken,
    sessionExpiresAt: isString(record.sessionExpiresAt) ? record.sessionExpiresAt : null,
  };
}
