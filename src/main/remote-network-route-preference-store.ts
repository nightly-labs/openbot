import {
  DEFAULT_REMOTE_NETWORK_ROUTE,
  isRemoteNetworkRoute,
  type RemoteNetworkRoutePreference,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { PreferenceStore } from "./preference-file";

/**
 * The network that devices use to connect to this computer. The host reads it each time it connects
 * to Signal. A file that names an unknown route reads as `openbot`, which is how every connection
 * worked before the setting existed.
 */
export type RemoteNetworkRoutePreferenceStore = PreferenceStore<RemoteNetworkRoutePreference>;

export function createRemoteNetworkRoutePreferenceStore(path: string): RemoteNetworkRoutePreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: { route: DEFAULT_REMOTE_NETWORK_ROUTE },
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isRemoteNetworkRoute(parsed.route)
        ? { route: parsed.route }
        : null,
  });
}
