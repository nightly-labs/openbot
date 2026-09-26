import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";

export const REMOTE_RETRY_INTERVAL_MS = 10_000;
export const REMOTE_RETRY_LIMIT = 5;
export const REMOTE_RETRY_COOLDOWN_MS = 120_000;

export interface RemoteRecoveryStatus {
  phase: "connecting" | "waiting" | "cooldown" | "online" | "suspended";
  attempt: number;
  remainingSeconds: number;
}

export type RemoteConnectionStage =
  | "preferences"
  | "connection"
  | "compatibility"
  | "agents"
  | "reads"
  | "conversations";

const CONNECTION_STAGES = {
  preferences: "status.remote.stagePreferences",
  connection: "status.remote.stageConnection",
  compatibility: "status.remote.stageCompatibility",
  agents: "status.remote.stageAgents",
  reads: "status.remote.stageReads",
  conversations: "status.remote.stageConversations",
} as const satisfies Record<RemoteConnectionStage, keyof SourceMessages>;

// Only fixed protocol messages may appear in diagnostics. Arbitrary server or
// decoder errors can contain request bodies, credentials, or conversation text.
const SAFE_CONNECTION_ERRORS = new Set(
  (
    [
      "error.remote.appInBackground",
      "error.remote.connectionReplaced",
      "error.remote.selectedServerOffline",
      "error.remote.serverDisconnected",
      "error.remote.desktopOffline",
      "error.remote.desktopDidNotConnect",
      "error.remote.desktopRestoreNeeded",
      "error.remote.hostSessionActive",
      "error.remote.tooManyConnections",
      "error.remote.serverRequestFailed",
      "error.remote.sessionNotActive",
      "error.remote.accountSessionEnded",
      "error.remote.hostOffline",
      "error.remote.sessionEnded",
      "error.remote.ticketInvalidOrExpired",
      "error.remote.desktopIdentityNotVerified",
      "error.remote.dataBeforeAuth",
      "error.remote.eventStreamGap",
      "error.remote.malformedEvent",
      "error.remote.signalInvalidMessage",
      "error.remote.preferencesUnreadable",
      "error.remote.desktopRequestTimeout",
      "error.remote.sessionInvalid",
      "error.remote.ticketInvalid",
      "error.remote.channelNotOpen",
      "error.remote.signalOffline",
      "error.remote.mobileUpdateRequired",
    ] as const satisfies readonly (keyof SourceMessages)[]
  ).map((key) => sourceText(key)),
);

export function remoteConnectionFailure(stage: RemoteConnectionStage, error: unknown): string {
  const reason =
    error instanceof Error && SAFE_CONNECTION_ERRORS.has(error.message)
      ? error.message
      : sourceText("error.remote.connectionStepFailed");
  return sourceText(CONNECTION_STAGES[stage], { reason });
}

export function remoteRecoveryMessage(status: RemoteRecoveryStatus, failure?: string | null): string | null {
  if (status.phase === "online") return null;
  const detail = failure || null;
  // No countdown, because nothing is scheduled. Retrying is what this phase exists to stop.
  if (status.phase === "suspended") {
    return detail
      ? sourceText("status.remote.suspendedDetail", { detail })
      : sourceText("error.remote.mobileUpdateRequired");
  }
  if (status.phase === "cooldown") {
    const minutes = Math.floor(status.remainingSeconds / 60);
    const seconds = String(status.remainingSeconds % 60).padStart(2, "0");
    const params = { limit: REMOTE_RETRY_LIMIT, minutes, seconds };
    return detail
      ? sourceText("status.remote.cooldownDetail", { ...params, detail })
      : sourceText("status.remote.cooldown", params);
  }
  const count = status.remainingSeconds;
  if (status.phase === "waiting" && status.attempt === 0) {
    return detail
      ? sourceText("status.remote.connectionLostDetail", { count, detail })
      : sourceText("status.remote.connectionLost", { count });
  }
  if (status.phase === "waiting") {
    return detail
      ? sourceText("status.remote.attemptFailedDetail", { count, detail })
      : sourceText("status.remote.attemptFailed", { count });
  }
  // The limit is the {count} value: only a number placeholder at the end keeps this text apart from its detail form.
  return detail
    ? sourceText("status.remote.reconnectingDetail", { attempt: status.attempt, count: REMOTE_RETRY_LIMIT, detail })
    : sourceText("status.remote.reconnecting", { attempt: status.attempt, count: REMOTE_RETRY_LIMIT });
}

