import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { AgentRuntimeSnapshot } from "@openbot/contracts/ipc";
import { LIVE_ACTIVITY_SEALED_LIMIT, type LiveActivityRelayPush } from "@openbot/contracts/live-activity-relay";
import type { LiveActivityPushRegistration } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { mobileTranslateFor, resolveLocale } from "@openbot/i18n/mobile";
import { toLogValue } from "@openbot/logging";
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
import type { TeamApiAgents } from "./team-api/dependencies";
import type { markerExclusionsForCapabilities } from "./team-api/request-helpers";

/** Events come in bursts, such as a streamed reply. One update covers each burst. */
const EVENT_DELAY_MS = 1_000;
/** iOS limits how often a Live Activity gets updates. A change inside one state waits this long. */
const SAME_MODE_INTERVAL_MS = 5_000;
/** Content older than this looks out of date, as when this computer sleeps and sends nothing. */
const STALE_AFTER_MS = 15 * 60 * 1000;
/** An unchanged state is sent again before it becomes out of date. */
const KEEPALIVE_MS = 10 * 60 * 1000;
/** A failed send is tried again, first after this time, and then after double the time. */
const RETRY_MS = 15_000;
const RETRY_MAX_MS = 5 * 60 * 1000;
/** iOS ends a Live Activity after 8 hours, and removes it from the Lock Screen 4 hours later. */
const REGISTRATION_LIFETIME_MS = 12 * 60 * 60 * 1000;

export type LiveActivityPushAgents = Pick<TeamApiAgents, "on" | "off" | "getRuntimeSnapshot" | "listConversationReads">;

export interface LiveActivityPushOptions {
  agents: LiveActivityPushAgents;
  /** Sends one update through the account service. `gone` means Apple refused the token. */
  send(push: LiveActivityRelayPush): Promise<"sent" | "gone">;
  now?: () => number;
  randomBytes(size: number): Uint8Array;
  /** Whether the member is still a member and not disabled. A removed member gets no more updates. */
  memberActive(memberId: string): boolean;
  logger?: { warn(message: string, ...values: unknown[]): void };
}

/** What the member can see. It reads the host state again for each update. */
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
  /** `false` after the connection of the session closed, as when iOS suspends the app. */
  connected: boolean;
  timer: { handle: ReturnType<typeof setTimeout>; at: number } | null;
  sent: { key: string; mode: string | null; at: number } | null;
  sending: boolean;
  /** Sends that failed in a row, for the time before the next attempt. */
  failures: number;
  /** After a failed send, no update runs before this time, also for a new agent event. */
  retryAt: number;
}

/**
 * Keeps the iOS Live Activity of a member's phone current while iOS suspends the app. The phone
 * gives its push token and a secret over the Team API, and says when it goes away. iOS can suspend
 * it before that request goes out, so a closed connection of the session also counts as away.
 * While it is away, this reads the same state the phone would read, builds the same view with the
 * shared builder, seals it, and sends it through the account service to Apple.
 *
 * Registrations live in memory only: a restart forgets them, and the phone gives them again when
 * it connects. The account service and Apple see the token, the time, and sealed bytes only.
 */
