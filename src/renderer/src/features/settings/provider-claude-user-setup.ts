import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { ProviderClaudeUserSetup } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createHostSetting } from "./host-setting-state";

/** The "Use my Claude Code setup" calls of one server's host. The desktop reaches them through main. */
export type HostClaudeUserSetupCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getClaudeUserSetup" | "setClaudeUserSetup"
>;

export interface HostClaudeUserSetupOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostClaudeUserSetupCalls;
}

export interface ProviderClaudeUserSetupSource extends HostClaudeUserSetupOptions {
  serverId: string;
  /** A joined server: the setup is the one of the host's user, on the host. */
  remote: boolean;
}

/**
 * The Claude page's "Use my Claude Code setup" switch of this computer or a joined server
 * (`claude-user-setup-v1`). The host checks the role again. Undefined while `source` is.
 *
 * Each new value of `status` reads the setting again: the host sends a status event after a change.
 */
export function createProviderClaudeUserSetup(
  source: () => ProviderClaudeUserSetupSource | undefined,
  status: () => unknown,
): () => ProviderClaudeUserSetup | undefined {
  const { t } = useText();
  const calls = (): HostClaudeUserSetupCalls => source()?.calls ?? window.openbot.hostAdmin;
  const setting = createHostSetting<boolean, boolean>({
    serverId: () => source()?.serverId,
    status,
    read: async (serverId) => (await calls().getClaudeUserSetup(serverId)).enabled,
    save: async (enabled, serverId) => (await calls().setClaudeUserSetup(enabled, serverId)).enabled,
    loadFailed: () => t("provider.settings.claudeUserSetupLoadFailed"),
  });
  const setup: ProviderClaudeUserSetup = {
    get value() {
      return setting.state.value;
    },
    get pending() {
      return setting.state.pending;
    },
    get error() {
      return setting.state.error;
    },
    get remote() {
      return source()?.remote === true;
    },
    onChange: (next) => void setting.choose(next),
  };
  return () => (source() ? setup : undefined);
}
