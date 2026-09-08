import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { type RemoteRecoveryStatus, RemoteTeamDirectoryClient } from "@openbot/team-client";
import type { RemoteTeamConnectionUpdate } from "@openbot/team-client/remote-peer";
import { act, useImperativeHandle, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteTeamTransportRef } from "./remote-team-transport";
import { ServerConnection, type ServerConnectionHandle } from "./server-connection";

const endpoints = new Map<
  string,
  {
    client: RemoteTeamTransportRef;
    update(value: RemoteTeamConnectionUpdate): void;
    event(hostId: string, value: AgentEvent | TeamRealtimeEvent): void;
  }
>();
vi.mock("./remote-team-transport", () => ({
  RemoteTeamTransport: ({
    ref,
    onConnectionUpdate,
    onTeamEvent,
  }: {
    ref: React.Ref<RemoteTeamTransportRef>;
    onConnectionUpdate(value: RemoteTeamConnectionUpdate): void;
    onTeamEvent(hostId: string, value: AgentEvent | TeamRealtimeEvent): void;
  }) => {
    const callbacks = useRef({ onConnectionUpdate, onTeamEvent });
    callbacks.current = { onConnectionUpdate, onTeamEvent };
    useImperativeHandle(ref, () => {
      const client: RemoteTeamTransportRef = {
        connect: async (hostId) => {
          endpoints.set(hostId, {
            client,
            update: (value) => callbacks.current.onConnectionUpdate(value),
            event: (id, value) => callbacks.current.onTeamEvent(id, value),
          });
        },
        disconnect: async () => {},
        request: async (_method, _path, decode) => decode({ connected: true }),
      };
      return client;
    }, []);
    return null;
  },
}));

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  endpoints.clear();
  vi.useRealTimers();
});

it("keeps both memberships connected across selection, retries one failure, and removes only the left server", async () => {
  vi.useFakeTimers();
  const directory = new RemoteTeamDirectoryClient({ apiUrl: "https://example.com", token: "test", fetch });
  const handles = new Map<string, ServerConnectionHandle>();
  const states = new Map<string, RemoteRecoveryStatus["phase"]>();
  const loads: string[] = [];
  const register = (id: string, handle: ServerConnectionHandle | null) => {
    if (handle) handles.set(id, handle);
    else handles.delete(id);
  };
  const load = async (id: string, key: string, client: RemoteTeamTransportRef) => {
    loads.push(id);
    await client.connect(id, key);
  };
  const status = (id: string, value: RemoteRecoveryStatus) => {
    states.set(id, value.phase);
  };
  const events = vi.fn();
  const render = (selected: string, ids = ["local", "remote"]) =>
    root.render(
      <section aria-label={selected}>
        {ids.map((id) => (
          <ServerConnection
            key={id}
            hostId={id}
            publicKey="key"
            active
            directory={directory}
            register={register}
            load={load}
            onStatus={status}
            onTeamEvent={events}
          />
        ))}
      </section>,
    );
  await act(async () => render("local"));
  expect([...states]).toEqual([
    ["local", "online"],
    ["remote", "online"],
  ]);
  await act(async () => render("remote"));
  expect(loads).toEqual(["local", "remote"]);
  await act(async () => endpoints.get("local")?.update({ hostId: "local", state: "offline", message: null }));
  expect([...states]).toEqual([
    ["local", "waiting"],
    ["remote", "online"],
  ]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect({ loads, states: [...states] }).toEqual({
    loads: ["local", "remote", "local"],
    states: [
      ["local", "online"],
      ["remote", "online"],
    ],
  });
  await act(async () => render("remote", ["remote"]));
  expect([...handles.keys()]).toEqual(["remote"]);
});

it("refreshes membership after revocation without waiting for a foreground transition", async () => {
  const directory = new RemoteTeamDirectoryClient({ apiUrl: "https://example.com", token: "test", fetch });
  const refreshMemberships = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <ServerConnection
        hostId="revoked"
        publicKey="key"
        active
        directory={directory}
        register={() => {}}
        load={async (id, key, client) => {
          await client.connect(id, key);
        }}
        onStatus={() => {}}
        onTeamEvent={() => {}}
        onMembershipChanged={refreshMemberships}
      />,
    ),
  );
  await act(async () =>
    endpoints
      .get("revoked")
      ?.update({ hostId: "revoked", state: "offline", code: "session_revoked", message: "The remote session ended." }),
  );
  expect(refreshMemberships).toHaveBeenCalledTimes(1);
});

it("retains background failures and defers membership requests and retries until resume", async () => {
  vi.useFakeTimers();
  const directory = new RemoteTeamDirectoryClient({ apiUrl: "https://example.com", token: "test", fetch });
  const memberships = vi.fn(async () => {});
  const load = vi.fn(async (id: string, key: string, client: RemoteTeamTransportRef) => client.connect(id, key));
  const register = () => {};
  const status = vi.fn();
  const event = () => {};
  const render = (active: boolean) =>
    root.render(
      <ServerConnection
        hostId="host"
        publicKey="key"
        active={active}
        directory={directory}
        register={register}
        load={load}
        onStatus={status}
        onTeamEvent={event}
        onMembershipChanged={memberships}
      />,
    );
  await act(async () => render(true));
  await act(async () => render(false));
  await act(async () => render(true));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => render(false));
  await act(async () =>
    endpoints.get("host")?.update({ hostId: "host", state: "offline", code: "session_revoked", message: null }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(memberships).not.toHaveBeenCalled();
  await act(async () => render(true));
  expect(memberships).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(2);
  expect(status).toHaveBeenLastCalledWith("host", { phase: "online", attempt: 0, remainingSeconds: 0 }, null);
});
