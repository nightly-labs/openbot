import { verify } from "node:crypto";
import { REMOTE_ACCOUNT_CHECK_INTERVAL_MS } from "@openbot/team-client";
import {
  followHostKeyHandovers,
  type HostKeySignatureCheck,
  hostKeyChangedAt,
} from "@openbot/team-client/host-key-handover";
import { Effect } from "effect";
import type { RemoteHostSummary } from "./central-auth-records";
import type { PreservedHostIdentity, StoredRemoteServerView } from "./remote-server-store";
import type { StoredRemoteServer } from "./remote-server-stored-shape";
import type { RemoteWorkflowError } from "./remote-service-effects";
import { fingerprint } from "./team-store";

export function watchRemoteHostDirectory(options: {
  isActive(): boolean;
  refresh(): Effect.Effect<void, RemoteWorkflowError>;
}): () => void {
  const timer = setInterval(() => {
    if (options.isActive()) void Effect.runPromise(options.refresh().pipe(Effect.catch(() => Effect.void)));
  }, REMOTE_ACCOUNT_CHECK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

const SERVER_CLAIM_FIRST_REFRESH_MS = 5_000;
const SERVER_CLAIM_MAX_REFRESH_MS = 60_000;
const SERVER_CLAIM_MAX_WATCH_MS = 15 * 60_000;

export function watchServerClaims(options: { serverIds(): readonly string[]; refresh(): void }): {
  add(expiresAt: number): void;
  stop(): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let known = new Set<string>();
  let claims = 0;
  let deadline = 0;
  let delay = SERVER_CLAIM_FIRST_REFRESH_MS;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    claims = 0;
  };
  const schedule = () => {
    timer = setTimeout(tick, delay);
    timer.unref();
    delay = Math.min(delay * 2, SERVER_CLAIM_MAX_REFRESH_MS);
  };
  const tick = () => {
    const fresh = options.serverIds().filter((id) => !known.has(id)).length;
    if (fresh >= claims || Date.now() >= deadline) return stop();
    options.refresh();
    schedule();
  };
  return {
    add(expiresAt) {
      if (!timer) known = new Set(options.serverIds());
      clearTimeout(timer);
      delay = SERVER_CLAIM_FIRST_REFRESH_MS;
      claims += 1;
      deadline = Math.max(deadline, Math.min(expiresAt, Date.now() + SERVER_CLAIM_MAX_WATCH_MS));
      schedule();
    },
    stop,
  };
}

interface HostKeyPin {
  readonly hostId: string;
  readonly publicKey: string;
}

export interface WebRtcHostReconciliation {
  readonly servers: StoredRemoteServer[];
  readonly removedHostIds: readonly string[];
  readonly staleTransportHostIds: readonly string[];
  readonly pinnedKeys: readonly HostKeyPin[];
}

export interface WebRtcHostReconciliationInput {
  readonly hosts: readonly RemoteHostSummary[];
  readonly servers: readonly StoredRemoteServerView[];
  readonly preservedIdentities: readonly PreservedHostIdentity[];
  readonly localHostId: string | null;
  readonly isHiddenHost: (hostId: string) => boolean;
  readonly username: string;
  readonly keepOtherTransports: boolean;
  readonly isThisComputer?: (serverId: string) => boolean;
  readonly isConnected: (hostId: string) => boolean;
  readonly followedHandovers?: ReadonlySet<string>;
}

export const verifyHostKeySignature: HostKeySignatureCheck = (signature, message, publicKeyPem) =>
  Effect.try({
    try: () => verify(null, message, publicKeyPem, Buffer.from(signature, "base64url")),
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));

export const followedHostKeyHandovers = Effect.fn("RemoteHostDirectory.followedHostKeyHandovers")(function* (
  input: Pick<WebRtcHostReconciliationInput, "hosts" | "servers" | "preservedIdentities">,
) {
  const followed = new Set<string>();
  for (const host of input.hosts) {
    const advertised = host.devicePublicKey;
    if (!advertised || host.keyHandovers.length === 0) continue;
    const existing = pinnedIdentity(input, host.hostId);
    const trustedFingerprint = existing?.publicKey ? fingerprint(existing.publicKey) : pinnedFingerprint(existing);
    if (!trustedFingerprint || trustedFingerprint === fingerprint(advertised)) continue;
    if (
      yield* followHostKeyHandovers({
        hostId: host.hostId,
        trustedFingerprint,
        advertisedPublicKey: advertised,
        handovers: host.keyHandovers,
        verify: verifyHostKeySignature,
      })
    )
      followed.add(host.hostId);
  }
  return followed;
});

export const hostKeyChangeTimes = Effect.fn("RemoteHostDirectory.hostKeyChangeTimes")(function* (
  hosts: readonly RemoteHostSummary[],
  trustedKey: (host: RemoteHostSummary) => string | null | undefined,
) {
  const times = new Map<string, number>();
  for (const host of hosts) {
    const publicKey = trustedKey(host);
    if (!publicKey || host.keyHandovers.length === 0) continue;
    const changedAt = yield* hostKeyChangedAt({
      hostId: host.hostId,
      publicKey,
      handovers: host.keyHandovers,
      verify: verifyHostKeySignature,
    });
    if (changedAt !== null) times.set(host.hostId, changedAt);
  }
  return times;
});

export function reconcileWebRtcHosts(input: WebRtcHostReconciliationInput): WebRtcHostReconciliation {
  const pinnedKeys: HostKeyPin[] = [];
  const listed = input.hosts
    .filter(
      (host) =>
        host.hostId !== input.localHostId &&
        !input.isHiddenHost(host.hostId) &&
        input.isThisComputer?.(host.hostId) !== true,
    )
    .map<StoredRemoteServer>((host) => {
      const handedOver = input.followedHandovers?.has(host.hostId) === true;
      const existing = handedOver ? undefined : pinnedIdentity(input, host.hostId);
      const publicKey = resolveHostKey(existing, host.devicePublicKey);
      if (publicKey) pinnedKeys.push({ hostId: host.hostId, publicKey });
      return {
        id: host.hostId,
        name: host.name,
        apiUrl: `webrtc://${host.hostId}`,
        fingerprint: pinnedFingerprint(existing) || advertisedFingerprint(host.devicePublicKey),
        ...(publicKey ? { publicKey } : {}),
        username: input.username,
        encryptedToken: "",
        remoteDesktopAvailable: false,
        logoVersion: host.logoKey,
        ...(host.appearance === undefined ? {} : { appearance: host.appearance }),
        role: host.role,
        ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
        ...(host.licenseRaisesMemberLimit === undefined
          ? {}
          : { licenseRaisesMemberLimit: host.licenseRaisesMemberLimit }),
        ...(host.hosted === undefined ? {} : { hosted: host.hosted }),
        ...(host.restartAvailable === undefined ? {} : { restartAvailable: host.restartAvailable }),
        ...(host.storageGb === undefined ? {} : { storageGb: host.storageGb }),
        ...(host.paymentRequired ? { paymentRequired: true } : {}),
        ...(host.customPlan ? { customPlan: host.customPlan } : {}),
        transport: "webrtc-v2",
      };
    });

  const listedById = new Map(listed.map((server) => [server.id, server]));
  const seen = new Set<string>();
  const staleTransportHostIds: string[] = [];
  const servers = input.servers.flatMap((server) => {
    if (server.transport !== "webrtc-v2") {
      if ((input.keepOtherTransports || input.isThisComputer?.(server.id)) && !listedById.has(server.id))
        return [{ ...server }];
      staleTransportHostIds.push(server.id);
      return [];
    }
    const refreshed = listedById.get(server.id);
    if (!refreshed) return [];
    seen.add(server.id);
    if (input.isConnected(server.id) && server.publicKey === refreshed.publicKey) {
      refreshed.remoteDesktopAvailable = server.remoteDesktopAvailable;
    }
    if (server.appearance !== undefined && (refreshed.appearance === undefined || input.isConnected(server.id)))
      refreshed.appearance = server.appearance;
    return [refreshed];
  });
  for (const server of listed) {
    if (seen.has(server.id)) continue;
    seen.add(server.id);
    servers.push(server);
  }

  return {
    servers,
    removedHostIds: input.servers
      .filter((server) => server.transport === "webrtc-v2" && !seen.has(server.id))
      .map((server) => server.id),
    staleTransportHostIds,
    pinnedKeys,
  };
}

function pinnedIdentity(
  input: Pick<WebRtcHostReconciliationInput, "servers" | "preservedIdentities">,
  hostId: string,
): PinnedIdentity | undefined {
  const stored = input.servers.find((server) => server.id === hostId);
  if (stored) {
    return stored.transport === "webrtc-v2"
      ? { publicKey: stored.publicKey ?? null, fingerprint: stored.fingerprint }
      : { publicKey: null, fingerprint: "" };
  }
  return input.preservedIdentities.find((identity) => identity.hostId === hostId);
}

interface PinnedIdentity {
  readonly publicKey: string | null;
  readonly fingerprint: string;
}

function resolveHostKey(existing: PinnedIdentity | undefined, advertised: string | null): string | null {
  if (existing?.publicKey) return existing.publicKey;
  const pinned = pinnedFingerprint(existing);
  if (pinned && pinned !== advertisedFingerprint(advertised)) return null;
  return advertised;
}

function pinnedFingerprint(existing: PinnedIdentity | undefined): string {
  return existing?.fingerprint ?? "";
}

function advertisedFingerprint(devicePublicKey: string | null): string {
  return devicePublicKey ? fingerprint(devicePublicKey) : "";
}
