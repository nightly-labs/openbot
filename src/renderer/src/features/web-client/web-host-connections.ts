import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { decodeTeamProtocolSupportV1, teamProtocolUpdateDirection } from "@openbot/contracts/team-protocol/v1";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import type { createRemoteTeamPeer, RemoteTeamPeerActions } from "@openbot/team-client/remote-peer";
import { createRemoteConnectionRecovery } from "@openbot/team-client/remote-recovery";
import { currentText } from "@openbot/ui/text";
import {
  type acquireWebHostLock,
  decodeWebHostTabMessage,
  type WebHostState,
  type WebHostTabMessage,
} from "./web-host-lock";

/** After another tab asks for a host, this tab does not ask for its lock again for this long. */
const RELEASED_HOST_REST_MS = 30_000;

type Peer = ReturnType<typeof createRemoteTeamPeer>;

interface HostEntry {
  host: RemoteTeamHost;
  stop: AbortController;
  releaseLock: (() => void) | null;
  peer: Peer | null;
  recovery: ReturnType<typeof createRemoteConnectionRecovery> | null;
  /** The connect command in progress. Its bootstrap can still end the session after `dispose`. */
  connecting: Promise<unknown> | null;
  /** Session ends in progress. The peer starts some without waiting, for example after a protocol error. */
  endingSessions: Set<Promise<void>>;
  incompatible: boolean;
}

export interface WebHostConnections {
  /** The hosts of the account. Every host that this tab has not opened gets a status connection. */
  setHosts(hosts: readonly RemoteTeamHost[]): void;
  /** The host this tab opens, or null. Resolves when its status connection has ended. */
  select(hostId: string | null): Promise<void>;
  /** Whether this tab holds the lock of the opened host. Only then does it speak for that host. */
  holdSelected(hostId: string, held: boolean): void;
  /** The state of the opened host, for the other tabs. */
  reportSelected(hostId: string, state: WebHostState): void;
  refresh(): void;
  dispose(): Promise<void>;
}

/**
 * One status connection for each host that this tab has not opened, as the mobile app keeps one for
 * each server. A connection holds the host's tab lock, so one browser has at most one peer for each
 * host; the tabs share one logical session for it. Other tabs learn the state from the channel.
 */
