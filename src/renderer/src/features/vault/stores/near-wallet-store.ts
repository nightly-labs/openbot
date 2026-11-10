import { type NearWalletDesktopApi, type NearWalletStatus, NO_NEAR_WALLET } from "@openbot/contracts/ipc";
import type { NearWalletActions } from "@openbot/ui/features/vault/VaultNearWallet";
import { createStore } from "solid-js";

/**
 * The NEAR Intents wallet of this computer, for the Vault page and the payment cards in the chat.
 * Each call answers with the new status, and main sends it again when a signature in the browser ends.
 */
export function createNearWalletStore(api: () => NearWalletDesktopApi = () => window.openbot.nearWallet) {
  const [state, setState] = createStore<{ status: NearWalletStatus }>({ status: structuredClone(NO_NEAR_WALLET) });
  let request = 0;

  const show = (status: NearWalletStatus) => {
    // A status that a call or an event brings is newer than one that is still loading.
    request++;
    setState((draft) => {
      draft.status = status;
    });
    return status;
  };

  const actions: NearWalletActions = {
    setKey: async (key) => show(await api().setKey(key)),
    create: async (input) => show(await api().create(input)),
    setBudget: async (dailyBudgetUsd) => show(await api().setBudget({ dailyBudgetUsd })),
    setAgents: async (agentIds) => show(await api().setAgents({ agentIds })),
    renewGrant: async () => show(await api().renewGrant()),
    freeze: async () => show(await api().freeze()),
    unfreeze: async () => show(await api().unfreeze()),
    deposit: (assetId) => api().deposit({ assetId }),
    saveRule: async (input) => show(await api().saveRule(input)),
    removeRule: async (domain) => show(await api().removeRule({ domain })),
    allowPayment: async (input) => show(await api().allowPayment(input)),
    openSigning: () => api().openSigning(),
    cancelSigning: async () => show(await api().cancelSigning()),
    disconnect: async () => show(await api().disconnect()),
  };

  return {
    state,
    actions,
    refresh: async () => {
      const current = ++request;
      const status = await api().status();
      if (current === request) show(status);
    },
    /** Shows each status that main sends. Returns the function that stops it. */
    subscribe: () => api().onChanged(show),
  };
}

export type NearWalletStore = ReturnType<typeof createNearWalletStore>;
