import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  AgentEvent,
  AgentRuntimeSnapshot,
  AgentSummary,
  AgentTurnCompletedEvent,
  ConversationPage,
  ConversationSnapshot,
} from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import {
  TEAM_BOOTSTRAP_CAPABILITIES,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_PROTOCOL_V9_ONLY_CAPABILITIES,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol/current";
import { optionalRouteCodec } from "@openbot/contracts/team-protocol/optional-routes";
import {
  PUSH_NOTIFICATION_THREADS_CAPABILITY,
  PUSH_NOTIFICATION_THREADS_ROUTES,
} from "@openbot/contracts/team-protocol/push-notification-threads-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { type AgentLiveActivityProps, readLiveActivityLink } from "@openbot/team-client/live-activity-props";
import {
  encodeLiveActivityBytes,
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityKeys,
} from "@openbot/team-client/live-activity-seal";
import { type PushNotificationContent, pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { Effect } from "effect";
import {
  liveActivityRoute,
  resetLiveActivityActions,
  setLiveActivityLinkKeys,
  setLiveActivityNavigator,
} from "../apps/mobile/src/features/live-activity/model/live-activity-link";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import {
  knownSideThread,
  type OutsideTarget,
  type OutsideTargetSources,
  outsideDestination,
  sideThreadDestination,
} from "../apps/mobile/src/features/workspace/model/outside-target";
import { LiveActivityPushService } from "../src/main/live-activity-push";
import { PushNotificationStore } from "../src/main/push-notification-store";
import { type NotificationRelayRequest, PushNotificationService } from "../src/main/push-notifications";

const OUT = resolve(import.meta.dirname, "../.openbot-build/thread-notifications-e2e");
const STEP_DEADLINE_MS = 20_000;
const MEMBER = "fixture-member";
const SERVER = "fixture-server";
const AGENT = "fixture-agent";
const MAIN_THREAD = "fixture-main-thread";
const SIDE_TASK = "fixture-side-task";
const SIDE_THREAD = "fixture-side-thread";
const ROUTINE_TASK = "fixture-routine-task";
const ROUTINE_THREAD = "fixture-routine-thread";
const CHANNEL = "fixture-channel";
const CHANNEL_THREAD = "fixture-channel-thread";
const SIDE_ANSWER = "The side thread is done.";
const SIDE_WORK_TURN = "fixture-side-work-turn";
const MAIN_WORK_TURN = "fixture-main-work-turn";
const NEW_PHONE = "new-phone-session";
const OLD_PHONE = "old-phone-session";
const IPHONE = "iphone-session";
const logger = createOpenBotLogger("thread-notifications-e2e");
const readOptions = {
  excludeRoutineEvents: true,
  excludeRoutineRunEvents: true,
  excludeHostedSiteEvents: true,
  excludeRoutineQuietAnswers: true,
};

const events = new EventEmitter<{ event: [AgentEvent] }>();
const state: {
  unread: number;
  workTurn: string | null;
  failedTurn: string | null;
  prompt: AgentRuntimeSnapshot["pendingPrompts"][number] | null;
  approval: AgentRuntimeSnapshot["pendingApprovals"][number] | null;
} = { unread: 0, workTurn: null, failedTurn: null, prompt: null, approval: null };
const sent: NotificationRelayRequest[] = [];
const activityPushes: LiveActivityRelayPush[] = [];
const waiters = new Set<() => void>();

const agent: AgentSummary = {
  id: AGENT,
  name: "Fixture Agent",
  title: "",
  description: "",
  notifications: true,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  threadId: MAIN_THREAD,
  workspacePath: "",
  preview: "Done.",
  updatedAt: null,
  avatarSeed: AGENT,
  avatarHue: null,
  avatarUrl: null,
};

function snapshot(): AgentRuntimeSnapshot {
  return {
    agents: [
      {
        id: AGENT,
        name: agent.name,
        notifications: true,
        preview: "Done.",
        updatedAt: "2026-11-10T00:00:00.000Z",
        avatarSeed: AGENT,
        avatarHue: null,
        avatarUrl: null,
      },
    ],
    activeTurns:
      state.workTurn === MAIN_WORK_TURN ? [{ agentId: AGENT, threadId: MAIN_THREAD, turnId: MAIN_WORK_TURN }] : [],
    work: state.workTurn
      ? [
          {
            id: "work-delivery",
            agentId: AGENT,
            turnId: state.workTurn,
            status: "running",
            text: "Do the task.",
            error: null,
          },
        ]
      : [],
    latestMessages:
      state.unread > 0
        ? [{ agentId: AGENT, id: "main-message", text: "An older reply.", createdAt: "2026-11-10T00:00:00.000Z" }]
        : [],
    attentionComplete: true,
    pendingPrompts: state.prompt ? [state.prompt] : [],
    pendingApprovals: state.approval ? [state.approval] : [],
    pendingBrowserTakeovers: [],
    failedTurns: state.failedTurn ? [{ agentId: AGENT, turnId: state.failedTurn }] : [],
  };
}

function readTask(agentId: string, taskId: string): ConversationSnapshot {
  if (agentId !== AGENT || taskId !== SIDE_TASK) throw new Error("The thread is unknown.");
  return {
    agentId,
    threadId: SIDE_THREAD,
    activeTurnId: null,
    revision: 1,
    messages: [
      {
        id: "side-message",
        turnId: "side-turn",
        author: "assistant",
        text: SIDE_ANSWER,
        createdAt: "2026-11-10T00:00:00.000Z",
        status: "completed",
      },
    ],
  };
}

function mainPage(): ConversationPage {
  return {
    agentId: AGENT,
    threadId: MAIN_THREAD,
    activeTurnId: null,
    revision: 1,
    messages: [],
    references: {},
    pageInfo: { hasOlder: false, olderCursor: null },
  };
}

const agents = {
  on: (_name: "event", listener: (event: AgentEvent) => void) => events.on("event", listener),
  off: (_name: "event", listener: (event: AgentEvent) => void) => events.off("event", listener),
  listAgents: () => [agent],
  readConversationPageFor: () => Effect.succeed(mainPage()),
  readTask,
  getRuntimeSnapshot: snapshot,
  listTaskReads: () => [],
  listConversationReads: () =>
    Object.fromEntries(
      state.unread > 0
        ? [[AGENT, { unreadCount: state.unread, firstUnreadMessageId: "main-message", throughMessageId: null }]]
        : [],
    ),
};

const liveActivity = new LiveActivityPushService({
  agents,
  send: (push) =>
    Effect.sync(() => {
      activityPushes.push(push);
      for (const wake of waiters) wake();
      return "sent" as const;
    }),
  memberActive: (memberId) => memberId === MEMBER,
  sideThreadOfTurn: (_agentId, turnId) => (turnId === SIDE_WORK_TURN ? SIDE_THREAD : null),
  randomBytes: (size) => new Uint8Array(randomBytes(size)),
});

const directory = mkdtempSync(join(tmpdir(), "openbot-thread-notifications-"));
const storePath = join(directory, "push-notifications.json");
const store = new PushNotificationStore(storePath);

function notificationService(from: PushNotificationStore): PushNotificationService {
  return new PushNotificationService({
    agents,
    store: from,
    send: (request) =>
      Effect.sync(() => {
        sent.push(request);
        for (const wake of waiters) wake();
        return "sent" as const;
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
}

let phones = notificationService(store);

const secrets = new Map(
  [NEW_PHONE, OLD_PHONE, IPHONE].map((session) => [session, new Uint8Array(randomBytes(LIVE_ACTIVITY_SECRET_BYTES))]),
);
const secretOf = (session: string) => {
  const secret = secrets.get(session);
  assert.ok(secret, "The phone has no secret.");
  return secret;
};
const newCapabilities = new Set<string>(teamCapabilitiesForProtocol(9));
const oldCapabilities = new Set([...newCapabilities].filter((name) => name !== PUSH_NOTIFICATION_THREADS_CAPABILITY));

function registerAndroid(
  session: string,
  capabilities: ReadonlySet<string>,
  level: "all" | "needs-me" = "all",
  away = true,
) {
  phones.register(
    session,
    { memberId: MEMBER, protocol: 9, capabilities },
    {
      platform: "android",
      value: {
        serverId: SERVER,
        token: `${session}-token-`.padEnd(40, "x"),
        secret: encodeLiveActivityBytes(secretOf(session)),
        locale: "en",
        away,
        level,
        mutedUntil: null,
        preview: true,
        sound: "default",
      },
    },
  );
}

function opened(request: NotificationRelayRequest): PushNotificationContent {
  const keys = pushNotificationKeys(secretOf(request.push.sessionId));
  const text = openSealedLiveActivity(
    request.push.sealed,
    encodeLiveActivityBytes(keys.seal),
    encodeLiveActivityBytes(keys.tag),
  );
  assert.ok(text, "The phone cannot open the send.");
  const content: PushNotificationContent = JSON.parse(text);
  return content;
}

function waitFor<T>(what: string, read: () => T | null): Promise<T> {
  return new Promise((resolveValue, reject) => {
    const deadline = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`No ${what} before the deadline.`));
    }, STEP_DEADLINE_MS);
    const check = () => {
      const value = read();
      if (value === null) return;
      clearTimeout(deadline);
      waiters.delete(check);
      resolveValue(value);
    };
    waiters.add(check);
    check();
  });
}

async function sendsUntilPrompt(from: number, last: string, requestId: number): Promise<string[]> {
  const prompts = () =>
    sent.slice(from).filter((request) => request.push.sessionId === last && opened(request).kind === "input").length;
  const before = prompts();
  events.emit("event", prompt(requestId, MAIN_THREAD));
  await waitFor("closing prompt", () => (prompts() > before ? true : null));
  events.emit("event", { type: "agent-input-resolved", kind: "prompt", requestId, agentId: AGENT });
  return sent
    .slice(from)
    .map((request) => ({ session: request.push.sessionId, content: opened(request) }))
    .filter(({ content }) => content.kind !== "input")
    .map(({ session, content }) => `${session} ${content.kind} ${content.threadId}`)
    .sort();
}

const turn = (threadId: string, turnId: string, status = "completed"): AgentTurnCompletedEvent => ({
  type: "turn-completed",
  agentId: AGENT,
  threadId,
  turnId,
  status,
});
const sideTurn = (turnId: string, status?: string): AgentEvent => ({
  type: "thread-turn-completed",
  taskId: SIDE_TASK,
  routine: false,
  turn: turn(SIDE_THREAD, turnId, status),
});
const routineTurn = (turnId: string): AgentEvent => ({
  type: "thread-turn-completed",
  taskId: ROUTINE_TASK,
  routine: true,
  turn: turn(ROUTINE_THREAD, turnId),
});
const prompt = (requestId: number, threadId: string): Extract<AgentEvent, { type: "prompt" }> => ({
  type: "prompt",
  requestId,
  agentId: AGENT,
  threadId,
  turnId: "turn-prompt",
  questions: [
    {
      id: "q",
      header: "Question",
      question: "Which one?",
      options: [
        { label: "One", description: "The first." },
        { label: "Two", description: "The second." },
      ],
      isSecret: false,
    },
  ],
});

function activityProps(from: number, mode: AgentLiveActivityProps["mode"]): Promise<AgentLiveActivityProps> {
  return activityPropsWith(from, `shows ${mode}`, (props) => props.mode === mode);
}

function activityPropsWith(
  from: number,
  what: string,
  wanted: (props: AgentLiveActivityProps) => boolean,
): Promise<AgentLiveActivityProps> {
  const keys = liveActivityKeys(secretOf(IPHONE));
  return waitFor(`Live Activity update that ${what}`, () => {
    for (const push of activityPushes.slice(from).reverse()) {
      if (!push.sealed) continue;
      const text = openSealedLiveActivity(
        push.sealed,
        encodeLiveActivityBytes(keys.seal),
        encodeLiveActivityBytes(keys.tag),
      );
      assert.ok(text, "The widget cannot open the update.");
      const props: AgentLiveActivityProps = JSON.parse(text);
      if (wanted(props)) return props;
    }
    return null;
  });
}

function phoneSources(options: {
  known?: boolean;
  host?: "answers" | "refuses" | "silent";
  loads?: string[];
}): OutsideTargetSources {
  const threads = [
    { id: SIDE_TASK, threadId: SIDE_THREAD },
    { id: ROUTINE_TASK, threadId: ROUTINE_THREAD },
  ];
  return {
    channels: async () => [{ id: CHANNEL, archived: false, threads: [{ threadId: CHANNEL_THREAD }] }],
    knownThreads: () => (options.known ? threads : undefined),
    loadThreads: (_serverId, agentId) => {
      options.loads?.push(agentId);
      if (options.host === "refuses") return Promise.reject(new Error("The host has no side threads."));
      if (options.host === "silent") return new Promise(() => undefined);
      return Promise.resolve(threads);
    },
  };
}

const target = (threadId: string | null): OutsideTarget => ({ agentId: AGENT, serverId: SERVER, threadId });

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
  await Effect.runPromise(store.load());
  phones.start();

  await step("the capability is a protocol 9 capability with a codec for its route", async () => {
    const sends = (capabilities: readonly string[]) => capabilities.includes(PUSH_NOTIFICATION_THREADS_CAPABILITY);
    assert.ok(sends(TEAM_CURRENT_CAPABILITIES));
    assert.ok(TEAM_PROTOCOL_V9_ONLY_CAPABILITIES.has(PUSH_NOTIFICATION_THREADS_CAPABILITY));
    assert.ok(!sends(TEAM_BOOTSTRAP_CAPABILITIES));
    assert.ok(!sends(teamCapabilitiesForProtocol(8)));
    assert.ok(sends(teamCapabilitiesForProtocol(9)));
    const codec = optionalRouteCodec(PUSH_NOTIFICATION_THREADS_ROUTES.set);
    assert.ok(codec, "The route has no codec.");
    assert.deepEqual(codec.request({ replies: false }), { replies: false });
    assert.throws(() => codec.request({ replies: "no" }));
    assert.throws(() => codec.request({}));
    return { route: PUSH_NOTIFICATION_THREADS_ROUTES.set };
  });

  await step("a side thread turn notifies the phone that can open the thread, with its answer", async () => {
    registerAndroid(NEW_PHONE, newCapabilities);
    registerAndroid(OLD_PHONE, oldCapabilities);
    const from = sent.length;
    events.emit("event", sideTurn("side-turn"));
    const said = await sendsUntilPrompt(from, OLD_PHONE, 1);
    assert.deepEqual(said, [`${NEW_PHONE} reply ${SIDE_THREAD}`]);
    const content = opened(sent[from] ?? assert.fail("No send."));
    assert.equal(content.body, SIDE_ANSWER);
    assert.equal(content.agentId, AGENT);
    assert.equal(content.serverId, SERVER);
    return { said, body: content.body };
  });

  await step("a routine thread turn notifies each phone, as before", async () => {
    const from = sent.length;
    events.emit("event", routineTurn("routine-turn"));
    const said = await sendsUntilPrompt(from, OLD_PHONE, 2);
    assert.deepEqual(said, [`${NEW_PHONE} reply ${ROUTINE_THREAD}`, `${OLD_PHONE} reply ${ROUTINE_THREAD}`]);
    return { said };
  });

  await step("a failed side thread turn notifies, and a turn of the agent's own chat still does", async () => {
    const from = sent.length;
    events.emit("event", sideTurn("side-turn-failed", "failed"));
    events.emit("event", turn(MAIN_THREAD, "main-turn"));
    const said = await sendsUntilPrompt(from, OLD_PHONE, 3);
    assert.deepEqual(said, [
      `${NEW_PHONE} failed ${SIDE_THREAD}`,
      `${NEW_PHONE} reply ${MAIN_THREAD}`,
      `${OLD_PHONE} reply ${MAIN_THREAD}`,
    ]);
    return { said };
  });

  await step("the phone that turns thread replies off gets the other notifications only", async () => {
    phones.setThreadReplies(NEW_PHONE, false);
    const from = sent.length;
    events.emit("event", sideTurn("side-turn-2"));
    events.emit("event", routineTurn("routine-turn-2"));
    events.emit("event", turn(MAIN_THREAD, "main-turn-2"));
    events.emit("event", prompt(40, SIDE_THREAD));
    await waitFor("side thread question", () =>
      sent.slice(from).some((request) => request.push.sessionId === OLD_PHONE && opened(request).kind === "input")
        ? true
        : null,
    );
    events.emit("event", { type: "agent-input-resolved", kind: "prompt", requestId: 40, agentId: AGENT });
    const questions = sent
      .slice(from)
      .map(opened)
      .filter((content) => content.kind === "input")
      .map((content) => content.threadId);
    assert.deepEqual(questions, [SIDE_THREAD, SIDE_THREAD]);
    const said = await sendsUntilPrompt(from, OLD_PHONE, 4);
    assert.deepEqual(said, [
      `${NEW_PHONE} reply ${MAIN_THREAD}`,
      `${NEW_PHONE} reply ${ROUTINE_THREAD}`,
      `${OLD_PHONE} reply ${MAIN_THREAD}`,
      `${OLD_PHONE} reply ${ROUTINE_THREAD}`,
    ]);
    return { said, questions };
  });

  await step("the choice stays when the phone registers again and when the host restarts", async () => {
    registerAndroid(NEW_PHONE, newCapabilities);
    const from = sent.length;
    events.emit("event", sideTurn("side-turn-3"));
    assert.deepEqual(await sendsUntilPrompt(from, OLD_PHONE, 5), []);
    await Effect.runPromise(phones.dispose());
    const restarted = new PushNotificationStore(storePath);
    await Effect.runPromise(restarted.load());
    const kept = restarted.list().map((entry) => ({ session: entry.sessionId, threadReplies: entry.threadReplies }));
    assert.deepEqual(kept, [
      { session: NEW_PHONE, threadReplies: false },
      { session: OLD_PHONE, threadReplies: undefined },
    ]);
    phones = notificationService(restarted);
    phones.start();
    const afterRestart = sent.length;
    events.emit("event", sideTurn("side-turn-4"));
    assert.deepEqual(await sendsUntilPrompt(afterRestart, OLD_PHONE, 6), []);
    phones.setThreadReplies(NEW_PHONE, true);
    const on = sent.length;
    events.emit("event", sideTurn("side-turn-5"));
    const said = await sendsUntilPrompt(on, OLD_PHONE, 7);
    assert.deepEqual(said, [`${NEW_PHONE} reply ${SIDE_THREAD}`]);
    return { kept, said };
  });

  await step("the level Only when it needs me keeps a side thread turn quiet", async () => {
    registerAndroid(NEW_PHONE, newCapabilities, "needs-me");
    const from = sent.length;
    events.emit("event", sideTurn("side-turn-6"));
    assert.deepEqual(await sendsUntilPrompt(from, NEW_PHONE, 8), []);
    registerAndroid(NEW_PHONE, newCapabilities);
    return {};
  });

  await step("a side thread turn that a phone does not take does not push out an event that it keeps", async () => {
    registerAndroid(NEW_PHONE, newCapabilities, "all", false);
    phones.setThreadReplies(NEW_PHONE, false);
    const from = sent.length;
    state.unread = 1;
    events.emit("event", turn(MAIN_THREAD, "main-turn-kept"));
    for (let index = 0; index < 25; index += 1) events.emit("event", sideTurn(`side-turn-kept-${index}`));
    assert.equal(sent.slice(from).filter((request) => request.push.sessionId === NEW_PHONE).length, 0);
    phones.disconnected(NEW_PHONE);
    const kept = await waitFor("kept reply", () => {
      const request = sent.slice(from).find((candidate) => candidate.push.sessionId === NEW_PHONE);
      return request ? opened(request) : null;
    });
    assert.equal(kept.threadId, MAIN_THREAD);
    state.unread = 0;
    phones.setThreadReplies(NEW_PHONE, true);
    return { kept: kept.threadId };
  });

  phones.remove(NEW_PHONE);
  phones.remove(OLD_PHONE);
  phones.register(
    IPHONE,
    { memberId: MEMBER, protocol: 9, capabilities: newCapabilities },
    {
      value: {
        serverId: SERVER,
        token: "ab".repeat(32),
        environment: "development",
        secret: encodeLiveActivityBytes(secretOf(IPHONE)),
        locale: "en",
        away: true,
        level: "all",
        mutedUntil: null,
        preview: true,
        sound: "openbot",
        liveActivityStartedAt: Math.floor(Date.now() / 1000),
      },
    },
  );
  liveActivity.register(
    IPHONE,
    { memberId: MEMBER, hiddenAgentIds: () => new Set(), readOptions },
    {
      serverId: SERVER,
      token: "ef".repeat(32),
      environment: "development",
      secret: encodeLiveActivityBytes(secretOf(IPHONE)),
      locale: "en",
      away: true,
      photos: [],
    },
  );

  await step("a Live Activity that shows an older reply does not replace a side thread reply", async () => {
    state.unread = 1;
    const from = sent.length;
    events.emit("event", sideTurn("side-turn-7"));
    const request = await waitFor("iPhone notification", () => sent[from] ?? null);
    const content = opened(request);
    assert.equal(content.threadId, SIDE_THREAD);
    const main = sent.length;
    events.emit("event", turn(MAIN_THREAD, "main-turn-3"));
    events.emit("event", sideTurn("side-turn-8"));
    await waitFor("second side thread notification", () => sent[main] ?? null);
    assert.deepEqual(
      sent.slice(main).map((sentRequest) => opened(sentRequest).threadId),
      [SIDE_THREAD],
    );
    return { threadId: content.threadId };
  });

  await step(
    "a Live Activity that shows a failed turn of the chat does not replace a side thread failure",
    async () => {
      const shownFrom = activityPushes.length;
      state.failedTurn = "main-turn-failed";
      events.emit("event", { type: "queue-invalidated", agentId: AGENT });
      await activityProps(shownFrom, "failed");
      const from = sent.length;
      events.emit("event", sideTurn("side-turn-failed-2", "failed"));
      const content = opened(await waitFor("side thread failure", () => sent[from] ?? null));
      assert.equal(content.kind, "failed");
      assert.equal(content.threadId, SIDE_THREAD);
      state.failedTurn = null;
      return { kind: content.kind, threadId: content.threadId };
    },
  );

  const actionKey = liveActivityKeys(secretOf(IPHONE)).action;
  const keyFor = (serverId: string) => (serverId === SERVER ? actionKey : null);

  await step("the Live Activity link of the work of a side thread names that thread", async () => {
    const from = activityPushes.length;
    state.workTurn = SIDE_WORK_TURN;
    events.emit("event", { type: "queue-invalidated", agentId: AGENT });
    const side = await activityProps(from, "working");
    assert.deepEqual(readLiveActivityLink(side.tapUrl, keyFor), {
      type: "open",
      serverId: SERVER,
      agentId: AGENT,
      threadId: SIDE_THREAD,
    });
    const main = activityPushes.length;
    state.workTurn = MAIN_WORK_TURN;
    events.emit("event", { type: "queue-invalidated", agentId: AGENT });
    const chat = await activityPropsWith(
      main,
      "shows the work of the agent's own chat",
      (props) => props.mode === "working" && props.tapUrl !== side.tapUrl,
    );
    assert.equal(chat.tapUrl, `openbot://live-activity?${new URLSearchParams({ server: SERVER, agent: AGENT })}`);
    state.workTurn = null;
    return { side: side.tapUrl, chat: chat.tapUrl };
  });

  await step("the Live Activity links of a side thread question name that thread", async () => {
    const from = activityPushes.length;
    const asked = prompt(50, SIDE_THREAD);
    state.prompt = {
      requestId: asked.requestId,
      agentId: asked.agentId,
      threadId: asked.threadId,
      turnId: asked.turnId,
      questions: asked.questions,
    };
    events.emit("event", asked);
    const shown = await activityProps(from, "question");
    const tap = readLiveActivityLink(shown.tapUrl, keyFor);
    assert.deepEqual(tap, { type: "open", serverId: SERVER, agentId: AGENT, threadId: SIDE_THREAD });
    assert.equal(shown.buttons.length, 2);
    const button = readLiveActivityLink(shown.buttons[0]?.url ?? "", keyFor);
    assert.equal(button.type, "action", "The signature of the button does not match.");
    assert.equal(button.type === "action" ? button.threadId : null, SIDE_THREAD);
    const forged = readLiveActivityLink(shown.buttons[0]?.url ?? "", () => new Uint8Array(32));
    assert.deepEqual(forged, { type: "list" });
    return { tapUrl: shown.tapUrl };
  });

  await step("the running app opens the thread of a link, and a link that starts the app opens it later", async () => {
    resetLiveActivityActions();
    const openedTargets: (OutsideTarget | null)[] = [];
    const chatOpened: boolean[] = [];
    const link = `openbot://live-activity?${new URLSearchParams({ server: SERVER, agent: AGENT, thread: SIDE_THREAD })}`;
    assert.equal(liveActivityRoute(link, true), `/chat/${AGENT}?serverId=${SERVER}`);
    const stop = setLiveActivityNavigator((opened, routeOpenedChat) => {
      openedTargets.push(opened);
      chatOpened.push(routeOpenedChat === true);
    });
    assert.deepEqual(openedTargets, [target(SIDE_THREAD)]);
    assert.deepEqual(chatOpened, [true]);
    assert.equal(liveActivityRoute(link, false), null);
    assert.deepEqual(openedTargets, [target(SIDE_THREAD), target(SIDE_THREAD)]);
    assert.deepEqual(chatOpened, [true, false]);
    const plain = `openbot://live-activity?${new URLSearchParams({ server: SERVER, agent: AGENT })}`;
    assert.equal(liveActivityRoute(plain, true), `/chat/${AGENT}?serverId=${SERVER}`);
    assert.equal(liveActivityRoute(plain, false), null);
    assert.deepEqual(openedTargets.at(-1), target(null));
    assert.equal(openedTargets.length, 3, "A link without a thread opened a thread when the app started.");
    setLiveActivityLinkKeys((serverId) => keyFor(serverId) ?? new Uint8Array(32));
    const shown = await activityProps(0, "question");
    assert.equal(liveActivityRoute(shown.buttons[0]?.url ?? "", false), null);
    assert.deepEqual(openedTargets.at(-1), target(SIDE_THREAD));
    stop();
    resetLiveActivityActions();
    return { opened: openedTargets.length };
  });

  await step("the phone opens the channel, the side thread or the agent's chat of a thread", async () => {
    const known = phoneSources({ known: true });
    assert.deepEqual(await outsideDestination(target(SIDE_THREAD), known), {
      type: "thread",
      serverId: SERVER,
      agentId: AGENT,
      taskId: SIDE_TASK,
    });
    assert.deepEqual(await outsideDestination(target(CHANNEL_THREAD), known), {
      type: "channel",
      serverId: SERVER,
      channelId: CHANNEL,
    });
    assert.deepEqual(await outsideDestination(target(MAIN_THREAD), known), { type: "chat", agentId: AGENT });
    assert.deepEqual(await outsideDestination(target(null), known), { type: "chat", agentId: AGENT });
    assert.deepEqual(await outsideDestination({ agentId: AGENT, serverId: null, threadId: SIDE_THREAD }, known), {
      type: "chat",
      agentId: AGENT,
    });
    assert.equal(knownSideThread(target(MAIN_THREAD), known), null);
    return {};
  });

  await step("a thread that the phone has not read opens the chat, and then the thread from the host", async () => {
    const loads: string[] = [];
    const unread = phoneSources({ loads });
    assert.deepEqual(await outsideDestination(target(SIDE_THREAD), unread), { type: "chat", agentId: AGENT });
    assert.equal(loads.length, 0, "The first answer asked the host.");
    assert.deepEqual(await sideThreadDestination(target(SIDE_THREAD), unread, 1_000), {
      type: "thread",
      serverId: SERVER,
      agentId: AGENT,
      taskId: SIDE_TASK,
    });
    assert.equal(await sideThreadDestination(target(MAIN_THREAD), unread, 1_000), null);
    assert.equal(await sideThreadDestination(target(SIDE_THREAD), phoneSources({ host: "refuses" }), 1_000), null);
    assert.equal(await sideThreadDestination(target(SIDE_THREAD), phoneSources({ host: "silent" }), 50), null);
    assert.equal(await sideThreadDestination(target(null), unread, 1_000), null);
    return { loads };
  });

  passed = true;
} catch (error) {
  logger.error("thread-notifications-e2e failed:", error);
  passed = false;
} finally {
  await Effect.runPromise(phones.dispose());
  await Effect.runPromise(liveActivity.dispose());
  rmSync(directory, { recursive: true, force: true });
  const listenersRemaining = events.listenerCount("event");
  if (listenersRemaining !== 0) passed = false;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, "report.json"),
    `${JSON.stringify(
      {
        passed,
        surface:
          "PushNotificationService + PushNotificationStore + LiveActivityPushService -> injected relay send; phone link and thread modules",
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
logger.info(`thread-notifications-e2e: ${passed ? "passed" : "failed"} (${join(OUT, "report.json")})`);
process.exit(passed ? 0 : 1);
