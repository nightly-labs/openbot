import { Effect } from "effect";
// @vitest-environment node

import { IPC_ENDPOINTS, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import { EVENTS_CAPABILITY, EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type HostEventsApi, HostEventsFailure } from "../host-events-api";
import type { ResponseDecoder } from "../remote-host-decoding";
import { type RemoteRequestInit, RemoteServerClient } from "../remote-server-client";
import { RemoteServerConnections } from "../remote-server-connections";
import { storedHttpsServer, stubTeamFetch } from "../remote-server-test-harness";
import { remoteCall } from "../remote-service-effects";
import { createTeamApiFixture, stopTeamApiFixtures } from "../team-api-server-test-harness";
import { TeamWebRtcRequestError } from "../team-webrtc-client-transport";
import { registerIpcGroup } from "./define-ipc-group";
import { eventsIpcHandlers } from "./events-handlers";

type Invoke = (event: unknown, request: unknown) => unknown;

const { bound } = vi.hoisted(() => ({ bound: new Map<string, Invoke>() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, invoke: Invoke) => bound.set(channel, invoke) },
}));

const TRUSTED_EVENT = { senderFrame: { url: "openbot-app://app/index.html" } };

function unusedEvents(): HostEventsApi {
  const unused = () => Effect.fail(new HostEventsFailure({ cause: new Error("unused in this test") }));
  return {
    getStatus: () => Effect.succeed({ supported: true, connected: true }),
    listActivity: unused,
    listRoutines: unused,
    saveRoutine: unused,
    deleteRoutine: unused,
    testRoutine: unused,
    rotateSecret: unused,
  };
}

function setup(capable: boolean) {
  bound.clear();
  const requests: { serverId: string; path: string; init?: RemoteRequestInit | undefined }[] = [];
  const remoteServers = {
    supportsCapability: (_serverId: string, capability: typeof EVENTS_CAPABILITY) =>
      capable && capability === EVENTS_CAPABILITY,
    request: <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit) =>
      Effect.sync(() => {
        requests.push({ serverId, path, init });
        return decoder({ supported: true, connected: false });
      }),
  };
  registerIpcGroup("events", eventsIpcHandlers({ events: unusedEvents(), remoteServers }).events);
  const invoke = async (channel: string, serverId: string) => {
    const handler = bound.get(channel);
    if (!handler) throw new Error(`${channel} was not registered.`);
    return handler(TRUSTED_EVENT, { serverId, payload: null });
  };
  return { requests, invoke };
}

describe("eventsIpcHandlers", () => {
  it("reports an older host as unsupported without requesting a route", async () => {
    const oldHost = setup(false);
    await expect(oldHost.invoke(IPC_ENDPOINTS.events.getStatus.channel, "remote-1")).resolves.toEqual({
      supported: false,
      connected: false,
    });
    expect(oldHost.requests).toEqual([]);
  });

  it("reads local status and uses events-v1 for a supported remote host", async () => {
    const capable = setup(true);
    await expect(capable.invoke(IPC_ENDPOINTS.events.getStatus.channel, LOCAL_SERVER_ID)).resolves.toEqual({
      supported: true,
      connected: true,
    });
    await expect(capable.invoke(IPC_ENDPOINTS.events.getStatus.channel, "remote-1")).resolves.toEqual({
      supported: true,
      connected: false,
    });
    expect(capable.requests).toEqual([
      { serverId: "remote-1", path: EVENTS_ROUTES.status, init: { method: "POST", body: {} } },
    ]);
  });
});

