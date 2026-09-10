import { RemoteTeamDirectoryClient } from "@openbot/team-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileConversationStore } from "../workspace/model/conversation-store";
import type { MobileWorkspaceContextValue } from "../workspace/model/workspace-types";
import { MobileAnalytics, type MobileAnalyticsClient } from "./analytics-core";
import { MobileConnectionAnalytics } from "./connection";
import { MobileConversationAnalytics } from "./conversation";
import { sanitizeMobileEvent } from "./events";

const native = vi.hoisted(
  (): { stored: string | null; readFails: boolean; writeFails: boolean; active: Set<(state: string) => void> } => ({
    stored: null,
    readFails: false,
    writeFails: false,
    active: new Set<(state: string) => void>(),
  }),
);
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      native.active.add(listener);
      return { remove: () => native.active.delete(listener) };
    },
  },
}));
vi.mock("expo-application", () => ({
  nativeApplicationVersion: "1.0.0",
  nativeBuildVersion: "42",
  getInstallReferrerAsync: async () => "https://private.example/?token=secret-referrer",
}));
vi.mock("expo-constants", () => ({ default: { getWebViewUserAgentAsync: async () => "test-native-agent" } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => {
    if (native.readFails) throw new Error("Storage unavailable");
    return native.stored;
  },
  setItemAsync: async (_: string, value: string) => {
    if (native.writeFails) throw new Error("Storage unavailable");
    native.stored = value;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("__DEV__", false);
  vi.stubEnv("EXPO_PUBLIC_APP_ENV", "production");
  vi.stubEnv("EXPO_PUBLIC_OPENPANEL_CLIENT_ID", "test-mobile-client");
  vi.stubEnv("EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET", "test-write-credential");
  native.stored = null;
  native.readFails = false;
  native.writeFails = false;
  native.active.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function clientFixture() {
  let profileId: string | null = null;
  const events: { name: string; profileId: string | null; properties: object }[] = [];
  const client: MobileAnalyticsClient = {
    track: (name, properties) => {
      events.push({ name, profileId, properties });
    },
    identify: ({ profileId: id }) => {
      profileId = id;
    },
    clear: () => {
      profileId = null;
    },
  };
  const analytics = new MobileAnalytics(() => client);
  return { analytics, client, events };
}

it("removes private values, unknown enums and prototype keys at the event boundary", () => {
  expect(
    sanitizeMobileEvent("message_send", {
      result: "succeeded",
      attachment_count: 2,
      is_reply: true,
      text: "private prompt",
      agentId: "agent-secret",
      path: "/home/private",
      email: "private@example.com",
      failure_code: "raw error with token",
      model: "private model with token",
      provider: "private-provider",
      constructor: "private constructor",
      toString: "private method",
      duration_ms: Infinity,
    }),
  ).toEqual({ result: "succeeded", attachment_count: 2, is_reply: true });
});

it("preserves accepted events under their original account and drops late operation results", async () => {
  const { analytics, events } = clientFixture();
  analytics.setEnabled(true);
  analytics.track("mobile_pairing_action", { action: "redeem", result: "succeeded" });
  analytics.setUser({ id: "first", email: "first@example.com" });
  analytics.track("message_send", { result: "succeeded" });
  const oldScope = analytics.scope();
  analytics.setUser({ id: "second", email: "second@example.com" });
  oldScope.track("message_send", { result: "failed" });
  analytics.track("usage_viewed", {});
  analytics.track("account_sign_out", { result: "succeeded" });
  analytics.setUser(null);
  analytics.track("mobile_app_opened", { kind: "foreground", signed_in: false });
  await analytics.settled();
  expect(events.map(({ name, profileId }) => [name, profileId])).toEqual([
    ["mobile_pairing_action", null],
    ["message_send", "first"],
    ["usage_viewed", "second"],
    ["account_sign_out", "second"],
    ["mobile_app_opened", null],
  ]);
});

it("drops pending events and disabled scopes when consent is removed, then permits new events", async () => {
  const { analytics, events } = clientFixture();
  analytics.track("usage_viewed", {});
  analytics.setEnabled(true);
  analytics.track("usage_viewed", {});
  const old = analytics.scope();
  analytics.setEnabled(false);
  const disabled = analytics.scope();
  analytics.setEnabled(true);
  old.track("usage_viewed", {});
  disabled.track("usage_viewed", {});
  analytics.track("message_send", { result: "succeeded" });
  await analytics.settled();
  expect(events.map((event) => event.name)).toEqual(["message_send"]);
});

it("keeps operation results and errors intact while emitting only bounded outcomes", async () => {
  const { analytics, events } = clientFixture();
  analytics.setEnabled(true);
  await expect(analytics.operation("message_send", { attachment_count: 1 }, async () => "receipt")).resolves.toBe(
    "receipt",
  );
  const error = new Error("secret token in transport error");
  await expect(
    analytics.operation("message_send", {}, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  await analytics.settled();
  expect(events.map((event) => event.properties)).toEqual([
    { attachment_count: 1, result: "succeeded", duration_ms: expect.any(Number) },
    { result: "failed", failure_code: "operation_failed", duration_ms: expect.any(Number) },
  ]);
  const broken = new MobileAnalytics(() => ({
    track: () => {
      throw error;
    },
    identify: () => undefined,
    clear: () => undefined,
  }));
  broken.setEnabled(true);
  await expect(broken.operation("message_send", {}, async () => "delivered")).resolves.toBe("delivered");
  await broken.settled();
});

it("records connection attempts and recovery without duplicate losses or background failures", async () => {
  const { analytics, events } = clientFixture();
  analytics.setEnabled(true);
  const connection = new MobileConnectionAnalytics(analytics);
  connection.attempt()("failed", "compatibility");
  connection.attempt()("succeeded", "conversations");
  connection.lost();
  connection.lost();
  connection.attempt()("succeeded", "conversations");
  connection.background();
  connection.lost();
  await analytics.settled();
  expect(events.map((event) => event.properties)).toEqual([
    {
      action: "connect",
      result: "failed",
      stage: "compatibility",
      duration_ms: expect.any(Number),
      failure_code: "connection_failed",
    },
    { action: "connect", result: "succeeded", stage: "conversations", duration_ms: expect.any(Number) },
    { action: "lost", result: "failed", failure_code: "connection_failed" },
    { action: "reconnect", result: "succeeded", stage: "conversations", duration_ms: expect.any(Number) },
  ]);
});

function captureRequests() {
  const requests: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, input: RequestInit) => {
    requests.push({ url, body: String(input.body) });
    return new Response("{}", { status: 200 });
  });
  return requests;
}

describe("installed React Native SDK", () => {
  it("uses the native endpoint and strips SDK referrers, identifiers and content from actual HTTP requests", async () => {
    const requests = captureRequests();
    const { mobileAnalytics } = await import("./mobile-analytics");
    mobileAnalytics.setUser({ id: "account-one", email: " PERSON@Example.com " });
    mobileAnalytics.setEnabled(true);
    // Android SDK refreshes its defaults on foreground, including a raw install URL.
    for (const notify of native.active) notify("active");
    mobileAnalytics.track("message_send", { result: "succeeded", channel: "agent", attachment_count: 1 });
    await mobileAnalytics.settled();
    expect(requests.map((request) => request.url)).toEqual([
      "https://analytics.openbot.run/api/track",
      "https://analytics.openbot.run/api/track",
    ]);
    const bodies = requests.map((request) => JSON.parse(request.body));
    expect(bodies[0]).toEqual({
      type: "identify",
      payload: {
        profileId: "account-one",
        email: "person@example.com",
        properties: expect.objectContaining({ surface: "mobile", app_version: "1.0.0", build_number: "42" }),
      },
    });
    expect(bodies[1]).toEqual({
      type: "track",
      payload: {
        name: "message_send",
        profileId: "account-one",
        properties: {
          result: "succeeded",
          channel: "agent",
          attachment_count: 1,
          surface: "mobile",
          platform: "android",
          environment: "production",
          event_schema_version: 1,
          app_version: "1.0.0",
          build_number: "42",
          __referrer: "",
          __path: "",
        },
      },
    });
  });

  it.each(["development", "preview", "missing_credentials", "dev_runtime"])(
    "does not create network traffic for %s",
    async (mode) => {
      const requests = captureRequests();
      if (mode === "missing_credentials") vi.stubEnv("EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET", "");
      else if (mode === "dev_runtime") vi.stubGlobal("__DEV__", true);
      else vi.stubEnv("EXPO_PUBLIC_APP_ENV", mode);
      const { mobileAnalytics } = await import("./mobile-analytics");
      mobileAnalytics.setEnabled(true);
      mobileAnalytics.setUser({ id: "account", email: "a@example.com" });
      mobileAnalytics.track("usage_viewed", {});
      await mobileAnalytics.settled();
      expect(requests).toEqual([]);
    },
  );
});

it("restores opt-out after restart and supports opting back in without replay", async () => {
  const requests = captureRequests();
  const preference = await import("./preference");
  const { mobileAnalytics } = await import("./mobile-analytics");
  await preference.loadAnalyticsPreference();
  await preference.saveAnalyticsPreference(false);
  mobileAnalytics.track("usage_viewed", {});
  await mobileAnalytics.settled();
  expect(native.stored).toBe("false");
  vi.resetModules();
  const restarted = await import("./preference");
  const next = (await import("./mobile-analytics")).mobileAnalytics;
  await restarted.loadAnalyticsPreference();
  next.track("usage_viewed", {});
  await next.settled();
  expect(requests).toEqual([]);
  await restarted.saveAnalyticsPreference(true);
  next.track("usage_viewed", {});
  await next.settled();
  expect(requests).toHaveLength(1);
});

it("fails closed when preference storage is unreadable and does not enable tracking on a failed save", async () => {
  const requests = captureRequests();
  native.readFails = true;
  const preference = await import("./preference");
  const { mobileAnalytics } = await import("./mobile-analytics");
  await preference.loadAnalyticsPreference();
  mobileAnalytics.track("usage_viewed", {});
  native.writeFails = true;
  await expect(preference.saveAnalyticsPreference(true)).rejects.toThrow("Storage unavailable");
  mobileAnalytics.track("usage_viewed", {});
  await mobileAnalytics.settled();
  expect(requests).toEqual([]);
});

it("instruments message commands without sending their contents or changing the receipt", async () => {
  const requests = captureRequests();
  const { mobileAnalytics } = await import("./mobile-analytics");
  const { trackWorkspaceActions } = await import("./workspace-actions");
  mobileAnalytics.setEnabled(true);
  const unexpected = async () => {
    throw new Error("Unexpected workspace operation");
  };
  const sendMessage = vi.fn(async () => "message-receipt");
  const workspace: MobileWorkspaceContextValue = {
    servers: [],
    agents: [],
    activeAgents: [],
    hiddenAgents: [],
    pinnedAgentIds: [],
    unreadAgentIds: [],
    activityByServer: {},
    serverDirectoryState: "ready",
    serverDirectoryError: null,
    teamDirectory: new RemoteTeamDirectoryClient({ apiUrl: "https://example.com", token: "test", fetch }),
    activeServer: {
      id: "host-private",
      name: "Private host",
      kind: "remote",
      state: "online",
      initialConnectionPending: false,
      connectionMessage: null,
      address: null,
      accent: "",
      publicKey: "",
      membershipId: "",
      role: "member",
    },
    conversationStore: new MobileConversationStore(() => () => {}),
    selectServer: () => {},
    leaveServer: unexpected,
    refreshServers: unexpected,
    refreshServer: unexpected,
    addRemoteServer: unexpected,
    createAgent: unexpected,
    updateAgent: unexpected,
    deleteAgent: unexpected,
    duplicateAgent: unexpected,
    saveAgentMemory: unexpected,
    deleteAgentMemory: unexpected,
    createAgentRoutine: unexpected,
    updateAgentRoutine: unexpected,
    deleteAgentRoutine: unexpected,
    loadAgentModels: unexpected,
    loadAgentMemories: unexpected,
    loadAgentRoutines: unexpected,
    loadAgentAnalytics: unexpected,
    loadConversation: unexpected,
    loadOlderMessages: unexpected,
    respondToPrompt: unexpected,
    sendMessage,
    uploadAttachment: unexpected,
    downloadAttachment: unexpected,
    discardAttachment: unexpected,
    hideAgent: () => {},
    unhideAgent: () => {},
    markAgentRead: () => {},
    markAgentUnread: () => {},
    toggleAgentPin: () => "pinned",
  };
  const tracked = trackWorkspaceActions(workspace);
  await expect(
    tracked.sendMessage("agent-private", "private contents", ["file-private"], "reply-private"),
  ).resolves.toBe("message-receipt");
  expect(sendMessage).toHaveBeenCalledWith("agent-private", "private contents", ["file-private"], "reply-private");
  await mobileAnalytics.settled();
  expect(requests.map(({ body }) => JSON.parse(body))).toEqual([
    {
      type: "track",
      payload: {
        name: "message_send",
        properties: expect.objectContaining({
          result: "succeeded",
          attachment_count: 1,
          is_reply: true,
          channel: "agent",
          server_kind: "remote",
        }),
      },
    },
  ]);
  expect(requests[0]?.body).not.toContain("private");
});

it("stops immediately after a failed opt-out write and permits a save retry", async () => {
  const requests = captureRequests();
  const preference = await import("./preference");
  const { mobileAnalytics } = await import("./mobile-analytics");
  await preference.loadAnalyticsPreference();
  native.writeFails = true;
  await expect(preference.saveAnalyticsPreference(false)).rejects.toThrow("Storage unavailable");
  mobileAnalytics.track("usage_viewed", {});
  await mobileAnalytics.settled();
  expect(requests).toEqual([]);
  native.writeFails = false;
  await preference.saveAnalyticsPreference(false);
  expect(native.stored).toBe("false");
});

it("counts visible conversation outcomes once, including cached reads and failed loads", async () => {
  const { analytics, events } = clientFixture();
  analytics.setEnabled(true);
  const view = new MobileConversationAnalytics(analytics);
  view.update(false, true, false);
  view.update(true, false, false);
  view.update(true, true, false);
  view.update(true, true, false);
  view.update(false, true, false);
  view.update(true, true, true);
  view.update(false, false, false);
  view.update(true, false, true);
  await analytics.settled();
  expect(events.map(({ name, properties }) => ({ name, properties }))).toEqual([
    { name: "conversation_opened", properties: { result: "succeeded", duration_ms: expect.any(Number) } },
    { name: "conversation_opened", properties: { result: "succeeded", duration_ms: expect.any(Number) } },
    {
      name: "conversation_opened",
      properties: { result: "failed", duration_ms: expect.any(Number), failure_code: "load_failed" },
    },
  ]);
});
