import {
  type AgentProviderId,
  agentProviderName,
  isProviderEnvironmentProvider,
  type OpenBotDesktopApi,
  type ProviderEnvironment,
  type ProviderEnvironmentVariableInput,
} from "@openbot/contracts/ipc";
import type { ProviderEnvironmentControl } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createHostSetting } from "./host-setting-state";

/** The variable calls of one server's host. The desktop reaches them through main. */
export type HostProviderEnvironmentCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getProviderEnvironment" | "setProviderEnvironment"
>;

export interface HostProviderEnvironmentOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostProviderEnvironmentCalls;
}

export interface ProviderEnvironmentSource extends HostProviderEnvironmentOptions {
  serverId: string;
}

/**
 * The Environment section of each provider page, for this computer or a joined server
 * (`provider-environment-v1`). The host checks the role again. Undefined while `source` is, and for a
 * provider that takes no variables.
 *
 * Each new value of `status` reads the variables again: the host sends a status event after a change.
 */
export function createProviderEnvironment(
  source: () => ProviderEnvironmentSource | undefined,
  status: () => unknown,
): () => ((provider: AgentProviderId) => ProviderEnvironmentControl | undefined) | undefined {
  const { t } = useText();
  const calls = (): HostProviderEnvironmentCalls => source()?.calls ?? window.openbot.hostAdmin;

  /** Runs when a provider page opens, so its effects end when the page closes. */
  function open(provider: AgentProviderId): ProviderEnvironmentControl | undefined {
    if (!isProviderEnvironmentProvider(provider)) return undefined;
    const setting = createHostSetting<ProviderEnvironment, ProviderEnvironmentVariableInput[]>({
      serverId: () => source()?.serverId,
      status,
      read: (serverId) => calls().getProviderEnvironment(provider, serverId),
      save: (variables, serverId) => calls().setProviderEnvironment({ provider, variables }, serverId),
      loadFailed: () => t("provider.settings.environmentLoadFailed", { name: agentProviderName(provider) }),
    });
    return {
      get value() {
        return setting.state.value;
      },
      get pending() {
        return setting.state.pending;
      },
      get error() {
        return setting.state.error;
      },
      onSave: (variables) => void setting.choose(variables),
    };
  }
  return () => (source() ? open : undefined);
}
