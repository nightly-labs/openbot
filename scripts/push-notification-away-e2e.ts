// Checks that a phone gets the notifications of events that came while it only looked on screen, and
// that a Live Activity replaces a notification only when it shows that event.
//
// iOS can suspend the app before its `away` registration goes out, and the host sees the lost path
// about 30 s later. Events in that time were lost: the host counted the app as on screen. The host
// now keeps them, and sends the ones that the member did not see when the phone turns out to be away.
// The Live Activity showed one item, but it replaced the notification of each event, also of an event
// it did not show, such as a reply while another agent worked.
//
// It runs the real phone notification service and the real Live Activity push service, wired as the
// host wires them, with a synthetic runtime snapshot and read state, and a send that records the
// requests. A first send fails, as a short fault at Apple or Google does. It sends nothing.
// Run it with `bun scripts/push-notification-away-e2e.ts`.
// Writes .openbot-build/push-notification-away-e2e/report.json.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentEvent, AgentRuntimeSnapshot, AgentSummary } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import { createOpenBotLogger } from "@openbot/logging";
import { encodeLiveActivityBytes, LIVE_ACTIVITY_SECRET_BYTES } from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import { LiveActivityPushService } from "../src/main/live-activity-push";
import {
  type NotificationRelayRequest,
  PushNotificationSendFailure,
  PushNotificationService,
} from "../src/main/push-notifications";

const OUT = resolve(import.meta.dirname, "../.openbot-build/push-notification-away-e2e");
/** Longer than the wait before kept events go out, and than the first resend. */
const STEP_DEADLINE_MS = 20_000;
const MEMBER = "fixture-member";
const ANDROID = "android-session";
const IPHONE = "iphone-session";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const logger = createOpenBotLogger("push-notification-away-e2e");
const readOptions = {
  excludeRoutineEvents: true,
  excludeRoutineRunEvents: true,
  excludeHostedSiteEvents: true,
  excludeRoutineQuietAnswers: true,
};

const events = new EventEmitter<{ event: [AgentEvent] }>();
/** The host state that both services read. */
const state: {
  working: Set<string>;
  unread: Map<string, number>;
  failedTurns: { agentId: string; turnId: string }[];
} = { working: new Set(), unread: new Map(), failedTurns: [] };
const sent: NotificationRelayRequest[] = [];
const activityPushes: LiveActivityRelayPush[] = [];
const waiters = new Set<() => void>();
let failNextSend = false;

