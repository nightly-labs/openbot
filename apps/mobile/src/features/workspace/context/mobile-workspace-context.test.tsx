import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { remoteHostFingerprint } from "@openbot/team-client";
import type { RemoteTeamConnectionUpdate } from "@openbot/team-client/remote-peer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type PropsWithChildren, useImperativeHandle, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteTeamTransportRef } from "../components/remote-team-transport";
import { MobileWorkspaceProvider, useMobileWorkspace } from "./mobile-workspace-context";

const native = vi.hoisted(() => ({
  state: "active",
  listeners: new Set<(state: string) => void>(),
  storage: new Map<string, string>(),
}));
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
        request: async <T,>(_method: string, path: string, decode: (value: unknown) => T): Promise<T> => {
          if (path === TEAM_API_ROUTES.compatibility)
            return decode({ appVersion: "test", protocol: { minimum: 3, maximum: 3 }, capabilities: [] });
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
  reconnectSnapshot = null;
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
    expect(current.activityByServer[host.hostId]).toEqual({
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
    expect(current.activityByServer[host.hostId]).toEqual({});
  },
);
