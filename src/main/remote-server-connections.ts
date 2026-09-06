// One record per server for everything the app knows about its connection: state, negotiated
// compatibility, current issue, and how many times it has reconnected.
//
// These were four parallel `Map`s on the manager, keyed by the same ids and always written together.
// Every read had to remember each map's own default, forgetting one silently reported a server as
// healthier than it was, and clearing a server meant remembering to delete from all four -- which is
// why the old `#clearServerConnectionState` was a twenty-line ritual and is now `forget`.
//
// `remote-server-connection-status.ts` decides what a failure means; this file decides what is
// remembered about it. Keeping those apart is what lets the whole error table be tested without a
// manager, a socket or a disk.

import type { ServerCompatibility, ServerConnectionIssue, ServerSummary } from "@openbot/contracts/ipc";
import {
  checkingCompatibility,
  classifyRemoteConnectionError,
  classifyTransportError,
  hostUnreachable,
  type RemoteConnectionOutcome,
  type RemoteServerConnectionStatus,
} from "./remote-server-connection-status";

export interface RemoteServerConnectionsOptions {
  appVersion: string | null;
  // Called once per reported failure, matching where the manager used to emit `changed` from its
  // error paths. The plain setters stay silent: their callers write several fields in a row and emit
  // once at the end, and moving the event into each setter would multiply what the renderer sees.
  onChanged: () => void;
  // A failure no retry fixes. The event stream stops reconnecting until the user does something.
  onReconnectSuspended: (serverId: string) => void;
}

interface MutableStatus {
  state: ServerSummary["state"];
  compatibility: ServerCompatibility | null;
  issue: ServerConnectionIssue | null;
  connectionSequence: number;
}

export class RemoteServerConnections {
  readonly #appVersion: string | null;
  readonly #onChanged: () => void;
  readonly #onReconnectSuspended: (serverId: string) => void;
  readonly #statuses = new Map<string, MutableStatus>();

  constructor(options: RemoteServerConnectionsOptions) {
    this.#appVersion = options.appVersion;
    this.#onChanged = options.onChanged;
    this.#onReconnectSuspended = options.onReconnectSuspended;
  }