function agentSummary(id: string): AgentSummary {
  return {
    id,
    name: id === AGENT_A ? "Agent A" : "Agent B",
    title: "",
    description: "",
    notifications: true,
    provider: "codex",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    threadId: id,
    workspacePath: "",
    preview: "Done.",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

function snapshot(): AgentRuntimeSnapshot {
  return {
    agents: [AGENT_A, AGENT_B].map((id) => ({
      id,
      name: id === AGENT_A ? "Agent A" : "Agent B",
      notifications: true,
      preview: "Done.",
      updatedAt: "2026-10-30T00:00:00.000Z",
      avatarSeed: id,
      avatarHue: null,
      avatarUrl: null,
    })),
    activeTurns: [...state.working].map((agentId) => ({ agentId, threadId: agentId, turnId: `${agentId}-running` })),
    work: [],
    latestMessages: [...state.unread.keys()].map((agentId) => ({
      agentId,
      id: `${agentId}-message`,
      text: "Done.",
      createdAt: "2026-10-30T00:00:00.000Z",
    })),
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: state.failedTurns,
  };
}

function reads() {
  return Object.fromEntries(
    [...state.unread].map(([agentId, unreadCount]) => [
      agentId,
      { unreadCount, firstUnreadMessageId: `${agentId}-message`, throughMessageId: null },
    ]),
  );
}

const agents = {
  on: (_name: "event", listener: (event: AgentEvent) => void) => events.on("event", listener),
  off: (_name: "event", listener: (event: AgentEvent) => void) => events.off("event", listener),
  listAgents: () => [agentSummary(AGENT_A), agentSummary(AGENT_B)],
  readConversationPageFor: () => Effect.die(new Error("Previews are off in this check.")),
  getRuntimeSnapshot: snapshot,
  listConversationReads: reads,
};

const liveActivity = new LiveActivityPushService({
  agents,
  send: (push) =>
    Effect.sync(() => {
      activityPushes.push(push);
      return "sent" as const;
    }),
  memberActive: (memberId) => memberId === MEMBER,
  randomBytes: (size) => new Uint8Array(randomBytes(size)),
});

const phones = new PushNotificationService({
  agents,
  store: { list: () => [], replace: () => Effect.void },
  send: (request) =>
    Effect.suspend(() => {
      if (failNextSend) {
        failNextSend = false;
        return Effect.fail(new PushNotificationSendFailure({ cause: new Error("Relay unavailable.") }));
      }
      sent.push(request);
      for (const wake of waiters) wake();
      return Effect.succeed("sent" as const);
    }),
  hiddenAgentIds: () => new Set(),
  memberActive: (memberId) => memberId === MEMBER,
  lastUseElsewhere: () => null,
  atHostComputer: () => false,
  liveActivityShows: (sessionId, subject, alert, startedAt) =>
    liveActivity.showsEvent(sessionId, subject, alert, startedAt),
  randomBytes: (size) => new Uint8Array(randomBytes(size)),
  logger,
});

const secrets = new Map([ANDROID, IPHONE].map((session) => [session, randomBytes(LIVE_ACTIVITY_SECRET_BYTES)]));
const androidSecret = encodeLiveActivityBytes(secrets.get(ANDROID) ?? new Uint8Array());
const iphoneSecret = encodeLiveActivityBytes(secrets.get(IPHONE) ?? new Uint8Array());

/** What a send says, opened with the keys of its phone as the phone opens it: `kind agent`. */
function opened(request: NotificationRelayRequest): string {
  const secret = secrets.get(request.push.sessionId);
  assert.ok(secret, "A send went to an unknown phone.");
  const keys = pushNotificationKeys(secret);
  const text = openSealedLiveActivity(
    request.push.sealed,
    encodeLiveActivityBytes(keys.seal),
    encodeLiveActivityBytes(keys.tag),
  );
  assert.ok(text, "The phone cannot open the send.");
  const content: { kind: string; agentId: string } = JSON.parse(text);
  return `${content.kind} ${content.agentId}`;
}

function registerAndroid(away: boolean): void {
  phones.register(
    ANDROID,
    { memberId: MEMBER, protocol: 7, capabilities: new Set() },
    {
      platform: "android",
      value: {
        serverId: "fixture-server",
        token: "android-token-".padEnd(40, "x"),
        secret: androidSecret,
        locale: "en",
        away,
        level: "all",
        mutedUntil: null,
        preview: false,
        sound: "default",
      },
    },
  );
}

/**
 * What the sends to `sessionId` from number `from` say, once one says `last`. Each case makes `last`
 * the final send, so a send that must not go would be in the list before it.
 */
function sendsUntil(sessionId: string, from: number, last: string): Promise<string[]> {
  return new Promise((resolveSends, reject) => {
    const deadline = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`No "${last}" send to ${sessionId} before the deadline.`));
    }, STEP_DEADLINE_MS);
    const check = () => {
      const matching = sent
        .slice(from)
        .filter((request) => request.push.sessionId === sessionId)
        .map(opened);
      if (!matching.includes(last)) return;
      clearTimeout(deadline);
      waiters.delete(check);
      resolveSends(matching);
    };
    waiters.add(check);
    check();
  });
}

const reply = (agentId: string, turnId: string): AgentEvent => ({
  type: "turn-completed",
  agentId,
  threadId: agentId,
  turnId,
  status: "completed",
});
/** A reply in another thread of the agent: the host does not know whether the member read it. */
const sideReply = (agentId: string, turnId: string): AgentEvent => ({
  type: "turn-completed",
  agentId,
  threadId: `${agentId}-side`,
  turnId,
  status: "completed",
});
const failure = (agentId: string, turnId: string): AgentEvent => ({
  type: "turn-completed",
  agentId,
  threadId: agentId,
  turnId,
  status: "failed",
});
const prompt = (requestId: number): AgentEvent => ({
  type: "prompt",
  requestId,
  agentId: AGENT_A,
  threadId: AGENT_A,
  turnId: "turn-prompt",
  questions: [{ id: "q", header: "Question", question: "Which one?", options: null, isSecret: false }],
});

