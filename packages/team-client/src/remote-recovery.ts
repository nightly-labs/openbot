import type { ConversationSnapshot } from "@openbot/contracts/ipc";

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

const CONNECTION_STAGES: Record<RemoteConnectionStage, string> = {
  preferences: "Loading local chat preferences",
  connection: "Connecting to the desktop",
  compatibility: "Checking desktop compatibility",
  agents: "Loading agents",
  reads: "Loading read status",
  conversations: "Loading conversations",
};

// Only fixed protocol messages may appear in diagnostics. Arbitrary server or
// decoder errors can contain request bodies, credentials, or conversation text.
const SAFE_CONNECTION_ERRORS = new Set([
  "The app is in the background.",
  "The connection was replaced.",
  "The selected server is offline.",
  "The server disconnected.",
  "The desktop went offline.",
  "The desktop did not connect.",
  "The desktop connection needs to be restored.",
  "The host already has an active remote session.",
  "The host is offline.",
  "The remote session ended.",
  "Remote ticket is invalid or expired.",
  "The desktop identity could not be verified.",
  "The host sent data before authentication.",
  "The host event stream has a gap.",
  "The host returned a malformed event.",
  "Signal returned an invalid message.",
  "The saved chat preferences could not be read.",
  "The desktop request timed out.",
  "The remote session is invalid.",
  "The connection ticket is invalid.",
  "The WebRTC channel is not open.",
  "Signal is offline.",
  "Update OpenBot Mobile or the desktop app before connecting.",
]);

export function remoteConnectionFailure(stage: RemoteConnectionStage, error: unknown): string {
  const reason =
    error instanceof Error && SAFE_CONNECTION_ERRORS.has(error.message)
      ? error.message
      : error instanceof TypeError
        ? "TypeError."
        : error instanceof SyntaxError
          ? "SyntaxError."
          : "Unexpected error.";
  return `${CONNECTION_STAGES[stage]}: ${reason}`;
}

export function remoteRecoveryMessage(status: RemoteRecoveryStatus, failure?: string | null): string | null {
  if (status.phase === "online") return null;
  const detail = failure ? `\n${failure}` : "";
  // No countdown, because nothing is scheduled. Retrying is what this phase exists to stop.
  if (status.phase === "suspended") return `Update OpenBot Mobile or the desktop app before connecting.${detail}`;
  if (status.phase === "cooldown") {
    const minutes = Math.floor(status.remainingSeconds / 60);
    const seconds = String(status.remainingSeconds % 60).padStart(2, "0");
    return `Connection failed after ${REMOTE_RETRY_LIMIT} attempts. Retrying in ${minutes}:${seconds}.${detail}`;
  }
  if (status.phase === "waiting") {
    const reason = status.attempt === 0 ? "Connection lost." : "Connection attempt failed.";
    return `${reason} Retrying in ${status.remainingSeconds}s.${detail}`;
  }
  return `Reconnecting ${status.attempt}/${REMOTE_RETRY_LIMIT}${detail}`;
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
  let suspended = false;
  let retryRequested = false;
  let refreshRequested = false;
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
    retryRequested = false;
    refreshRequested = false;
    attempt += 1;
    onStatus({ phase: "connecting", attempt, remainingSeconds: 0 });
    try {
      await connect();
    } catch (error) {
      if (!disposed) onError(error);
      retryRequested = true;
    } finally {
      running = false;
      if (retryRequested) scheduleRetry();
      else {
        attempt = 0;
        retryAt = null;
        if (!disposed) onStatus({ phase: "online", attempt: 0, remainingSeconds: 0 });
        if (refreshRequested) void run();
      }
    }
  }

  return {
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value;
      cancelTimer();
      if (active) {
        // Coming back to the app is this phone's version of the explicit refresh the desktop asks
        // for after a protocol error, and it is the exit a user reaches without knowing there is
        // one: the desktop they left to update is the reason the frame was unreadable. One attempt
        // per return, not a loop.
        suspended = false;
        if (running) refreshRequested = true;
        else if (retryAt !== null) scheduleRetry();
        else void run();
      }
    },
    offline(error?: unknown) {
      if (disposed) return;
      if (error !== undefined) onError(error);
      retryRequested = true;
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
      suspended = true;
      retryRequested = false;
      retryAt = null;
      cancelTimer();
      if (error !== undefined) onError(error);
      onStatus({ phase: "suspended", attempt: 0, remainingSeconds: 0 });
    },
    refresh() {
      suspended = false;
      if (running) refreshRequested = true;
      else if (retryAt !== null) scheduleRetry();
      else void run();
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}

/** Merge one server/page's read state without clearing unrelated cached unread IDs. */
export function mergeRemoteUnreadIds(current: string[], reads: Record<string, { unreadCount: number }>): string[] {
  return [
    ...current.filter((id) => !(id in reads)),
    ...Object.entries(reads)
      .filter(([, state]) => state.unreadCount > 0)
      .map(([id]) => id),
  ];
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