/** One recovery attempt at a time. Background time never starts network work. */
export function createRemoteConnectionRecovery(
  connect: () => Promise<void>,
  onError: (error: unknown) => void,
  onStatus: (status: RemoteRecoveryStatus) => void = () => {},
) {
  let active = false;
  let disposed = false;
  let running = false;
  let online = false;
  let suspended = false;
  let retryRequested = false;
  let refreshRequested = false;
  let interrupted = false;
  let attempt = 0;
  let retryAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function scheduleRetry() {
    if (disposed || suspended) return;
    retryAt ??= Date.now() + (attempt >= REMOTE_RETRY_LIMIT ? REMOTE_RETRY_COOLDOWN_MS : REMOTE_RETRY_INTERVAL_MS);
    if (!active) return;
    const remaining = Math.max(0, retryAt - Date.now());
    if (remaining === 0 && !running) {
      retryAt = null;
      if (attempt >= REMOTE_RETRY_LIMIT) attempt = 0;
      void run();
      return;
    }
    onStatus({
      phase: attempt >= REMOTE_RETRY_LIMIT ? "cooldown" : "waiting",
      attempt,
      remainingSeconds: Math.ceil(remaining / 1000),
    });
    // Offline can arrive before the bridge finishes its command. Show the failure
    // immediately, but let run's finally start an overdue retry after cleanup.
    if (timer !== null || remaining === 0) return;
    // The one-second tick only updates the UI; network work starts at the deadline.
    timer = setTimeout(
      () => {
        timer = null;
        scheduleRetry();
      },
      Math.min(1000, remaining),
    );
  }

  async function run() {
    if (!active || disposed || running || suspended) return;
    cancelTimer();
    running = true;
    const checkingConnection = online;
    retryRequested = false;
    refreshRequested = false;
    interrupted = false;
    attempt += 1;
    // A foreground read is not a lost connection. Keep the workspace usable
    // until the transport reports a failure or the read fails.
    if (!online) onStatus({ phase: "connecting", attempt, remainingSeconds: 0 });
    try {
      await connect();
    } catch (error) {
      if (error instanceof Error && error.message === sourceText("error.remote.appInBackground")) {
        interrupted = true;
        retryRequested = false;
        retryAt = null;
        return;
      }
      if (active) {
        online = false;
        if (!disposed) onError(error);
      }
      retryRequested = true;
      // A read on a previously usable peer detected a dead connection. Its first
      // replacement starts now; only a failed replacement earns a retry delay.
      if (checkingConnection) {
        attempt = 0;
        retryAt = Date.now();
      }
      scheduleRetry();
    } finally {
      running = false;
      if (!disposed && !suspended && active) {
        if (refreshRequested) {
          retryAt = null;
          void run();
        } else if (retryRequested) scheduleRetry();
        else if (interrupted) void run();
        else {
          online = true;
          attempt = 0;
          retryAt = null;
          onStatus({ phase: "online", attempt: 0, remainingSeconds: 0 });
        }
      }
    }
  }

  return {
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value;
      cancelTimer();
      if (!active && running) {
        // Background entry invalidates the consumer's pending workspace reads.
        interrupted = true;
      }
      if (active) {
        // Coming back to the app is this phone's version of the explicit refresh the desktop asks
        // for after a protocol error, and it is the exit a user reaches without knowing there is
        // one: the desktop they left to update is the reason the frame was unreadable. One attempt
        // per return, not a loop.
        suspended = false;
        if (running) return;
        else if (retryAt !== null) scheduleRetry();
        else void run();
      }
    },
    offline(error?: unknown) {
      if (disposed) return;
      online = false;
      if (error !== undefined) onError(error);
      retryRequested = true;
      // Losing a connection is not a failed reconnection attempt.
      if (!running && retryAt === null) retryAt = Date.now();
      scheduleRetry();
    },
    /**
     * A failure no retry can fix: the two ends disagree about the wire, so the next attempt is told
     * the same thing. Stops the loop rather than joining it -- `offline` would schedule five
     * attempts ten seconds apart and then one every two minutes, for as long as the app is open.
     * Reversible: `refresh`, returning to the foreground, and switching servers each clear it.
     */
    suspend(error?: unknown) {
      if (disposed) return;
      online = false;
      suspended = true;
      retryRequested = false;
      retryAt = null;
      cancelTimer();
      if (error !== undefined) onError(error);
      onStatus({ phase: "suspended", attempt: 0, remainingSeconds: 0 });
    },
    refresh() {
      if (disposed) return;
      suspended = false;
      retryAt = null;
      attempt = 0;
      cancelTimer();
      if (running || !active) refreshRequested = true;
      else void run();
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}

/** Order initial and event reads together, without invalidating another server's responses. */
export function createRemoteReadRefresh() {
  const requests = new Map<string, number>();
  const cursors = new Map<string, number>();
  return {
    invalidate(serverId: string): () => boolean {
      const cursor = (cursors.get(serverId) ?? 0) + 1;
      cursors.set(serverId, cursor);
      return () => cursors.get(serverId) === cursor;
    },
    async refresh<T>(
      serverId: string,
      load: () => Promise<T>,
      apply: (value: T) => void,
      isCurrent: () => boolean,
    ): Promise<void> {
      const request = (requests.get(serverId) ?? 0) + 1;
      requests.set(serverId, request);
      const cursor = cursors.get(serverId);
      const value = await load();
      if (requests.get(serverId) === request && cursors.get(serverId) === cursor && isCurrent()) apply(value);
    },
  };
}

/**
 * Merge one server/page's read state without clearing unrelated cached unread IDs. An unchanged
 * result returns `current`, so a state setter does not notify consumers for a read refresh that
 * changed nothing.
 */
export function mergeRemoteUnreadIds(current: string[], reads: Record<string, { unreadCount: number }>): string[] {
  const next = [
    ...current.filter((id) => !(id in reads)),
    ...Object.entries(reads)
      .filter(([, state]) => state.unreadCount > 0)
      .map(([id]) => id),
  ];
  return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
}

/** Only conversations cached for agents in this server need recovery. */
export async function resyncRemoteConversations(input: {
  agentIds: string[];
  cached: Record<string, ConversationSnapshot>;
  load: (agentId: string) => Promise<ConversationSnapshot>;
  apply: (snapshot: ConversationSnapshot) => void;
  isCurrent: () => boolean;
}): Promise<void> {
  for (const agentId of input.agentIds) {
    if (!input.isCurrent()) return;
    if (!input.cached[agentId]) continue;
    const snapshot = await input.load(agentId);
    if (!input.isCurrent()) return;
    input.apply(snapshot);
  }
}
