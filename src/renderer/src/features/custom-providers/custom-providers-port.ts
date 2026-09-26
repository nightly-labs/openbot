import type { CustomProvidersDesktopApi, OpenBotDesktopApi, ProviderAdminDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the custom providers context reaches in main: the endpoints the user named.
 */
export interface CustomProvidersPort {
  customProviders: OpenBotDesktopApi["customProviders"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function customProvidersPort(): CustomProvidersPort {
  return window.openbot;
}

/** The endpoints of a joined server's host, for an account that administers it. */
export function hostCustomProvidersApi(
  admin: () => ProviderAdminDesktopApi,
  serverId: string,
): CustomProvidersDesktopApi {
  return {
    list: () => admin().listCustomProviders(serverId),
    save: (input) => admin().saveCustomProvider(input, serverId),
    delete: (input) => admin().deleteCustomProvider(input, serverId),
  };
}
