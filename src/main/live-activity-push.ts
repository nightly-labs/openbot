import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { AgentRuntimeSnapshot, DynamicIslandPresentation } from "@openbot/contracts/ipc";
import { LIVE_ACTIVITY_SEALED_LIMIT, type LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import type { LiveActivityPushRegistration } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { mobileTranslateFor, resolveLocale } from "@openbot/i18n/mobile";
import { redactText, toLogValue } from "@openbot/logging";
import { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import {
  type AgentLiveActivityProps,
  type LiveActivityUnreadAgent,
  liveActivityBloubFile,
  liveActivityIslandText,
  liveActivityShorterProps,
  liveActivityView,
} from "@openbot/team-client/live-activity-props";
import {
  decodeLiveActivityBytes,
  LIVE_ACTIVITY_NONCE_BYTES,
  type LiveActivityKeys,
  liveActivityKeys,
  sealLiveActivity,
} from "@openbot/team-client/live-activity-seal";
import { Effect, Exit, Schema, Scope } from "effect";
import type { PushNotificationSubject } from "./push-notifications";
import type { TeamApiAgents } from "./team-api/dependencies";
import type { markerExclusionsForCapabilities } from "./team-api/request-helpers";

const EVENT_DELAY_MS = 1_000;
const SAME_MODE_INTERVAL_MS = 5_000;
const STALE_AFTER_MS = 15 * 60 * 1000;
const KEEPALIVE_MS = 10 * 60 * 1000;
const RETRY_MS = 15_000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const ACTIVITY_LIFETIME_MS = 8 * 60 * 60 * 1000;
const REGISTRATION_LIFETIME_MS = ACTIVITY_LIFETIME_MS + 4 * 60 * 60 * 1000;

type LiveActivityPushAgents = Pick<
  TeamApiAgents,
  "on" | "off" | "getRuntimeSnapshot" | "listConversationReads" | "listAgents"
>;

export interface LiveActivityPushOptions {
  agents: LiveActivityPushAgents;
  send(push: LiveActivityRelayPush): Effect.Effect<"sent" | "gone", LiveActivitySendFailure>;
  now?: () => number;
  randomBytes(size: number): Uint8Array;
  memberActive(memberId: string): boolean;
  sideThreadOfTurn?(agentId: string, turnId: string): string | null;
  logger?: { warn(message: string, ...values: unknown[]): void };
}

export interface LiveActivityPushViewer {
  memberId: string;
  hiddenAgentIds(): ReadonlySet<string>;
  readOptions: ReturnType<typeof markerExclusionsForCapabilities>;
}

interface Registration {
  sessionId: string;
  viewer: LiveActivityPushViewer;
  value: LiveActivityPushRegistration;
  keys: LiveActivityKeys;
  photos: Map<string, string>;
  coordinator: DynamicIslandCoordinator;
  expiresAt: number;
  startedAt: number;
  alert: LiveActivityRelayPush["alert"];
  connected: boolean;
  timer: { handle: ReturnType<typeof setTimeout>; at: number } | null;
  sent: { key: string; mode: string | null; item: string | null; workers: string[] | null; at: number } | null;
  timestamp: number;
  sending: boolean;
  failures: number;
  retryAt: number;
}

export class LiveActivityPushService {
  readonly #options: LiveActivityPushOptions;
  readonly #now: () => number;
  readonly #registrations = new Map<string, Registration>();
  readonly #listener = () => {
    for (const registration of this.#registrations.values()) this.#schedule(registration, EVENT_DELAY_MS);
  };
  #scope = Scope.makeUnsafe();
  #listening = false;

  constructor(options: LiveActivityPushOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  register(sessionId: string, viewer: LiveActivityPushViewer, value: LiveActivityPushRegistration): void {
    const secret = decodeLiveActivityBytes(value.secret);
    if (!secret) throw new Error("The Live Activity secret is not valid.");
    const previous = this.#registrations.get(sessionId);
    const same = previous?.value.token === value.token && previous.value.secret === value.secret;
    if (previous) this.#clearTimer(previous);
    if (previous && !same) this.#stop(previous);
    const now = this.#now();
    const others = [...this.#registrations.values()].filter(
      (other) => other.sessionId !== sessionId && other.value.token === value.token,
    );
    const registration: Registration = {
      sessionId,
      viewer,
      value,
      keys: same && previous ? previous.keys : liveActivityKeys(secret),
      photos: new Map(value.photos.map((photo) => [photo.agentId, photo.file])),
      coordinator:
        same && previous
          ? previous.coordinator
          : new DynamicIslandCoordinator(() => liveActivityIslandText(phoneText(value.locale))),
      expiresAt: now + REGISTRATION_LIFETIME_MS,
      startedAt: Math.min(same && previous ? previous.startedAt : now, ...others.map((other) => other.startedAt)),
      alert: null,
      connected: true,
      timer: null,
      sent: null,
      timestamp: Math.max(same && previous ? previous.timestamp : 0, ...others.map((other) => other.timestamp)),
      sending: false,
      failures: 0,
      retryAt: 0,
    };
    this.#registrations.set(sessionId, registration);
    for (const other of others) this.#stop(other);
    this.#schedule(registration, 0);
    this.#listen();
  }

  disconnected(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (!registration) return;
    registration.connected = false;
    this.#schedule(registration, 0);
  }

  reconnected(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (!registration) return;
    registration.connected = true;
    if (away(registration)) return;
    this.#clearTimer(registration);
    registration.sent = null;
    registration.alert = null;
  }

  showsEvent(
    sessionId: string,
    subject: PushNotificationSubject,
    alert: LiveActivityRelayPush["alert"],
    startedAt: number | null,
  ): boolean {
    const registration = this.#registrations.get(sessionId);
    if (!registration || !away(registration)) return false;
    if (registration.failures > 0) return false;
    if (this.#now() >= (startedAt ?? registration.startedAt) + ACTIVITY_LIFETIME_MS) return false;
    if (!presentationShows(this.#read(registration).presentation, subject)) return false;
    if (alert) {
      registration.alert = alert;
      this.#schedule(registration, EVENT_DELAY_MS);
    }
    return true;
  }

  remove(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (registration) this.#stop(registration);
  }

  readonly dispose = Effect.fn("LiveActivityPush.dispose")(function* (this: LiveActivityPushService) {
    for (const registration of [...this.#registrations.values()]) this.#stop(registration);
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
  }, Effect.uninterruptible);

  #schedule(registration: Registration, delay: number): void {
    if (this.#registrations.get(registration.sessionId) !== registration || !away(registration)) return;
    const at = Math.max(this.#now() + delay, registration.retryAt);
    if (registration.timer && registration.timer.at <= at) return;
    this.#clearTimer(registration);
    registration.timer = {
      at,
      handle: setTimeout(() => {
        registration.timer = null;
        Effect.runFork(
          this.#update(registration).pipe(
            Effect.uninterruptible,
            Effect.forkIn(this.#scope, { startImmediately: true }),
          ),
        );
      }, at - this.#now()),
    };
  }

  #update = Effect.fn("LiveActivityPush.update")(function* (this: LiveActivityPushService, registration: Registration) {
    if (this.#registrations.get(registration.sessionId) !== registration || !away(registration)) return;
    const now = this.#now();
    if (now >= registration.expiresAt || !this.#options.memberActive(registration.viewer.memberId)) {
      this.#stop(registration);
      return;
    }
    if (now >= registration.startedAt + ACTIVITY_LIFETIME_MS) {
      this.#schedule(registration, registration.expiresAt - now);
      return;
    }
    if (registration.sending) {
      this.#schedule(registration, EVENT_DELAY_MS);
      return;
    }
    if (now < registration.retryAt) {
      this.#schedule(registration, 0);
      return;
    }
    const view = this.#view(registration);
    const props = view.props;
    const mode = props?.mode ?? null;
    const item = props ? view.item : null;
    const workers = props ? view.workers : null;
    const key = JSON.stringify(props);
    const sent = registration.sent;
    const alert = props ? registration.alert : null;
    if (!alert && sent && sent.key === key && now - sent.at < KEEPALIVE_MS) {
      if (props) this.#schedule(registration, sent.at + KEEPALIVE_MS - now);
      return;
    }
    const shownWorkers = sent?.workers ?? null;
    const finished = shownWorkers !== null && (workers === null || shownWorkers.some((id) => !workers.includes(id)));
    const repeats = !sent && registration.value.away && registration.connected;
    const urgent =
      alert !== null || (item !== null && !repeats && item !== sent?.item) || finished || (!props && !sent);
    if (!urgent && sent && sent.mode === mode && now - sent.at < SAME_MODE_INTERVAL_MS) {
      this.#schedule(registration, sent.at + SAME_MODE_INTERVAL_MS - now);
      return;
    }
    const timestamp = Math.max(registration.timestamp + 1, Math.ceil(now / 1000));
    registration.timestamp = timestamp;
    const push: LiveActivityRelayPush = {
      token: registration.value.token,
      environment: registration.value.environment,
      event: props ? "update" : "end",
      sealed: props ? this.#sealToFit(props, registration.keys) : null,
      timestamp,
      staleAt: props ? Math.floor((now + STALE_AFTER_MS) / 1000) : null,
      priority: urgent ? 10 : 5,
      alert,
    };
    registration.sending = true;
    registration.sent = { key, mode, item, workers, at: now };
    yield* this.#options.send(push).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          registration.failures = 0;
          registration.retryAt = 0;
          if (registration.alert === alert) registration.alert = null;
          if (result === "gone" || !props) this.#stop(registration);
          else this.#schedule(registration, KEEPALIVE_MS);
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          registration.sent = sent;
          registration.failures += 1;
          registration.retryAt = this.#now() + Math.min(RETRY_MS * 2 ** (registration.failures - 1), RETRY_MAX_MS);
          this.#options.logger?.warn("Live Activity update was not sent:", toLogValue(error.cause));
          this.#schedule(registration, 0);
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          registration.sending = false;
        }),
      ),
    );
  });

  #sealToFit(props: AgentLiveActivityProps, keys: LiveActivityKeys): string {
    let sealed = "";
    for (const candidate of liveActivityShorterProps(props)) {
      sealed = sealLiveActivity(JSON.stringify(candidate), keys, this.#options.randomBytes(LIVE_ACTIVITY_NONCE_BYTES));
      if (sealed.length <= LIVE_ACTIVITY_SEALED_LIMIT) break;
    }
    return sealed;
  }

  #read(registration: Registration) {
    const { value, viewer, coordinator } = registration;
    const hidden = viewer.hiddenAgentIds();
    const snapshot = visibleSnapshot(this.#options.agents.getRuntimeSnapshot(), hidden);
    coordinator.applyEvent({ serverId: value.serverId, event: { type: "runtime-snapshot", snapshot } }, value.serverId);
    const reads = this.#options.agents.listConversationReads(viewer.memberId, viewer.readOptions);
    const counts = new Map(
      Object.entries(reads).flatMap(([agentId, read]) =>
        read.unreadCount > 0 && !hidden.has(agentId) ? [[agentId, read.unreadCount] as const] : [],
      ),
    );
    coordinator.replaceUnreadReplies(value.serverId, Object.fromEntries(counts));
    return { snapshot, counts, presentation: coordinator.presentation([value.serverId]) };
  }

  #view(registration: Registration) {
    const { value } = registration;
    const { snapshot, counts, presentation } = this.#read(registration);
    const unreadAgents: LiveActivityUnreadAgent[] = snapshot.agents.flatMap((agent) => {
      const count = counts.get(agent.id);
      return count && agent.notifications ? [{ ...agent, serverId: value.serverId, count }] : [];
    });
    const colors = new Map(this.#options.agents.listAgents().map((agent) => [agent.id, agent.avatarColor ?? null]));
    const props = liveActivityView(presentation, {
      t: phoneText(value.locale),
      agentColor: (agent) => avatarHeadColor(agent.avatarSeed, agent.avatarHue, colors.get(agent.id) ?? null),
      avatar: (_serverId, agent, mood) =>
        registration.photos.get(agent.id) ?? liveActivityBloubFile(agent.avatarSeed, agent.avatarHue, mood),
      unreadAgents,
      actionKey: registration.keys.action,
      threadId: this.#threadId(registration, presentation),
      redact: redactText,
    });
    return {
      props,
      item: shownItem(presentation),
      workers: presentation.mode === "working" ? presentation.working.map((work) => work.agent.id) : null,
    };
  }

  #threadId(registration: Registration, presentation: DynamicIslandPresentation): string | null {
    const requestThread = registration.coordinator.requestThreadId(presentation);
    if (requestThread) return requestThread;
    const working = registration.coordinator.workingTurn(presentation);
    return working ? (this.#options.sideThreadOfTurn?.(working.agentId, working.turnId) ?? null) : null;
  }

  #stop(registration: Registration): void {
    this.#clearTimer(registration);
    if (this.#registrations.get(registration.sessionId) === registration) {
      this.#registrations.delete(registration.sessionId);
    }
    if (this.#registrations.size === 0 && this.#listening) {
      this.#options.agents.off("event", this.#listener);
      this.#listening = false;
    }
  }

  #clearTimer(registration: Registration): void {
    if (registration.timer) clearTimeout(registration.timer.handle);
    registration.timer = null;
  }

  #listen(): void {
    if (this.#listening) return;
    this.#options.agents.on("event", this.#listener);
    this.#listening = true;
  }
}

function presentationShows(
  presentation: DynamicIslandPresentation,
  { agentId, kind, sideThread }: PushNotificationSubject,
): boolean {
  if (sideThread) return false;
  switch (presentation.mode) {
    case "message":
      return kind === "reply" && presentation.message.agent.id === agentId;
    case "question":
      return kind === "input" && presentation.item.agent.id === agentId;
    case "approval":
      return kind === "approval" && presentation.item.agent.id === agentId;
    case "takeover":
      return kind === "browser" && presentation.item.agent.id === agentId;
    case "failed":
      return kind === "failed" && presentation.item.agent.id === agentId;
    default:
      return false;
  }
}

function shownItem(presentation: DynamicIslandPresentation): string | null {
  switch (presentation.mode) {
    case "question":
    case "approval":
    case "takeover":
      return JSON.stringify([presentation.mode, presentation.item.agent.id, presentation.item.requestId]);
    case "failed":
      return JSON.stringify(["failed", presentation.item.agent.id, presentation.item.turnId]);
    case "message":
      return JSON.stringify(["message", presentation.message.agent.id, presentation.message.messageId]);
    default:
      return null;
  }
}

function away(registration: Registration): boolean {
  return registration.value.away || !registration.connected;
}

function visibleSnapshot(snapshot: AgentRuntimeSnapshot, hidden: ReadonlySet<string>): AgentRuntimeSnapshot {
  if (hidden.size === 0) return snapshot;
  const visible = <T extends { agentId: string }>(items: T[]) => items.filter((item) => !hidden.has(item.agentId));
  return {
    ...snapshot,
    agents: snapshot.agents.filter((agent) => !hidden.has(agent.id)),
    activeTurns: visible(snapshot.activeTurns),
    work: visible(snapshot.work),
    latestMessages: visible(snapshot.latestMessages),
    pendingPrompts: visible(snapshot.pendingPrompts),
    pendingApprovals: visible(snapshot.pendingApprovals),
    pendingBrowserTakeovers: visible(snapshot.pendingBrowserTakeovers),
    failedTurns: visible(snapshot.failedTurns),
  };
}

function phoneText(locale: string) {
  return mobileTranslateFor(resolveLocale("system", locale));
}

export class LiveActivitySendFailure extends Schema.TaggedError<LiveActivitySendFailure>()("LiveActivitySendFailure", {
  cause: Schema.Defect(),
}) {}
