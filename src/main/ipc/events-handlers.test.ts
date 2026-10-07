import { Effect } from "effect";
// @vitest-environment node

import { IPC_ENDPOINTS, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { EVENTS_CAPABILITY, EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import { describe, expect, it, vi } from "vitest";
import { type HostEventsApi, HostEventsFailure } from "../host-events-api";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
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
  const requests: { serverId: string; path: string; init?: RemoteRequestInit }[] = [];
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
