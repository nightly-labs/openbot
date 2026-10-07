import { Effect } from "effect";
// @vitest-environment node

import {
  type AgentSummary,
  type ConversationMessage,
  hostedSiteConversationEventItemType,
  hostedSiteConversationEventText,
  type McpServerConfig,
  routineRunConversationEventItemType,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { OpenPanelBase } from "@openpanel/web";
import { describe, expect, it, vi } from "vitest";
import {
  type AnalyticsInventory,
  type AnalyticsInventoryDayStore,
  analyticsDomain,
  HostAnalytics,
  type HostAnalyticsOptions,
  type HostOpenPanelClient,
  sanitizeHostEvent,
} from "./analytics";
import { catalogPluginSlug, loadCatalogPluginServers } from "./analytics-plugin-catalog";

const AGENT: AgentSummary = {
  id: "chief",
  provider: "codex",
  name: "Chief",
  title: "Chief of staff",
  description: "",
  notifications: true,
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  avatarSeed: "chief",
  avatarHue: null,
  avatarUrl: null,
  threadId: "thread-chief",
  workspacePath: "/private/workspace",
  preview: "private preview",
  updatedAt: null,
};

function fakeClient(): HostOpenPanelClient {
  return {
    setGlobalProperties: vi.fn(),
    track: vi.fn(),
    identify: vi.fn(),
    clear: vi.fn(),
  };
}

function hostedSiteMessage(
  id: string,
  action: "publish" | "replace" | "delete",
  status: "running" | "succeeded" | "failed" | "interrupted" | "cancelled",
  operationId: string,
): ConversationMessage {
  const terminalSite = {
    siteId: "site-1",
    title: "Hosted site",
    hostname: "hosted-site-23456789ab.openbot.site",
    url: "https://hosted-site-23456789ab.openbot.site",
  };
  const details =
    action === "publish" && status !== "succeeded"
      ? { siteId: null, title: "Hosted site", hostname: null, url: null }
      : terminalSite;
  return {
    id,
    turnId: "turn-hosted-site",
    author: "system",
    source: "system",
    text: hostedSiteConversationEventText(details),
    createdAt: "2026-08-31T10:00:00.000Z",
    status: "completed",
    itemType: hostedSiteConversationEventItemType(action, status, operationId),
  };
}

describe("host analytics", () => {
  it("emits one owner-scoped lifecycle pair without local identifiers", () => {
    const client = fakeClient();
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => ({ id: "owner-account", email: "owner@example.com" }),
        resolveAgent: (agentId) => (agentId === AGENT.id ? AGENT : null),
      },
      () => client,
    );

    expect(client.setGlobalProperties).toHaveBeenCalledWith(
      expect.objectContaining({ event_schema_version: 7, surface: "desktop_host" }),
    );

    analytics.handleAgentEvent({
      type: "turn-started",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-private",
      origin: "user",
    });
    analytics.handleAgentEvent({
      type: "turn-completed",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-private",
      origin: "user",
      status: "completed",
    });

    expect(client.identify).toHaveBeenCalledOnce();
    expect(client.identify).toHaveBeenCalledWith({ profileId: "owner-account", email: "owner@example.com" });
    expect(client.track).toHaveBeenCalledTimes(2);
    expect(client.track).toHaveBeenNthCalledWith(1, "system_turn_started", {
      provider: "codex",
      model: "gpt-5.6-luna",
      reasoning_effort: "medium",
      agent_source: "custom",
      origin: "user",
      profileId: "owner-account",
    });
    expect(client.track).toHaveBeenNthCalledWith(
      2,
      "system_turn_completed",
      expect.objectContaining({
        provider: "codex",
        model: "gpt-5.6-luna",
        reasoning_effort: "medium",
        origin: "user",
        status: "completed",
        duration_ms: expect.any(Number),
        profileId: "owner-account",
      }),
    );
    expect(JSON.stringify(vi.mocked(client.track).mock.calls)).not.toContain("turn-private");
    expect(JSON.stringify(vi.mocked(client.track).mock.calls)).not.toContain("thread-chief");
  });

  it("buffers lifecycle until the owner is known and preserves its timestamp", () => {
    const client = fakeClient();
    let owner: { id: string; email: string } | null = null;
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    analytics.handleAgentEvent({
      type: "turn-started",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-1",
      origin: "routine",
    });
    expect(client.track).not.toHaveBeenCalled();

    owner = { id: "owner-account", email: "owner@example.com" };
    analytics.flushPending();

    expect(client.track).toHaveBeenCalledWith(
      "system_turn_started",
      expect.objectContaining({
        origin: "routine",
        profileId: "owner-account",
        __timestamp: expect.any(String),
      }),
    );
    analytics.handleAgentEvent({
      type: "turn-completed",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-1",
      origin: "unknown",
      status: "completed",
    });
    expect(client.track).toHaveBeenLastCalledWith(
      "system_turn_completed",
      expect.objectContaining({ profileId: "owner-account" }),
    );
  });

  it("clears pending host events and the identified session on logout", () => {
    const client = fakeClient();
    let owner: { id: string; email: string } | null = { id: "owner-account", email: "owner@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );

    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "private" });
    owner = null;
    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "pending-after-logout" });
    analytics.clear();
    analytics.flushPending();

    expect(client.track).toHaveBeenCalledOnce();
    expect(client.clear).toHaveBeenCalledOnce();
  });

  it("updates the email for the same owner without clearing its session", () => {
    const client = fakeClient();
    let owner = { id: "owner-account", email: "old@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    analytics.handleAgentEvent({ type: "error", code: "first_error", message: "private" });
    vi.mocked(client.clear).mockClear();
    vi.mocked(client.identify).mockClear();

    owner = { id: "owner-account", email: "new@example.com" };
    analytics.handleAgentEvent({ type: "error", code: "second_error", message: "private" });

    expect(client.clear).not.toHaveBeenCalled();
    expect(client.identify).toHaveBeenCalledWith({ profileId: "owner-account", email: "new@example.com" });
  });

  it("sends the owner email through the real SDK transport", async () => {
    const requests: unknown[] = [];
    let releaseIdentify!: () => void;
    const identifyReady = new Promise<void>((resolve) => {
      releaseIdentify = resolve;
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      if (isDynamicRecord(request) && request.type === "identify") await identifyReady;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const analytics = new HostAnalytics(
        {
          enabled: true,
          appVersion: "1.2.3",
          platform: "darwin",
          resolveOwner: () => ({ id: "owner-account", email: "owner@example.com" }),
          resolveAgent: () => AGENT,
        },
        (options) => new OpenPanelBase(options),
      );
      analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "private" });

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(isDynamicRecord(requests[0]) ? requests[0].type : undefined).toBe("identify");
      releaseIdentify();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const identifyRequest = requests.find((candidate) => isDynamicRecord(candidate) && candidate.type === "identify");
      const trackRequest = requests.find(
        (candidate) =>
          isDynamicRecord(candidate) &&
          isDynamicRecord(candidate.payload) &&
          candidate.payload.name === "system_operation_failed",
      );
      expect(
        isDynamicRecord(identifyRequest) && isDynamicRecord(identifyRequest.payload) ? identifyRequest.payload : null,
      ).toMatchObject({ profileId: "owner-account", email: "owner@example.com" });
      expect(
        isDynamicRecord(trackRequest) && isDynamicRecord(trackRequest.payload)
          ? trackRequest.payload.profileId
          : undefined,
      ).toBe("owner-account");
      expect(JSON.stringify(trackRequest)).not.toContain("owner@example.com");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tracks terminal hosted-site markers once for the operation owner", () => {
    const client = fakeClient();
    let owner = { id: "owner-1", email: "one@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    const running = hostedSiteMessage("hosted-running", "publish", "running", "operation-success");
    const runningFailed = hostedSiteMessage("hosted-running-failed", "replace", "running", "operation-failed");
    const runningCancelled = hostedSiteMessage("hosted-running-cancelled", "delete", "running", "operation-cancelled");
    const runningInterrupted = hostedSiteMessage(
      "hosted-running-interrupted",
      "replace",
      "running",
      "operation-interrupted",
    );
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: {
        agentId: AGENT.id,
        threadId: AGENT.threadId,
        activeTurnId: null,
        revision: 1,
        messages: [running, runningFailed, runningCancelled, runningInterrupted],
      },
    });

    owner = { id: "owner-2", email: "two@example.com" };
    const succeeded = hostedSiteMessage("hosted-succeeded", "publish", "succeeded", "operation-success");
    const failed = hostedSiteMessage("hosted-failed", "replace", "failed", "operation-failed");
    const cancelled = hostedSiteMessage("hosted-cancelled", "delete", "cancelled", "operation-cancelled");
    const interrupted = hostedSiteMessage("hosted-interrupted", "replace", "interrupted", "operation-interrupted");
    const messages = [
      running,
      runningFailed,
      runningCancelled,
      runningInterrupted,
      succeeded,
      failed,
      cancelled,
      interrupted,
    ];
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: { agentId: AGENT.id, threadId: AGENT.threadId, activeTurnId: null, revision: 2, messages },
    });
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: { agentId: AGENT.id, threadId: AGENT.threadId, activeTurnId: null, revision: 3, messages },
    });

    expect(client.track).toHaveBeenCalledTimes(4);
    expect(client.track).toHaveBeenNthCalledWith(1, "hosted_site_action", {
      action: "publish",
      entry_point: "agent",
      result: "succeeded",
      profileId: "owner-1",
    });
    expect(client.track).toHaveBeenNthCalledWith(2, "hosted_site_action", {
      action: "replace",
      entry_point: "agent",
      result: "failed",
      failure_code: "hosted_site_failed",
      profileId: "owner-1",
    });
    expect(client.track).toHaveBeenNthCalledWith(3, "hosted_site_action", {
      action: "delete",
      entry_point: "agent",
      result: "failed",
      failure_code: "cancelled",
      profileId: "owner-1",
    });
    expect(client.track).toHaveBeenNthCalledWith(4, "hosted_site_action", {
      action: "replace",
      entry_point: "agent",
      result: "failed",
      failure_code: "interrupted",
      profileId: "owner-1",
    });
    expect(JSON.stringify(vi.mocked(client.track).mock.calls)).not.toContain("hosted-site-23456789ab.openbot.site");
  });

  it("ignores hosted-site history even when it contains running and terminal markers", () => {
    const client = fakeClient();
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => ({ id: "owner-account", email: "owner@example.com" }),
        resolveAgent: () => AGENT,
      },
      () => client,
    );

    const messages = [
      hostedSiteMessage("hosted-history-running", "publish", "running", "operation-history"),
      hostedSiteMessage("hosted-history-terminal", "publish", "succeeded", "operation-history"),
    ];
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: {
        agentId: AGENT.id,
        threadId: AGENT.threadId,
        activeTurnId: null,
        revision: 1,
        messages,
      },
    });
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: { agentId: AGENT.id, threadId: AGENT.threadId, activeTurnId: null, revision: 2, messages },
    });

    expect(client.track).not.toHaveBeenCalled();
  });

  it("keeps a hosted-site operation owner across account clearing", () => {
    const client = fakeClient();
    let owner: { id: string; email: string } | null = { id: "owner-1", email: "one@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    const running = hostedSiteMessage("hosted-running", "publish", "running", "operation-owner");
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: { agentId: AGENT.id, threadId: AGENT.threadId, activeTurnId: null, revision: 1, messages: [running] },
    });

    analytics.clear();
    owner = null;
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: {
        agentId: AGENT.id,
        threadId: AGENT.threadId,
        activeTurnId: null,
        revision: 2,
        messages: [running, hostedSiteMessage("hosted-succeeded", "publish", "succeeded", "operation-owner")],
      },
    });

    expect(client.track).toHaveBeenCalledWith("hosted_site_action", expect.objectContaining({ profileId: "owner-1" }));
    expect(client.clear).toHaveBeenCalledTimes(2);
  });

  it("does not flush ownerless events with a captured hosted-site owner", () => {
    const client = fakeClient();
    let owner: { id: string; email: string } | null = { id: "owner-1", email: "one@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    const running = hostedSiteMessage("hosted-running", "publish", "running", "operation-pending");
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: { agentId: AGENT.id, threadId: AGENT.threadId, activeTurnId: null, revision: 1, messages: [running] },
    });

    owner = null;
    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "private" });
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: {
        agentId: AGENT.id,
        threadId: AGENT.threadId,
        activeTurnId: null,
        revision: 2,
        messages: [running, hostedSiteMessage("hosted-succeeded", "publish", "succeeded", "operation-pending")],
      },
    });

    expect(client.track).toHaveBeenCalledOnce();
    expect(client.track).toHaveBeenCalledWith("hosted_site_action", expect.objectContaining({ profileId: "owner-1" }));

    owner = { id: "owner-2", email: "two@example.com" };
    analytics.flushPending();

    expect(client.track).toHaveBeenCalledTimes(2);
    expect(client.track).toHaveBeenLastCalledWith(
      "system_operation_failed",
      expect.objectContaining({ profileId: "owner-2" }),
    );
  });

  it("preserves identity transitions when the queue overflows", async () => {
    const client = fakeClient();
    let releaseIdentify!: () => void;
    const identifyReady = new Promise<void>((resolve) => {
      releaseIdentify = resolve;
    });
    vi.mocked(client.identify).mockImplementation(async () => identifyReady);
    let owner = { id: "owner-1", email: "one@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );

    analytics.handleAgentEvent({ type: "error", code: "agent_initial", message: "private" });
    owner = { id: "owner-2", email: "two@example.com" };
    for (let index = 0; index < 150; index += 1) {
      analytics.handleAgentEvent({ type: "error", code: `agent_${index}`, message: "private" });
    }
    releaseIdentify();

    await vi.waitFor(() => expect(client.track).toHaveBeenCalledTimes(100));
    expect(client.identify).toHaveBeenCalledWith({ profileId: "owner-2", email: "two@example.com" });
    expect(client.clear).toHaveBeenCalled();
  });

  it("preserves host events queued before logout", async () => {
    const client = fakeClient();
    let releaseIdentify!: () => void;
    const identifyReady = new Promise<void>((resolve) => {
      releaseIdentify = resolve;
    });
    vi.mocked(client.identify).mockImplementation(async () => identifyReady);
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => ({ id: "owner-account", email: "owner@example.com" }),
        resolveAgent: () => AGENT,
      },
      () => client,
    );

    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "private" });
    analytics.clear();
    releaseIdentify();

    await vi.waitFor(() => expect(client.track).toHaveBeenCalledOnce());
    expect(client.clear).toHaveBeenCalledOnce();
  });

  it("normalizes the owner email before identifying", () => {
    const client = fakeClient();
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => ({ id: "owner-account", email: " Owner@EXAMPLE.COM " }),
        resolveAgent: () => AGENT,
      },
      () => client,
    );

    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "private" });

    expect(client.identify).toHaveBeenCalledWith({ profileId: "owner-account", email: "owner@example.com" });
  });

  it("drops unsafe runtime fields", () => {
    expect(
      sanitizeHostEvent("system_operation_failed", {
        ...Object.assign(
          { area: "agent", failure_code: "interrupt_failed" },
          { raw_error: "secret", agentId: "chief" },
        ),
      }),
    ).toEqual({ area: "agent", failure_code: "interrupt_failed" });
    expect(
      sanitizeHostEvent("system_turn_completed", {
        provider: "private-provider",
        model: "../../private",
        origin: "private",
        status: "private",
        duration_ms: Number.NaN,
      }),
    ).toEqual({ status: "other" });
  });

  // A model OpenCode serves is named `<provider>/<model>`, and when the user named that endpoint the
  // prefix is a string they typed. It must not leave the computer, so every prefixed id collapses.
  it("reports a prefixed model id as custom", () => {
    expect(sanitizeHostEvent("system_turn_completed", { model: "acme-internal/glm-5-air" })).toEqual({
      model: "custom",
    });
    expect(sanitizeHostEvent("system_turn_completed", { model: "anthropic/claude-sonnet-5" })).toEqual({
      model: "custom",
    });
    expect(sanitizeHostEvent("system_turn_completed", { model: "gpt-5.6-luna" })).toEqual({
      model: "gpt-5.6-luna",
    });
    expect(sanitizeHostEvent("system_turn_completed", { model: "opencode/anything" })).toEqual({
      model: "opencode/anything",
    });
  });

  it("deduplicates starts and keeps a known stored origin on completion", () => {
    const client = fakeClient();
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => ({ id: "owner-account", email: "owner@example.com" }),
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    const started = {
      type: "turn-started" as const,
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-1",
      origin: "routine" as const,
    };
    analytics.handleAgentEvent(started);
    analytics.handleAgentEvent(started);
    analytics.handleAgentEvent({
      type: "turn-completed",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-1",
      origin: "unknown",
      status: "completed",
    });

    expect(client.track).toHaveBeenCalledTimes(2);
    expect(client.track).toHaveBeenLastCalledWith(
      "system_turn_completed",
      expect.objectContaining({ origin: "routine" }),
    );
  });

  it("keeps an active turn with the account that started it", () => {
    const client = fakeClient();
    let owner = { id: "owner-1", email: "one@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );

    analytics.handleAgentEvent({
      type: "turn-started",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-account-bound",
      origin: "user",
    });
    analytics.clear();
    owner = { id: "owner-2", email: "two@example.com" };
    analytics.handleAgentEvent({
      type: "prompt",
      requestId: "request-1",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-account-bound",
      questions: [],
    });
    analytics.handleAgentEvent({
      type: "turn-completed",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-account-bound",
      origin: "unknown",
      status: "completed",
    });

    expect(client.track).toHaveBeenCalledTimes(3);
    expect(vi.mocked(client.track).mock.calls.every(([, properties]) => properties?.profileId === "owner-1")).toBe(
      true,
    );
  });

  it("clears a captured host identity after a turn continues past logout", () => {
    const client = fakeClient();
    let owner: { id: string; email: string } | null = { id: "owner-1", email: "one@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );

    analytics.handleAgentEvent({
      type: "turn-started",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-after-logout",
      origin: "user",
    });
    analytics.clear();
    owner = null;
    analytics.handleAgentEvent({
      type: "turn-completed",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-after-logout",
      origin: "unknown",
      status: "completed",
    });

    expect(client.clear).toHaveBeenCalledTimes(2);

    owner = { id: "owner-1", email: "one@example.com" };
    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "private-after-relogin" });

    expect(client.identify).toHaveBeenCalledTimes(3);
  });

  it("drops ownerless events after logout until a signed-in owner is flushed", () => {
    const client = fakeClient();
    let owner: { id: string; email: string } | null = { id: "owner-1", email: "one@example.com" };
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => owner,
        resolveAgent: () => AGENT,
      },
      () => client,
    );

    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "before-logout" });
    owner = null;
    analytics.clear();
    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "after-logout" });
    owner = { id: "owner-2", email: "two@example.com" };
    analytics.flushPending();

    expect(client.track).toHaveBeenCalledOnce();
    owner = { id: "owner-2", email: "two@example.com" };
    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "after-relogin" });

    expect(client.track).toHaveBeenCalledTimes(2);
    expect(client.track).toHaveBeenLastCalledWith(
      "system_operation_failed",
      expect.objectContaining({ profileId: "owner-2" }),
    );
  });

  it("adds safe agent context to host failures", () => {
    const client = fakeClient();
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => ({ id: "owner-account", email: "owner@example.com" }),
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    analytics.handleAgentEvent({ type: "error", agentId: AGENT.id, code: "interrupt_failed", message: "private" });

    expect(client.track).toHaveBeenCalledWith("system_operation_failed", {
      provider: "codex",
      model: "gpt-5.6-luna",
      reasoning_effort: "medium",
      area: "agent",
      failure_code: "interrupt_failed",
      cause_code: "unknown",
      severity: "error",
      operation: "turn",
      profileId: "owner-account",
    });
  });

  it("does not identify or emit lifecycle while tracking is disabled", () => {
    const client = fakeClient();
    const analytics = new HostAnalytics(
      {
        enabled: true,
        trackingEnabled: false,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => ({ id: "owner-account", email: "owner@example.com" }),
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    analytics.handleAgentEvent({
      type: "turn-started",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-1",
      origin: "user",
    });
    expect(client.identify).not.toHaveBeenCalled();
    expect(client.track).not.toHaveBeenCalled();

    const running = hostedSiteMessage("hosted-running", "publish", "running", "operation-opted-out");
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: { agentId: AGENT.id, threadId: AGENT.threadId, activeTurnId: null, revision: 1, messages: [running] },
    });
    analytics.setTrackingEnabled(true);
    analytics.handleAgentEvent({
      type: "conversation",
      snapshot: {
        agentId: AGENT.id,
        threadId: AGENT.threadId,
        activeTurnId: null,
        revision: 2,
        messages: [running, hostedSiteMessage("hosted-succeeded", "publish", "succeeded", "operation-opted-out")],
      },
    });
    analytics.handleAgentEvent({
      type: "turn-started",
      agentId: AGENT.id,
      threadId: AGENT.threadId ?? "",
      turnId: "turn-2",
      origin: "user",
    });
    expect(client.track).toHaveBeenCalledOnce();
    expect(client.track).toHaveBeenCalledWith("system_turn_started", expect.anything());
  });

  it("clears the host OpenPanel client when tracking is disabled", () => {
    const client = fakeClient();
    const analytics = new HostAnalytics(
      {
        enabled: true,
        appVersion: "1.2.3",
        platform: "darwin",
        resolveOwner: () => ({ id: "owner-account", email: "owner@example.com" }),
        resolveAgent: () => AGENT,
      },
      () => client,
    );
    analytics.handleAgentEvent({ type: "error", code: "provider_error", message: "private" });
    vi.mocked(client.clear).mockClear();

    analytics.setTrackingEnabled(false);

    expect(client.clear).toHaveBeenCalledOnce();
  });
});

