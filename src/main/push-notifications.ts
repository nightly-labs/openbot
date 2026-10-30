import { type AgentEvent, type AgentSummary, latestTurnAnswer } from "@openbot/contracts/ipc";
import type { LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import {
  type AndroidNotificationRelayPush,
  NOTIFICATION_SEALED_LIMIT,
  type NotificationRelayPush,
  type NotificationSound,
} from "@openbot/contracts/notification-relay";
import { TEAM_CHANNEL_ATTENTION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { resolveLocale, translateFor } from "@openbot/i18n";
import { redactText, toLogValue } from "@openbot/logging";
import {
  type AgentNotificationChannel,
  agentEventCanNotify,
  agentEventRequestThread,
  notificationForAgentEvent,
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
import { Effect, Exit, Fiber, Schema, Scope } from "effect";
import { isNoUpdateAnswer } from "../backend/agent/routine-quiet-runs";
import type { PushNotificationStore, PushTarget, StoredPushRegistration } from "./push-notification-store";
import type { TeamApiAgents } from "./team-api/dependencies";

/** The answer of a turn is among the last messages of the conversation. */
const ANSWER_PAGE_SIZE = 20;
/**
 * A member who did something in a desktop or web app this recently is at that app, which shows the
 * event itself, so the phone stays quiet. This includes the events that wait for the member: the
 * desktop app asks for them. The computer of this host counts the same idle time. It is short: a task
 * can end at any time after the member leaves the computer.
 */
export const DESKTOP_USE_MS = 30 * 1000;

/** One notification for the relay route of its platform. */
export type NotificationRelayRequest =
  | { platform: "ios"; push: NotificationRelayPush }
  | { platform: "android"; push: AndroidNotificationRelayPush };

type PushNotificationAgents = Pick<TeamApiAgents, "on" | "off" | "listAgents" | "readConversationPageFor">;

interface PushNotificationOptions {
  agents: PushNotificationAgents;
  store: Pick<PushNotificationStore, "list" | "replace">;
  /** Sends one notification through the account service. `gone` means the phone gets no more. */
  send(request: NotificationRelayRequest): Effect.Effect<"sent" | "gone", PushNotificationSendFailure>;
  /** The agents that the member's phone with this protocol and these capabilities cannot see. */
  hiddenAgentIds(protocol: number, capabilities: ReadonlySet<string>, memberId: string): ReadonlySet<string>;
  /** Whether the member is still a member and not disabled. A removed member gets no more notifications. */
  memberActive(memberId: string): boolean;
  /** The last send, answer or typing of the member in a session other than this phone, or `null`. */
  lastUseElsewhere(memberId: string, sessionId: string): number | null;
  /** Whether the member is at the computer of this host, where the desktop app shows the event. */
  atHostComputer(memberId: string, event: AgentEvent): boolean;
  /**
   * Whether the session's phone shows a Live Activity of this host, which then shows the event in
   * place of a notification. With `alert`, the activity lights up the screen and plays the sound.
   * `startedAt` is the start of the activity that the phone gives, in milliseconds, or `null`.
   */
  liveActivityShows(sessionId: string, alert: LiveActivityRelayPush["alert"], startedAt: number | null): boolean;
  /** The channel whose execution thread `threadId` is, or `null` for an agent's own thread. */
  channelForThread?(threadId: string): AgentNotificationChannel | null;
  randomBytes(size: number): Uint8Array;
  now?: () => number;
  logger?: { warn(message: string, ...values: unknown[]): void };
}

/** What the phone of a member can see. */
interface PushNotificationViewer {
  memberId: string;
  protocol: number;
  capabilities: ReadonlySet<string>;
}

interface Registration {
  stored: StoredPushRegistration;
  capabilities: ReadonlySet<string>;
  keys: PushNotificationKeys;
  /** `false` after the connection of the session closed, as when iOS suspends the app. */
  connected: boolean;
}

/**
 * Sends a notification to a member's iPhone or Android phone when an agent that the member can see
 * finishes, fails, cannot start a message, or waits for input, an approval or a browser step, while
 * the app is not on screen.
 * It decides as the desktop does (`notificationForAgentEvent`): the member's level, the agent's own
 * switch, and no notification for a quiet routine run. It sends nothing while the member uses a
 * desktop app, and no answer to a message while an iPhone shows the Live Activity, which shows the
 * answer. The agent name and the text are sealed for the phone, so the account service, Apple and
 * Google see the token, the time, and sealed bytes only.
 *
 * The phones are kept in a file, so they get notifications after this computer restarts, also when
 * they do not connect again. The account service sends nothing for a session that has ended.
 */
export class PushNotificationService {
  readonly #options: PushNotificationOptions;
  readonly #now: () => number;
  readonly #registrations = new Map<string, Registration>();
  readonly #listener = (event: AgentEvent) => {
    Effect.runFork(this.#deliver(event).pipe(Effect.forkIn(this.#scope, { startImmediately: true })));
  };
  #scope = Scope.makeUnsafe();
  #listening = false;
  /** Between `start` and `dispose`. A request that comes later must not save a list without the other phones. */
  #running = false;
  /** Saves finish before `dispose` returns, so the file has the last list. */
  readonly #saves = new Set<Fiber.Fiber<void>>();

  constructor(options: PushNotificationOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** Reads the saved phones when the host starts. They count as away until they connect again. */
  start(): void {
    this.#running = true;
    for (const stored of this.#options.store.list()) {
      if (!this.#registrations.has(stored.sessionId)) this.#add(stored, false);
    }
    this.#listen();
  }

  register(sessionId: string, viewer: PushNotificationViewer, target: PushTarget): void {
    // The phone registers again when it connects to the next runtime.
    if (!this.#running) return;
    const { memberId, protocol, capabilities } = viewer;
    // The request came over the connection of this session, so it is open.
    if (!this.#add({ sessionId, memberId, protocol, capabilities: [...capabilities], ...target }, true)) {
      throw new Error("The notification secret is not valid.");
    }
    // A phone that signs in again gets a new session. The old one would notify it a second time.
    const token = target.value.token;
    for (const [other, registration] of this.#registrations) {
      if (other !== sessionId && token !== null && registration.stored.value.token === token) {
        this.#registrations.delete(other);
      }
    }
    this.#listen();
    this.#save();
  }

  /** The connection of the session closed. The phone can still come back on the same session. */
  disconnected(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (registration) registration.connected = false;
  }

  /** The path of the session came back, as when the phone app runs again. The app shows events itself. */
  reconnected(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (registration) registration.connected = true;
  }

  /** The phone turned notifications off, signed out, or the session ended. */
  remove(sessionId: string): void {
    if (this.#running && this.#registrations.delete(sessionId)) this.#save();
  }

  /** The saved phones stay in the file for the next start. */
  readonly dispose = Effect.fn("PushNotifications.dispose")(function* (this: PushNotificationService) {
    this.#running = false;
    if (this.#listening) this.#options.agents.off("event", this.#listener);
    this.#listening = false;
    this.#registrations.clear();
    yield* Fiber.awaitAll([...this.#saves]);
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
  }, Effect.uninterruptible);

  #add(stored: StoredPushRegistration, connected: boolean): boolean {
    const secret = decodeLiveActivityBytes(stored.value.secret);
    if (secret?.length !== LIVE_ACTIVITY_SECRET_BYTES) return false;
    this.#registrations.set(stored.sessionId, {
      stored,
      capabilities: new Set(stored.capabilities),
      keys: pushNotificationKeys(secret),
      connected,
    });
    return true;
  }

  #deliver = Effect.fn("PushNotifications.deliver")(function* (this: PushNotificationService, event: AgentEvent) {
    const subject = eventSubject(event);
    if (!subject) return;
    const now = this.#now();
    const targets = [...this.#registrations.values()].filter((registration) => {
      const { value, memberId, protocol, sessionId } = registration.stored;
      // While the app is on screen, it shows the event itself.
      if (!value.away && registration.connected) return false;
      if (value.mutedUntil !== null && value.mutedUntil * 1_000 > now) return false;
      if (!this.#options.memberActive(memberId)) {
        this.remove(sessionId);
        return false;
      }
      if (this.#options.hiddenAgentIds(protocol, registration.capabilities, memberId).has(subject.agentId))
        return false;
      // A member at a desktop app sees the event there, and the phone would only repeat it.
      const used = this.#options.lastUseElsewhere(memberId, sessionId);
      return !((used !== null && now - used < DESKTOP_USE_MS) || this.#options.atHostComputer(memberId, event));
    });
    if (!targets.length) return;
    const agents = this.#options.agents.listAgents();
    // A prompt, an approval or a takeover on a channel thread names the channel, as on desktop.
    const requestThread = agentEventRequestThread(event);
    const channel = requestThread ? (this.#options.channelForThread?.(requestThread) ?? null) : null;
    let answer: string | null | undefined;
    for (const registration of targets) {
      const { stored } = registration;
      const { value, memberId, sessionId } = stored;
      const translate = translateFor(resolveLocale("system", value.locale));
      // A phone from before channel-attention-v1 has no channel view, so its title names the agent only.
      const eventChannel = registration.capabilities.has(TEAM_CHANNEL_ATTENTION_CAPABILITY) ? channel : null;
      // The fixed text, as the desktop shows it without a preview.
      const fixed = notificationForAgentEvent(event, agents, translate, value.level, null, eventChannel);
      if (!fixed) continue;
      // The Live Activity of an iPhone shows the event, and a notification would repeat it. With a
      // sound, the activity also lights up the screen and plays it; without one, it updates silently.
      // A message that did not start has no turn, so the activity does not show it.
      if (stored.platform !== "android") {
        const sound = soundOf(stored.value);
        const startedAt =
          stored.value.liveActivityStartedAt === null ? null : stored.value.liveActivityStartedAt * 1_000;
        if (event.type !== "error" && this.#options.liveActivityShows(sessionId, sound ? { sound } : null, startedAt))
          continue;
        // An iPhone with notifications off registers for the sound of the Live Activity only.
        if (stored.value.token === null) continue;
      }
      if (value.preview && subject.kind === "reply" && event.type === "turn-completed" && answer === undefined) {
        answer = yield* this.#answer(event, memberId, agents);
      }
      // The desktop builds the same preview: the answer, the question, or the action to approve,
      // with its secrets redacted.
      const notice = value.preview
        ? (notificationForAgentEvent(
            event,
            agents,
            translate,
            value.level,
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
      yield* this.#send(registration, content, fixed.body);
    }
  });

  /** The answer of a turn in the agent's own chat, or `null` when it has none. */
  #answer = Effect.fn("PushNotifications.answer")(function* (
    this: PushNotificationService,
    event: Extract<AgentEvent, { type: "turn-completed" }>,
    memberId: string,
    agents: readonly AgentSummary[],
  ) {
    if (agents.find((agent) => agent.id === event.agentId)?.threadId !== event.threadId) return null;
    const page = yield* this.#options.agents
      .readConversationPageFor(event.agentId, memberId, undefined, ANSWER_PAGE_SIZE)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    const text = page ? latestTurnAnswer(page.messages, event.turnId)?.text : undefined;
    // A routine Test run shows the no-update marker in the chat, but it is not news.
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
    // A long agent name and a preview of wide characters can pass the 4 KB limit of Apple and Google.
    if (sealed.length > NOTIFICATION_SEALED_LIMIT) {
      const short = { ...content, title: content.title.slice(0, 64), body: shortBody };
      sealed = sealPushNotification(short, keys, this.#options.randomBytes(LIVE_ACTIVITY_NONCE_BYTES));
    }
    const request = relayRequest(stored, sealed, Math.floor(this.#now() / 1_000));
    if (!request) return;
    yield* this.#options.send(request).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          // The session ended, the app was removed, or Apple or Google refused the token.
          if (result === "gone" && this.#registrations.get(stored.sessionId) === registration) {
            this.remove(stored.sessionId);
          }
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => this.#options.logger?.warn("Push notification was not sent:", toLogValue(error.cause))),
      ),
    );
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

/** The relay request of the platform of the phone, or `null` for an iPhone without a token. */
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

/** The agent and the kind of an event that can notify. `notificationForAgentEvent` decides the rest. */
function eventSubject(event: AgentEvent): { agentId: string; kind: PushNotificationKind } | null {
  if (!agentEventCanNotify(event)) return null;
  switch (event.type) {
    case "turn-completed":
      return { agentId: event.agentId, kind: event.status === "completed" ? "reply" : "failed" };
    case "prompt":
      return { agentId: event.agentId, kind: "input" };
    case "approval":
      return { agentId: event.approval.agentId, kind: "approval" };
    case "browser-takeover-requested":
      return { agentId: event.request.agentId, kind: "browser" };
    // A message or a routine run that did not start failed as a turn does.
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
