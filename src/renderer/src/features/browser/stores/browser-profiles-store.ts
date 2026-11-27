import type {
  AgentBrowserProfile,
  AvatarHue,
  BrowserProfileSummary,
  BrowserProxyComputer,
  BrowserProxySummary,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import type { BrowserProfileCalls } from "../browser-profiles-port";

interface BrowserProfilesState {
  profiles: BrowserProfileSummary[] | undefined;
  sharedAgentIds: string[] | undefined;
  proxies: BrowserProxySummary[] | undefined;
  computers: BrowserProxyComputer[] | undefined;
  sharing: boolean | undefined;
}

export function createBrowserProfilesStore(calls: () => BrowserProfileCalls) {
  const [state, setState] = createStore<BrowserProfilesState>({
    profiles: undefined,
    sharedAgentIds: undefined,
    proxies: undefined,
    computers: undefined,
    sharing: undefined,
  });
  let request = 0;
  let listed: BrowserProfileCalls | undefined;

  async function refresh(): Promise<void> {
    const current = ++request;
    const target = calls();
    if (target !== listed) {
      listed = target;
      setState((draft) => {
        draft.profiles = undefined;
        draft.sharedAgentIds = undefined;
        draft.proxies = undefined;
        draft.computers = undefined;
        draft.sharing = undefined;
      });
    }
    const [list, proxies, sharing] = await Promise.all([
      target.list(),
      target.proxies?.list().catch(() => null) ?? Promise.resolve(null),
      target.proxies?.computerSharing?.read().catch(() => null) ?? Promise.resolve(null),
    ]);
    if (current === request)
      setState((draft) => {
        draft.profiles = list.profiles;
        draft.sharedAgentIds = list.sharedAgentIds;
        draft.proxies = proxies?.proxies;
        draft.computers = proxies?.computers;
        draft.sharing = sharing?.sharing;
      });
  }

  function proxyCalls() {
    const proxies = calls().proxies;
    if (!proxies) throw new Error(currentText().t("browser.proxies.unsupported"));
    return proxies;
  }

  const refreshAfterChange = () => refresh().catch(() => undefined);

  async function change(action: () => Promise<unknown>): Promise<void> {
    await action();
    await refreshAfterChange();
  }

  return {
    state,
    refresh,
    follow: (onChange?: () => void): (() => void) =>
      calls().onChanged?.(() => {
        void refreshAfterChange();
        onChange?.();
      }) ?? (() => undefined),
    create: async (name: string): Promise<string> => {
      const profile = await calls().create(name);
      await refreshAfterChange();
      return profile.id;
    },
    rename: (profileId: string, name: string) => change(() => calls().update({ profileId, name })),
    recolor: (profileId: string, hue: AvatarHue) => change(() => calls().update({ profileId, hue })),
    clear: (profileId: string) => change(() => calls().clear({ profileId })),
    remove: (profileId: string) => change(() => calls().remove(profileId)),
    saveProxy: async (input: {
      proxyId?: string;
      previousAddress?: string;
      keepPassword?: boolean;
      address: string;
      assignTo?: string;
    }): Promise<void> => {
      const proxies = proxyCalls();
      const saved = await proxies.save(
        input.proxyId === undefined
          ? { address: input.address }
          : {
              proxyId: input.proxyId,
              previousAddress: input.previousAddress ?? "",
              keepPassword: input.keepPassword === true,
              address: input.address,
            },
      );
      if (input.assignTo !== undefined) await proxies.setProfileProxy({ profileId: input.assignTo, proxyId: saved.id });
      await refreshAfterChange();
    },
    removeProxy: (proxyId: string, profileIds: readonly string[]) =>
      change(() => proxyCalls().remove({ proxyId, profileIds: [...profileIds] })),
    setSharing: async (sharing: boolean, assignTo?: string): Promise<void> => {
      const proxies = proxyCalls();
      if (!proxies.computerSharing) throw new Error(currentText().t("browser.proxies.unsupported"));
      await proxies.computerSharing.set(sharing);
      if (assignTo !== undefined) {
        const list = await proxies.list();
        const mine = list?.computers.find((computer) => computer.mine);
        if (mine) await proxies.setProfileProxy({ profileId: assignTo, proxyId: mine.id });
      }
      await refreshAfterChange();
    },
    setProfileProxy: (profileId: string, proxyId: string | null) =>
      change(() => proxyCalls().setProfileProxy({ profileId, proxyId })),
    assign: (agentId: string, profile: AgentBrowserProfile): Promise<AgentBrowserProfile> =>
      calls().updateAgent({ agentId, profile }),
  };
}

export type BrowserProfilesStore = ReturnType<typeof createBrowserProfilesStore>;
