// Checks that the host leaves a member's muted agents out of the iOS Live Activity (#3583): the
// levels that the member chose on the server (`agent-notification-levels-v1`) hide an agent from the
// island and from the unread list, the other agents stay, an unmute shows the agent again, and the
// registration of another member still shows the muted agent.
//
// It runs the real Live Activity push service with two member registrations, a synthetic runtime
// snapshot, and a local relay adapter, and opens each push with the widget code. It sends nothing.
// Run it with `bun scripts/live-activity-agent-mute-host-e2e.ts`. Writes
// .openbot-build/live-activity-agent-mute-host-e2e/report.json.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentEvent, AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import {
  encodeLiveActivityBytes,
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityKeys,
} from "@openbot/team-client/live-activity-seal";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import { LiveActivityPushService } from "../src/main/live-activity-push";

const OUT = resolve(import.meta.dirname, "../.openbot-build/live-activity-agent-mute-host-e2e");
const STEP_DEADLINE_MS = 10_000;
const SERVER = "fixture-server";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const MEMBER_1 = "member-1";
const MEMBER_2 = "member-2";
const TOKEN_1 = "11".repeat(32);
const TOKEN_2 = "22".repeat(32);
const logger = createOpenBotLogger("live-activity-agent-mute-host-e2e");

const events = new EventEmitter<{ event: [AgentEvent] }>();
const secret = randomBytes(LIVE_ACTIVITY_SECRET_BYTES);
const keys = liveActivityKeys(secret);
const pushes: LiveActivityRelayPush[] = [];
const waiters = new Set<() => void>();
/** The agents that run a turn now. An agent that is not here has its last message in the snapshot. */
const workingAgents = new Set<string>([AGENT_A, AGENT_B]);
/** The levels that each member chose on the server. The test changes them between steps. */
const memberAgentLevels = new Map<string, Map<string, "all" | "needs-me" | "nothing">>();

function snapshot(): AgentRuntimeSnapshot {
  return {
    agents: [agent(AGENT_A, "Alpha"), agent(AGENT_B, "Beta")],
    activeTurns: [...workingAgents].map((agentId) => ({ agentId, threadId: agentId, turnId: `turn-${agentId}` })),
    work: [],
    latestMessages: [AGENT_A, AGENT_B]
      .filter((agentId) => !workingAgents.has(agentId))
      .map((agentId) => ({ agentId, id: `message-${agentId}`, text: "Done.", createdAt: "2026-11-17T00:00:00.000Z" })),
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
}

function agent(id: string, name: string) {
  return {
    id,
    name,
    notifications: true,
    preview: "Done.",
    updatedAt: "2026-11-17T00:00:00.000Z",
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

/** Waits for the next push for `token`, which can already have gone out. */
function pushFor(token: string, after: number): Promise<LiveActivityRelayPush> {
  return new Promise((resolvePush, reject) => {
    const deadline = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`No push for ${token} after ${after} before the deadline.`));
    }, STEP_DEADLINE_MS);
    const check = () => {
      const push = pushes.slice(after).find((candidate) => candidate.token === token);
      if (!push) return;
      clearTimeout(deadline);
      waiters.delete(check);
      resolvePush(push);
    };
    waiters.add(check);
    check();
  });
}

/** The last push for `token` so far, or `null` when none went out. */
function latestPushFor(token: string): LiveActivityRelayPush | null {
  return pushes.findLast((candidate) => candidate.token === token) ?? null;
}

/** The count of pushes when the caller starts to wait, so `pushFor` waits for a later one. */
function pushCount(): number {
  return pushes.length;
}

/** The island view that the widget opens, with the fields that the checks read. */
interface OpenedProps {
  mode: string;
  /** The serialized view for the name checks. */
  content: string;
}

/** The props that the widget opens, or `null` for an end push. */
function openedProps(push: LiveActivityRelayPush | null) {
  assert.ok(push, "A push went out.");
  assert.equal(push.event, "update");
  assert.ok(push.sealed, "An update must carry sealed content.");
  const opened = openSealedLiveActivity(
    push.sealed,
    encodeLiveActivityBytes(keys.seal),
    encodeLiveActivityBytes(keys.tag),
  );
  assert.ok(opened, "The widget must open the push.");
  const parsed = JSON.parse(opened);
  assert.ok(isDynamicRecord(parsed) && typeof parsed.mode === "string");
  const props: OpenedProps = { mode: parsed.mode, content: opened };
  return props;
}