  // What the renderer sees, with every default already applied -- a server nothing has been recorded
  // about is offline and still being checked, not absent.
  statusFor(serverId: string): RemoteServerConnectionStatus {
    const status = this.#statuses.get(serverId);
    return {
      state: status?.state ?? "offline",
      compatibility: status?.compatibility ?? checkingCompatibility(this.#appVersion),
      issue: status?.issue ?? null,
      connectionSequence: status?.connectionSequence ?? 0,
    };
  }

  // Raw, unlike `statusFor`: negotiation has to be able to tell "never asked the host" from "asked
  // and it told us nothing", because only the first is worth a request.
  compatibilityFor(serverId: string): ServerCompatibility | null {
    return this.#statuses.get(serverId)?.compatibility ?? null;
  }

  stateFor(serverId: string): ServerSummary["state"] | null {
    return this.#statuses.get(serverId)?.state ?? null;
  }

  issueFor(serverId: string): ServerConnectionIssue | null {
    return this.#statuses.get(serverId)?.issue ?? null;
  }

  hasIssue(serverId: string): boolean {
    return this.issueFor(serverId) != null;
  }

  setState(serverId: string, state: ServerSummary["state"]): void {
    this.#mutable(serverId).state = state;
  }

  setCompatibility(serverId: string, compatibility: ServerCompatibility): void {
    this.#mutable(serverId).compatibility = compatibility;
  }

  startCheckingCompatibility(serverId: string): void {
    this.setCompatibility(serverId, checkingCompatibility(this.#appVersion));
  }

  clearCompatibility(serverId: string): void {
    this.#mutable(serverId).compatibility = null;
  }

  clearIssue(serverId: string): void {
    this.#mutable(serverId).issue = null;
  }

  /**
   * Clears the issue only while it is still the one the caller saw. A question asked before a
   * failure was recorded must not erase that failure when its answer comes back: negotiation and a
   * request race here, and the newer of the two is the one the user has to be told about.
   */
  clearStaleIssue(serverId: string, issue: { code: string; message: string } | null): void {
    const status = this.#mutable(serverId);
    if (status.issue === issue) status.issue = null;
  }

  // A connection that just came up: online, no issue, nothing known about the host yet, and a new
  // sequence number so the renderer treats it as a reconnect rather than a continuing session.
  markConnected(serverId: string): void {
    const status = this.#mutable(serverId);
    status.state = "online";
    status.compatibility = null;
    status.issue = null;
    status.connectionSequence += 1;
  }

  // `fallbackState` is what to show when the error is one this app has no specific word for -- the
  // caller knows whether that means "still blocked" or "just failed".
  reportError(serverId: string, error: unknown, fallbackState: ServerSummary["state"] | null = null): void {
    if (this.#apply(serverId, classifyRemoteConnectionError(error), fallbackState).changed) this.#onChanged();
  }

  // The WebRTC transport's own failures. Returns whether reconnecting is now suspended, because the
  // caller schedules the retry and this is the one thing that stops it.
  reportTransportError(serverId: string, code: string, message: string): boolean {
    const { changed, suspended } = this.#apply(serverId, classifyTransportError(code, message), null);
    if (changed) this.#onChanged();
    return suspended;
  }

  // A connection that never got through, with no error object worth classifying. Silent, so the
  // caller can fold it into one emission with whatever else the failure changed.
  reportUnreachable(serverId: string): void {
    this.#apply(serverId, hostUnreachable(), null);
  }

  forget(serverId: string): void {
    this.#statuses.delete(serverId);
  }

  #apply(
    serverId: string,
    outcome: RemoteConnectionOutcome,
    fallbackState: ServerSummary["state"] | null,
  ): { changed: boolean; suspended: boolean } {
    const status = this.#mutable(serverId);
    let changed = false;
    // The host told us what it speaks on its way to refusing us. Recording it is what lets the app
    // say "update the host" instead of "something went wrong".
    if (outcome.hostSupport) {
      const compatibility = {
        ...checkingCompatibility(this.#appVersion),
        hostAppVersion: outcome.hostSupport.appVersion,
        hostProtocol: outcome.hostSupport.protocol,
        capabilities: outcome.hostSupport.capabilities,
      };
      changed ||= !sameCompatibility(status.compatibility, compatibility);
      status.compatibility = compatibility;
    }
    // The issue object is replaced even when it says the same thing, because `clearStaleIssue`
    // withdraws a complaint by identity -- but an identical complaint is not news, and reporting it
    // as one is what turns a host answering 401 into a broadcast storm: every refused request would
    // wake every window, and a window that reacts by asking again closes the loop.
    if (outcome.issue) {
      changed ||= !sameIssue(status.issue, outcome.issue);
      status.issue = outcome.issue;
    }
    const state = outcome.state ?? fallbackState;
    if (state) {
      changed ||= status.state !== state;
      status.state = state;
    }
    if (outcome.suspendReconnect) this.#onReconnectSuspended(serverId);
    return { changed, suspended: outcome.suspendReconnect };
  }

  #mutable(serverId: string): MutableStatus {
    const existing = this.#statuses.get(serverId);
    if (existing) return existing;
    const status: MutableStatus = { state: "offline", compatibility: null, issue: null, connectionSequence: 0 };
    this.#statuses.set(serverId, status);
    return status;
  }
}

function sameIssue(left: ServerConnectionIssue | null, right: ServerConnectionIssue): boolean {
  return left?.code === right.code && left?.message === right.message && left?.retryable === right.retryable;
}

function sameCompatibility(left: ServerCompatibility | null, right: ServerCompatibility): boolean {
  return (
    left != null &&
    left.localAppVersion === right.localAppVersion &&
    left.hostAppVersion === right.hostAppVersion &&
    left.negotiatedProtocol === right.negotiatedProtocol &&
    left.localProtocol.minimum === right.localProtocol.minimum &&
    left.localProtocol.maximum === right.localProtocol.maximum &&
    left.hostProtocol?.minimum === right.hostProtocol?.minimum &&
    left.hostProtocol?.maximum === right.hostProtocol?.maximum &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every((capability, index) => capability === right.capabilities[index])
  );
}
