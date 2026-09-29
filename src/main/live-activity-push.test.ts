import type { AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import type { LiveActivityPushRegistration } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LiveActivityPushAgents, LiveActivityPushService } from "./live-activity-push";

const agent = (id: string, name: string) => ({
  id,
  name,
  notifications: true,
  preview: "",
  updatedAt: null,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
});

const approval = (agentId: string, command: string) => ({
  requestId: `request-${agentId}`,
  agentId,
  threadId: `thread-${agentId}`,
  turnId: `turn-${agentId}`,
  kind: "command" as const,
  command,
  cwd: null,
  reason: null,
  grantRoot: null,
  permissions: null,
  truncated: false,
});

const registration: LiveActivityPushRegistration = {
  serverId: "server-1",
  token: "ab".repeat(32),
  environment: "production",
  secret: "A".repeat(43),
  locale: "en",
  away: true,
  photos: [],
};

let snapshot: AgentRuntimeSnapshot;
let listener: ((event: AgentEvent) => void) | null;
const agents: LiveActivityPushAgents = {
  on: (_event, receive) => {
    listener = receive;
  },
  off: () => {
    listener = null;
  },
  getRuntimeSnapshot: () => snapshot,
  listConversationReads: () => ({}),
};

beforeEach(() => {
  vi.useFakeTimers();
  listener = null;
  memberActive = true;
  snapshot = {
    agents: [agent("ada", "Ada"), agent("hidden", "Hidden")],
    activeTurns: [],
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [approval("hidden", "cat hidden-secret")],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
});

afterEach(() => {
  vi.useRealTimers();
});

let memberActive = true;

function service(send: (push: LiveActivityRelayPush) => Promise<"sent" | "gone">) {
  return new LiveActivityPushService({
    agents,
    send,
    randomBytes: (size) => new Uint8Array(size).fill(4),
    memberActive: () => memberActive,
  });
}

const viewer = {
  memberId: "member-1",
  hiddenAgentIds: () => new Set(["hidden"]),
  readOptions: { excludeRoutineEvents: false, excludeRoutineRunEvents: false, excludeHostedSiteEvents: false },
};

describe("LiveActivityPushService", () => {
  it("sends sealed state only while the phone is away, and only for agents the member can see", async () => {
    const send = vi.fn(async (_push: LiveActivityRelayPush) => "sent" as const);
    const push = service(send);

    push.register("session-1", viewer, { ...registration, away: false });
    snapshot.pendingApprovals.push(approval("ada", "npm test"));
    listener?.({ type: "agents-changed", agents: [] });
    await vi.runOnlyPendingTimersAsync();
    expect(send).not.toHaveBeenCalled();

    // iOS suspended the app before it could say so: its connection closed.
    push.disconnected("session-1");
    await vi.runOnlyPendingTimersAsync();

    expect(send).toHaveBeenCalledTimes(1);
    const [sent] = send.mock.calls[0] ?? [];
    expect(sent).toMatchObject({ token: registration.token, event: "update", priority: 10 });
    // The relay and Apple see sealed bytes only.
    expect(JSON.stringify(sent)).not.toMatch(/npm test|Ada|hidden-secret|approval/iu);
    push.dispose();
  });

  it("ends the activity when nothing needs the member, and forgets a token that Apple refused", async () => {
    const send = vi.fn(async (_push: LiveActivityRelayPush) => "sent" as const);
    const push = service(send);

    push.register("session-1", viewer, registration);
    await vi.runOnlyPendingTimersAsync();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ event: "end", sealed: null }));
    expect(listener).toBeNull();

    const refused = vi.fn(async (_push: LiveActivityRelayPush) => "gone" as const);
    const other = service(refused);
    snapshot.pendingApprovals.push(approval("ada", "npm test"));
    other.register("session-2", viewer, registration);
    await vi.runOnlyPendingTimersAsync();
    listener?.({ type: "agents-changed", agents: [] });
    await vi.runOnlyPendingTimersAsync();
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("sends nothing more after the member loses access, and tries a failed send again", async () => {
    snapshot.pendingApprovals.push(approval("ada", "npm test"));
    const send = vi
      .fn(async (_push: LiveActivityRelayPush) => "sent" as const)
      .mockRejectedValueOnce(new Error("Apple did not answer."));
    const push = service(send);

    push.register("session-1", viewer, registration);
    await vi.runOnlyPendingTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
    // The approval did not change, so only the retry sends it.
    await vi.runOnlyPendingTimersAsync();
    expect(send).toHaveBeenCalledTimes(2);

    memberActive = false;
    snapshot.pendingApprovals.push(approval("ada", "rm -rf build"));
    listener?.({ type: "agents-changed", agents: [] });
    await vi.runOnlyPendingTimersAsync();
    expect(send).toHaveBeenCalledTimes(2);
    expect(listener).toBeNull();
  });
});
