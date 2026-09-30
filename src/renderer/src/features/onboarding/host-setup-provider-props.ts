import type { HostProviderSettings } from "../settings/ProviderSettingsSection";
import type { SetupProviderProps } from "./SetupProviderPicker";

/**
 * The providers of a joined server's host, as the provider step of setup takes them.
 *
 * The step then gives only what reaches the host: runtime downloads, the OpenCode key, a code
 * sign-in and the host's endpoints. A browser sign-in, an install guide and the scan for local
 * servers are of this computer, so the step shows none of them.
 */
export function hostSetupProviderProps(settings: HostProviderSettings): SetupProviderProps {
  return {
    hostProviders: true,
    get agentStatus() {
      return settings.agentStatus;
    },
    get refreshingProviders() {
      const phase = settings.agentStatus.phase;
      return phase === "starting" || phase === "restarting";
    },
    get providerRuntimeStatuses() {
      return settings.providerRuntimeStatuses;
    },
    get providerAvailableVersions() {
      return settings.providerAvailableVersions;
    },
    get onUpdateProvider() {
      return settings.onUpdateProvider;
    },
    get onDownloadProvider() {
      return settings.onDownloadProvider;
    },
    get onCancelProviderDownload() {
      return settings.onCancelProviderDownload;
    },
    get providerKeys() {
      return settings.providerKeys;
    },
    get codeLogin() {
      return settings.codeLogin;
    },
    get customProviders() {
      return settings.customProviders;
    },
    get onAddCustomProvider() {
      return settings.onAddCustomProvider;
    },
    get onDeleteCustomProvider() {
      return settings.onDeleteCustomProvider;
    },
  };
}
