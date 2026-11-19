import type { ServerCompatibility, ServerConnectionIssue, ServerSummary } from "@openbot/contracts/ipc";
import {
  checkingCompatibility,
  classifyConnectFailure,
  classifyRemoteConnectionError,
  classifyTransportError,
  hostUnreachable,
  type RemoteConnectionOutcome,
  type RemoteServerConnectionStatus,
} from "./remote-server-connection-status";

export interface RemoteServerConnectionsOptions {
  appVersion: string | null;
  onChanged: () => void;
  onReconnectSuspended: (serverId: string) => void;
}

interface MutableStatus {
  state: ServerSummary["state"];
  compatibility: ServerCompatibility | null;
  issue: ServerConnectionIssue | null;
  connectionSequence: number;
  capabilitiesPending: boolean;
  hostRestart: ServerSummary["hostRestart"];
  hostedSleep: HostedSleep;
  hostedIssue: ServerSummary["hostedIssue"];
  hostedStart: ServerSummary["hostedStart"];
}

type HostedSleep = NonNullable<ServerSummary["hostedSleep"]> | null;

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

  statusFor(serverId: string): RemoteServerConnectionStatus {
    const status = this.#statuses.get(serverId);
    return {
      state: status?.state ?? "offline",
      compatibility: status?.compatibility ?? checkingCompatibility(this.#appVersion),
      issue: status?.issue ?? null,
      connectionSequence: status?.connectionSequence ?? 0,
      capabilitiesPending: status?.capabilitiesPending ?? false,
      hostRestart: status?.hostRestart ?? null,
      hostedSleep: status?.hostedSleep ?? null,
      hostedIssue: status?.hostedIssue ?? null,
      hostedStart: status?.hostedStart ?? null,
    };
  }

  setHostedIssue(serverId: string, issue: ServerSummary["hostedIssue"]): void {
    this.#mutable(serverId).hostedIssue = issue;
  }

  setHostedStart(serverId: string, start: ServerSummary["hostedStart"]): boolean {
    const status = this.#mutable(serverId);
    if (status.hostedStart?.step === start?.step && status.hostedStart?.startedAt === start?.startedAt) return false;
    status.hostedStart = start;
    return true;
  }

  hostedSleepFor(serverId: string): HostedSleep {
    return this.#statuses.get(serverId)?.hostedSleep ?? null;
  }

  setHostedSleep(serverId: string, hostedSleep: HostedSleep): boolean {
    const status = this.#mutable(serverId);
    if (status.hostedSleep === hostedSleep) return false;
    status.hostedSleep = hostedSleep;
    return true;
  }

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

  hostRestartFor(serverId: string): ServerSummary["hostRestart"] {
    return this.#statuses.get(serverId)?.hostRestart ?? null;
  }

  setHostRestart(serverId: string, hostRestart: ServerSummary["hostRestart"]): boolean {
    const status = this.#mutable(serverId);
    if (status.hostRestart?.state === hostRestart?.state && status.hostRestart?.version === hostRestart?.version)
      return false;
    status.hostRestart = hostRestart;
    return true;
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

  clearStaleIssue(serverId: string, issue: { code: string; message: string } | null): void {
    const status = this.#mutable(serverId);
    if (status.issue === issue) status.issue = null;
  }

  markConnected(serverId: string): void {
    const status = this.#mutable(serverId);
    status.state = "online";
    status.compatibility = null;
    status.issue = null;
    status.hostRestart = null;
    status.hostedSleep = null;
    status.hostedIssue = null;
    status.hostedStart = null;
    status.connectionSequence += 1;
    status.capabilitiesPending = false;
  }

  startCapabilityRead(serverId: string): number {
    const status = this.#mutable(serverId);
    status.capabilitiesPending = true;
    return status.connectionSequence;
  }

  endCapabilityRead(serverId: string, connectionSequence: number): void {
    const status = this.#mutable(serverId);
    if (status.connectionSequence === connectionSequence) status.capabilitiesPending = false;
  }

  reportError(serverId: string, error: unknown, fallbackState: ServerSummary["state"] | null = null): void {
    if (this.#apply(serverId, classifyRemoteConnectionError(error), fallbackState).changed) this.#onChanged();
  }

  reportTransportError(serverId: string, code: string, message: string): boolean {
    const { changed, suspended } = this.#apply(serverId, classifyTransportError(code, message), null);
    if (changed) this.#onChanged();
    return suspended;
  }

  reportUnreachable(serverId: string, reference?: string): void {
    this.#apply(serverId, hostUnreachable(reference), null);
  }

  reportConnectFailure(serverId: string, failure: unknown): void {
    this.#apply(serverId, classifyConnectFailure(failure), null);
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
    const status: MutableStatus = {
      state: "offline",
      compatibility: null,
      issue: null,
      connectionSequence: 0,
      capabilitiesPending: false,
      hostRestart: null,
      hostedSleep: null,
      hostedIssue: null,
      hostedStart: null,
    };
    this.#statuses.set(serverId, status);
    return status;
  }
}

function sameIssue(left: ServerConnectionIssue | null, right: ServerConnectionIssue): boolean {
  return (
    left?.code === right.code &&
    left?.message === right.message &&
    left?.retryable === right.retryable &&
    left?.reference === right.reference
  );
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
