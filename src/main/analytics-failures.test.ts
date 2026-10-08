import type { AgentSummary } from "@openbot/contracts/ipc";
import { type Report, ReportQueue } from "@openbot/telemetry";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { HostAnalytics } from "./analytics";

it("reports the provider and model captured when a turn started and drops stale identity scopes", async () => {
  let agent: AgentSummary = {
    id: "private-agent",
    provider: "codex",
    name: "Private name",
    title: "",
    description: "",
    notifications: true,
    model: "gpt-6",
    reasoningEffort: "medium",
    avatarSeed: "private",
    avatarHue: null,
    avatarUrl: null,
    threadId: "private-thread",
    workspacePath: "/private/workspace",
    preview: "private prompt",
    updatedAt: null,
  };
  let owner: { id: string; email: string } | null = { id: "account-1", email: "owner@example.com" };
  const sent: Report[] = [];
  const reports = new ReportQueue(
    { read: () => Effect.succeed(null), write: () => Effect.void },
    (value) =>
      Effect.sync(() => {
        sent.push(value);
        return true;
      }),
    { surface: "desktop_host", platform: "darwin", app_version: "0.31.0", event_schema_version: 7 },
  );
  const analytics = new HostAnalytics(
    {
      enabled: true,
      appVersion: "0.31.0",
      platform: "darwin",
      resolveOwner: () => owner,
      resolveAgent: () => agent,
      reports,
    },
    () => ({ track: vi.fn(), identify: vi.fn(), clear: vi.fn(), setGlobalProperties: vi.fn() }),
  );
  try {
    analytics.flushPending();
    analytics.handleAgentEvent({
      type: "turn-started",
      agentId: agent.id,
      threadId: "private-thread",
      turnId: "private-turn",
      origin: "routine",
    });
    agent = { ...agent, provider: "opencode", model: "other-model" };
    analytics.handleFailure({
      agentId: agent.id,
      turnId: "private-turn",
      code: "agent_error",
      causeCode: "invalid_upload_request",
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.properties).toMatchObject({
      provider: "codex",
      model: "gpt-6",
      origin: "routine",
      operation: "turn",
      cause_code: "invalid_upload_request",
      failure_code: "agent_event_failed",
    });
    expect(JSON.stringify(sent)).not.toContain("private");
    owner = null;
    analytics.clear();
    analytics.handleAgentEvent({
      type: "turn-started",
      agentId: agent.id,
      threadId: "private-thread",
      turnId: "anonymous-turn",
      origin: "user",
    });
    owner = { id: "account-2", email: "second@example.com" };
    analytics.flushPending();
    analytics.handleFailure({ agentId: agent.id, turnId: "anonymous-turn", code: "agent_error", causeCode: "unknown" });
    await Effect.runPromise(reports.flush());
    expect(sent).toHaveLength(1);
  } finally {
    await Effect.runPromise(analytics.close());
  }
});
