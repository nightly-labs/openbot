import type { HostProviderSettings } from "../settings/ProviderSettingsSection";
import type { SetupProviderProps } from "./SetupProviderPicker";

export function hostSetupProviderProps(settings: HostProviderSettings): SetupProviderProps {
  return {
    hostProviders: true,
    get customProviderHarnessChoice() {
      return settings.customProviderHarnessChoice;
    },
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
    get connection() {
      return settings.connection;
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
