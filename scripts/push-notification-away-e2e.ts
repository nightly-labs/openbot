import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentEvent, AgentProviderState, AgentRuntimeSnapshot, AgentSummary } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import { PUSH_NOTIFICATION_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/push-notification-threads-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { encodeLiveActivityBytes, LIVE_ACTIVITY_SECRET_BYTES } from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import { ProviderSignInWaits } from "../src/backend/agent/provider-sign-in-waits";
import { LiveActivityPushService } from "../src/main/live-activity-push";
import {
  type NotificationRelayRequest,
  PushNotificationSendFailure,
  PushNotificationService,
} from "../src/main/push-notifications";

const OUT = resolve(import.meta.dirname, "../.openbot-build/push-notification-away-e2e");
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
  readTask: () => {
    throw new Error("Previews are off in this check.");
  },
  getRuntimeSnapshot: snapshot,
  listConversationReads: reads,
  listTaskReads: () => [],
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

const signInWaits = new ProviderSignInWaits((agentId) => agentId === AGENT_A || agentId === AGENT_B);

const phones = new PushNotificationService({
  agents,
  signInWaits,
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

function openedContent(request: NotificationRelayRequest): {
  kind: string;
  agentId: string;
  title: string;
  body: string;
} {
  const secret = secrets.get(request.push.sessionId);
  assert.ok(secret, "A send went to an unknown phone.");
  const keys = pushNotificationKeys(secret);
  const text = openSealedLiveActivity(
    request.push.sealed,
    encodeLiveActivityBytes(keys.seal),
    encodeLiveActivityBytes(keys.tag),
  );
  assert.ok(text, "The phone cannot open the send.");
  return JSON.parse(text);
}

function opened(request: NotificationRelayRequest): string {
  const content = openedContent(request);
  return `${content.kind} ${content.agentId}`;
}

const providerState = (state: AgentProviderState) => ({
  providers: [{ id: "codex" as const, state, version: null, message: null }],
});

function registerAndroid(away: boolean, capabilities: string[] = []): void {
  phones.register(
    ANDROID,
    { memberId: MEMBER, protocol: 7, capabilities: new Set(capabilities) },
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

const reply = (agentId: string, turnId: string, origin: "user" | "agent" = "user"): AgentEvent => ({
  type: "turn-completed",
  agentId,
  threadId: agentId,
  turnId,
  status: "completed",
  origin,
});
const sideReply = (
  agentId: string,
  turnId: string,
  origin: "user" | "agent" = "user",
): Extract<AgentEvent, { type: "turn-completed" }> => ({
  type: "turn-completed",
  agentId,
  threadId: `${agentId}-side`,
  turnId,
  status: "completed",
  origin,
});
const failure = (agentId: string, turnId: string, origin: "user" | "agent" = "user"): AgentEvent => ({
  type: "turn-completed",
  agentId,
  threadId: agentId,
  turnId,
  status: "failed",
  origin,
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
    events.emit("event", sideReply(AGENT_B, "turn-1b"));
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
      state.unread.set(AGENT_A, 0);
      events.emit("event", reply(AGENT_A, "turn-2"));
      events.emit("event", sideReply(AGENT_A, "turn-2b"));
      events.emit("event", prompt(7));
      events.emit("event", { type: "agent-input-resolved", kind: "prompt", requestId: 7, agentId: AGENT_A });
      state.failedTurns = [{ agentId: AGENT_B, turnId: "turn-3" }];
      events.emit("event", failure(AGENT_B, "turn-3"));
      registerAndroid(true);
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
    registerAndroid(true);
    registerAndroid(false);
    events.emit("event", prompt(8));
    phones.disconnected(ANDROID);
    const said = await sendsUntil(ANDROID, from, `input ${AGENT_A}`);
    assert.deepEqual(said, [`input ${AGENT_A}`], "The reply that the app showed on screen went out.");
    return { said };
  });

  await step("a send that fails goes again", async () => {
    const from = sent.length;
    failNextSend = true;
    events.emit("event", prompt(9));
    const said = await sendsUntil(ANDROID, from, `input ${AGENT_A}`);
    assert.equal(failNextSend, false);
    assert.deepEqual(said, [`input ${AGENT_A}`]);
    return { said };
  });

  await step(
    "a turn that a teammate's message started stays quiet, a task result and a failed turn go out",
    async () => {
      registerAndroid(true, [PUSH_NOTIFICATION_THREADS_CAPABILITY]);
      const from = sent.length;
      state.unread.set(AGENT_B, 1);
      events.emit("event", reply(AGENT_B, "turn-teammate", "agent"));
      events.emit("event", {
        type: "thread-turn-completed",
        taskId: "task-1",
        routine: false,
        turn: sideReply(AGENT_A, "turn-task", "agent"),
      });
      state.failedTurns = [{ agentId: AGENT_B, turnId: "turn-teammate-failed" }];
      events.emit("event", failure(AGENT_B, "turn-teammate-failed", "agent"));
      const said = await sendsUntil(ANDROID, from, `failed ${AGENT_B}`);
      assert.deepEqual(said, [`reply ${AGENT_A}`, `failed ${AGENT_B}`]);
      return { said };
    },
  );

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
    const from = sent.length;
    state.failedTurns = [];
    state.working.add(AGENT_B);
    state.unread.set(AGENT_A, 1);
    events.emit("event", reply(AGENT_A, "turn-5"));
    await sendsUntil(IPHONE, from, `reply ${AGENT_A}`);
    state.working.delete(AGENT_B);
    events.emit("event", reply(AGENT_A, "turn-6"));
    state.failedTurns = [{ agentId: AGENT_B, turnId: "turn-7" }];
    events.emit("event", failure(AGENT_B, "turn-7"));
    events.emit("event", failure(AGENT_A, "turn-8"));
    const said = await sendsUntil(IPHONE, from, `failed ${AGENT_A}`);
    assert.deepEqual(said, [`reply ${AGENT_A}`, `failed ${AGENT_A}`]);
    return { said };
  });

  await step(
    "queued work that waits for provider sign-in sends one push to each phone until the provider is available again",
    async () => {
      state.failedTurns = [];
      const from = sent.length;
      signInWaits.note(AGENT_A, "codex");
      signInWaits.note(AGENT_A, "codex");
      signInWaits.statusChanged(providerState("checking"));
      signInWaits.statusChanged(providerState("sign-in-required"));
      signInWaits.note(AGENT_A, "codex");
      events.emit("event", failure(AGENT_B, "turn-sign-in-1"));
      const first = await sendsUntil(ANDROID, from, `failed ${AGENT_B}`);
      assert.deepEqual(first, [`sign-in ${AGENT_A}`, `failed ${AGENT_B}`]);
      const iphoneFirst = await sendsUntil(IPHONE, from, `sign-in ${AGENT_A}`);
      assert.deepEqual(
        iphoneFirst.filter((said) => said.startsWith("sign-in")),
        [`sign-in ${AGENT_A}`],
      );
      const content = sent
        .slice(from)
        .map(openedContent)
        .find((item) => item.kind === "sign-in");
      assert.equal(content?.title, "Agent A");
      assert.equal(content?.body, "Waits for ChatGPT sign-in.");
      const again = sent.length;
      signInWaits.statusChanged(providerState("available"));
      signInWaits.statusChanged(providerState("sign-in-required"));
      signInWaits.note(AGENT_A, "codex");
      events.emit("event", failure(AGENT_B, "turn-sign-in-2"));
      const second = await sendsUntil(ANDROID, again, `failed ${AGENT_B}`);
      assert.deepEqual(second, [`sign-in ${AGENT_A}`, `failed ${AGENT_B}`]);
      return { first, iphoneFirst, second, content };
    },
  );
  passed = true;
} catch {
  passed = false;
} finally {
  await Effect.runPromise(phones.dispose());
  await Effect.runPromise(liveActivity.dispose());
  const listenersRemaining = events.listenerCount("event") + signInWaits.listenerCount("signInWait");
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
