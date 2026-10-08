// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerCompatibility } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { HOST_TAILSCALE_ROUTES } from "@openbot/contracts/team-protocol/host-tailscale-v1";
import { Deferred, Effect, Fiber } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteDirectSessionStore } from "./remote-direct-session-store";
import {
  DIRECT_REFRESH_MARGIN_MS,
  DIRECT_RETRY_AFTER_MS,
  type DirectSessionPersistence,
  RemoteDirectRoutes,
  type RemoteDirectRoutesOptions,
} from "./remote-server-direct-route";
import type { RemoteServerDirectory, StoredRemoteServerView } from "./remote-server-store";
import type { StoredRemoteServer } from "./remote-server-stored-shape";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TailscaleLocalState } from "./tailscale-cli";

const HOST = "00000000-0000-4000-8000-0000000000aa";
const DIRECT = "https://studio-mac.tail4b2c1.ts.net";
const compatibility: ServerCompatibility = {
  localAppVersion: "1.0.0",
  hostAppVersion: "1.0.0",
  localProtocol: { minimum: 1, maximum: 6 },
  hostProtocol: { minimum: 1, maximum: 6 },
  negotiatedProtocol: 6,
  capabilities: [],
};
const connected: TailscaleLocalState = {
  kind: "connected",
  tailnet: "owner@example.com",
  deviceName: "laptop",
  dnsName: "laptop.tail4b2c1.ts.net",
  httpsCertificates: true,
  peerDnsNames: ["studio-mac.tail4b2c1.ts.net"],
};

function webRtcServer(overrides: Partial<StoredRemoteServer> = {}): StoredRemoteServer {
  return {
    id: HOST,
    name: "Studio",
    apiUrl: `webrtc://${HOST}`,
    fingerprint: "pinned-fingerprint",
    publicKey: "pinned-key",
    username: "person@example.com",
    encryptedToken: "",
    remoteDesktopAvailable: false,
    role: "member",
    transport: "webrtc-v2",
    directUrl: DIRECT,
    ...overrides,
  };
}

function directory(server: StoredRemoteServer): RemoteServerDirectory & { current: StoredRemoteServer | null } {
  const state: { current: StoredRemoteServer | null } = { current: server };
  return {
    get current() {
      return state.current;
    },
    set current(value) {
      state.current = value;
    },
    activeServerId: HOST,
    get servers() {
      return state.current ? [state.current] : [];
    },
    require: (serverId) => {
      if (!state.current || state.current.id !== serverId) throw new Error("missing");
      return state.current;
    },
    find: (serverId) => (state.current?.id === serverId ? state.current : null),
    has: (serverId) => state.current?.id === serverId,
    token: () => "webrtc-token",
  };
}

