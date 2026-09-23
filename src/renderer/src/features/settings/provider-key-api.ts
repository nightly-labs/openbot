import type { ProviderKeyApi } from "./OpenCodeKeyDialog";

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
