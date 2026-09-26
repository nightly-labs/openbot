import type { ProviderAdminDesktopApi } from "@openbot/contracts/ipc";
import type { ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";

/**
 * The four calls the OpenCode key dialog makes, bound once.
 *
 * It is a narrow object rather than `window.openbot` itself so the dialog's props say exactly what
 * it reaches for, and so a test hands it four functions instead of the whole bridge. Settings and
 * onboarding both open the dialog, so it lives here rather than in either.
 */
export const providerKeyApi: ProviderKeyApi = {
  getProviderApiKeyState: (provider) => window.openbot.getProviderApiKeyState(provider),
  setProviderApiKey: (input) => window.openbot.setProviderApiKey(input),
  clearProviderApiKey: (provider) => window.openbot.clearProviderApiKey(provider),
  openExternal: (destination) => window.openbot.openExternal(destination),
};

/**
 * The same four calls for the host of a joined server the account administers. The key goes to that
 * host, and only its state comes back. Links still open in the browser of this computer.
 */
export function hostProviderKeyApi(admin: () => ProviderAdminDesktopApi, serverId: string): ProviderKeyApi {
  return {
    getProviderApiKeyState: (provider) => admin().getApiKeyState(provider, serverId),
    setProviderApiKey: (input) => admin().setApiKey(input, serverId),
    clearProviderApiKey: (provider) => admin().clearApiKey(provider, serverId),
    openExternal: (destination) => window.openbot.openExternal(destination),
  };
}