const OWNER = { id: "owner-account", email: "owner@example.com" };

function usageAnalytics(options: Partial<HostAnalyticsOptions> = {}) {
  const client = fakeClient();
  const analytics = new HostAnalytics(
    {
      enabled: true,
      appVersion: "1.2.3",
      platform: "darwin",
      resolveOwner: () => OWNER,
      resolveAgent: () => AGENT,
      ...options,
    },
    () => client,
  );
  const tracked = (name: string) =>
    vi
      .mocked(client.track)
      .mock.calls.filter(([event]) => event === name)
      .map(([, properties]) => properties);
  return { analytics, client, tracked };
}

function routineRunMessage(id: string, status: "running" | "succeeded", runId: string): ConversationMessage {
  return {
    id,
    author: "system",
    source: "system",
    text: "Private routine name",
    createdAt: "2026-09-01T10:00:00.000Z",
    status: "completed",
    itemType: routineRunConversationEventItemType(status, "routine-1", runId),
  };
}

function inventory(): AnalyticsInventory {
  return {
    agentCount: 2,
    enabledRoutineCount: 1,
    customMcpServerCount: 1,
    plugins: ["github", "github", "Private Server"],
    curatedSkills: ["pdf"],
    curatedAgents: [],
    localSkillCount: 3,
    communitySkillCount: 0,
    providers: ["codex", "private-provider"],
    computerUseEnabled: false,
  };
}

