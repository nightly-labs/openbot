import { useProviders } from "../../providers";
import { useAgents } from "../agents/agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useProviderDetection } from "../custom-providers/provider-detection-context";
import type { HostProviderSettings } from "../settings/ProviderSettingsSection";
import { providerKeyApi } from "../settings/provider-key-api";
import type { SetupProviderProps } from "./SetupProviderPicker";

export function useSetupProviderProps(local: () => boolean = () => true): SetupProviderProps {
  const { agentStatus } = useAgents();
  const providers = useProviders();
  const endpoints = useCustomProviders();
  const detection = useProviderDetection();
  const downloads = () => local() && providers.providerRuntimeDownloadsAvailable();
  const guides = () => local() && !providers.providerRuntimeDownloadsAvailable();
  return {
    get agentStatus() {
      return agentStatus();
    },
    get refreshingProviders() {
      return (
        providers.refreshingProviders() || agentStatus().phase === "starting" || agentStatus().phase === "restarting"
      );
    },
    get providerRuntimeStatuses() {
      return downloads() ? providers.providerRuntimeStatuses() : undefined;
    },
    get providerAvailableVersions() {
      return downloads() ? providers.providerAvailableVersions() : undefined;
    },
    get onUpdateProvider() {
      return downloads() ? providers.startProviderUpdate : undefined;
    },
    get onDownloadProvider() {
      return downloads() ? providers.downloadProviderRuntime : undefined;
    },
    get onCancelProviderDownload() {
      return downloads() ? providers.cancelProviderRuntimeDownload : undefined;
    },
    get onCancelProviderSignIn() {
      return local() ? providers.cancelProviderSignIn : undefined;
    },
    get onInstallProvider() {
      return local() ? providers.openProviderInstallGuide : undefined;
    },
    get onSignInProvider() {
      return guides() ? providers.connectProvider : undefined;
    },
    get providerKeys() {
      return downloads() ? providerKeyApi : undefined;
    },
    get connection() {
      return local() ? providers.connection : undefined;
    },
    get onRefreshProviders() {
      return guides() ? providers.refreshAgentProviders : undefined;
    },
    get customProviders() {
      return local() ? endpoints.customProviders() : undefined;
    },
    get onAddCustomProvider() {
      return local() ? endpoints.saveCustomProvider : undefined;
    },
    get onDeleteCustomProvider() {
      return local() ? endpoints.deleteCustomProvider : undefined;
    },
    get providerDetection() {
      return local() ? detection.detection() : undefined;
    },
    get detectedProviderApi() {
      return local() ? detection.firstRunApi : undefined;
    },
    get takenAgentIds() {
      return local() ? detection.takenAgentIds() : undefined;
    },
  };
}

export function useHostProviderSettings(): () => HostProviderSettings | undefined {
  const { agentStatus } = useAgents();
  const providers = useProviders();
  const downloads = () => providers.providerRuntimeDownloadsAvailable();
  const settings: HostProviderSettings = {
    get agentStatus() {
      return agentStatus();
    },
    get providerRuntimeStatuses() {
      return downloads() ? providers.providerRuntimeStatuses() : undefined;
    },
    get providerAvailableVersions() {
      return downloads() ? providers.providerAvailableVersions() : undefined;
    },
    get onDownloadProvider() {
      return downloads() ? providers.downloadProviderRuntime : undefined;
    },
    get onCancelProviderDownload() {
      return downloads() ? providers.cancelProviderRuntimeDownload : undefined;
    },
    get onUpdateProvider() {
      return downloads() ? providers.startProviderUpdate : undefined;
    },
    get customProviders() {
      return providers.hostCustomProviders.customProviders();
    },
    onAddCustomProvider: (value) => providers.hostCustomProviders.saveCustomProvider(value),
    onDeleteCustomProvider: (id) => providers.hostCustomProviders.deleteCustomProvider(id),
    get providerKeys() {
      return downloads() ? providers.providerKeys() : undefined;
    },
    get connection() {
      return downloads() ? providers.connection : undefined;
    },
  };
  return () => (providers.providerAdminServerId() ? settings : undefined);
}