const steps: { name: string; passed: boolean; detail?: unknown }[] = [];
async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    steps.push({ name, passed: true, detail: await run() });
  } catch (error) {
    steps.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

let passed = false;
try {
  phones.start();

  await step("an unread reply that came while the phone looked on screen goes out when its path fails", async () => {
    registerAndroid(false);
    const from = sent.length;
    state.unread.set(AGENT_A, 1);
    events.emit("event", reply(AGENT_A, "turn-1"));
    // iOS can have suspended the app before it showed a reply in another thread, so it goes out too.
    events.emit("event", sideReply(AGENT_B, "turn-1b"));
    // The phone looked on screen, so nothing went out. The path then fails, as when iOS suspended it.
    assert.equal(sent.length, from);
    phones.disconnected(ANDROID);
    const said = await sendsUntil(ANDROID, from, `reply ${AGENT_B}`);
    assert.deepEqual(said, [`reply ${AGENT_A}`, `reply ${AGENT_B}`]);
    return { said };
  });

  await step(
    "a read reply, a reply in another thread and an answered question stay quiet, a failed turn goes out",
    async () => {
      phones.reconnected(ANDROID);
      registerAndroid(false);
      const from = sent.length;
      // The member read this reply in the app before it went away.
      state.unread.set(AGENT_A, 0);
      events.emit("event", reply(AGENT_A, "turn-2"));
      // The app was on screen and can have shown a reply in another thread, so the host does not repeat it.
      events.emit("event", sideReply(AGENT_A, "turn-2b"));
      events.emit("event", prompt(7));
      events.emit("event", { type: "agent-input-resolved", kind: "prompt", requestId: 7, agentId: AGENT_A });
      state.failedTurns = [{ agentId: AGENT_B, turnId: "turn-3" }];
      events.emit("event", failure(AGENT_B, "turn-3"));
      // The phone says that it goes away, as when the `away` request goes out late.
      registerAndroid(true);
      // The failed turn is the last kept event, so the others were decided before it went out.
      const said = await sendsUntil(ANDROID, from, `failed ${AGENT_B}`);
      assert.deepEqual(said, [`failed ${AGENT_B}`]);
      return { said };
    },
  );

  await step("a phone that comes back at once does not get the kept events", async () => {
    registerAndroid(false);
    const from = sent.length;
    state.unread.set(AGENT_A, 1);
    events.emit("event", reply(AGENT_A, "turn-4"));
    // iOS ran the app again: the late `away` and then the return arrive together.
    registerAndroid(true);
    registerAndroid(false);
    // A later event that waits for the member is kept and goes out with the next failed path.
    events.emit("event", prompt(8));
    phones.disconnected(ANDROID);
    const said = await sendsUntil(ANDROID, from, `input ${AGENT_A}`);
    assert.deepEqual(said, [`input ${AGENT_A}`], "The reply that the app showed on screen went out.");
    return { said };
  });

  await step("a send that fails goes again", async () => {
    // The phone is away now, so the event goes out at once and the first send fails.
    const from = sent.length;
    failNextSend = true;
    events.emit("event", prompt(9));
    const said = await sendsUntil(ANDROID, from, `input ${AGENT_A}`);
    assert.equal(failNextSend, false);
    assert.deepEqual(said, [`input ${AGENT_A}`]);
    return { said };
  });

  await step("a Live Activity replaces the notification only of an event that it shows", async () => {
    phones.register(
      IPHONE,
      { memberId: MEMBER, protocol: 7, capabilities: new Set() },
      {
        value: {
          serverId: "fixture-server",
          token: "cd".repeat(32),
          environment: "development",
          secret: iphoneSecret,
          locale: "en",
          away: true,
          level: "all",
          mutedUntil: null,
          preview: false,
          sound: "default",
          liveActivityStartedAt: Math.floor(Date.now() / 1000),
        },
      },
    );
    liveActivity.register(
      IPHONE,
      { memberId: MEMBER, hiddenAgentIds: () => new Set(), readOptions },
      {
        serverId: "fixture-server",
        token: "ef".repeat(32),
        environment: "development",
        secret: iphoneSecret,
        locale: "en",
        away: true,
        photos: [],
      },
    );
    // Agent B works, so the activity shows the work and not the reply of agent A.
    const from = sent.length;
    state.failedTurns = [];
    state.working.add(AGENT_B);
    state.unread.set(AGENT_A, 1);
    events.emit("event", reply(AGENT_A, "turn-5"));
    await sendsUntil(IPHONE, from, `reply ${AGENT_A}`);
    // With nothing else to show, the activity shows the reply in place of a notification.
    state.working.delete(AGENT_B);
    events.emit("event", reply(AGENT_A, "turn-6"));
    // The activity shows the failure of agent B, and not the later failure of agent A.
    state.failedTurns = [{ agentId: AGENT_B, turnId: "turn-7" }];
    events.emit("event", failure(AGENT_B, "turn-7"));
    events.emit("event", failure(AGENT_A, "turn-8"));
    const said = await sendsUntil(IPHONE, from, `failed ${AGENT_A}`);
    assert.deepEqual(said, [`reply ${AGENT_A}`, `failed ${AGENT_A}`]);
    return { said };
  });
  passed = true;
} catch {
  passed = false;
} finally {
  await Effect.runPromise(phones.dispose());
  await Effect.runPromise(liveActivity.dispose());
  const listenersRemaining = events.listenerCount("event");
  if (listenersRemaining !== 0) passed = false;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify(
      {
        passed,
        surface: "PushNotificationService + LiveActivityPushService -> injected relay send",
        transport: "injected local send adapter; no account, APNs, FCM, provider, or model",
        steps,
        sends: sent.map((request) => ({ platform: request.platform, session: request.push.sessionId })),
        listenersRemaining,
      },
      null,
      2,
    )}\n`,
  );
}
logger.info(`push-notification-away-e2e: ${passed ? "passed" : "failed"} (${join(OUT, "report.json")})`);
process.exit(passed ? 0 : 1);
