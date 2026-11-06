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

/** A saved proxy or the computer of a member, as one proxy choice of a named profile. */
export interface BrowserProxyChoice {
  id: string;
  kind: "proxy" | "computer";
  name: string;
  /** Why the last page load through it failed, or null. */
  failure: BrowserProxyFailure | null;
  /** A computer whose desktop app does not share its connection now. */
  offline: boolean;
  profileIds: readonly string[];
}

/** The name of the computer of a member, as the desktop Browser profiles section names it. */
function useBrowserComputerName() {
  const { t } = useText();
  return (computer: Pick<BrowserProxyComputer, "mine" | "name">) => {
    if (computer.mine) return t("mobile.server.browserProxies.yourComputer");
    return computer.name === null
      ? t("mobile.server.browserProxies.unknownComputer")
      : t("mobile.server.browserProxies.memberComputer", { name: computer.name });
  };
}

/** Each saved proxy, then each computer, in the order the list shows them. */
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

/** "SOCKS5 · port 1080 · 2 profiles", "Online · 1 profile", or the problem of the proxy. */
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

/**
 * The saved proxies of the named profiles of one host, and the computers of its members
 * (`browser-proxies-v1`). The phone lists, adds, changes and deletes proxies and chooses the proxy of
 * a profile, as the desktop app does. It cannot share its own connection: the phone app has no TCP
 * sockets, so a member shares a computer only from the desktop app. Each change reads the proxies and
 * the profiles again, because a change closes the tabs of the profiles that use the proxy.
 */
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
    // The change is done when a list fails, so a failed list does not report it as failed.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.serverBrowserProfiles(queryScope, serverId), exact: true }),
    ]).catch(() => undefined);
  }

  return {
    available,
    query,
    list: query.data,
    /**
     * A new proxy, or a change to one. `previousAddress` is the address that the page opened with, so
     * the host refuses the change when another admin changed the proxy first.
     */
    async save(input: SaveBrowserProxyInput): Promise<BrowserProxySummary> {
      try {
        return await actions.saveBrowserProxy(input, serverId);
      } finally {
        await changed();
      }
    },
    /** `profileIds`: the profiles that the person saw use it. They change to Automatic. */
    async remove(proxyId: string, profileIds: readonly string[]): Promise<void> {
      await actions.deleteBrowserProxy({ proxyId, profileIds: [...profileIds] }, serverId);
      await changed();
    },
    /** Null: Automatic. The host closes the open tabs of the profile. */
    async setProfileProxy(profileId: string, proxyId: string | null): Promise<void> {
      await actions.setBrowserProfileProxy({ profileId, proxyId }, serverId);
      await changed();
    },
  };
}
