// Checks which Live Activity updates a host sends with priority 10 while several agents run.
// iOS has an hourly budget of priority 10 updates and can delay or drop the updates above it. Before,
// each change of state had priority 10, so the work of several agents used the budget, and the update
// that the member must see came late or not at all. Now priority 10 is only for a new request, a new
// failure, a new reply, an alert, and an agent that finishes its work. Each other change has priority 5.
//
// It runs the real Live Activity push service with a synthetic runtime snapshot of two agents and a
// local relay adapter, and opens each push with the widget code. It sends nothing. Run it with
// `bun scripts/live-activity-priority-e2e.ts`. Writes .openbot-build/live-activity-priority-e2e/report.json.
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

const OUT = resolve(import.meta.dirname, "../.openbot-build/live-activity-priority-e2e");
/** A priority 5 change inside one state waits 5 seconds after the last update. */
const STEP_DEADLINE_MS = 15_000;
const SESSION = "fixture-session";
const FIRST = "fixture-agent-a";
const SECOND = "fixture-agent-b";
const AGENTS = [FIRST, SECOND] as const;
const TIME = "2026-11-13T00:00:00.000Z";
const logger = createOpenBotLogger("live-activity-priority-e2e");

const events = new EventEmitter<{ event: [AgentEvent] }>();
const secret = randomBytes(LIVE_ACTIVITY_SECRET_BYTES);
const keys = liveActivityKeys(secret);
const pushes: LiveActivityRelayPush[] = [];
const waiters = new Set<() => void>();

/** The host state. Each step changes it and then sends an agent event. */
const working = new Set<string>(AGENTS);
/** The agents that wait for an approval, the oldest request first. */
const approvals: string[] = [];
/** The unread reply of each agent. */
const replies = new Map<string, string>();

function snapshot(): AgentRuntimeSnapshot {
  return {
    agents: AGENTS.map((id) => ({
      id,
      name: id === FIRST ? "First agent" : "Second agent",
      notifications: true,
      preview: "",
      updatedAt: TIME,
      avatarSeed: id,
      avatarHue: null,
      avatarUrl: null,
    })),
    activeTurns: AGENTS.filter((id) => working.has(id)).map((id) => ({
      agentId: id,
      threadId: id,
      turnId: `turn-${id}`,
    })),
    work: [],
    latestMessages: [...replies].map(([agentId, id]) => ({ agentId, id, text: "Done.", createdAt: TIME })),
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: approvals.map((agentId) => ({
      requestId: `approval-${agentId}`,
      agentId,
      threadId: agentId,
      turnId: `turn-${agentId}`,
      kind: "command",
      command: "bun run deploy",
      cwd: null,
      reason: null,
      grantRoot: null,
      permissions: null,
      truncated: false,
    })),
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
}

/** Tells the service that the host state changed. It reads the state again and does not read the event. */
function changed(agentId: string): void {
  events.emit("event", {
    type: "turn-completed",
    agentId,
    threadId: agentId,
    turnId: `turn-${agentId}`,
    status: "completed",
  });
}

/** Waits for push number `count`, which can already have gone out. */
function pushNumber(count: number): Promise<LiveActivityRelayPush> {
  return new Promise((resolvePush, reject) => {
    const deadline = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`No push number ${count} before the deadline.`));
    }, STEP_DEADLINE_MS);
    const check = () => {
      const push = pushes[count - 1];
      if (!push) return;
      clearTimeout(deadline);
      waiters.delete(check);
      resolvePush(push);
    };
    waiters.add(check);
    check();
  });
}

/** The view that the widget shows for an update, or `null` for the end of the activity. */
function shown(push: LiveActivityRelayPush): { mode: string; agent: string; footer: string } | null {
  if (push.event === "end") return null;
  assert.ok(push.sealed, "An update must carry sealed content.");
  const opened = openSealedLiveActivity(
    push.sealed,
    encodeLiveActivityBytes(keys.seal),
    encodeLiveActivityBytes(keys.tag),
  );
  assert.ok(opened, "The widget must open the push.");
  const props = JSON.parse(opened);
  assert.ok(isDynamicRecord(props) && typeof props.mode === "string");
  // The compact view of a request names its agent.
  return { mode: props.mode, agent: String(props.compact), footer: String(props.footer) };
}

