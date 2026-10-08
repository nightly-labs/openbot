// @vitest-environment node

import type { ServerCompatibility } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIRECT_RETRY_AFTER_MS,
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

    const off = routes(webRtcServer(), { localTailscale: () => Effect.succeed({ kind: "signed-out" }) });
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
});
