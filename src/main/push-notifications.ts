import {
  type AgentEvent,
  type AgentSummary,
  type AgentTurnCompletedEvent,
  type ConversationMessage,
  latestTurnAnswer,
  type ServerNotificationLevel,
} from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import {
  type AndroidNotificationRelayPush,
  NOTIFICATION_SEALED_LIMIT,
  type NotificationRelayPush,
  type NotificationSound,
} from "@openbot/contracts/notification-relay";
import { TEAM_CHANNEL_ATTENTION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { PUSH_NOTIFICATION_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/push-notification-threads-v1";
import { resolveLocale, translateFor } from "@openbot/i18n";
import { redactText, toLogValue } from "@openbot/logging";
import {
  type AgentNotificationChannel,
  agentEventCanNotify,
  agentEventRequestThread,
  agentNotificationLevel,
  notificationForAgentEvent,
  teammateTurnCompleted,
} from "@openbot/team-client/agent-notifications";
import {
  decodeLiveActivityBytes,
  LIVE_ACTIVITY_NONCE_BYTES,
  LIVE_ACTIVITY_SECRET_BYTES,
} from "@openbot/team-client/live-activity-seal";
import {
  type PushNotificationContent,
  type PushNotificationKeys,
  type PushNotificationKind,
  pushNotificationKeys,
  sealPushNotification,
} from "@openbot/team-client/push-notification-seal";
import { Effect, Exit, Fiber, Result, Schema, Scope } from "effect";
import { isNoUpdateAnswer } from "../backend/agent/routine-quiet-runs";
import type { AgentService } from "../backend/agent-service";
import type { PushNotificationStore, PushTarget, StoredPushRegistration } from "./push-notification-store";
import type { TeamApiAgents } from "./team-api/dependencies";
import { markerExclusionsForCapabilities } from "./team-api/request-helpers";

const ANSWER_PAGE_SIZE = 20;
export const DESKTOP_USE_MS = 30 * 1000;
const HELD_EVENT_MS = 5 * 60 * 1000;
const HELD_EVENT_LIMIT = 20;
const HELD_FLUSH_DELAY_MS = 3_000;
const RESEND_DELAYS_MS = [10_000, 60_000] as const;

export type NotificationRelayRequest =
  | { platform: "ios"; push: NotificationRelayPush }
  | { platform: "android"; push: AndroidNotificationRelayPush };

type PushNotificationAgents = Pick<
  TeamApiAgents,
  "on" | "off" | "listAgents" | "readConversationPageFor" | "getRuntimeSnapshot" | "listConversationReads"
> &
  Pick<AgentService, "readTask">;

interface PushNotificationOptions {
  agents: PushNotificationAgents;
  store: Pick<PushNotificationStore, "list" | "replace">;
  send(request: NotificationRelayRequest): Effect.Effect<"sent" | "gone", PushNotificationSendFailure>;
  hiddenAgentIds(protocol: number, capabilities: ReadonlySet<string>, memberId: string): ReadonlySet<string>;
  memberActive(memberId: string): boolean;
  lastUseElsewhere(memberId: string, sessionId: string): number | null;
  awayAfterMs?: number;
  memberLevels?(memberId: string): {
    server: ServerNotificationLevel | null;
    agents: ReadonlyMap<string, ServerNotificationLevel>;
  };
  atHostComputer(memberId: string, event: AgentEvent): boolean;
  liveActivityShows(
    sessionId: string,
    subject: PushNotificationSubject,
    alert: LiveActivityRelayPush["alert"],
    startedAt: number | null,
  ): boolean;
  channelForThread?(threadId: string): AgentNotificationChannel | null;
  randomBytes(size: number): Uint8Array;
  now?: () => number;
  logger?: { warn(message: string, ...values: unknown[]): void };
}

interface PushNotificationViewer {
  memberId: string;
  protocol: number;
  capabilities: ReadonlySet<string>;
}

export interface PushNotificationSubject {
  agentId: string;
  kind: PushNotificationKind;
  sideThread?: boolean;
}

interface HeldEvent {
  event: AgentEvent;
  at: number;
}

interface Registration {
  stored: StoredPushRegistration;
  capabilities: ReadonlySet<string>;
  keys: PushNotificationKeys;
  connected: boolean;
  held: HeldEvent[];
  flushTimer: ReturnType<typeof setTimeout> | null;
}

export class PushNotificationService {
  readonly #options: PushNotificationOptions;
  readonly #now: () => number;
  readonly #registrations = new Map<string, Registration>();
  readonly #computerInput = new Map<string, { memberId: string; at: number }>();
  readonly #awayAfterMs: number;
  readonly #listener = (event: AgentEvent) => {
    this.#releaseAnswered(event);
    Effect.runFork(this.#deliver(event).pipe(Effect.forkIn(this.#scope, { startImmediately: true })));
  };
  #scope = Scope.makeUnsafe();
  #listening = false;
  #running = false;
  readonly #saves = new Set<Fiber.Fiber<void>>();

  constructor(options: PushNotificationOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#awayAfterMs = options.awayAfterMs ?? DESKTOP_USE_MS;
  }

  computerInput(sessionId: string, memberId: string, idleSeconds: number): boolean {
    const now = this.#now();
    for (const [other, input] of this.#computerInput) {
      if (now - input.at >= this.#awayAfterMs) this.#computerInput.delete(other);
    }
    const at = now - idleSeconds * 1_000;
    if (now - at < this.#awayAfterMs) this.#computerInput.set(sessionId, { memberId, at });
    else this.#computerInput.delete(sessionId);
    return [...this.#registrations.values()].some((registration) => registration.stored.memberId === memberId);
  }

  #lastUseElsewhere(memberId: string, sessionId: string): number | null {
    let last = this.#options.lastUseElsewhere(memberId, sessionId);
    for (const [other, input] of this.#computerInput) {
      if (other !== sessionId && input.memberId === memberId && (last === null || input.at > last)) last = input.at;
    }
    return last;
  }

  start(): void {
    this.#running = true;
    for (const stored of this.#options.store.list()) {
      if (!this.#registrations.has(stored.sessionId)) this.#add(stored, false);
    }
    this.#listen();
  }

  register(sessionId: string, viewer: PushNotificationViewer, target: PushTarget): void {
    if (!this.#running) return;
    const { memberId, protocol, capabilities } = viewer;
    const previous = this.#registrations.get(sessionId);
    const threadReplies = previous?.stored.threadReplies;
    const threadChoice = threadReplies === undefined ? {} : { threadReplies };
    const stored = { sessionId, memberId, protocol, capabilities: [...capabilities], ...threadChoice, ...target };
    if (!this.#add(stored, true, previous)) throw new Error("The notification secret is not valid.");
    const registration = this.#registrations.get(sessionId);
    if (registration && target.value.away) this.#scheduleFlush(registration);
    else if (registration) this.#dropHeld(registration);
    const token = target.value.token;
    for (const [other, registration] of this.#registrations) {
      if (other !== sessionId && token !== null && registration.stored.value.token === token) {
        this.#registrations.delete(other);
      }
    }
    this.#listen();
    this.#save();
  }

  setThreadReplies(sessionId: string, replies: boolean): void {
    const registration = this.#registrations.get(sessionId);
    if (!this.#running || !registration) return;
    if (registration.stored.threadReplies === replies) return;
    registration.stored = { ...registration.stored, threadReplies: replies };
    this.#save();
  }

  disconnected(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (!registration) return;
    registration.connected = false;
    this.#scheduleFlush(registration);
  }

  reconnected(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (!registration) return;
    registration.connected = true;
    if (!registration.stored.value.away) this.#dropHeld(registration);
  }

  remove(sessionId: string): void {
    this.#computerInput.delete(sessionId);
    const registration = this.#registrations.get(sessionId);
    if (!this.#running || !registration) return;
    this.#dropHeld(registration);
    this.#registrations.delete(sessionId);
    this.#save();
  }

  readonly dispose = Effect.fn("PushNotifications.dispose")(function* (this: PushNotificationService) {
    this.#running = false;
    if (this.#listening) this.#options.agents.off("event", this.#listener);
    this.#listening = false;
    for (const registration of this.#registrations.values()) this.#dropHeld(registration);
    this.#registrations.clear();
    this.#computerInput.clear();
    yield* Fiber.awaitAll([...this.#saves]);
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
  }, Effect.uninterruptible);

  #add(stored: StoredPushRegistration, connected: boolean, previous?: Registration): boolean {
    const secret = decodeLiveActivityBytes(stored.value.secret);
    if (secret?.length !== LIVE_ACTIVITY_SECRET_BYTES) return false;
    if (previous) this.#clearFlush(previous);
    this.#registrations.set(stored.sessionId, {
      stored,
      capabilities: new Set(stored.capabilities),
      keys: pushNotificationKeys(secret),
      connected,
      held: previous?.held ?? [],
      flushTimer: null,
    });
    return true;
  }

  #deliver = Effect.fn("PushNotifications.deliver")(function* (
    this: PushNotificationService,
    received: AgentEvent,
    only?: Registration,
  ) {
    if (teammateTurnCompleted(received)) return;
    const thread = received.type === "thread-turn-completed" ? received : null;
    const event = thread ? thread.turn : received;
    const subject = eventSubject(event, thread !== null);
    if (!subject) return;
    const now = this.#now();
    const desktopNotifies = !thread || thread.routine;
    const targets = (only ? [only] : [...this.#registrations.values()]).filter((registration) => {
      const { value, memberId, protocol, sessionId } = registration.stored;
      if (
        thread &&
        !thread.routine &&
        (!registration.capabilities.has(PUSH_NOTIFICATION_THREADS_CAPABILITY) ||
          registration.stored.threadReplies === false)
      )
        return false;
      if (!value.away && registration.connected) {
        if (!only) this.#hold(registration, received, now);
        return false;
      }
      if (value.mutedUntil !== null && value.mutedUntil * 1_000 > now) return false;
      if (!this.#options.memberActive(memberId)) {
        this.remove(sessionId);
        return false;
      }
      if (this.#options.hiddenAgentIds(protocol, registration.capabilities, memberId).has(subject.agentId))
        return false;
      const used = desktopNotifies
        ? this.#lastUseElsewhere(memberId, sessionId)
        : this.#options.lastUseElsewhere(memberId, sessionId);
      return !(
        (used !== null && now - used < this.#awayAfterMs) ||
        this.#options.atHostComputer(memberId, desktopNotifies ? event : received)
      );
    });
    if (!targets.length) return;
    const agents = this.#options.agents.listAgents();
    const userHidden = agents.some((agent) => agent.id === subject.agentId && agent.hiddenAt !== undefined);
    const requestThread = agentEventRequestThread(event);
    const channel = requestThread ? (this.#options.channelForThread?.(requestThread) ?? null) : null;
    let answer: string | null | undefined;
    for (const registration of targets) {
      const { stored } = registration;
      const { value, memberId, sessionId } = stored;
      const translate = translateFor(resolveLocale("system", value.locale));
      const chosen = this.#options.memberLevels?.(memberId);
      const level = agentNotificationLevel(
        chosen?.server ?? value.level,
        chosen?.agents ?? null,
        subject.agentId,
        userHidden,
      );
      const eventChannel = registration.capabilities.has(TEAM_CHANNEL_ATTENTION_CAPABILITY) ? channel : null;
      const fixed = notificationForAgentEvent(event, agents, translate, level, null, eventChannel);
      if (!fixed) continue;
      if (stored.platform !== "android") {
        const sound = soundOf(stored.value);
        const startedAt =
          stored.value.liveActivityStartedAt === null ? null : stored.value.liveActivityStartedAt * 1_000;
        if (
          event.type !== "error" &&
          this.#options.liveActivityShows(sessionId, subject, sound ? { sound } : null, startedAt)
        )
          continue;
        if (stored.value.token === null) continue;
      }
      if (value.preview && subject.kind === "reply" && event.type === "turn-completed" && answer === undefined) {
        answer = yield* this.#answer(event, memberId, agents, thread?.taskId ?? null);
      }
      const notice = value.preview
        ? (notificationForAgentEvent(
            event,
            agents,
            translate,
            level,
            { reply: answer ?? null, redact: redactText },
            eventChannel,
          ) ?? fixed)
        : fixed;
      const content: PushNotificationContent = {
        serverId: value.serverId,
        agentId: notice.agentId,
        threadId: notice.threadId,
        kind: subject.kind,
        title: notice.title,
        body: notice.body,
      };
      yield* this.#send(registration, content, fixed.body).pipe(Effect.forkIn(this.#scope, { startImmediately: true }));
    }
  });

  #answer = Effect.fn("PushNotifications.answer")(function* (
    this: PushNotificationService,
    event: AgentTurnCompletedEvent,
    memberId: string,
    agents: readonly AgentSummary[],
    taskId: string | null,
  ) {
    let messages: ConversationMessage[] | null = null;
    if (taskId) {
      messages = yield* Effect.try(() => this.#options.agents.readTask(event.agentId, taskId).messages).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
    } else if (agents.find((agent) => agent.id === event.agentId)?.threadId === event.threadId) {
      const page = yield* this.#options.agents
        .readConversationPageFor(event.agentId, memberId, undefined, ANSWER_PAGE_SIZE)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      messages = page?.messages ?? null;
    }
    const text = messages ? latestTurnAnswer(messages, event.turnId)?.text : undefined;
    return text && !isNoUpdateAnswer(text) ? text : null;
  });

  #send = Effect.fn("PushNotifications.send")(function* (
    this: PushNotificationService,
    registration: Registration,
    content: PushNotificationContent,
    shortBody: string,
  ) {
    const { stored, keys } = registration;
    let sealed = sealPushNotification(content, keys, this.#options.randomBytes(LIVE_ACTIVITY_NONCE_BYTES));
    if (sealed.length > NOTIFICATION_SEALED_LIMIT) {
      const short = { ...content, title: content.title.slice(0, 64), body: shortBody };
      sealed = sealPushNotification(short, keys, this.#options.randomBytes(LIVE_ACTIVITY_NONCE_BYTES));
    }
    const request = relayRequest(stored, sealed, Math.floor(this.#now() / 1_000));
    if (!request) return;
    for (let attempt = 0; ; attempt += 1) {
      const result = yield* Effect.result(this.#options.send(request));
      if (Result.isSuccess(result)) {
        if (result.success === "gone" && this.#registrations.get(stored.sessionId) === registration) {
          this.remove(stored.sessionId);
        }
        return;
      }
      const delay = RESEND_DELAYS_MS[attempt];
      if (delay === undefined) {
        this.#options.logger?.warn("Push notification was not sent:", toLogValue(result.failure.cause));
        return;
      }
      yield* Effect.sleep(delay);
      if (this.#registrations.get(stored.sessionId) !== registration) return;
    }
  });

  #hold(registration: Registration, event: AgentEvent, now: number): void {
    const held = registration.held.filter((item) => now - item.at < HELD_EVENT_MS);
    held.push({ event, at: now });
    registration.held = held.slice(-HELD_EVENT_LIMIT);
  }

  #dropHeld(registration: Registration): void {
    this.#clearFlush(registration);
    registration.held = [];
  }

  #clearFlush(registration: Registration): void {
    if (registration.flushTimer) clearTimeout(registration.flushTimer);
    registration.flushTimer = null;
  }

  #releaseAnswered(event: AgentEvent): void {
    const answered =
      event.type === "agent-input-resolved" || event.type === "browser-takeover-resolved"
        ? { agentId: event.agentId, requestId: event.requestId }
        : null;
    if (!answered) return;
    for (const registration of this.#registrations.values()) {
      registration.held = registration.held.filter(({ event: held }) => {
        const request = heldRequest(held);
        return !request || request.agentId !== answered.agentId || request.requestId !== answered.requestId;
      });
    }
  }

  #scheduleFlush(registration: Registration): void {
    if (!registration.held.length || registration.flushTimer) return;
    registration.flushTimer = setTimeout(() => {
      registration.flushTimer = null;
      if (this.#registrations.get(registration.stored.sessionId) !== registration) return;
      Effect.runFork(this.#flush(registration).pipe(Effect.forkIn(this.#scope, { startImmediately: true })));
    }, HELD_FLUSH_DELAY_MS);
  }

  #flush = Effect.fn("PushNotifications.flush")(function* (this: PushNotificationService, registration: Registration) {
    const { value, memberId } = registration.stored;
    if (!value.away && registration.connected) return;
    const now = this.#now();
    const held = registration.held.filter((item) => now - item.at < HELD_EVENT_MS);
    registration.held = [];
    if (!held.length) return;
    const snapshot = this.#options.agents.getRuntimeSnapshot();
    const reads = this.#options.agents.listConversationReads(
      memberId,
      markerExclusionsForCapabilities(registration.capabilities),
    );
    const agents = this.#options.agents.listAgents();
    const sawScreen = registration.connected;
    for (const { event } of held) {
      const unseen = heldEventUnseen(event, snapshot, reads, agents);
      if (unseen === false || (unseen === null && sawScreen)) continue;
      yield* this.#deliver(event, registration);
    }
  });

  #save(): void {
    const registrations = [...this.#registrations.values()].map((registration) => registration.stored);
    const save = Effect.runFork(
      this.#options.store
        .replace(registrations)
        .pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              this.#options.logger?.warn("Push notification phones were not saved:", toLogValue(error.cause)),
            ),
          ),
        ),
    );
    this.#saves.add(save);
    save.addObserver(() => this.#saves.delete(save));
  }

  #listen(): void {
    if (this.#listening) return;
    this.#options.agents.on("event", this.#listener);
    this.#listening = true;
  }
}

function soundOf(value: StoredPushRegistration["value"]): NotificationSound | null {
  return value.sound === "none" ? null : value.sound;
}

function relayRequest(
  stored: StoredPushRegistration,
  sealed: string,
  timestamp: number,
): NotificationRelayRequest | null {
  const { sessionId, value } = stored;
  const sound = soundOf(value);
  if (stored.platform === "android") {
    return { platform: "android", push: { token: stored.value.token, sessionId, sealed, sound, timestamp } };
  }
  const { token, environment } = stored.value;
  return token === null ? null : { platform: "ios", push: { token, environment, sessionId, sealed, sound, timestamp } };
}

function heldEventUnseen(
  event: AgentEvent,
  snapshot: ReturnType<PushNotificationAgents["getRuntimeSnapshot"]>,
  reads: ReturnType<PushNotificationAgents["listConversationReads"]>,
  agents: readonly AgentSummary[],
): boolean | null {
  if (event.type === "error" || event.type === "thread-turn-completed") return null;
  if (event.type !== "turn-completed") return true;
  if (event.status !== "completed") {
    return snapshot.failedTurns.some((failed) => failed.agentId === event.agentId && failed.turnId === event.turnId);
  }
  if (agents.find((agent) => agent.id === event.agentId)?.threadId !== event.threadId) return null;
  return (reads[event.agentId]?.unreadCount ?? 0) > 0;
}

function heldRequest(event: AgentEvent): { agentId: string; requestId: string | number } | null {
  switch (event.type) {
    case "prompt":
      return { agentId: event.agentId, requestId: event.requestId };
    case "approval":
      return { agentId: event.approval.agentId, requestId: event.approval.requestId };
    case "browser-takeover-requested":
      return { agentId: event.request.agentId, requestId: event.request.requestId };
    default:
      return null;
  }
}

function eventSubject(event: AgentEvent, sideThread: boolean): PushNotificationSubject | null {
  if (!agentEventCanNotify(event)) return null;
  switch (event.type) {
    case "turn-completed":
      return { agentId: event.agentId, kind: event.status === "completed" ? "reply" : "failed", sideThread };
    case "prompt":
      return { agentId: event.agentId, kind: "input" };
    case "approval":
      return { agentId: event.approval.agentId, kind: "approval" };
    case "browser-takeover-requested":
      return { agentId: event.request.agentId, kind: "browser" };
    case "error":
      return event.agentId ? { agentId: event.agentId, kind: "failed" } : null;
    default:
      return null;
  }
}

export class PushNotificationSendFailure extends Schema.TaggedError<PushNotificationSendFailure>()(
  "PushNotificationSendFailure",
  { cause: Schema.Defect() },
) {}
