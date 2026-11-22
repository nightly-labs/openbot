import type { ProviderAdminDesktopApi } from "@openbot/contracts/ipc";
import type { ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";

export const providerKeyApi: ProviderKeyApi = {
  getProviderApiKeyState: (provider) => window.openbot.getProviderApiKeyState(provider),
  setProviderApiKey: (input) => window.openbot.setProviderApiKey(input),
  clearProviderApiKey: (provider) => window.openbot.clearProviderApiKey(provider),
  openExternal: (destination) => window.openbot.openExternal(destination),
};

export function hostProviderKeyApi(
  admin: () => ProviderAdminDesktopApi,
  serverId: string,
  openExternal: ProviderKeyApi["openExternal"] = (destination) => window.openbot.openExternal(destination),
): ProviderKeyApi {
  return {
    onHost: true,
    getProviderApiKeyState: (provider) => admin().getApiKeyState(provider, serverId),
    setProviderApiKey: (input) => admin().setApiKey(input, serverId),
    clearProviderApiKey: (provider) => admin().clearApiKey(provider, serverId),
    openExternal,
  };
}