function dayStore(stored: string | "missing" | "malformed"): AnalyticsInventoryDayStore & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    read: () => Effect.sync(() => written.at(-1) ?? stored),
    write: (day) =>
      Effect.sync(() => {
        written.push(day);
      }),
  };
}

describe("usage analytics", () => {
  it("sends the registrable domain of a page and never a private or local host", () => {
    expect(analyticsDomain("www.LinkedIn.com.")).toBe("linkedin.com");
    expect(analyticsDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(analyticsDomain("private-user.github.io")).toBe("github.io");
    for (const host of [
      "localhost",
      "intranet",
      "192.168.1.10",
      "[::1]",
      "printer.local",
      "nas.home.arpa",
      "wiki.corp",
    ]) {
      expect(analyticsDomain(host)).toBeUndefined();
    }
  });

  it("names a server as a catalog plugin only when its address or command matches the listing", async () => {
    const servers = await Effect.runPromise(loadCatalogPluginServers("resources/plugin-catalog"));
    const config = (fields: Partial<McpServerConfig>): McpServerConfig => ({
      id: "server",
      name: "linear",
      transport: "http",
      enabled: true,
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "https://mcp.linear.app/mcp",
      headers: [],
      ...fields,
    });
    expect(catalogPluginSlug(config({}), servers, "/home/user")).toBe("linear");
    expect(catalogPluginSlug(config({ url: "https://mcp.private.example/linear" }), servers, "/home/user")).toBeNull();
    expect(catalogPluginSlug(config({ name: "composio", url: "https://mcp.composio.dev/abc" }), servers, "/home")).toBe(
      "composio",
    );
    const paper = { name: "paper", transport: "stdio" as const, url: "", args: ["mcp"] };
    expect(catalogPluginSlug(config({ ...paper, command: "/home/user/.paper/bin/paper" }), servers, "/home/user")).toBe(
      "paper",
    );
    expect(catalogPluginSlug(config({ ...paper, command: "/opt/private/paper" }), servers, "/home/user")).toBeNull();
  });

  it("reports a site visit once per tab and domain with its actor", () => {
    const { analytics, tracked } = usageAnalytics();
    analytics.handleSiteVisit({ tabId: "tab-1", hostname: "mail.google.com", actor: "user", agentId: null });
    analytics.handleSiteVisit({ tabId: "tab-1", hostname: "docs.google.com", actor: "user", agentId: null });
    analytics.handleSiteVisit({ tabId: "tab-1", hostname: "intranet", actor: "agent", agentId: AGENT.id });
    analytics.handleSiteVisit({ tabId: "tab-1", hostname: "private.github.io", actor: "agent", agentId: AGENT.id });

    expect(tracked("system_site_visited")).toEqual([
      { domain: "google.com", actor: "user", profileId: OWNER.id },
      expect.objectContaining({ domain: "github.io", actor: "agent", provider: "codex", agent_source: "custom" }),
    ]);
  });

  it("names catalog plugins and built-in tools, and only counts a custom server", () => {
    const { analytics, tracked } = usageAnalytics({
      resolveMcpServer: (name) => {
        if (name === "linear") return { slug: "linear" };
        return name === "github" || name === "computer_use" ? { slug: null } : null;
      },
    });
    const turn = { agentId: AGENT.id, turnId: "turn-tools" };
    analytics.handleAgentEvent({ type: "turn-started", ...turn, threadId: "thread", origin: "user" });
    analytics.handleToolUsage({ ...turn, kind: "mcp", server: "linear", tool: "create_issue", failed: false });
    analytics.handleToolUsage({ ...turn, kind: "mcp", server: "linear", tool: "create_issue", failed: true });
    analytics.handleToolUsage({ ...turn, kind: "mcp", server: "openbot_browser", tool: "navigate", failed: false });
    // A server the user named `github` that the catalog does not recognize is the user's own.
    analytics.handleToolUsage({ ...turn, kind: "mcp", server: "github", tool: "private_lookup", failed: false });
    // A server the user named `computer use` reports under the built-in name, and stays custom.
    analytics.handleToolUsage({ ...turn, kind: "mcp", server: "computer_use", tool: "private_click", failed: false });
    analytics.handleToolUsage({ ...turn, kind: "command", failed: false });
    expect(tracked("system_tool_used")).toEqual([]);
    analytics.handleAgentEvent({ type: "turn-completed", ...turn, threadId: "thread", status: "completed" });

    const rows = tracked("system_tool_used");
    expect(rows).toEqual([
      expect.objectContaining({
        tool_kind: "mcp",
        plugin: "linear",
        tool: "create_issue",
        call_count: 2,
        failed_count: 1,
      }),
      expect.objectContaining({ tool_kind: "browser", plugin: "builtin", tool: "navigate", call_count: 1 }),
      expect.objectContaining({ tool_kind: "mcp", plugin: "custom", call_count: 2 }),
      expect.objectContaining({ tool_kind: "command", call_count: 1, failed_count: 0 }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("private_");
    expect(JSON.stringify(rows)).not.toContain("github");
  });

  it("drops buffered tool use when the user turns analytics off", () => {
    const { analytics, tracked } = usageAnalytics();
    const turn = { agentId: AGENT.id, turnId: "turn-opt-out" };
    analytics.handleAgentEvent({ type: "turn-started", ...turn, threadId: "thread", origin: "user" });
    analytics.handleToolUsage({ ...turn, kind: "command", failed: false });
    analytics.setTrackingEnabled(false);
    analytics.setTrackingEnabled(true);
    analytics.handleAgentEvent({ type: "turn-completed", ...turn, threadId: "thread", status: "completed" });

    expect(tracked("system_tool_used")).toEqual([]);
  });

  it("reports a routine run that ran in this process and never a replayed one or its name", () => {
    const { analytics, tracked } = usageAnalytics({
      resolveRoutineRun: () => ({ runKind: "scheduled", triggerType: "daily" }),
    });
    const conversation = (messages: ConversationMessage[]) =>
      analytics.handleAgentEvent({
        type: "conversation",
        snapshot: { agentId: AGENT.id, threadId: "thread", activeTurnId: null, revision: 1, messages },
      });
    const replayed = [routineRunMessage("m1", "running", "run-old"), routineRunMessage("m2", "succeeded", "run-old")];
    conversation(replayed);
    conversation([...replayed, routineRunMessage("m3", "running", "run-live")]);
    conversation([
      ...replayed,
      routineRunMessage("m3", "running", "run-live"),
      routineRunMessage("m4", "succeeded", "run-live"),
    ]);
    conversation([
      ...replayed,
      routineRunMessage("m3", "running", "run-live"),
      routineRunMessage("m4", "succeeded", "run-live"),
    ]);

    const runs = tracked("system_routine_run");
    expect(runs).toEqual([
      expect.objectContaining({ status: "succeeded", run_kind: "scheduled", trigger_type: "daily", provider: "codex" }),
    ]);
    expect(JSON.stringify(runs)).not.toContain("Private routine name");
  });

  it("sends the inventory once per local day with only catalog names", async () => {
    const store = dayStore("missing");
    const resolveInventory = vi.fn(() => Effect.sync(inventory));
    const { analytics, tracked } = usageAnalytics({ resolveInventory, inventoryDay: store });
    analytics.flushPending();
    await vi.waitFor(() => expect(tracked("system_inventory")).toHaveLength(1));
    analytics.flushPending();
    analytics.handleAgentEvent({ type: "turn-started", agentId: AGENT.id, threadId: "thread", turnId: "turn" });

    expect(resolveInventory).toHaveBeenCalledOnce();
    expect(store.written).toHaveLength(1);
    expect(tracked("system_inventory")).toEqual([
      expect.objectContaining({ plugins: ["github"], curated_skills: ["pdf"], providers: ["codex"], agent_count: 2 }),
    ]);
  });

  it("treats a malformed inventory day as sent today, and repairs it for the next day", async () => {
    const store = dayStore("malformed");
    const resolveInventory = vi.fn(() => Effect.sync(inventory));
    const { analytics } = usageAnalytics({ resolveInventory, inventoryDay: store });
    analytics.flushPending();
    await vi.waitFor(() => expect(store.written).toHaveLength(1));
    analytics.flushPending();

    expect(resolveInventory).not.toHaveBeenCalled();
    expect(store.written).toHaveLength(1);
  });

  it("does not send the inventory when the user turns analytics off during the check", async () => {
    const store = dayStore("missing");
    const { analytics, tracked } = usageAnalytics({
      resolveInventory: () => Effect.sync(inventory),
      inventoryDay: {
        ...store,
        write: (day) =>
          Effect.gen(function* () {
            analytics.setTrackingEnabled(false);
            yield* store.write(day);
          }),
      },
    });
    analytics.flushPending();
    await vi.waitFor(() => expect(store.written).toHaveLength(1));

    expect(tracked("system_inventory")).toEqual([]);
  });
});