function routes(server: StoredRemoteServer, overrides: Partial<RemoteDirectRoutesOptions> = {}) {
  const servers = directory(server);
  const steps: string[] = [];
  const options: RemoteDirectRoutesOptions = {
    servers,
    localTailscale: () => Effect.succeed(connected),
    verifyIdentity: (apiUrl) =>
      Effect.sync(() => {
        steps.push(`identity ${apiUrl}`);
        return { publicKey: "pinned-key", compatibility };
      }),
    createTicket: () =>
      Effect.sync(() => {
        steps.push("ticket");
        return "account-ticket";
      }),
    signIn: (apiUrl, ticket) =>
      Effect.sync(() => {
        steps.push(`sign-in ${apiUrl} ${ticket}`);
        return { sessionToken: "direct-token", sessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString() };
      }),
    setCompatibility: vi.fn(),
    clearCompatibility: vi.fn(),
    onRefreshDue: vi.fn(),
    ...overrides,
  };
  return { direct: new RemoteDirectRoutes(options), servers, steps, options };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RemoteDirectRoutes", () => {
  it("checks the pinned host key before it asks for a ticket, then gives an HTTPS view", async () => {
    const { direct, steps, options } = routes(webRtcServer());
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(true);
    expect(steps).toEqual([`identity ${DIRECT}`, "ticket", `sign-in ${DIRECT} account-ticket`]);
    expect(options.setCompatibility).toHaveBeenCalledWith(HOST, compatibility);
    const view = direct.require(HOST);
    expect(view.transport).toBeUndefined();
    expect(view.apiUrl).toBe(`${DIRECT}/`);
    expect(direct.token(view)).toBe("direct-token");
    expect(direct.servers[0]).toBe(view);
    // The remote screen and the browser view stay on WebRTC.
    expect(direct.require(HOST, TEAM_API_ROUTES.remoteScreen.sessions).transport).toBe("webrtc-v2");
    expect(direct.require(HOST, TEAM_API_ROUTES.browser.viewSessions).transport).toBe("webrtc-v2");
    // The owner's Tailscale setup can take the direct path down, so it goes over WebRTC too.
    expect(direct.require(HOST, HOST_TAILSCALE_ROUTES.direct).transport).toBe("webrtc-v2");
    expect(direct.status(webRtcServer())).toEqual({ offered: true, enabled: true, active: true, hint: null });
  });

  it("sends no ticket and no token when the address answers with another host key", async () => {
    const { direct, steps } = routes(webRtcServer(), {
      verifyIdentity: () => Effect.succeed({ publicKey: "another-key", compatibility }),
    });
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(false);
    expect(steps).toEqual([]);
    expect(direct.require(HOST).transport).toBe("webrtc-v2");
    expect(direct.status(webRtcServer()).hint).toBe("failed");
  });

  it("sends no ticket when the identity proof fails", async () => {
    const { direct, steps } = routes(webRtcServer(), {
      verifyIdentity: () => Effect.fail(new RemoteWorkflowError({ cause: new Error("not verified") })),
    });
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(false);
    expect(steps).toEqual([]);
  });

  it("gives up at its deadline and keeps the server on WebRTC", async () => {
    const { direct, steps } = routes(webRtcServer(), {
      attemptTimeoutMs: 20,
      verifyIdentity: () => Effect.never,
    });
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(false);
    expect(steps).toEqual([]);
    expect(direct.isActive(HOST)).toBe(false);
  });

  it("counts a local Tailscale that does not answer against the same deadline", async () => {
    const { direct, steps } = routes(webRtcServer(), { attemptTimeoutMs: 20, localTailscale: () => Effect.never });
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(false);
    expect(steps).toEqual([]);
    expect(direct.status(webRtcServer()).hint).toBe("failed");
  });

  it("does not retry a failed address until later, unless the member asks", async () => {
    let now = 1_000;
    const verifyIdentity = vi.fn(() => Effect.fail(new RemoteWorkflowError({ cause: new Error("down") })));
    const { direct } = routes(webRtcServer(), { verifyIdentity, now: () => now });
    await Effect.runPromise(direct.tryActivate(HOST));
    await Effect.runPromise(direct.tryActivate(HOST));
    expect(verifyIdentity).toHaveBeenCalledOnce();
    now += DIRECT_RETRY_AFTER_MS + 1;
    await Effect.runPromise(direct.tryActivate(HOST));
    expect(verifyIdentity).toHaveBeenCalledTimes(2);
    direct.clearRetry(HOST);
    await Effect.runPromise(direct.tryActivate(HOST));
    expect(verifyIdentity).toHaveBeenCalledTimes(3);
  });

  it("does not try a server without an address: a host without the capability stays on WebRTC", async () => {
    const localTailscale = vi.fn(() => Effect.succeed(connected));
    const { direct, steps } = routes(webRtcServer({ directUrl: undefined }), { localTailscale });
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(false);
    expect(localTailscale).not.toHaveBeenCalled();
    expect(steps).toEqual([]);
    expect(direct.status(webRtcServer({ directUrl: undefined })).offered).toBe(false);
  });

  it("does not try when the member turned it off, or for an address outside ts.net", async () => {
    for (const server of [
      webRtcServer({ directDisabled: true }),
      webRtcServer({ directUrl: "https://example.com" }),
      webRtcServer({ transport: undefined }),
    ]) {
      const { direct, steps } = routes(server);
      expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(false);
      expect(steps).toEqual([]);
    }
  });

  it("explains a device in another tailnet and a Tailscale that is not running", async () => {
    const other = routes(webRtcServer(), {
      localTailscale: () => Effect.succeed({ ...connected, peerDnsNames: ["pc.other.ts.net"] }),
    });
    expect(await Effect.runPromise(other.direct.tryActivate(HOST))).toBe(false);
    expect(other.direct.status(webRtcServer()).hint).toBe("other-tailnet");
    expect(other.steps).toEqual([]);

    const off = routes(webRtcServer(), { localTailscale: () => Effect.succeed({ kind: "signed-out", authUrl: null }) });
    expect(await Effect.runPromise(off.direct.tryActivate(HOST))).toBe(false);
    expect(off.direct.status(webRtcServer()).hint).toBe("tailscale-unavailable");
  });

  it("does not keep a session the member turned off while it was being made", async () => {
    const { direct, servers } = routes(webRtcServer(), {
      signIn: () =>
        Effect.sync(() => {
          servers.current = webRtcServer({ directDisabled: true });
          return { sessionToken: "direct-token", sessionExpiresAt: null };
        }),
    });
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(false);
    expect(direct.isActive(HOST)).toBe(false);
  });

  it("renews before the session ends, and goes back to the WebRTC view when deactivated", async () => {
    vi.useFakeTimers();
    const { direct, options } = routes(webRtcServer(), {
      signIn: () => Effect.succeed({ sessionToken: "direct-token", sessionExpiresAt: null }),
    });
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(true);
    // No host answer: the client still ends the session within 24 hours.
    vi.advanceTimersByTime(24 * 60 * 60_000 - 10 * 60_000);
    expect(options.onRefreshDue).toHaveBeenCalledWith(HOST);
    direct.deactivate(HOST, false);
    expect(options.clearCompatibility).toHaveBeenCalledWith(HOST);
    const view: StoredRemoteServerView = direct.require(HOST);
    expect(view.transport).toBe("webrtc-v2");
    expect(direct.token(view)).toBe("webrtc-token");
  });

  it("makes one attempt for callers that come together, and gives each of them its answer", async () => {
    const ticket = Deferred.makeUnsafe<string, RemoteWorkflowError>();
    const createTicket = vi.fn(() => Deferred.await(ticket));
    const { direct, steps } = routes(webRtcServer(), { createTicket });
    const first = Effect.runPromise(direct.tryActivate(HOST));
    const second = Effect.runPromise(direct.tryActivate(HOST));
    // A request that comes meanwhile waits for the same attempt.
    let waited = false;
    const request = Effect.runPromise(direct.awaitAttempt(HOST)).then(() => {
      waited = true;
      return direct.require(HOST).apiUrl;
    });
    await vi.waitFor(() => expect(createTicket).toHaveBeenCalledOnce());
    expect(waited).toBe(false);
    Deferred.doneUnsafe(ticket, Effect.succeed("account-ticket"));
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(await request).toBe(`${DIRECT}/`);
    expect(steps).toEqual([`identity ${DIRECT}`, `sign-in ${DIRECT} account-ticket`]);
    expect(createTicket).toHaveBeenCalledOnce();
    expect(direct.status(webRtcServer())).toEqual({ offered: true, enabled: true, active: true, hint: null });
    // Once the path is on, a caller gets it without another attempt.
    expect(await Effect.runPromise(direct.tryActivate(HOST))).toBe(true);
    expect(createTicket).toHaveBeenCalledOnce();
  });

  it("gives every waiting caller the same failure, and tries once", async () => {
    const identity = Deferred.makeUnsafe<
      { publicKey: string; compatibility: ServerCompatibility },
      RemoteWorkflowError
    >();
    const verifyIdentity = vi.fn(() => Deferred.await(identity));
    const { direct } = routes(webRtcServer(), { verifyIdentity });
    const callers = [Effect.runPromise(direct.tryActivate(HOST)), Effect.runPromise(direct.tryActivate(HOST))];
    await vi.waitFor(() => expect(verifyIdentity).toHaveBeenCalledOnce());
    Deferred.doneUnsafe(identity, Effect.fail(new RemoteWorkflowError({ cause: new Error("refused") })));
    expect(await Promise.all(callers)).toEqual([false, false]);
    expect(verifyIdentity).toHaveBeenCalledOnce();
    expect(direct.status(webRtcServer()).hint).toBe("failed");
  });

  it("answers WebRTC to waiting callers when the attempt is interrupted, and allows the next one", async () => {
    const createTicket = vi.fn(() => Effect.never);
    const { direct } = routes(webRtcServer(), { createTicket });
    const fiber = Effect.runFork(direct.tryActivate(HOST));
    await vi.waitFor(() => expect(createTicket).toHaveBeenCalledOnce());
    const waiting = Effect.runPromise(direct.tryActivate(HOST));
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(await waiting).toBe(false);
    expect(await Effect.runPromise(direct.awaitAttempt(HOST))).toBeUndefined();
  });
});

