import { Effect } from "effect";
// @vitest-environment node

import { IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { ROUTINE_FLOWS_CAPABILITY, ROUTINE_FLOWS_ROUTES } from "@openbot/contracts/team-protocol/routine-flows-v1";
import { sourceText } from "@openbot/i18n/source";
import { describe, expect, it, vi } from "vitest";
import type { RoutineFlowsHandle } from "../../backend/routine-flows/routine-flows";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { registerIpcGroup } from "./define-ipc-group";
import { routineFlowIpcHandlers } from "./routine-flow-handlers";

type Invoke = (event: unknown, request: unknown) => unknown;

const { bound } = vi.hoisted(() => ({ bound: new Map<string, Invoke>() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, invoke: Invoke) => bound.set(channel, invoke) },
}));

const TRUSTED_EVENT = { senderFrame: { url: "openbot-app://app/index.html" } };
const LINK = {
  id: "link-1",
  routineId: "routine-1",
  fromAgentId: "chief",
  toAgentId: "writer",
  instruction: "",
  createdAt: "2026-10-08T09:00:00.000Z",
};

function setup(capable: boolean) {
  bound.clear();
  const requests: { serverId: string; path: string; init?: RemoteRequestInit | undefined }[] = [];
  const remoteServers = {
    supportsCapability: (_serverId: string, capability: typeof ROUTINE_FLOWS_CAPABILITY) =>
      capable && capability === ROUTINE_FLOWS_CAPABILITY,
    request: <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit) =>
      Effect.sync(() => {
        requests.push({ serverId, path, init });
        return decoder(LINK);
      }),
  };
  const unused = () => Effect.die(new Error("A joined server never reaches the local runtime."));
  const routineFlows: RoutineFlowsHandle = {
    canvas: unused,
    savePosition: unused,
    removePosition: unused,
    connect: unused,
    disconnect: unused,
    updateLink: unused,
    agentsOf: unused,
    sweep: unused,
    notice: unused,
    close: unused,
  };
  registerIpcGroup("routineFlows", routineFlowIpcHandlers({ routineFlows, remoteServers }).routineFlows);
  const invoke = async (channel: string, payload: unknown) => {
    const handler = bound.get(channel);
    if (!handler) throw new Error(`${channel} was not registered.`);
    return handler(TRUSTED_EVENT, { serverId: "remote-1", payload });
  };
  return { requests, invoke };
}

describe("routineFlowIpcHandlers on a joined server", () => {
  const connect = { routineId: "routine-1", fromAgentId: "chief", toAgentId: "writer" };

  it("refuses a host without routine-flows-v1 before any request", async () => {
    const oldHost = setup(false);
    await expect(oldHost.invoke(IPC_ENDPOINTS.routineFlows.connect.channel, connect)).rejects.toThrow(
      sourceText("error.team.routineFlowsUnsupported"),
    );
    expect(oldHost.requests).toEqual([]);
  });

  it("sends the frozen path and the parsed input to a host that has it", async () => {
    const capable = setup(true);
    await expect(capable.invoke(IPC_ENDPOINTS.routineFlows.connect.channel, connect)).resolves.toEqual(LINK);
    expect(capable.requests).toEqual([
      { serverId: "remote-1", path: ROUTINE_FLOWS_ROUTES.connect, init: { method: "POST", body: connect } },
    ]);
  });
});
