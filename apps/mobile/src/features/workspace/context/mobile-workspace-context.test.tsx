import type { AgentEvent, ChannelSummary, SidebarLayoutSnapshot, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { remoteHostFingerprint } from "@openbot/team-client";
import type { RemoteTeamConnectionUpdate } from "@openbot/team-client/remote-peer";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, type PropsWithChildren, useImperativeHandle, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteTeamTransportRef } from "../components/remote-team-transport";
import { mobileSidebarItems } from "../model/sidebar-layout";
import { MobileWorkspaceProvider, useMobileWorkspace } from "./mobile-workspace-context";

const native = vi.hoisted(() => ({
  state: "active",
  listeners: new Set<(state: string) => void>(),
  storage: new Map<string, string>(),
}));
const sent = vi.hoisted((): { method: string; path: string; body: unknown }[] => []);
const host = {
  hostId: "host",
  name: "Desktop",
  logoKey: null,
  devicePublicKey: "trusted-key",
  membershipId: "membership",
  role: "owner",
};
const session = {
  apiUrl: "https://account.example.com",
  sessionToken: "test-token",
  user: { id: "user", name: "User", email: "user@example.com", avatarUrl: null },
  host: { hostId: host.hostId, fingerprint: remoteHostFingerprint(host.devicePublicKey) },
};
vi.mock("@/features/auth/context/mobile-session-context", () => ({
  useMobileSession: () => ({ session, sessionScope: 1 }),
}));
// Native storage, lifecycle, and the DOM bridge have no runtime in this React harness.
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Alert: { alert: () => {} },
  AppState: {
    get currentState() {
      return native.state;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      native.listeners.add(listener);
      return { remove: () => native.listeners.delete(listener) };
    },
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo/fetch", () => ({ fetch: async () => Response.json({ hosts: [host] }) }));
vi.mock("expo-secure-store", () => ({
  getItem: (key: string) => native.storage.get(key) ?? null,
  setItem: (key: string, value: string) => native.storage.set(key, value),
  getItemAsync: async (key: string) => native.storage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    native.storage.set(key, value);
  },
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
}));
let sidebarSupported = false;
const initialLayout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    { id: "work", name: "Work" },
    { id: "empty", name: "Empty" },
  ],
  order: ["people", "work", "empty", "unassigned"],
  agentAssignments: { working: "work", waiting: "work" },
  agentOrder: ["waiting", "working"],
};
const sidebarRequest = vi.fn(
  async (_method: string, _body?: TeamProtocolV2Json): Promise<SidebarLayoutSnapshot> => initialLayout,
);
let emit = (_event: AgentEvent | TeamRealtimeEvent) => {};
let disconnect = () => {};
let reconnectSnapshot: AgentEvent | null = null;
vi.mock("../components/remote-team-transport", () => ({
  RemoteTeamTransport: ({
    ref,
    onTeamEvent,
    onConnectionUpdate,
  }: {
    ref: React.Ref<RemoteTeamTransportRef>;
    onTeamEvent(hostId: string, event: AgentEvent | TeamRealtimeEvent): void;
    onConnectionUpdate(update: RemoteTeamConnectionUpdate): void;
  }) => {
    const callbacks = useRef({ onTeamEvent, onConnectionUpdate });
    callbacks.current = { onTeamEvent, onConnectionUpdate };
    useImperativeHandle(
      ref,
      () => ({
        connect: async (hostId: string) => {
          emit = (event) => callbacks.current.onTeamEvent(hostId, event);
          disconnect = () => callbacks.current.onConnectionUpdate({ hostId, state: "offline", message: null });
          if (reconnectSnapshot) emit(reconnectSnapshot);
        },
        disconnect: async () => {},
        request: async <T,>(
          method: string,
          path: string,
          decode: (value: unknown) => T,
          body?: TeamProtocolV2Json,
        ): Promise<T> => {
          sent.push({ method, path, body });
          if (path === TEAM_API_ROUTES.agent.interrupt("working")) return decode({});
          if (path === TEAM_API_ROUTES.sidebarLayout.state || path === TEAM_API_ROUTES.sidebarLayout.actions)
            return decode(await sidebarRequest(method, body));
          if (path === TEAM_API_ROUTES.compatibility)
            return decode({
              appVersion: "test",
              protocol: { minimum: 3, maximum: 3 },
              capabilities: sidebarSupported ? ["sidebar-layout"] : [],
            });
          if (path === TEAM_API_ROUTES.agents.all)
            return decode(
              ["working", "waiting"].map((id) => ({
                id,
                name: id,
                title: "",
                description: "",
                preview: "",
                updatedAt: null,
                avatarSeed: "first-bot",
                avatarHue: null,
              })),
            );
          if (path === TEAM_API_ROUTES.agents.conversationReads) return decode({});
          throw new Error(`Unexpected request: ${path}`);
        },
      }),
      [],
    );
    return null;
  },
}));