describe("RemoteDirectRoutes with kept sessions", () => {
  let directory = "";
  // Across runs, so that each sign-in gives another token.
  let issued = 0;
  const DAY = 24 * 60 * 60_000;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = "";
  });

  /** One run of the app: a new store object over the same file, as after a restart. */
  async function run(
    principal: { id: string | null },
    overrides: Partial<RemoteDirectRoutesOptions> & { server?: StoredRemoteServer; valid?: Set<string> } = {},
  ) {
    directory ||= await mkdtemp(join(tmpdir(), "openbot-direct-route-"));
    const store = new RemoteDirectSessionStore({
      path: join(directory, "sessions.bin"),
      canPersist: () => true,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
    });
    const sessions: DirectSessionPersistence = {
      principalId: () => principal.id,
      read: (principalId, serverId) => store.load().pipe(Effect.map(() => store.get(principalId, serverId))),
      write: (principalId, serverId, session) => store.set(principalId, serverId, session),
      remove: (serverId) => store.delete(serverId),
      clear: () => store.clear(),
    };
    const valid = overrides.valid ?? new Set<string>();
    const result = routes(overrides.server ?? webRtcServer(), {
      sessions,
      signIn: () =>
        Effect.sync(() => {
          issued += 1;
          const sessionToken = `direct-token-${issued}`;
          valid.add(sessionToken);
          return { sessionToken, sessionExpiresAt: new Date(Date.now() + DAY).toISOString() };
        }),
      checkSession: (_apiUrl, token) => Effect.succeed(valid.has(token) ? "valid" : "rejected"),
      ...overrides,
    });
    return { ...result, store, valid };
  }

  async function keptToken(store: RemoteDirectSessionStore, principalId: string): Promise<string | null> {
    await Effect.runPromise(store.load());
    return store.get(principalId, HOST)?.token ?? null;
  }

  it("uses the kept session after a restart: the host key is checked, and no ticket or sign-in follows", async () => {
    const principal = { id: "user-1" };
    const valid = new Set<string>();
    const first = await run(principal, { valid });
    expect(await Effect.runPromise(first.direct.tryActivate(HOST))).toBe(true);
    expect(first.steps).toEqual([`identity ${DIRECT}`, "ticket"]);
    const token = first.direct.token(first.direct.require(HOST));
    first.direct.clear();

    const checked: string[] = [];
    const second = await run(principal, {
      valid,
      checkSession: (apiUrl, token) =>
        Effect.sync(() => {
          checked.push(`${apiUrl} ${token}`);
          return valid.has(token) ? "valid" : "rejected";
        }),
    });
    expect(await Effect.runPromise(second.direct.tryActivate(HOST))).toBe(true);
    expect(second.steps).toEqual([`identity ${DIRECT}`]);
    expect(checked).toEqual([`${DIRECT} ${token}`]);
    expect(second.direct.token(second.direct.require(HOST))).toBe(token);
  });

  it("sends no kept token to an address that answers with another host key", async () => {
    const principal = { id: "user-1" };
    const valid = new Set<string>();
    const first = await run(principal, { valid });
    await Effect.runPromise(first.direct.tryActivate(HOST));
    const token = first.direct.token(first.direct.require(HOST));
    const checkSession = vi.fn(() => Effect.succeed("valid" as const));
    const second = await run(principal, {
      valid,
      checkSession,
      verifyIdentity: () => Effect.succeed({ publicKey: "another-key", compatibility }),
    });
    expect(await Effect.runPromise(second.direct.tryActivate(HOST))).toBe(false);
    expect(checkSession).not.toHaveBeenCalled();
    // The host may be back with its own key later: the session stays kept.
    expect(await keptToken(second.store, "user-1")).toBe(token);
  });

  it("signs in once when the host no longer accepts the kept session, and keeps the new one", async () => {
    const principal = { id: "user-1" };
    const first = await run(principal);
    await Effect.runPromise(first.direct.tryActivate(HOST));
    const old = first.direct.token(first.direct.require(HOST));
    // The host restarted: its sessions are gone.
    const checked: string[] = [];
    const valid = new Set<string>();
    const second = await run(principal, {
      valid,
      checkSession: (_apiUrl, token) =>
        Effect.sync(() => {
          checked.push(token);
          return valid.has(token) ? "valid" : "rejected";
        }),
    });
    expect(await Effect.runPromise(second.direct.tryActivate(HOST))).toBe(true);
    expect(checked).toEqual([old]);
    expect(second.steps).toEqual([`identity ${DIRECT}`, "ticket"]);
    const renewed = second.direct.token(second.direct.require(HOST));
    expect(renewed).not.toBe(old);
    expect(await keptToken(second.store, "user-1")).toBe(renewed);
  });

  it("keeps the session and uses WebRTC when the check fails for another reason", async () => {
    const principal = { id: "user-1" };
    const valid = new Set<string>();
    const first = await run(principal, { valid });
    await Effect.runPromise(first.direct.tryActivate(HOST));
    const token = first.direct.token(first.direct.require(HOST));
    const second = await run(principal, {
      valid,
      checkSession: () => Effect.fail(new RemoteWorkflowError({ cause: new Error("timed out") })),
    });
    expect(await Effect.runPromise(second.direct.tryActivate(HOST))).toBe(false);
    expect(second.steps).toEqual([`identity ${DIRECT}`]);
    expect(await keptToken(second.store, "user-1")).toBe(token);
  });

  it("does not use a session of another account", async () => {
    const valid = new Set<string>();
    const first = await run({ id: "user-1" }, { valid });
    await Effect.runPromise(first.direct.tryActivate(HOST));
    const checkSession = vi.fn(() => Effect.succeed("valid" as const));
    const second = await run({ id: "user-2" }, { valid, checkSession });
    expect(await Effect.runPromise(second.direct.tryActivate(HOST))).toBe(true);
    expect(checkSession).not.toHaveBeenCalled();
    expect(second.steps).toEqual([`identity ${DIRECT}`, "ticket"]);
    expect(await keptToken(second.store, "user-2")).toBe(second.direct.token(second.direct.require(HOST)));
    expect(await keptToken(second.store, "user-1")).toBeNull();
  });

  it("keeps nothing while no account is signed in", async () => {
    const first = await run({ id: null });
    expect(await Effect.runPromise(first.direct.tryActivate(HOST))).toBe(true);
    const second = await run({ id: "user-1" });
    await Effect.runPromise(second.store.load());
    expect(second.store.get("user-1", HOST)).toBeNull();
  });

  it("does not keep or use a session when the account changes during the attempt", async () => {
    const principal: { id: string | null } = { id: "user-1" };
    const first = await run(principal, {
      createTicket: () =>
        Effect.sync(() => {
          principal.id = "user-2";
          return "account-ticket";
        }),
    });
    expect(await Effect.runPromise(first.direct.tryActivate(HOST))).toBe(false);
    expect(first.direct.isActive(HOST)).toBe(false);
    expect(await keptToken(first.store, "user-1")).toBeNull();
    expect(await keptToken(first.store, "user-2")).toBeNull();
  });

  it("waits for the account at startup, then uses its kept session", async () => {
    const principal: { id: string | null } = { id: "user-1" };
    const valid = new Set<string>();
    const first = await run(principal, { valid });
    expect(await Effect.runPromise(first.direct.tryActivate(HOST))).toBe(true);
    first.direct.clear();

    // The next start: the account is still loading when the attempt begins.
    principal.id = null;
    const loaded = Deferred.makeUnsafe<void>();
    const accountReady = vi.fn(() => Deferred.await(loaded));
    const second = await run(principal, { valid, accountReady });
    const attempt = Effect.runPromise(second.direct.tryActivate(HOST));
    await vi.waitFor(() => expect(accountReady).toHaveBeenCalledOnce());
    expect(second.steps).toEqual([]);
    principal.id = "user-1";
    Deferred.doneUnsafe(loaded, Effect.void);
    expect(await attempt).toBe(true);
    // The kept session: the key is checked, and no ticket follows.
    expect(second.steps).toEqual([`identity ${DIRECT}`]);
  });

  it("does not fail when the account was not known at the start and loads during the attempt", async () => {
    const principal: { id: string | null } = { id: null };
    const first = await run(principal, {
      createTicket: () =>
        Effect.sync(() => {
          principal.id = "user-1";
          return "account-ticket";
        }),
    });
    expect(await Effect.runPromise(first.direct.tryActivate(HOST))).toBe(true);
    expect(first.direct.status(webRtcServer())).toMatchObject({ active: true, hint: null });
    // Nothing is kept: the attempt did not know which account it was for.
    expect(await keptToken(first.store, "user-1")).toBeNull();
  });

  it("signs in again for a session close to its end, or one for another address", async () => {
    const principal = { id: "user-1" };
    const valid = new Set<string>();
    const first = await run(principal, { valid });
    await Effect.runPromise(first.direct.tryActivate(HOST));

    const late = Date.now() + DAY - DIRECT_REFRESH_MARGIN_MS + 1_000;
    const checkSession = vi.fn(() => Effect.succeed("valid" as const));
    const second = await run(principal, { valid, checkSession, now: () => late });
    expect(await Effect.runPromise(second.direct.tryActivate(HOST))).toBe(true);
    expect(checkSession).not.toHaveBeenCalled();
    expect(second.steps).toEqual([`identity ${DIRECT}`, "ticket"]);

    const moved = "https://studio-mac-1.tail4b2c1.ts.net";
    const third = await run(principal, {
      valid,
      checkSession,
      server: webRtcServer({ directUrl: moved }),
      localTailscale: () => Effect.succeed({ ...connected, peerDnsNames: ["studio-mac-1.tail4b2c1.ts.net"] }),
    });
    expect(await Effect.runPromise(third.direct.tryActivate(HOST))).toBe(true);
    expect(checkSession).not.toHaveBeenCalled();
    expect(third.steps).toEqual([`identity ${moved}`, "ticket"]);
    await Effect.runPromise(third.store.load());
    expect(third.store.get("user-1", HOST)?.url).toBe(moved);
  });

  it("does not use a session that was forgotten, even before its removal is written", async () => {
    const principal = { id: "user-1" };
    const valid = new Set<string>();
    const first = await run(principal, { valid });
    await Effect.runPromise(first.direct.tryActivate(HOST));
    first.direct.deactivate(HOST, false);
    // The removal is not run yet: only the flag set by the call guards the next attempt.
    first.direct.forgetSession(HOST);
    expect(await Effect.runPromise(first.direct.tryActivate(HOST))).toBe(true);
    expect(first.steps).toEqual([`identity ${DIRECT}`, "ticket", `identity ${DIRECT}`, "ticket"]);
  });

  it("forgets every kept session at once", async () => {
    const principal = { id: "user-1" };
    const first = await run(principal);
    await Effect.runPromise(first.direct.tryActivate(HOST));
    await Effect.runPromise(first.direct.forgetAllSessions());
    expect(await keptToken((await run(principal)).store, "user-1")).toBeNull();
  });
});
