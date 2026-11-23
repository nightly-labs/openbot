import type { OpenBotDesktopApi, PromptCacheTtl } from "@openbot/contracts/ipc";
import type {
  ProviderCacheExpiryCompaction,
  ProviderPromptCache,
} from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createHostSetting } from "./host-setting-state";

export type HostPromptCacheTtlCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getPromptCacheTtl" | "setPromptCacheTtl" | "getCacheExpiryCompaction" | "setCacheExpiryCompaction"
>;

export interface HostPromptCacheTtlOptions {
  calls?: HostPromptCacheTtlCalls;
}

export interface ProviderPromptCacheSource extends HostPromptCacheTtlOptions {
  serverId: string;
  appliesToPi: boolean;
  compaction: boolean;
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
  const compactionSetting = createHostSetting<boolean, boolean>({
    serverId: () => (source()?.compaction ? source()?.serverId : undefined),
    status,
    read: async (serverId) => (await calls().getCacheExpiryCompaction(serverId)).enabled,
    save: async (enabled, serverId) => (await calls().setCacheExpiryCompaction(enabled, serverId)).enabled,
    loadFailed: () => t("provider.settings.cacheExpiryCompactionLoadFailed"),
  });
  const compaction: ProviderCacheExpiryCompaction = {
    get value() {
      return compactionSetting.state.value;
    },
    get pending() {
      return compactionSetting.state.pending;
    },
    get error() {
      return compactionSetting.state.error;
    },
    onChange: (enabled) => void compactionSetting.choose(enabled),
  };
  const cache: ProviderPromptCache = {
    get value() {
      return setting.state.value;
    },
    get appliesToPi() {
      return source()?.appliesToPi === true;
    },
    get pending() {
      return setting.state.pending;
    },
    get error() {
      return setting.state.error;
    },
    get compaction() {
      return source()?.compaction ? compaction : undefined;
    },
    onChange: (ttl) => void setting.choose(ttl),
  };
  return () => (source() ? cache : undefined);
}
