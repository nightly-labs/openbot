// @vitest-environment node

import type { AgentEvent, AgentSummary, ServerSummary } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { BrowserWindow } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import type { AgentNotificationContent } from "./agent-notifications";
import { createRendererForwarders } from "./renderer-forwarders";

const mocks = vi.hoisted(() => {
  const state: { clickListeners: (() => void)[]; focused: boolean; desktopNotifications: boolean } = {
    clickListeners: [],
    focused: false,
    desktopNotifications: true,
  };
  return Object.assign(state, { show: vi.fn(), content: vi.fn(), send: vi.fn() });
});
vi.mock("electron", () => ({
  BrowserWindow: class {
    isDestroyed = () => false;
    isFocused = () => mocks.focused;
    webContents = {
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      mainFrame: { isDestroyed: () => false, detached: false },
      send: mocks.send,
    };
  },
  Notification: class {
    static isSupported = () => true;
    constructor(content: AgentNotificationContent) {
      mocks.content(content);
    }
    on = (name: string, listener: () => void) => {
      if (name === "click") mocks.clickListeners.push(listener);
    };
    show = mocks.show;
  },
}));

const agent: AgentSummary = {
  id: "chief",
  provider: "codex",
  name: "Local Chief",
  notifications: true,
  title: "Lead",
  description: "",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  threadId: "thread-chief",
  workspacePath: "/tmp/chief",
  preview: "",
  updatedAt: null,
  avatarSeed: "chief",
  avatarHue: null,
  avatarUrl: null,
};
const event: AgentEvent = {
  type: "turn-completed",
  agentId: "chief",
  threadId: "thread-chief",
  turnId: "turn-1",
  status: "completed",
};
function server(id: string): ServerSummary {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    state: "online",
    apiUrl: null,
    remoteDesktopAvailable: false,
    logoUrl: null,
    role: null,
    active: false,
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
  };
}
function setup() {
  const servers = [server("local"), server("alpha"), server("beta")];
  const request = vi.fn(async (_serverId: string): Promise<AgentSummary[]> => [{ ...agent, name: "Remote Chief" }]);
  let lookupSettled = Promise.resolve();
  const window = new BrowserWindow();
  const forwarders = createRendererForwarders({
    getMainWindow: () => window,
    getAgentService: () => ({ listAgents: () => [agent] }),
    getHostService: () => null,
    getHostAnalytics: () => null,
    getRemoteServerManager: () => ({
      list: () => servers,
      request: (serverId, _path, decoder) => {
        const result = request(serverId).then(decoder);
        lookupSettled = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    }),
    showMainWindow: vi.fn(),
    getTranslate: () => translateFor("en"),
    desktopNotificationsEnabled: () => mocks.desktopNotifications,
  });
  return { ...forwarders, servers, request, waitForLookup: () => lookupSettled };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.clickListeners = [];
  mocks.focused = false;
  mocks.desktopNotifications = true;
});

it("mutes only the selected server while forwarding its live events", async () => {
  const fixture = setup();
  fixture.servers[1].notificationsMuted = true;
  fixture.forwardAgentEvent("alpha", event);
  expect(mocks.send).toHaveBeenCalledWith("agent:event", { serverId: "alpha", event });
  expect(mocks.show).not.toHaveBeenCalled();
  expect(fixture.request).not.toHaveBeenCalled();
  fixture.forwardAgentEvent("beta", event);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
  expect(mocks.content).toHaveBeenLastCalledWith({ title: "Remote Chief", body: "Finished working." });
  expect(fixture.request.mock.calls[0][0]).toBe("beta");
  fixture.servers[1].notificationsMuted = false;
  fixture.forwardAgentEvent("alpha", event);
  await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2));
});

it("uses the local mute preference and local agent settings", () => {
  const fixture = setup();
  fixture.servers[0].notificationsMuted = true;
  fixture.forwardAgentEvent("local", event);
  expect(mocks.show).not.toHaveBeenCalled();
  fixture.servers[0].notificationsMuted = false;
  fixture.forwardAgentEvent("local", event);
  expect(mocks.content).toHaveBeenCalledWith({ title: "Local Chief", body: "Finished working." });
  expect(fixture.request).not.toHaveBeenCalled();
});

it.each(["mute", "remove", "focus", "agent-disabled"])(
  "rechecks notification eligibility after lookup: %s",
  async (change) => {
    const fixture = setup();
    let resolve = (_agents: (typeof agent)[]) => {};
    const promise = new Promise<(typeof agent)[]>((done) => {
      resolve = done;
    });
    fixture.request.mockReturnValue(promise);
    fixture.forwardAgentEvent("alpha", event);
    if (change === "mute") fixture.servers[1].notificationsMuted = true;
    if (change === "remove") fixture.servers.splice(1, 1);
    if (change === "focus") mocks.focused = true;
    resolve([{ ...agent, notifications: change !== "agent-disabled" }]);
    await fixture.waitForLookup();
    expect(mocks.show).not.toHaveBeenCalled();
  },
);

it("does not use local agents when the remote lookup fails", async () => {
  const fixture = setup();
  const promise = Promise.reject(new Error("offline"));
  fixture.request.mockReturnValue(promise);
  fixture.forwardAgentEvent("alpha", event);
  await fixture.waitForLookup();
  expect(mocks.show).not.toHaveBeenCalled();
});

it("stays quiet when desktop notifications are off or the server level rules the event out", () => {
  const fixture = setup();
  mocks.desktopNotifications = false;
  fixture.forwardAgentEvent("local", event);
  mocks.desktopNotifications = true;
  fixture.servers[0].notificationLevel = "nothing";
  fixture.forwardAgentEvent("local", event);
  fixture.servers[0].notificationLevel = "needs-me";
  fixture.forwardAgentEvent("local", event);
  expect(mocks.show).not.toHaveBeenCalled();
  fixture.forwardAgentEvent("local", {
    type: "prompt",
    agentId: "chief",
    threadId: "thread-chief",
    turnId: "turn-1",
    requestId: 1,
    questions: [],
  });
  expect(mocks.content).toHaveBeenCalledWith({ title: "Local Chief", body: "Needs your input." });
});

it("opens the agent's conversation when the user clicks the notification", () => {
  const fixture = setup();
  fixture.forwardAgentEvent("local", event);
  mocks.send.mockClear();
  for (const listener of mocks.clickListeners) listener();
  expect(mocks.send).toHaveBeenCalledWith("notifications:opened-event", {
    serverId: "local",
    agentId: "chief",
    threadId: "thread-chief",
  });
});