let current: ReturnType<typeof useMobileWorkspace>;
function Workspace() {
  current = useMobileWorkspace();
  return null;
}
const container = document.createElement("div");
let root = createRoot(container);
const queryClient = new QueryClient();
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  queryClient.clear();
  native.state = "active";
  native.storage.clear();
  sent.length = 0;
  reconnectSnapshot = null;
  sidebarSupported = false;
  sidebarRequest.mockReset();
  sidebarRequest.mockResolvedValue(initialLayout);
});

it.each(["foreground", "manual"])(
  "preserves waiting and working activity during a healthy %s refresh",
  async (reason) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MobileWorkspaceProvider>
            <Workspace />
          </MobileWorkspaceProvider>
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      emit({ type: "turn-started", agentId: "working", threadId: "thread", turnId: "running-turn" });
      emit({
        type: "approval",
        approval: {
          agentId: "waiting",
          threadId: "thread",
          turnId: "waiting-turn",
          requestId: "request",
          kind: "command",
          command: "pwd",
          cwd: null,
          reason: null,
          grantRoot: null,
          permissions: null,
        },
      });
    });
    if (reason === "foreground") {
      await act(async () => {
        native.state = "background";
        for (const listener of native.listeners) listener("background");
      });
      await act(async () => {
        native.state = "active";
        for (const listener of native.listeners) listener("active");
      });
    } else await act(async () => current.refreshServer(host.hostId));
    expect(current.liveState.get().activityByServer[host.hostId]).toEqual({
      working: { turnId: "running-turn", phase: "working", detail: null },
      waiting: { turnId: "waiting-turn", phase: "waiting", detail: null },
    });

    // A real replacement receives an authoritative snapshot, which clears finished work.
    reconnectSnapshot = {
      type: "runtime-snapshot",
      snapshot: {
        agents: [],
        activeTurns: [],
        work: [],
        latestMessages: [],
        attentionComplete: true,
        pendingPrompts: [],
        pendingApprovals: [],
        pendingBrowserTakeovers: [],
        failedTurns: [],
      },
    };
    await act(async () => disconnect());
    expect(current.liveState.get().activityByServer[host.hostId]).toEqual({});
  },
);

it.each(["memories", "routines"] as const)("refreshes active channel %s after a remote edit", async (section) => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MobileWorkspaceProvider>
          <Workspace />
        </MobileWorkspaceProvider>
      </QueryClientProvider>,
    ),
  );
  let records = ["original"];
  const key = ["channel-info", session.apiUrl, session.user.id, 1, host.hostId, "channel", section];
  const read = vi.fn(async () => records);
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: read, staleTime: Infinity });
  const close = observer.subscribe(() => {});
  await observer.refetch();
  const reads = read.mock.calls.length;
  await act(async () => emit({ type: "channels-changed", channelId: "channel", revision: 1 }));
  expect(read).toHaveBeenCalledTimes(reads);
  const otherKey = [...key.slice(0, 5), "other-channel", section];
  queryClient.setQueryData(otherKey, ["unchanged"]);
  records = [];
  await act(async () =>
    emit({
      type: section === "memories" ? "channel-memories-changed" : "channel-routines-changed",
      channelId: "channel",
    }),
  );
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual([]));
  expect(queryClient.getQueryData(otherKey)).toEqual(["unchanged"]);
  expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  close();
});

async function mountSidebar() {
  sidebarSupported = true;
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MobileWorkspaceProvider>
          <Workspace />
        </MobileWorkspaceProvider>
      </QueryClientProvider>,
    ),
  );
}
function sidebarRows() {
  return mobileSidebarItems(current.sidebarByServer.host?.layout ?? null, current.activeAgents, []).map(
    (item) => item.id,
  );
}

it("loads host sections and agent order, applies desktop events, and reloads after remount", async () => {
  await mountSidebar();
  expect(sidebarRows()).toEqual(["work", "waiting", "working", "empty"]);
  const changed: SidebarLayoutSnapshot = {
    ...initialLayout,
    revision: 2,
    order: ["empty", "unassigned", "work", "people"],
    agentAssignments: { working: "work" },
  };
  await act(async () => emit({ type: "sidebar-layout-changed", layout: changed }));
  expect(sidebarRows()).toEqual(["empty", "unassigned", "waiting", "work", "working"]);
  await act(async () => emit({ type: "sidebar-layout-changed", layout: initialLayout }));
  expect(current.sidebarByServer.host?.layout).toEqual(changed);
  sidebarRequest.mockResolvedValue(changed);
  await act(async () => current.refreshServer("host"));
  expect(sidebarRows()).toEqual(["empty", "unassigned", "waiting", "work", "working"]);
  await act(async () => root.unmount());
  root = createRoot(container);
  await mountSidebar();
  expect(current.sidebarByServer.host?.layout).toEqual(changed);
});

