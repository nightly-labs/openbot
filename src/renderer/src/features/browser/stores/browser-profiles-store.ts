import type { AgentBrowserProfile, AvatarHue, BrowserProfileSummary } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";
import type { BrowserProfileCalls } from "../browser-profiles-port";

interface BrowserProfilesState {
  /** Undefined until the first list of the current server arrives. */
  profiles: BrowserProfileSummary[] | undefined;
  /** The agents that use the shared session. Undefined until the first list arrives. */
  sharedAgentIds: string[] | undefined;
}

/**
 * The named browser profiles of one server, for the agent and server settings. Each change lists
 * them again, because it can also move agents and close tabs, which the summaries count. When the
 * calls change to another server, the list of the last server goes before the next one loads.
 */
export function createBrowserProfilesStore(calls: () => BrowserProfileCalls) {
  const [state, setState] = createStore<BrowserProfilesState>({ profiles: undefined, sharedAgentIds: undefined });
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
      });
    }
    const list = await target.list();
    if (current === request)
      setState((draft) => {
        draft.profiles = list.profiles;
        draft.sharedAgentIds = list.sharedAgentIds;
      });
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
    assign: (agentId: string, profile: AgentBrowserProfile): Promise<AgentBrowserProfile> =>
      calls().updateAgent({ agentId, profile }),
  };
}

export type BrowserProfilesStore = ReturnType<typeof createBrowserProfilesStore>;
