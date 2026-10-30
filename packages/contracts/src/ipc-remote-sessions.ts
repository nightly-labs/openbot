// The desktop choices for remote connections: to keep its remote server sessions between runs of
// the app, and the network that devices use to connect to this computer.

import { isOneOf } from "./runtime-values";

/** As it is stored and as it crosses IPC. */
export interface RemoteSessionReusePreference {
  /** Keep each joined server's session for the next start, and leave it open at quit. */
  keepBetweenRuns: boolean;
}

export const DEFAULT_REMOTE_SESSION_REUSE_PREFERENCE: RemoteSessionReusePreference = { keepBetweenRuns: true };

/**
 * How devices that connect to this computer send chats and files. `openbot` uses a direct path when
 * one works and the OpenBot relay when it does not. `private` uses only a local network or a
 * Tailscale tailnet: sign-in and connection setup still go through OpenBot, but chats and files do not.
 */
export const REMOTE_NETWORK_ROUTES = ["openbot", "private"] as const;
export type RemoteNetworkRoute = (typeof REMOTE_NETWORK_ROUTES)[number];
export const DEFAULT_REMOTE_NETWORK_ROUTE: RemoteNetworkRoute = "openbot";

export function isRemoteNetworkRoute(value: unknown): value is RemoteNetworkRoute {
  return isOneOf(REMOTE_NETWORK_ROUTES, value);
}

/** As it is stored and as the renderer sets it. */
export interface RemoteNetworkRoutePreference {
  route: RemoteNetworkRoute;
}

/** The preference, and whether Tailscale is connected on this computer when main reads it. */
export interface RemoteNetworkRouteState extends RemoteNetworkRoutePreference {
  tailscaleConnected: boolean;
}
