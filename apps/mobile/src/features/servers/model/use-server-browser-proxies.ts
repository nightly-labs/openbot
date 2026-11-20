import {
  type BrowserProxyComputer,
  type BrowserProxyFailure,
  type BrowserProxyList,
  type BrowserProxySummary,
  browserProxyName,
  type SaveBrowserProxyInput,
} from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useText } from "@/shared/lib/text";

export interface BrowserProxyChoice {
  id: string;
  kind: "proxy" | "computer";
  name: string;
  failure: BrowserProxyFailure | null;
  offline: boolean;
  profileIds: readonly string[];
}

function useBrowserComputerName() {
  const { t } = useText();
  return (computer: Pick<BrowserProxyComputer, "mine" | "name">) => {
    if (computer.mine) return t("mobile.server.browserProxies.yourComputer");
    return computer.name === null
      ? t("mobile.server.browserProxies.unknownComputer")
      : t("mobile.server.browserProxies.memberComputer", { name: computer.name });
  };
}

export function useBrowserProxyChoices(list: BrowserProxyList | undefined): BrowserProxyChoice[] {
  const computerName = useBrowserComputerName();
  if (!list) return [];
  return [
    ...list.proxies.map(
      (proxy): BrowserProxyChoice => ({
        id: proxy.id,
        kind: "proxy",
        name: browserProxyName(proxy, list.proxies),
        failure: proxy.failure,
        offline: false,
        profileIds: proxy.profileIds,
      }),
    ),
    ...list.computers.map(
      (computer): BrowserProxyChoice => ({
        id: computer.id,
        kind: "computer",
        name: computerName(computer),
        failure: computer.failure,
        offline: !computer.online,
        profileIds: computer.profileIds,
      }),
    ),
  ];
}

export function useBrowserProxyState() {
  const { t } = useText();
  return (choice: BrowserProxyChoice, proxy?: BrowserProxySummary) => {
    if (choice.offline) return t("mobile.server.browserProxies.offline", { name: choice.name });
    if (choice.failure === "signIn") return t("mobile.server.browserProxies.signInRefused", { name: choice.name });
    if (choice.failure === "unreachable") return t("mobile.server.browserProxies.failing", { name: choice.name });
    const profiles = t("mobile.server.browserProxies.profiles", { count: choice.profileIds.length });
    return proxy
      ? t("mobile.server.browserProxies.summary", { scheme: proxy.scheme.toUpperCase(), port: proxy.port, profiles })
      : t("mobile.server.browserProxies.computerSummary", {
          state: t("mobile.server.browserProxies.online"),
          profiles,
        });
  };
}

export function useServerBrowserProxies(serverId: string) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canManageBrowserProxies(serverId));
  const actions = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverBrowserProxies(queryScope, serverId);
  const query = useQuery({
    queryKey,
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: () => actions.loadBrowserProxies(serverId),
  });

  async function changed(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.serverBrowserProfiles(queryScope, serverId), exact: true }),
    ]).catch(() => undefined);
  }

  return {
    available,
    query,
    list: query.data,
    async save(input: SaveBrowserProxyInput): Promise<BrowserProxySummary> {
      try {
        return await actions.saveBrowserProxy(input, serverId);
      } finally {
        await changed();
      }
    },
    async remove(proxyId: string, profileIds: readonly string[]): Promise<void> {
      await actions.deleteBrowserProxy({ proxyId, profileIds: [...profileIds] }, serverId);
      await changed();
    },
    async setProfileProxy(profileId: string, proxyId: string | null): Promise<void> {
      await actions.setBrowserProfileProxy({ profileId, proxyId }, serverId);
      await changed();
    },
  };
}
