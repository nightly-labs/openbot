// Checks that a phone notification and a Live Activity show the lead of an agent message, not all of
// it, and in words that a person reads (issue #3930): no code blocks, headings, mail headers, tool
// names or redaction marks. The secrets stay hidden, and a command with a hidden secret cannot be
// approved from the Live Activity.
//
// It runs the real phone notification service and the real Live Activity push service, with a
// synthetic conversation, runtime snapshot and read state, and a send that records the requests. It
// opens each send with the keys of the phone, as the phone does. It sends nothing.
// Run it with `bun run test:notification-summary`.
// Writes .openbot-build/notification-summary-e2e/report.json.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  AgentEvent,
  AgentRuntimeApproval,
  AgentRuntimeSnapshot,
  AgentSummary,
  ConversationPage,
} from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import {
  encodeLiveActivityBytes,
  LIVE_ACTIVITY_SECRET_BYTES,
  liveActivityKeys,
} from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { Effect } from "effect";
import { openSealedLiveActivity } from "../apps/mobile/src/features/live-activity/model/live-activity-open";
import { LiveActivityPushService } from "../src/main/live-activity-push";
import { type NotificationRelayRequest, PushNotificationService } from "../src/main/push-notifications";

const OUT = resolve(import.meta.dirname, "../.openbot-build/notification-summary-e2e");
const STEP_DEADLINE_MS = 10_000;
const MEMBER = "fixture-member";
const ANDROID = "android-session";
const IPHONE = "iphone-session";
const AGENT = "fixture-agent";
const SECRET_COMMAND =
  "curl -H 'Authorization: Bearer sk-live-4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c' https://api.example.com";
const logger = createOpenBotLogger("notification-summary-e2e");

const REPLIES = [
  {
    name: "lead of a long reply, without heading, code and tool name",
    text: [
      "## Summary",
      "",
      "I revised the onboarding skill with `openbot.revise_skill`. It now asks for the team size first. Then it proposes three plans and waits for a choice.",
      "",
      "```ts",
      "const plan = pickPlan(team);",
      "```",
      "",
      "Tell me if the order of the plans should change.",
    ].join("\n"),
    expected:
      "I revised the onboarding skill with revise skill. It now asks for the team size first. Then it proposes three plans and waits for a choice.",
  },
  {
    name: "mail headers and a hidden address",
    text: [
      "In-Reply-To: <CAF1x2y3z@mail.example.com>",
      "References: <CAF1x2y3z@mail.example.com>",
      "",
      "I answered the customer at jane.doe@example.com and closed the ticket. The refund goes out today.",
    ].join("\n"),
    expected: "I answered the customer at ••• and closed the ticket. The refund goes out today.",
  },
  {
    name: "a short first sentence takes the next one",
    text: `Timer 2:30 set. I'm holding the reminder until the timer ends, then I will ping you here with the result of the run, the open questions and the next steps for the release.\n\nNothing else changed.`,
    expected:
      "Timer 2:30 set. I'm holding the reminder until the timer ends, then I will ping you here with the result of the run, the open questions and the next steps for the release.",
  },
  {
    name: "a list after its lead line",
    text: "Here is what I found:\n- The build fails on Linux.\n- The cache is stale.\n\nNext I will fix the cache.",
    expected: "Here is what I found: The build fails on Linux. The cache is stale.",
  },
];

const events = new EventEmitter<{ event: [AgentEvent] }>();
const state: { reply: string; turnId: string; unread: number; approvals: AgentRuntimeApproval[] } = {
  reply: "",
  turnId: "",
  unread: 0,
  approvals: [],
};
const sent: NotificationRelayRequest[] = [];
const activityPushes: LiveActivityRelayPush[] = [];
const waiters = new Set<() => void>();

const summary: AgentSummary = {
  id: AGENT,
  name: "Fixture agent",
  title: "",
  description: "",
  notifications: true,
  provider: "codex",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  threadId: AGENT,
  workspacePath: "",
  preview: "",
  updatedAt: null,
  avatarSeed: AGENT,
  avatarHue: null,
  avatarUrl: null,
};

function page(): ConversationPage {
  return {
    agentId: AGENT,
    threadId: AGENT,
    activeTurnId: null,
    revision: 1,
    messages: [
      {
        id: `${state.turnId}-answer`,
        turnId: state.turnId,
        author: "assistant",
        text: state.reply,
        createdAt: "2026-10-30T00:00:00.000Z",
        status: "completed",
      },
    ],
    references: {},
    pageInfo: { hasOlder: false, olderCursor: null },
  };
}

