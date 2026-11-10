import type { CustomProvidersDesktopApi, OpenBotDesktopApi, ProviderAdminDesktopApi } from "@openbot/contracts/ipc";
import type { ProviderDetectionCalls } from "./stores/provider-detection-store";

/**
 * What the custom providers context reaches in main: the endpoints the user named.
 */
export interface CustomProvidersPort {
  customProviders: OpenBotDesktopApi["customProviders"];
}

/**
 * The endpoint calls of one host. A joined server's host edits only with `custom-provider-edit-v1`,
 * so the settings page offers Edit by that capability.
 */
export type CustomProvidersEndpointApi = CustomProvidersDesktopApi;

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function customProvidersPort(): CustomProvidersPort {
  return window.openbot;
}

/** The endpoints of a joined server's host, for an account that administers it. */
export function hostCustomProvidersApi(
  admin: () => ProviderAdminDesktopApi,
  serverId: string,
): CustomProvidersEndpointApi {
  return {
    list: () => admin().listCustomProviders(serverId),
    save: (input) => admin().saveCustomProvider(input, serverId),
    update: (input) => admin().updateCustomProvider(input, serverId),
    delete: (input) => admin().deleteCustomProvider(input, serverId),
  };
}

/** What the detection store reaches in main: the scans of one computer and their settings. */
interface ProviderDetectionPort {
  providerDetection: OpenBotDesktopApi["providerDetection"];
}

/** Read on each call, like `customProvidersPort`. */
function providerDetectionPort(): ProviderDetectionPort {
  return window.openbot;
}

/**
 * The scans and the detection settings of one computer: this one (`LOCAL_SERVER_ID`), or a joined
 * server's host for an owner or admin, through `provider-detection-v1`.
 */
export function desktopProviderDetectionCalls(serverId: string): ProviderDetectionCalls {
  const api = () => providerDetectionPort().providerDetection;
  return {
    scanModelServers: () => api().scanModelServers(serverId),
    scanAgents: () => api().scanAgents(serverId),
    discoverModels: (input) => api().discoverModels(input, serverId),
    getSettings: () => api().getSettings(serverId),
    setSettings: (settings) => api().setSettings(settings, serverId),
  };
}