const steps: { name: string; passed: boolean; detail?: unknown }[] = [];
/** Changes the host state, then checks the mode and the priority of the push that follows. */
async function step(
  name: string,
  change: () => void,
  expected: { mode: string | null; priority: 5 | 10 },
): Promise<LiveActivityRelayPush> {
  try {
    const number = pushes.length + 1;
    change();
    const push = await pushNumber(number);
    const view = shown(push);
    const detail = { number, event: push.event, priority: push.priority, view };
    assert.equal(view?.mode ?? null, expected.mode, `${name}: the view`);
    assert.equal(push.priority, expected.priority, `${name}: the priority`);
    steps.push({ name, passed: true, detail });
    return push;
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
    listConversationReads: () =>
      Object.fromEntries(
        AGENTS.map((id) => {
          const reply = replies.get(id);
          return [
            id,
            reply
              ? { unreadCount: 1, firstUnreadMessageId: reply, throughMessageId: null }
              : { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
          ];
        }),
      ),
  },
  send: (push) =>
    Effect.sync(() => {
      pushes.push(push);
      for (const wake of waiters) wake();
      return "sent" as const;
    }),
  memberActive: (memberId) => memberId === "fixture-member",
  randomBytes,
});

/** The phone gives its token again. With `away`, it says that it leaves the foreground. */
function register(away: boolean): void {
  service.register(
    SESSION,
    {
      memberId: "fixture-member",
      hiddenAgentIds: () => new Set<string>(),
      readOptions: {
        excludeRoutineEvents: true,
        excludeRoutineRunEvents: true,
        excludeHostedSiteEvents: true,
        excludeRoutineQuietAnswers: true,
      },
    },
    {
      serverId: "fixture-server",
      token: "ab".repeat(32),
      environment: "development",
      secret: encodeLiveActivityBytes(secret),
      locale: "en",
      away,
      photos: [],
    },
  );
}

let passed = false;
try {
  await step("a phone that goes away while two agents work gets the work with priority 5", () => register(true), {
    mode: "working",
    priority: 5,
  });

  await step(
    "a new approval has priority 10",
    () => {
      approvals.push(FIRST);
      changed(FIRST);
    },
    { mode: "approval", priority: 10 },
  );

  const second = await step(
    "a second approval behind the first one changes only the count, with priority 5",
    () => {
      approvals.push(SECOND);
      changed(SECOND);
    },
    { mode: "approval", priority: 5 },
  );
  assert.equal(shown(second)?.agent, "First agent");

  const next = await step(
    "the next approval, after an answer to the first one on another device, has priority 10",
    () => {
      approvals.shift();
      changed(FIRST);
    },
    { mode: "approval", priority: 10 },
  );
  // The same state shows another request, so the state alone does not tell that the update is important.
  assert.equal(shown(next)?.agent, "Second agent");

  await step(
    "an approval that was answered on another device goes back to the work with priority 5",
    () => {
      approvals.shift();
      changed(SECOND);
    },
    { mode: "working", priority: 5 },
  );

  await step(
    "one agent that finishes while the other one works leaves the work with priority 10",
    () => {
      working.delete(FIRST);
      replies.set(FIRST, "reply-a-1");
      changed(FIRST);
    },
    { mode: "working", priority: 10 },
  );

  await step(
    "the reply at the end of all work has priority 10",
    () => {
      working.delete(SECOND);
      replies.set(SECOND, "reply-b-1");
      changed(SECOND);
    },
    { mode: "message", priority: 10 },
  );

  await step(
    "work that starts again has priority 5",
    () => {
      working.add(FIRST);
      changed(FIRST);
    },
    { mode: "working", priority: 5 },
  );

  await step(
    "work that ends with nothing to show ends the activity with priority 10",
    () => {
      working.clear();
      replies.clear();
      changed(FIRST);
    },
    { mode: null, priority: 10 },
  );

  await step(
    "a phone that says that it goes away gets the reply that it already shows with priority 5",
    () => {
      replies.set(FIRST, "reply-a-2");
      register(true);
    },
    { mode: "message", priority: 5 },
  );

  await step(
    "a phone whose connection closes can show an old view, so the reply has priority 10",
    () => {
      // The app is on screen again and shows its own view. Then iOS suspends it before it says so.
      register(false);
      service.disconnected(SESSION);
    },
    { mode: "message", priority: 10 },
  );
  passed = true;
} catch {
  passed = false;
} finally {
  await Effect.runPromise(service.dispose());
  const listenersRemaining = events.listenerCount("event");
  if (listenersRemaining !== 0) passed = false;
  const high = pushes.filter((push) => push.priority === 10).length;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify(
      {
        passed,
        surface: "LiveActivityPushService agent event -> coordinator -> priority -> seal -> local relay -> widget open",
        transport: "injected local send adapter; no account, APNs, provider, or model",
        steps,
        pushes: pushes.map((push) => ({ event: push.event, priority: push.priority })),
        highPriority: { count: high, of: pushes.length },
        listenersRemaining,
      },
      null,
      2,
    )}\n`,
  );
}
logger.info(`live-activity-priority-e2e: ${passed ? "passed" : "failed"} (${join(OUT, "report.json")})`);
process.exit(passed ? 0 : 1);