export class LiveActivityPushService {
  readonly #options: LiveActivityPushOptions;
  readonly #now: () => number;
  readonly #registrations = new Map<string, Registration>();
  readonly #listener = () => {
    for (const registration of this.#registrations.values()) this.#schedule(registration, EVENT_DELAY_MS);
  };
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
      expiresAt: this.#now() + REGISTRATION_LIFETIME_MS,
      // The request came over the connection of this session, so it is open.
      connected: true,
      timer: null,
      // The phone showed its own state last. The next update is sent, also when it matches the last one.
      sent: null,
      sending: false,
      failures: 0,
      retryAt: 0,
    };
    this.#registrations.set(sessionId, registration);
    this.#schedule(registration, 0);
    this.#listen();
  }

  /** The connection of the session closed. The phone can still come back on the same session. */
  disconnected(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (!registration) return;
    registration.connected = false;
    this.#schedule(registration, 0);
  }

  /** The phone turned Live Activities off, signed out, or chose another server. */
  remove(sessionId: string): void {
    const registration = this.#registrations.get(sessionId);
    if (registration) this.#stop(registration);
  }

  dispose(): void {
    for (const registration of [...this.#registrations.values()]) this.#stop(registration);
  }

  /** Runs an update after `delay`, or keeps an earlier one that is already planned. */
  #schedule(registration: Registration, delay: number): void {
    if (!away(registration)) return;
    const at = Math.max(this.#now() + delay, registration.retryAt);
    if (registration.timer && registration.timer.at <= at) return;
    this.#clearTimer(registration);
    registration.timer = {
      at,
      handle: setTimeout(() => {
        registration.timer = null;
        void this.#update(registration);
      }, at - this.#now()),
    };
  }

  async #update(registration: Registration): Promise<void> {
    if (this.#registrations.get(registration.sessionId) !== registration || !away(registration)) return;
    const now = this.#now();
    // Access can end while the phone is away: a removed or disabled member gets no more content.
    if (now >= registration.expiresAt || !this.#options.memberActive(registration.viewer.memberId)) {
      this.#stop(registration);
      return;
    }
    if (registration.sending) {
      this.#schedule(registration, EVENT_DELAY_MS);
      return;
    }
    // A timer from before a failed send can fire early. `#schedule` moves the update to the retry time.
    if (now < registration.retryAt) {
      this.#schedule(registration, 0);
      return;
    }
    const props = this.#view(registration);
    const mode = props?.mode ?? null;
    const key = JSON.stringify(props);
    const sent = registration.sent;
    if (sent && sent.key === key && now - sent.at < KEEPALIVE_MS) {
      if (props) this.#schedule(registration, sent.at + KEEPALIVE_MS - now);
      return;
    }
    if (sent && sent.mode === mode && now - sent.at < SAME_MODE_INTERVAL_MS) {
      this.#schedule(registration, sent.at + SAME_MODE_INTERVAL_MS - now);
      return;
    }
    const push: LiveActivityRelayPush = {
      token: registration.value.token,
      environment: registration.value.environment,
      event: props ? "update" : "end",
      sealed: props ? this.#sealToFit(props, registration.keys) : null,
      timestamp: Math.floor(now / 1000),
      staleAt: props ? Math.floor((now + STALE_AFTER_MS) / 1000) : null,
      priority: sent?.mode === mode ? 5 : 10,
    };
    registration.sending = true;
    registration.sent = { key, mode, at: now };
    try {
      const result = await this.#options.send(push);
      registration.failures = 0;
      registration.retryAt = 0;
      // Apple refused the token: the activity ended, or the app was removed.
      if (result === "gone" || !props) this.#stop(registration);
      else this.#schedule(registration, KEEPALIVE_MS);
    } catch (error) {
      // The network or Apple can fail for a time. Try again, less often each time. Without updates,
      // iOS marks the content out of date.
      registration.sent = sent;
      registration.failures += 1;
      registration.retryAt = this.#now() + Math.min(RETRY_MS * 2 ** (registration.failures - 1), RETRY_MAX_MS);
      this.#options.logger?.warn("Live Activity update was not sent:", toLogValue(error));
      this.#schedule(registration, 0);
    } finally {
      registration.sending = false;
    }
  }

  /** Apple takes 4 KB for each update, so the lists and then the buttons go when the seal is too long. */
  #sealToFit(props: AgentLiveActivityProps, keys: LiveActivityKeys): string {
    let sealed = "";
    for (const candidate of liveActivityShorterProps(props)) {
      sealed = sealLiveActivity(JSON.stringify(candidate), keys, this.#options.randomBytes(LIVE_ACTIVITY_NONCE_BYTES));
      if (sealed.length <= LIVE_ACTIVITY_SEALED_LIMIT) break;
    }
    return sealed;
  }

  #view(registration: Registration) {
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
    // An agent with its notifications off is not in the island, so it is not in the list.
    const unreadAgents: LiveActivityUnreadAgent[] = snapshot.agents.flatMap((agent) => {
      const count = counts.get(agent.id);
      return count && agent.notifications ? [{ ...agent, serverId: value.serverId, count }] : [];
    });
    return liveActivityView(coordinator.presentation([value.serverId]), {
      t: phoneText(value.locale),
      agentColor: avatarHeadColor,
      avatar: (_serverId, agent, mood) =>
        registration.photos.get(agent.id) ?? liveActivityBloubFile(agent.avatarSeed, agent.avatarHue, mood),
      unreadAgents,
      actionKey: registration.keys.action,
    });
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

/** While the phone runs, it updates the activity itself. */
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

/** The phone text. A language that this host does not have falls back to English. */
function phoneText(locale: string) {
  return mobileTranslateFor(resolveLocale("system", locale));
}