// The host answers a successful delete or test with `{}`, which is what the released events-v1 codec
// (`adminRoute(routineRef, empty)`) carries. A client decoder that refused it turned every successful
// "Test" of a webhook routine into a protocol failure, and a protocol failure suspends the whole
// server connection. These run the real host route and the real client, over both transports.
describe("events-v1 over a real host", () => {
  afterEach(async () => {
    await stopTeamApiFixtures();
    vi.unstubAllGlobals();
  });

  const APP_VERSION = "0.33.0";
  const REF = { owner: { kind: "agent", id: "chief" }, id: "routine-1" } as const;

  async function connect(transport: "https" | "webrtc", events: HostEventsApi) {
    const fixture = await createTeamApiFixture(`events-ipc-${transport}`, { configure: true });
    const { base } = await fixture.start({ events });
    const token = await fixture.signIn();
    const server =
      transport === "https"
        ? storedHttpsServer("host", { apiUrl: `${base}/` })
        : storedHttpsServer("host", { transport: "webrtc-v2", apiUrl: "webrtc://host" });
    const connections = new RemoteServerConnections({
      appVersion: APP_VERSION,
      onChanged: () => undefined,
      onReconnectSuspended: () => undefined,
    });
    // What `TeamWebRtcHostPeer` and `TeamWebRtcClientTransport` do with one request between them: the
    // frozen side-route codec on both ends, and a failing status sent back as an error frame.
    const request = (_hostId: string, path: string, init: { method?: string; body?: unknown } = {}) =>
      remoteCall(async () => {
        const sideRoute = teamSideRouteCodec(path);
        const response = await fetch(`${base}${path}`, {
          method: init.method ?? "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "OpenBot-App-Version": APP_VERSION,
            "OpenBot-Protocol-Version": "7",
            "OpenBot-Capabilities": TEAM_CURRENT_CAPABILITIES.join(","),
          },
          body:
            init.body === undefined ? null : JSON.stringify(sideRoute ? sideRoute.request(path, init.body) : init.body),
        });
        const body = await response.json();
        if (!response.ok) {
          const record = isDynamicRecord(body) ? body : null;
          throw new TeamWebRtcRequestError(
            response.status,
            isString(record?.code) ? record.code : "team_api_error",
            isString(record?.error) ? record.error : `The host returned ${response.status}.`,
          );
        }
        return sideRoute ? sideRoute.response(path, response.status, body) : body;
      });
    const client = new RemoteServerClient({
      appVersion: APP_VERSION,
      servers: { require: () => server, token: () => token },
      connections,
      transport:
        transport === "webrtc"
          ? { request, requestResponse: () => Effect.die(new Error("unused in this test")) }
          : null,
    });
    bound.clear();
    return bind(client, connections, events);
  }

  function bind(client: RemoteServerClient, connections: RemoteServerConnections, events: HostEventsApi) {
    const remoteServers = {
      supportsCapability: () => true,
      request: <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit) =>
        client.request(serverId, path, decoder, init),
    };
    bound.clear();
    registerIpcGroup("events", eventsIpcHandlers({ events, remoteServers }).events);
    const invoke = (channel: string, payload: unknown) => {
      const handler = bound.get(channel);
      if (!handler) throw new Error(`${channel} was not registered.`);
      return Promise.resolve(handler(TRUSTED_EVENT, { serverId: "host", payload }));
    };
    return { invoke, issue: () => connections.statusFor("host").issue?.code ?? null };
  }

  for (const transport of ["https", "webrtc"] as const) {
    it(`keeps the ${transport} connection after a successful routine test or delete`, async () => {
      const calls: string[] = [];
      const host = await connect(transport, {
        ...unusedEvents(),
        testRoutine: () => Effect.sync(() => void calls.push("test")),
        deleteRoutine: () => Effect.sync(() => void calls.push("delete")),
      });

      await expect(host.invoke(IPC_ENDPOINTS.events.testRoutine.channel, REF)).resolves.toBeUndefined();
      await expect(host.invoke(IPC_ENDPOINTS.events.deleteRoutine.channel, REF)).resolves.toBeUndefined();
      expect(calls).toEqual(["test", "delete"]);
      expect(host.issue()).toBeNull();
      // The next call still reaches the host, which a recorded protocol failure would refuse unsent.
      await expect(host.invoke(IPC_ENDPOINTS.events.getStatus.channel, null)).resolves.toEqual({
        supported: true,
        connected: true,
      });
    });

    it(`reports a failed ${transport} routine test as a request failure, not a protocol one`, async () => {
      const expected = sourceText("error.backend.webhookRouteUnavailable");
      let cause = new Error(expected);
      const host = await connect(transport, {
        ...unusedEvents(),
        testRoutine: () => Effect.fail(new HostEventsFailure({ cause })),
      });

      await expect(host.invoke(IPC_ENDPOINTS.events.testRoutine.channel, REF)).rejects.toThrow(expected);
      cause = new Error("database failure: private detail");
      await expect(host.invoke(IPC_ENDPOINTS.events.testRoutine.channel, REF)).rejects.toThrow();
      expect(host.issue()).not.toBe("protocol_error");
      await expect(host.invoke(IPC_ENDPOINTS.events.getStatus.channel, null)).resolves.toEqual({
        supported: true,
        connected: true,
      });
    });
  }

  // The empty answer is accepted because the events-v1 codec already read it. Anything else the codec
  // refuses, so a host sending data outside the contract still stops the connection.
  it("still fails the connection closed when a routine test answers outside events-v1", async () => {
    stubTeamFetch({
      compatibility: {
        appVersion: APP_VERSION,
        protocol: { minimum: 1, maximum: 6 },
        capabilities: [EVENTS_CAPABILITY],
      },
      routes: { [EVENTS_ROUTES.testRoutine]: () => Response.json(["unexpected"]) },
    });
    const connections = new RemoteServerConnections({
      appVersion: APP_VERSION,
      onChanged: () => undefined,
      onReconnectSuspended: () => undefined,
    });
    const server = storedHttpsServer("host");
    const client = new RemoteServerClient({
      appVersion: APP_VERSION,
      servers: { require: () => server, token: () => "token" },
      connections,
      transport: null,
    });
    const host = bind(client, connections, unusedEvents());

    await expect(host.invoke(IPC_ENDPOINTS.events.testRoutine.channel, REF)).rejects.toThrow();
    expect(host.issue()).toBe("protocol_error");
  });
});