const steps: { name: string; passed: boolean; detail?: unknown }[] = [];
async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    steps.push({ name, passed: true, detail: await run() });
  } catch (error) {
    steps.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const service = new LiveActivityPushService({
  agents: {
    on: (event, listener) => events.on(event, listener),
    off: (event, listener) => events.off(event, listener),
    getRuntimeSnapshot: snapshot,
    listConversationReads: (_memberId: string) =>
      Object.fromEntries(
        [AGENT_A, AGENT_B].map((agentId) => [
          agentId,
          workingAgents.has(agentId)
            ? { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null }
            : { unreadCount: 1, firstUnreadMessageId: `message-${agentId}`, throughMessageId: null },
        ]),
      ),
  },
  send: (push) =>
    Effect.sync(() => {
      pushes.push(push);
      for (const wake of waiters) wake();
      return "sent" as const;
    }),
  memberActive: () => true,
  memberLevels: (memberId) => ({ server: null, agents: memberAgentLevels.get(memberId) ?? new Map() }),
  randomBytes,
});

const readOptions = {
  excludeRoutineEvents: true,
  excludeRoutineRunEvents: true,
  excludeRoutineHostedSiteEvents: true,
  excludeHostedSiteEvents: true,
  excludeRoutineQuietAnswers: true,
};

service.register(
  "session-1",
  { memberId: MEMBER_1, hiddenAgentIds: () => new Set<string>(), readOptions },
  {
    serverId: SERVER,
    token: TOKEN_1,
    environment: "development",
    secret: encodeLiveActivityBytes(secret),
    locale: "en",
    away: true,
    photos: [],
  },
);
service.register(
  "session-2",
  { memberId: MEMBER_2, hiddenAgentIds: () => new Set<string>(), readOptions },
  {
    serverId: SERVER,
    token: TOKEN_2,
    environment: "development",
    secret: encodeLiveActivityBytes(secret),
    locale: "en",
    away: true,
    photos: [],
  },
);

let passed = false;
try {
  await step("baseline: both members get a push that names both agents", async () => {
    const before = pushCount();
    const forFirst = openedProps(await pushFor(TOKEN_1, before));
    const forSecond = openedProps(await pushFor(TOKEN_2, before));
    const content = forFirst.content;
    assert.ok(content.includes("Alpha") && content.includes("Beta"), "The island names both agents.");
    return {
      firstMode: forFirst.mode,
      secondMode: forSecond?.mode ?? null,
      tokensRegistered: new Set(pushes.map((push) => push.token)).size,
    };
  });

  await step("a muted agent leaves the island of its member, the other member still sees it", async () => {
    memberAgentLevels.set(MEMBER_1, new Map([[AGENT_A, "nothing"]]));
    const before = pushCount();
    events.emit("event", {
      type: "turn-completed",
      agentId: AGENT_A,
      threadId: AGENT_A,
      turnId: `turn-${AGENT_A}`,
      status: "completed",
    });
    const forFirst = openedProps(await pushFor(TOKEN_1, before));
    const forSecond = openedProps(latestPushFor(TOKEN_2));
    const firstContent = forFirst.content;
    const secondContent = forSecond.content;
    assert.ok(!firstContent.includes("Alpha"), "The muted agent is not in the island of member 1.");
    assert.ok(firstContent.includes("Beta"), "The control agent still shows for member 1.");
    assert.ok(secondContent.includes("Alpha"), "The other member still sees the muted agent.");
    return { firstMode: forFirst.mode, secondNamesAlpha: secondContent.includes("Alpha") };
  });

  await step("the island shows the unmuted control agent, so its event replaces a notification", async () => {
    workingAgents.delete(AGENT_B);
    const before = pushCount();
    events.emit("event", {
      type: "turn-completed",
      agentId: AGENT_B,
      threadId: AGENT_B,
      turnId: `turn-${AGENT_B}`,
      status: "completed",
    });
    await pushFor(TOKEN_1, before);
    const replyOf = (agentId: string) => ({ agentId, kind: "reply" }) as const;
    assert.equal(service.showsEvent("session-1", replyOf(AGENT_A), null, null), false);
    assert.equal(service.showsEvent("session-1", replyOf(AGENT_B), null, null), true);
    return { mutedHidden: true, controlShown: true };
  });

  await step("an unmute shows the agent again for its member", async () => {
    memberAgentLevels.set(MEMBER_1, new Map());
    workingAgents.add(AGENT_A);
    const before = pushCount();
    events.emit("event", {
      type: "turn-started",
      agentId: AGENT_A,
      threadId: AGENT_A,
      turnId: `turn-${AGENT_A}-again`,
    });
    const forFirst = openedProps(await pushFor(TOKEN_1, before));
    assert.ok(forFirst.content.includes("Alpha"), "The unmuted agent is in the island again.");
    return { firstMode: forFirst.mode };
  });

  await step("a later mute keeps the agent out of its member's island, the other member still sees it", async () => {
    memberAgentLevels.set(MEMBER_1, new Map([[AGENT_A, "nothing"]]));
    workingAgents.add(AGENT_B);
    const before = pushCount();
    events.emit("event", {
      type: "turn-started",
      agentId: AGENT_B,
      threadId: AGENT_B,
      turnId: `turn-${AGENT_B}-again`,
    });
    const forFirst = openedProps(await pushFor(TOKEN_1, before));
    const forSecond = openedProps(await pushFor(TOKEN_2, before));
    assert.ok(!forFirst.content.includes("Alpha"), "The muted agent is not in the island of member 1.");
    assert.ok(forFirst.content.includes("Beta"), "The control agent still shows for member 1.");
    assert.ok(forSecond.content.includes("Alpha"), "The other member still sees the muted agent.");
    return { perMemberIsolation: true, firstMode: forFirst.mode, secondMode: forSecond.mode };
  });
  passed = true;
} catch {
  passed = false;
} finally {
  await Effect.runPromise(service.dispose());
  const listenersRemaining = events.listenerCount("event");
  if (listenersRemaining !== 0) passed = false;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify(
      {
        passed,
        surface:
          "LiveActivityPushService memberLevels -> DynamicIslandCoordinator -> seal -> local relay -> widget open",
        transport: "injected local send adapter; no account, APNs, provider, or model",
        steps,
        pushes: pushes.map((push) => ({ event: push.event, priority: push.priority })),
        listenersRemaining,
      },
      null,
      2,
    )}\n`,
  );
}
logger.info(`live-activity-agent-mute-host-e2e: ${passed ? "passed" : "failed"} (${join(OUT, "report.json")})`);
process.exit(passed ? 0 : 1);