it("sends section actions to the chosen host and keeps a newer event over an action response", async () => {
  await mountSidebar();
  const changed = {
    ...initialLayout,
    revision: 3,
    sections: [
      { id: "work", name: "Renamed" },
      { id: "empty", name: "Empty" },
    ],
  };
  sidebarRequest.mockImplementationOnce(async () => {
    emit({ type: "sidebar-layout-changed", layout: changed });
    return { ...initialLayout, revision: 2 };
  });
  await act(async () => current.mutateSidebarLayout("host", { type: "rename", sectionId: "work", name: "Renamed" }));
  expect(sidebarRequest).toHaveBeenLastCalledWith("POST", { type: "rename", sectionId: "work", name: "Renamed" });
  expect(current.sidebarByServer.host?.layout).toEqual(changed);
  await expect(current.mutateSidebarLayout("other-host", { type: "delete", sectionId: "work" })).rejects.toThrow(
    "does not support",
  );
  sidebarRequest.mockRejectedValueOnce(new Error("Save failed"));
  await act(async () => {
    await expect(current.mutateSidebarLayout("host", { type: "delete", sectionId: "work" })).rejects.toThrow(
      "Save failed",
    );
  });
  expect(current.sidebarByServer.host?.layout).toEqual(changed);
});

it("keeps chats visible on layout failure and recovers on retry", async () => {
  sidebarRequest.mockRejectedValueOnce(new Error("Layout unavailable"));
  await mountSidebar();
  expect(current.sidebarByServer.host?.error).toBeTruthy();
  expect(sidebarRows()).toEqual(["working", "waiting"]);
  await act(async () => current.refreshServer("host"));
  expect(current.sidebarByServer.host?.error).toBeNull();
  expect(sidebarRows()).toEqual(["work", "waiting", "working", "empty"]);
});

it("returns chats to Agents on section deletion and supports unassignment", async () => {
  await mountSidebar();
  const unassigned = { ...initialLayout, revision: 2, agentAssignments: { waiting: "work" } };
  sidebarRequest.mockResolvedValueOnce(unassigned);
  await act(async () => current.mutateSidebarLayout("host", { type: "assign", agentId: "working", sectionId: null }));
  expect(sidebarRows()).toEqual(["work", "waiting", "empty", "unassigned", "working"]);
  const deleted = { ...unassigned, revision: 3, sections: [], order: ["people", "unassigned"], agentAssignments: {} };
  await act(async () => emit({ type: "sidebar-layout-changed", layout: deleted }));
  expect(sidebarRows()).toEqual(["unassigned", "waiting", "working"]);
});

it("mixes channels and agents in the host order and retains new and orphaned chats", async () => {
  await mountSidebar();
  const channel: ChannelSummary = {
    id: "channel",
    name: "Planning",
    title: "",
    instructions: "",
    members: [],
    leadAgentId: null,
    archived: false,
    revision: 1,
    createdAt: "2026-09-21T00:00:00Z",
    unreadCount: 0,
    activeTasks: 0,
    lastMessage: null,
  };
  const layout = {
    ...initialLayout,
    agentOrder: ["waiting", "channel"],
    agentAssignments: { waiting: "work", channel: "work", working: "deleted" },
  };
  expect(mobileSidebarItems(layout, current.activeAgents, [channel]).map((item) => item.id)).toEqual([
    "work",
    "waiting",
    "channel",
    "empty",
    "unassigned",
    "working",
  ]);
  const many = Array.from({ length: 2000 }, (_, index) => ({ ...channel, id: `channel-${index}` }));
  const largeLayout = { ...initialLayout, agentAssignments: {}, agentOrder: many.map((item) => item.id).reverse() };
  expect(
    mobileSidebarItems(largeLayout, [], many)
      .filter((item) => item.kind === "channel")
      .map((item) => item.id),
  ).toEqual(largeLayout.agentOrder);
});

it("keeps a desktop event that arrives during a layout read", async () => {
  const newer = { ...initialLayout, revision: 4, agentOrder: ["working", "waiting"] };
  sidebarRequest.mockImplementationOnce(async () => {
    emit({ type: "sidebar-layout-changed", layout: newer });
    return initialLayout;
  });
  await mountSidebar();
  expect(sidebarRows()).toEqual(["work", "working", "waiting", "empty"]);
});

it("sends section reorder actions and uses the returned order", async () => {
  await mountSidebar();
  const reordered = { ...initialLayout, revision: 2, order: ["people", "empty", "work", "unassigned"] };
  sidebarRequest.mockResolvedValueOnce(reordered);
  await act(async () =>
    current.mutateSidebarLayout("host", { type: "move", sectionId: "empty", direction: "up", steps: 1 }),
  );
  expect(sidebarRequest).toHaveBeenLastCalledWith("POST", {
    type: "move",
    sectionId: "empty",
    direction: "up",
    steps: 1,
  });
  expect(sidebarRows()).toEqual(["empty", "work", "waiting", "working"]);
});

it("stops a running turn through the interrupt route", async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MobileWorkspaceProvider>
          <Workspace />
        </MobileWorkspaceProvider>
      </QueryClientProvider>,
    ),
  );
  await act(async () => current.interruptTurn("working", "running-turn", host.hostId));
  expect(sent.at(-1)).toEqual({
    method: "POST",
    path: TEAM_API_ROUTES.agent.interrupt("working"),
    body: { turnId: "running-turn" },
  });
});
