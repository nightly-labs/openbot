import type { OpenBotDesktopApi, PromptCacheTtl } from "@openbot/contracts/ipc";
import type { ProviderPromptCache } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createHostSetting } from "./host-setting-state";

/** The prompt cache calls of one server's host. The desktop reaches them through main. */
export type HostPromptCacheTtlCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getPromptCacheTtl" | "setPromptCacheTtl">;

export interface HostPromptCacheTtlOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostPromptCacheTtlCalls;
}

export interface ProviderPromptCacheSource extends HostPromptCacheTtlOptions {
  serverId: string;
}

/**
 * The Claude page's prompt cache time of this computer or a joined server (`prompt-cache-ttl-v1`).
 * The host checks the role again. Undefined while `source` is.
 *
 * Each new value of `status` reads the time again: the host sends a status event after a change,
 * such as one from the mobile app or another admin.
 */
export function createProviderPromptCache(
  source: () => ProviderPromptCacheSource | undefined,
  status: () => unknown,
): () => ProviderPromptCache | undefined {
  const { t } = useText();
  const calls = (): HostPromptCacheTtlCalls => source()?.calls ?? window.openbot.hostAdmin;
  const setting = createHostSetting<PromptCacheTtl, PromptCacheTtl>({
    serverId: () => source()?.serverId,
    status,
    read: async (serverId) => (await calls().getPromptCacheTtl(serverId)).ttl,
    save: async (ttl, serverId) => (await calls().setPromptCacheTtl(ttl, serverId)).ttl,
    loadFailed: () => t("provider.settings.promptCacheLoadFailed"),
  });
  const cache: ProviderPromptCache = {
    get value() {
      return setting.state.value;
    },
    get pending() {
      return setting.state.pending;
    },
    get error() {
      return setting.state.error;
    },
    onChange: (ttl) => void setting.choose(ttl),
  };
  return () => (source() ? cache : undefined);
}