export function createWebHostConnections(options: {
  accountId: string;
  channel: BroadcastChannel;
  actions: Pick<RemoteTeamPeerActions, "getBootstrap" | "endSession">;
  createPeer: typeof createRemoteTeamPeer;
  acquireHostLock: typeof acquireWebHostLock;
  /** Throws when the host identity differs from the pinned one. */
  pinHostKey(host: RemoteTeamHost): void;
  onState(hostId: string, state: WebHostState): void;
  /** The host revoked the session. The membership may have ended. */
  onSessionRevoked(): void;
}): WebHostConnections {
  const { channel } = options;
  const entries = new Map<string, HostEntry>();
  const states = new Map<string, WebHostState>();
  const restingUntil = new Map<string, number>();
  const restTimers = new Set<ReturnType<typeof setTimeout>>();
  let hosts: readonly RemoteTeamHost[] = [];
  let selected: { hostId: string; state: WebHostState; held: boolean } | null = null;
  let disposed = false;

  function post(message: WebHostTabMessage): void {
    try {
      channel.postMessage(message);
    } catch {
      // A closed channel only costs the other tabs a state.
    }
  }
  function setState(hostId: string, state: WebHostState, local = true): void {
    if (states.get(hostId) === state) return;
    states.set(hostId, state);
    options.onState(hostId, state);
    if (local) post({ type: "state", hostId, state });
  }
  function holds(hostId: string): boolean {
    return Boolean(entries.get(hostId)?.releaseLock) || (selected?.hostId === hostId && selected.held);
  }

  function start(host: RemoteTeamHost): void {
    const entry: HostEntry = {
      host,
      stop: new AbortController(),
      releaseLock: null,
      peer: null,
      recovery: null,
      connecting: null,
      endingSessions: new Set(),
      incompatible: false,
    };
    entries.set(host.hostId, entry);
    options.acquireHostLock(options.accountId, host.hostId, { wait: entry.stop.signal }).then(
      (release) => {
        if (entries.get(host.hostId) !== entry) {
          release();
          return;
        }
        entry.releaseLock = release;
        connect(entry);
      },
      () => undefined,
    );
  }

  function connect(entry: HostEntry): void {
    const { host } = entry;
    const failed = (message: string | null | undefined) =>
      new Error(message ?? currentText().t("webClient.error.connectionUnavailable"));
    const peer = options.createPeer({
      current: {
        getBootstrap: options.actions.getBootstrap,
        endSession(sessionId) {
          const ending = options.actions.endSession(sessionId);
          entry.endingSessions.add(ending);
          void ending.then(
            () => entry.endingSessions.delete(ending),
            () => entry.endingSessions.delete(ending),
          );
          return ending;
        },
        async onConnectionUpdate(update) {
          if (entries.get(host.hostId) !== entry || update.state !== "offline") return;
          if (update.code === "session_revoked") options.onSessionRevoked();
          if (update.code === "protocol_error") entry.recovery?.suspend(failed(update.message));
          else entry.recovery?.offline(failed(update.message));
        },
        // A status connection shows no workspace, so it reads no events.
        onTeamEvent: async () => undefined,
      },
    });
    entry.peer = peer;
    const recovery = createRemoteConnectionRecovery(
      async () => {
        entry.incompatible = false;
        try {
          options.pinHostKey(host);
        } catch (error) {
          recovery.suspend(error);
          return;
        }
        const connecting = peer.execute({
          id: crypto.randomUUID(),
          type: "connect",
          hostId: host.hostId,
          hostPublicKey: host.devicePublicKey,
        });
        entry.connecting = connecting;
        const connected = await connecting;
        if (!connected.ok) throw failed(connected.error);
        const response = await peer.execute({
          id: crypto.randomUUID(),
          type: "request",
          method: "GET",
          path: TEAM_API_ROUTES.compatibility,
          body: {},
        });
        if (!response.ok || (response.status ?? 500) >= 400) throw failed(response.error);
        const support = decodeTeamProtocolSupportV1(response.body);
        // The same rule as opening the host, so the rail and the open agree.
        if (teamProtocolUpdateDirection({ minimum: TEAM_PROTOCOL_V3, maximum: TEAM_PROTOCOL_V3 }, support.protocol)) {
          entry.incompatible = true;
          recovery.suspend();
        }
      },
      () => undefined,
      (status) => {
        if (entries.get(host.hostId) !== entry) return;
        setState(
          host.hostId,
          status.phase === "online"
            ? "online"
            : status.phase === "connecting"
              ? "connecting"
              : status.phase === "suspended"
                ? entry.incompatible
                  ? "incompatible"
                  : "error"
                : "offline",
        );
      },
    );
    entry.recovery = recovery;
    // Unlike mobile, a hidden tab keeps retrying: it holds the lock, so no other tab can take its place.
    recovery.setActive(true);
  }

  async function stop(hostId: string): Promise<void> {
    const entry = entries.get(hostId);
    if (!entry) return;
    entries.delete(hostId);
    entry.stop.abort();
    entry.recovery?.dispose();
    try {
      await entry.peer?.dispose();
      // A bootstrap that was still pending ends its session when it returns. The tab that asked for the
      // host would reuse that session, so the lock waits for it.
      await entry.connecting?.catch(() => undefined);
      await Promise.allSettled([...entry.endingSessions]);
    } finally {
      entry.releaseLock?.();
    }
  }

  function sync(): void {
    if (disposed) return;
    const listed = new Map(hosts.map((host) => [host.hostId, host]));
    for (const [hostId, entry] of entries) {
      const host = listed.get(hostId);
      if (!host || hostId === selected?.hostId || host.devicePublicKey !== entry.host.devicePublicKey)
        void stop(hostId);
    }
    const now = Date.now();
    for (const host of hosts) {
      if (host.hostId === selected?.hostId || entries.has(host.hostId)) continue;
      if ((restingUntil.get(host.hostId) ?? 0) > now) continue;
      restingUntil.delete(host.hostId);
      start(host);
    }
  }

  function listen(event: MessageEvent): void {
    const message = decodeWebHostTabMessage(event.data);
    if (!message || disposed) return;
    if (message.type === "query") {
      for (const [hostId, entry] of entries) {
        const state = states.get(hostId);
        if (entry.releaseLock && state) post({ type: "state", hostId, state });
      }
      if (selected?.held) post({ type: "state", hostId: selected.hostId, state: selected.state });
    } else if (message.type === "state") {
      if (!holds(message.hostId)) setState(message.hostId, message.state, false);
    } else if (message.type === "release" && entries.has(message.hostId)) {
      // Also leave the queue: a queued request here would take the lock before the tab that asked.
      restingUntil.set(message.hostId, Date.now() + RELEASED_HOST_REST_MS);
      const timer = setTimeout(() => {
        restTimers.delete(timer);
        sync();
      }, RELEASED_HOST_REST_MS);
      restTimers.add(timer);
      void stop(message.hostId);
    }
  }
  channel.addEventListener("message", listen);
  post({ type: "query" });

  return {
    setHosts(next) {
      hosts = [...next];
      for (const hostId of states.keys()) {
        if (!hosts.some((host) => host.hostId === hostId)) states.delete(hostId);
      }
      sync();
    },
    async select(hostId) {
      const previous = selected?.hostId ?? null;
      selected = hostId === null ? null : { hostId, state: "connecting", held: false };
      if (hostId !== null) await stop(hostId);
      if (previous !== hostId) {
        // Its status connection reports again once it holds the lock.
        if (previous) {
          states.delete(previous);
          options.onState(previous, "unknown");
        }
        sync();
      }
    },
    holdSelected(hostId, held) {
      if (selected?.hostId !== hostId || selected.held === held) return;
      selected.held = held;
      if (held) post({ type: "state", hostId, state: selected.state });
    },
    reportSelected(hostId, state) {
      if (selected?.hostId !== hostId || selected.state === state) return;
      selected.state = state;
      // A tab whose open failed does not hold the host, so another tab speaks for it.
      if (selected.held) post({ type: "state", hostId, state });
    },
    refresh() {
      for (const entry of entries.values()) entry.recovery?.refresh();
    },
    async dispose() {
      disposed = true;
      channel.removeEventListener("message", listen);
      for (const timer of restTimers) clearTimeout(timer);
      restTimers.clear();
      await Promise.all([...entries.keys()].map(stop));
    },
  };
}
