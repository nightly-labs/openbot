import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { SIDEBAR_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { errorReference } from "@openbot/user-errors/reference";
import { Effect, Result, Schema } from "effect";
import { runTeamEffect } from "./effect-boundary";

class RemoteRecoveryError extends Schema.TaggedError<RemoteRecoveryError>()("RemoteRecoveryError", {
  message: Schema.String,
  reference: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

const recoveryCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (error) =>
      new RemoteRecoveryError({
        message: error instanceof Error ? error.message : sourceText("error.remote.operationFailed"),
        reference: errorReference(error),
      }),
  });

export const REMOTE_RETRY_INTERVAL_MS = 2_000;
export const REMOTE_RETRY_LIMIT = 5;
export const REMOTE_RETRY_COOLDOWN_MS = 30_000;
const REMOTE_RETRY_JITTER = 0.2;

function remoteRetryDelay(attempt: number): number {
  const delay =
    attempt >= REMOTE_RETRY_LIMIT ? REMOTE_RETRY_COOLDOWN_MS : REMOTE_RETRY_INTERVAL_MS * 2 ** Math.max(0, attempt - 1);
  return Math.round(delay * (1 + REMOTE_RETRY_JITTER * Math.random()));
}

export interface RemoteRecoveryStatus {
  phase: "connecting" | "waiting" | "cooldown" | "online" | "suspended";
  attempt: number;
  remainingSeconds: number;
}

export type RemoteConnectionStage = "preferences" | "connection" | "compatibility" | "agents" | "reads";

const CONNECTION_STAGES = {
  preferences: "status.remote.stagePreferences",
  connection: "status.remote.stageConnection",
  compatibility: "status.remote.stageCompatibility",
  agents: "status.remote.stageAgents",
  reads: "status.remote.stageReads",
} as const satisfies Record<RemoteConnectionStage, keyof SourceMessages>;

const SAFE_CONNECTION_ERRORS = new Set(
  (
    [
      "error.remote.appInBackground",
      "error.remote.connectionReplaced",
      "error.remote.connectionDropped",
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
      "error.team.hostUpdateRequired",
      "error.remote.hostBusy",
      "error.remote.signalPermissionDenied",
      "error.remote.signalProtocolError",
      "error.remote.signalRefused",
      "error.remote.signalClosed",
      "error.remote.relayUnavailable",
      "error.remote.iceFailed",
      "error.remote.iceDisconnected",
      "error.remote.directoryUnreachable",
      "error.remote.directoryTimeout",
      "error.remote.inviteAlreadyUsed",
      "error.remote.inviteNotFound",
      "error.remote.memberLimitReached",
      "error.remote.licenseUsersFull",
      "error.remote.hostNotRegistered",
      "error.remote.membershipEnded",
      "error.remote.accountSessionInactive",
      "error.remote.hostOtherAccount",
      "error.remote.remoteNotConfigured",
      "error.remote.hostKeyMissing",
      "error.remote.connectionNotStarted",
    ] as const satisfies readonly (keyof SourceMessages)[]
  ).map((key) => sourceText(key)),
);

const NUMBER_MARK = "\u0000";
function numberTemplate(text: string): RegExp {
  const [before = "", after = ""] = text.split(NUMBER_MARK);
  const literal = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${literal(before)}\\d{1,6}${literal(after)}$`, "u");
}

const SAFE_NUMBER_CONNECTION_ERRORS = [
  numberTemplate(sourceText("error.remote.signalRateLimited", { seconds: NUMBER_MARK })),
  numberTemplate(sourceText("error.remote.hostRefused", { status: NUMBER_MARK })),
  numberTemplate(sourceText("error.remote.requestFailedStatus", { status: NUMBER_MARK })),
];

export function isSafeConnectionError(message: string): boolean {
  return SAFE_CONNECTION_ERRORS.has(message) || SAFE_NUMBER_CONNECTION_ERRORS.some((pattern) => pattern.test(message));
}

export interface RemoteConnectionFailure {
  message: string;
  reference: string | null;
}

export function remoteConnectionFailureDetails(stage: RemoteConnectionStage, error: unknown): RemoteConnectionFailure {
  const reason =
    error instanceof Error && isSafeConnectionError(error.message)
      ? error.message
      : sourceText("error.remote.connectionStepFailed");
  return { message: sourceText(CONNECTION_STAGES[stage], { reason }), reference: errorReference(error) };
}

export function remoteRecoveryMessage(status: RemoteRecoveryStatus, failure?: string | null): string | null {
  if (status.phase === "online") return null;
  const detail = failure || null;
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
  return detail
    ? sourceText("status.remote.reconnectingDetail", { attempt: status.attempt, count: REMOTE_RETRY_LIMIT, detail })
    : sourceText("status.remote.reconnecting", { attempt: status.attempt, count: REMOTE_RETRY_LIMIT });
}

export function createRemoteConnectionRecovery(
  connect: (check: boolean) => Promise<void>,
  onError: (error: unknown) => void,
  onStatus: (status: RemoteRecoveryStatus) => void = () => {},
  startingRetryDelay: () => number | null = () => null,
) {
  let active = false;
  let disposed = false;
  let running = false;
  let online = false;
  let suspended = false;
  let retryRequested = false;
  let refreshRequested = false;
  let interrupted = false;
  let checking = false;
  let checkOnReturn = false;
  let attempt = 0;
  let retryAt: number | null = null;
  let retryDelay: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function startRun() {
    void runTeamEffect(run());
  }

  function scheduleRetry(start: () => void = startRun) {
    if (disposed || suspended) return;
    const startingDelay = startingRetryDelay();
    retryAt ??= Date.now() + (startingDelay ?? retryDelay ?? remoteRetryDelay(attempt));
    if (startingDelay !== null) retryAt = Math.min(retryAt, Date.now() + startingDelay);
    retryDelay = null;
    if (!active) return;
    const remaining = Math.max(0, retryAt - Date.now());
    if (remaining === 0 && !running) {
      retryAt = null;
      if (attempt >= REMOTE_RETRY_LIMIT) attempt = 0;
      start();
      return;
    }
    onStatus({
      phase: attempt >= REMOTE_RETRY_LIMIT ? "cooldown" : "waiting",
      attempt,
      remainingSeconds: Math.ceil(remaining / 1000),
    });
    if (timer !== null || remaining === 0) return;
    timer = setTimeout(
      () => {
        timer = null;
        scheduleRetry();
      },
      Math.min(1000, remaining),
    );
  }

  const run = Effect.fn("RemoteRecovery.run")(function* () {
    while (yield* attemptOnce()) {}
  });

  const attemptOnce = Effect.fn("RemoteRecovery.attempt")(function* () {
    if (!active || disposed || running || suspended) return false;
    let again = false;
    cancelTimer();
    running = true;
    const checkingConnection = online;
    checking = checkingConnection;
    const check = checkOnReturn && checkingConnection;
    checkOnReturn = false;
    retryRequested = false;
    refreshRequested = false;
    interrupted = false;
    attempt += 1;
    retryDelay = remoteRetryDelay(attempt);
    if (!online) onStatus({ phase: "connecting", attempt, remainingSeconds: Math.ceil(retryDelay / 1000) });
    yield* Effect.gen(function* () {
      const result = yield* recoveryCall(() => connect(check)).pipe(Effect.result);
      if (Result.isFailure(result)) {
        const error = result.failure;
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
        if (checkingConnection) {
          attempt = 0;
          retryAt = Date.now();
        }
        scheduleRetry();
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          running = false;
          if (!disposed && !suspended && active) {
            if (refreshRequested) {
              retryAt = null;
              again = true;
            } else if (retryRequested)
              scheduleRetry(() => {
                again = true;
              });
            else if (interrupted) again = true;
            else {
              online = true;
              attempt = 0;
              retryAt = null;
              onStatus({ phase: "online", attempt: 0, remainingSeconds: 0 });
            }
          }
        }),
      ),
    );
    return again;
  });

  return {
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value;
      cancelTimer();
      if (!active && running) {
        interrupted = true;
      }
      if (active) {
        suspended = false;
        if (running) return;
        else if (retryAt !== null) scheduleRetry();
        else {
          checkOnReturn = online && !refreshRequested;
          startRun();
        }
      }
    },
    offline(error?: unknown) {
      if (disposed) return;
      online = false;
      checkOnReturn = false;
      if (error !== undefined) onError(error);
      retryRequested = true;
      if (retryAt === null && (!running || checking)) {
        if (running) attempt = 0;
        retryAt = Date.now();
      }
      scheduleRetry();
    },
    networkRestored() {
      if (disposed || suspended || online || running || retryAt === null) return;
      retryAt = null;
      attempt = 0;
      cancelTimer();
      if (active) startRun();
    },
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
      checkOnReturn = false;
      suspended = false;
      retryAt = null;
      attempt = 0;
      cancelTimer();
      if (running || !active) refreshRequested = true;
      else startRun();
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}

export function createRemoteReadRefresh() {
  const requests = new Map<string, number>();
  const cursors = new Map<string, number>();
  return {
    invalidate(serverId: string): () => boolean {
      const cursor = (cursors.get(serverId) ?? 0) + 1;
      cursors.set(serverId, cursor);
      return () => cursors.get(serverId) === cursor;
    },
    refresh<T, E>(
      serverId: string,
      load: () => Effect.Effect<T, E>,
      apply: (value: T) => void,
      isCurrent: () => boolean,
    ): Effect.Effect<void, E> {
      return Effect.gen(function* () {
        const request = (requests.get(serverId) ?? 0) + 1;
        requests.set(serverId, request);
        const cursor = cursors.get(serverId);
        const value = yield* load();
        if (requests.get(serverId) === request && cursors.get(serverId) === cursor && isCurrent()) apply(value);
      });
    },
  };
}

export function mergeRemoteUnreadIds(current: string[], reads: Record<string, { unreadCount: number }>): string[] {
  const next = [
    ...current.filter((id) => !(id in reads)),
    ...Object.entries(reads)
      .filter(([, state]) => state.unreadCount > 0)
      .map(([id]) => id),
  ];
  return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
}

export const resyncRemoteConversations = Effect.fn("RemoteRecovery.resyncConversations")(function* <E>(input: {
  agentIds: string[];
  cached: Record<string, ConversationSnapshot>;
  load: (agentId: string) => Effect.Effect<ConversationSnapshot, E>;
  apply: (snapshot: ConversationSnapshot) => void;
  isCurrent: () => boolean;
}) {
  for (const agentId of input.agentIds) {
    if (!input.isCurrent()) return;
    if (!input.cached[agentId]) continue;
    const snapshot = yield* input.load(agentId);
    if (!input.isCurrent()) return;
    input.apply(snapshot);
  }
});

export const REMOTE_REQUEST_MAX_WAIT_MILLISECONDS = 60_000;

export function startRemoteRequestDeadline(
  timeoutMs: number,
  lastAnswerAt: () => number,
  expire: () => void,
  rearm: (timer: ReturnType<typeof setTimeout>) => void,
): ReturnType<typeof setTimeout> {
  const sentAt = performance.now();
  const limitAt = sentAt + Math.max(timeoutMs, REMOTE_REQUEST_MAX_WAIT_MILLISECONDS);
  const check = () => {
    const now = performance.now();
    const next = Math.min(Math.max(sentAt, lastAnswerAt()) + timeoutMs, limitAt);
    if (now >= next) expire();
    else rearm(setTimeout(check, next - now));
  };
  return setTimeout(check, timeoutMs);
}

export function remoteWorkspaceReadTimeout(method: string, path: string): number | undefined {
  const route = path.split("?")[0];
  if (method === "POST" && route === SIDEBAR_FOLDERS_ROUTES.read) return 15_000;
  if (method !== "GET") return undefined;
  return route === TEAM_API_ROUTES.compatibility ||
    route === TEAM_API_ROUTES.agents.all ||
    route === TEAM_API_ROUTES.agents.status ||
    route === TEAM_API_ROUTES.agents.models ||
    route === TEAM_API_ROUTES.sidebarLayout.state ||
    route === TEAM_API_ROUTES.browser.tabs ||
    route === TEAM_API_ROUTES.agents.conversationReads ||
    /^\/v1\/agents\/[^/]+\/(?:conversation(?:-page)?|queue)$/.test(route ?? "")
    ? 15_000
    : undefined;
}
