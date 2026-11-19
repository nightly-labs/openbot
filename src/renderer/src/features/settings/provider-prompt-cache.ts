import type { OpenBotDesktopApi, PromptCacheTtl } from "@openbot/contracts/ipc";
import type { ProviderPromptCache } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createHostSetting } from "./host-setting-state";

export type HostPromptCacheTtlCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getPromptCacheTtl" | "setPromptCacheTtl">;

export interface HostPromptCacheTtlOptions {
  calls?: HostPromptCacheTtlCalls;
}

export interface ProviderPromptCacheSource extends HostPromptCacheTtlOptions {
  serverId: string;
}

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
