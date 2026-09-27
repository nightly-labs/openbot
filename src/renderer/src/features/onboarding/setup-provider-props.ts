import { useProviders } from "../../providers";
import { useAgents } from "../agents/agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { providerKeyApi } from "../settings/provider-key-api";
import type { SetupProviderProps } from "./SetupProviderPicker";

/**
 * The providers of this computer and the actions on them, as the setup screens take them.
 *
 * Setup records the default provider of this computer, so the actions work only here. While
 * `local()` is false a joined server is active: the list then shows its status and offers no
 * action, and no custom endpoint, because an endpoint merges into the OpenCode process of the
 * computer that runs the agents.
 */
export function useSetupProviderProps(local: () => boolean = () => true): SetupProviderProps {
  const { agentStatus } = useAgents();
  const providers = useProviders();
  const endpoints = useCustomProviders();
  /** Managed runtimes: a row downloads its CLI. Without them a row opens a sign-in guide. */
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
    get onConnectProvider() {
      return local() ? providers.connectProvider : undefined;
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
    get codeLogin() {
      return local() ? providers.codeLogin : undefined;
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
  };
}
