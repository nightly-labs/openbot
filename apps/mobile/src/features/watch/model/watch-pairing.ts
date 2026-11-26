import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  decodeWatchRelaySetup,
  WATCH_RELAY_ROUTES,
  WATCH_RELAY_TEAM_CAPABILITY,
} from "@openbot/contracts/team-protocol/watch-relay-v1";
import type { WatchDirectCredentials, WatchDirectServer } from "@openbot/contracts/watch-protocol";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { fetch } from "@/features/support/model/logged-fetch";

const WATCH_SESSIONS_PATH = "/v2/remote/watch/sessions";
const ACCOUNT_REQUEST_TIMEOUT_MS = 10_000;
const SETUP_TIMEOUT_MS = 8_000;

export interface WatchAccountCredential {
  apiUrl: string;
  sessionToken: string;
}

export interface WatchSessionGrant {
  watchSessionId: string;
  token: string;
  expiresAt: number;
}

function decodeWatchSessionGrant(value: unknown): WatchSessionGrant {
  if (
    !isDynamicRecord(value) ||
    !isString(value.watchSessionId) ||
    !value.watchSessionId ||
    !isString(value.token) ||
    !value.token ||
    !isNumber(value.expiresAt) ||
    !Number.isSafeInteger(value.expiresAt)
  ) {
    throw new Error("The watch session response is invalid.");
  }
  return { watchSessionId: value.watchSessionId, token: value.token, expiresAt: value.expiresAt };
}

async function withTimeout<T>(timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function createWatchSession(credential: WatchAccountCredential, publicKey: string): Promise<WatchSessionGrant> {
  return withTimeout(ACCOUNT_REQUEST_TIMEOUT_MS, async (signal) => {
    const response = await fetch(new URL(WATCH_SESSIONS_PATH, credential.apiUrl).toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.sessionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey }),
      signal,
    });
    if (!response.ok) throw new Error(`The watch session was not created (${response.status}).`);
    return decodeWatchSessionGrant(await response.json());
  });
}

export async function revokeWatchSession(credential: WatchAccountCredential, watchSessionId: string): Promise<void> {
  await withTimeout(ACCOUNT_REQUEST_TIMEOUT_MS, (signal) =>
    fetch(new URL(`${WATCH_SESSIONS_PATH}/${encodeURIComponent(watchSessionId)}`, credential.apiUrl).toString(), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${credential.sessionToken}` },
      signal,
    }),
  );
}

export function supportsWatchRelay(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(WATCH_RELAY_TEAM_CAPABILITY) ?? false;
}

function settleWithin<T>(timeoutMs: number, promise: Promise<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function loadWatchServers(
  serverIds: readonly string[],
  teamApi: (serverId: string) => TeamApiRequest,
): Promise<WatchDirectServer[]> {
  const setups = await Promise.all(
    serverIds.map((serverId) =>
      settleWithin(SETUP_TIMEOUT_MS, teamApi(serverId)("GET", WATCH_RELAY_ROUTES.setup, decodeWatchRelaySetup)),
    ),
  );
  return serverIds.flatMap((serverId, index) => {
    const setup = setups[index];
    return setup ? [{ serverId, hostId: setup.hostId, watchKey: setup.watchKey }] : [];
  });
}

export function watchDirectCredentials(
  account: string,
  apiUrl: string,
  grant: WatchSessionGrant,
  servers: readonly WatchDirectServer[],
): WatchDirectCredentials {
  return {
    account,
    authUrl: new URL(apiUrl).origin,
    watchSessionId: grant.watchSessionId,
    token: grant.token,
    expiresAt: grant.expiresAt,
    servers: [...servers],
  };
}