function snapshot(): AgentRuntimeSnapshot {
  return {
    agents: [
      {
        id: AGENT,
        name: summary.name,
        notifications: true,
        preview: "",
        updatedAt: "2026-10-30T00:00:00.000Z",
        avatarSeed: AGENT,
        avatarHue: null,
        avatarUrl: null,
      },
    ],
    activeTurns: [],
    work: [],
    latestMessages: state.unread
      ? [{ agentId: AGENT, id: `${state.turnId}-answer`, text: state.reply, createdAt: "2026-10-30T00:00:00.000Z" }]
      : [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: state.approvals,
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
}

const agents = {
  on: (_name: "event", listener: (event: AgentEvent) => void) => events.on("event", listener),
  off: (_name: "event", listener: (event: AgentEvent) => void) => events.off("event", listener),
  listAgents: () => [summary],
  readConversationPageFor: () => Effect.succeed(page()),
  getRuntimeSnapshot: snapshot,
  listConversationReads: () =>
    Object.fromEntries(
      state.unread
        ? [
            [
              AGENT,
              { unreadCount: state.unread, firstUnreadMessageId: `${state.turnId}-answer`, throughMessageId: null },
            ],
          ]
        : [],
    ),
};

const wake = () => {
  for (const waiter of waiters) waiter();
};
const liveActivity = new LiveActivityPushService({
  agents,
  send: (push) =>
    Effect.sync(() => {
      activityPushes.push(push);
      wake();
      return "sent" as const;
    }),
  memberActive: (memberId) => memberId === MEMBER,
  randomBytes: (size) => new Uint8Array(randomBytes(size)),
});
const phones = new PushNotificationService({
  agents,
  store: { list: () => [], replace: () => Effect.void },
  send: (request) =>
    Effect.sync(() => {
      sent.push(request);
      wake();
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

const androidSecret = randomBytes(LIVE_ACTIVITY_SECRET_BYTES);
const iphoneSecret = randomBytes(LIVE_ACTIVITY_SECRET_BYTES);

/** The fields of an opened send that this check reads: a notification body, or Live Activity props. */
interface OpenedSend {
  body: string | null;
  mode: string | null;
  detail: string | null;
  /** Whether each Live Activity button is the prominent one, as Approve is. */
  prominentButtons: boolean[];
}

function open(sealed: string, keys: { seal: Uint8Array; tag: Uint8Array }): OpenedSend {
  const text = openSealedLiveActivity(sealed, encodeLiveActivityBytes(keys.seal), encodeLiveActivityBytes(keys.tag));
  assert.ok(text, "The phone cannot open the send.");
  const value = JSON.parse(text);
  assert.ok(isDynamicRecord(value), "The opened send is not an object.");
  const field = (name: string) => (typeof value[name] === "string" ? value[name] : null);
  return {
    body: field("body"),
    mode: field("mode"),
    detail: field("detail"),
    prominentButtons: Array.isArray(value.buttons)
      ? value.buttons.map((button) => isDynamicRecord(button) && button.prominent === true)
      : [],
  };
}

/** Waits until `ready` gives a value, or fails at the deadline. */
function waitFor<T>(what: string, ready: () => T | null): Promise<T> {
  return new Promise((resolveValue, reject) => {
    const deadline = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(`No ${what} before the deadline.`));
    }, STEP_DEADLINE_MS);
    const check = () => {
      const value = ready();
      if (value === null) return;
      clearTimeout(deadline);
      waiters.delete(check);
      resolveValue(value);
    };
    waiters.add(check);
    check();
  });
}

/** The props of the newest Live Activity update that `accept` takes. */
function activityProps(from: number, accept: (props: OpenedSend) => boolean) {
  return waitFor("Live Activity update", () => {
    for (const push of activityPushes.slice(from).reverse()) {
      if (!push.sealed) continue;
      const props = open(push.sealed, liveActivityKeys(iphoneSecret));
      if (accept(props)) return props;
    }
    return null;
  });
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

/** A text that a person reads: no redaction marks, tool names, headers or code fences. */
function assertReadable(text: string): void {
  assert.ok(!text.includes("[redacted"), "A redaction mark shows.");
  assert.ok(!/openbot\.\w+_\w+/u.test(text), "A tool name shows.");
  assert.ok(!/In-Reply-To|References:/u.test(text), "A mail header shows.");
  assert.ok(!text.includes("```") && !text.includes("##"), "Markdown blocks show.");
}

let passed = false;
try {
  phones.start();
  phones.register(
    ANDROID,
    { memberId: MEMBER, protocol: 7, capabilities: new Set() },
    {
      platform: "android",
      value: {
        serverId: "fixture-server",
        token: "android-token-".padEnd(40, "x"),
        secret: encodeLiveActivityBytes(androidSecret),
        locale: "en",
        away: true,
        level: "all",
        mutedUntil: null,
        preview: true,
        sound: "default",
      },
    },
  );

  for (const [index, reply] of REPLIES.entries()) {
    await step(`phone notification: ${reply.name}`, async () => {
      const from = sent.length;
      state.reply = reply.text;
      state.turnId = `turn-${index}`;
      events.emit("event", {
        type: "turn-completed",
        agentId: AGENT,
        threadId: AGENT,
        turnId: state.turnId,
        status: "completed",
      });
      const request = await waitFor("phone notification", () => sent[from] ?? null);
      const content = open(request.push.sealed, pushNotificationKeys(androidSecret));
      const body = content.body ?? "";
      assertReadable(body);
      assert.ok(!body.includes("jane.doe@example.com"), "The address shows.");
      assert.equal(body, reply.expected);
      return { body };
    });
  }

  liveActivity.register(
    IPHONE,
    {
      memberId: MEMBER,
      hiddenAgentIds: () => new Set(),
      readOptions: {
        excludeRoutineEvents: true,
        excludeRoutineRunEvents: true,
        excludeHostedSiteEvents: true,
        excludeRoutineQuietAnswers: true,
      },
    },
    {
      serverId: "fixture-server",
      token: "ef".repeat(32),
      environment: "development",
      secret: encodeLiveActivityBytes(iphoneSecret),
      locale: "en",
      away: true,
      photos: [],
    },
  );

  await step("Live Activity: the lead of a reply, with the address hidden", async () => {
    const from = activityPushes.length;
    const reply = REPLIES[1];
    assert.ok(reply);
    state.reply = reply.text;
    state.turnId = "turn-activity";
    state.unread = 1;
    events.emit("event", {
      type: "turn-completed",
      agentId: AGENT,
      threadId: AGENT,
      turnId: "turn-activity",
      status: "completed",
    });
    const props = await activityProps(from, (candidate) => candidate.mode === "message");
    const detail = props.detail ?? "";
    assertReadable(detail);
    assert.ok(!detail.includes("jane.doe@example.com"), "The address shows.");
    assert.equal(detail, "I answered the customer at ••• and closed the ticket. The refund goes out today.");
    return { detail };
  });

  await step("Live Activity: a command with a hidden secret has no Approve button", async () => {
    const from = activityPushes.length;
    state.unread = 0;
    state.approvals = [approval(1, SECRET_COMMAND)];
    events.emit("event", { type: "approval", approval: approval(1, SECRET_COMMAND) });
    const props = await activityProps(from, (candidate) => candidate.mode === "approval");
    const detail = props.detail ?? "";
    assert.ok(!detail.includes("sk-live-"), "The secret shows.");
    assert.ok(detail.includes("•••"), "The hidden secret has no mark.");
    assertReadable(detail);
    const buttons = props.prominentButtons;
    assert.ok(buttons.length > 0, "The activity has no buttons.");
    assert.ok(!buttons.includes(true), "The activity offers to approve a command that it does not show in full.");
    return { detail, buttons: buttons.length };
  });

  await step("Live Activity: a command without a secret keeps its Approve button", async () => {
    const from = activityPushes.length;
    state.approvals = [approval(2, "bun run test")];
    events.emit("event", { type: "agent-input-resolved", kind: "approval", requestId: 1, agentId: AGENT });
    events.emit("event", { type: "approval", approval: approval(2, "bun run test") });
    const props = await activityProps(
      from,
      (candidate) => candidate.mode === "approval" && candidate.detail === "bun run test",
    );
    const buttons = props.prominentButtons;
    assert.ok(buttons.includes(true), "The activity has no Approve button.");
    return { detail: props.detail, buttons: buttons.length };
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
        surface: "PushNotificationService + LiveActivityPushService -> injected relay send -> phone open",
        transport: "injected local send adapter; no account, APNs, FCM, provider, or model",
        steps,
        listenersRemaining,
      },
      null,
      2,
    )}\n`,
  );
}

function approval(requestId: number, command: string): AgentRuntimeApproval {
  return {
    requestId,
    agentId: AGENT,
    threadId: AGENT,
    turnId: `turn-approval-${requestId}`,
    kind: "command",
    command,
    cwd: null,
    reason: null,
    grantRoot: null,
    permissions: null,
    truncated: false,
  };
}

logger.info(`notification-summary-e2e: ${passed ? "passed" : "failed"} (${join(OUT, "report.json")})`);
process.exit(passed ? 0 : 1);
