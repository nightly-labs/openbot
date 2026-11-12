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
  /** Undefined until the first list of the current server arrives. */
  profiles: BrowserProfileSummary[] | undefined;
  /** The agents that use the shared session. Undefined until the first list arrives. */
  sharedAgentIds: string[] | undefined;
  /** Undefined until the first list arrives, and while the server has no proxy routes. */
  proxies: BrowserProxySummary[] | undefined;
  /** The computers of members, as proxies. Undefined while `proxies` is. */
  computers: BrowserProxyComputer[] | undefined;
  /** Whether this desktop app shares its connection with the server. Undefined: it cannot. */
  sharing: boolean | undefined;
}

/**
 * The named browser profiles of one server, for the agent and server settings. Each change lists
 * them again, because it can also move agents and close tabs, which the summaries count. When the
 * calls change to another server, the list of the last server goes before the next one loads.
 */
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
    // The profiles show also when the proxies do not load: the proxy choice then stays hidden.
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

  // The change is done when the list fails, so a failed list does not report it as failed; the
  // next refresh shows it.
  const refreshAfterChange = () => refresh().catch(() => undefined);

  async function change(action: () => Promise<unknown>): Promise<void> {
    await action();
    await refreshAfterChange();
  }

  return {
    state,
    refresh,
    /**
     * Lists again each time the host reports a change, also one made on another device, and then
     * calls `onChange`. Returns the unsubscribe. A host that reports no changes lists on open only.
     */
    follow: (onChange?: () => void): (() => void) =>
      calls().onChanged?.(() => {
        void refreshAfterChange();
        onChange?.();
      }) ?? (() => undefined),
    /** Returns the id of the new profile. */
    create: async (name: string): Promise<string> => {
      const profile = await calls().create(name);
      await refreshAfterChange();
      return profile.id;
    },
    rename: (profileId: string, name: string) => change(() => calls().update({ profileId, name })),
    recolor: (profileId: string, hue: AvatarHue) => change(() => calls().update({ profileId, hue })),
    clear: (profileId: string) => change(() => calls().clear({ profileId })),
    remove: (profileId: string) => change(() => calls().remove(profileId)),
    /**
     * Adds a proxy, or changes one when `proxyId` is set; `previousAddress` is then the address that
     * the person changed, and `keepPassword` keeps the saved password. `assignTo` is the named profile
     * that uses a new proxy at once, as when "New proxy…" opens from the menu of that profile.
     */
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
    /** `profileIds`: the named profiles that the person saw use the proxy. */
    removeProxy: (proxyId: string, profileIds: readonly string[]) =>
      change(() => proxyCalls().remove({ proxyId, profileIds: [...profileIds] })),
    /**
     * Turns on or off the sharing of this computer's connection with the server. On adds the
     * computer of this member, and `assignTo` is the named profile that uses it at once.
     */
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
    /** Null: the proxy settings of the computer. */
    setProfileProxy: (profileId: string, proxyId: string | null) =>
      change(() => proxyCalls().setProfileProxy({ profileId, proxyId })),
    assign: (agentId: string, profile: AgentBrowserProfile): Promise<AgentBrowserProfile> =>
      calls().updateAgent({ agentId, profile }),
  };
}

export type BrowserProfilesStore = ReturnType<typeof createBrowserProfilesStore>;
