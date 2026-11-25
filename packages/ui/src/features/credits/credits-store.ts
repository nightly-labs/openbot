import type {
  CreditActivity,
  CreditCheckoutRequest,
  CreditRedeemRequest,
  CreditRedeemResult,
  CreditServerWallet,
  CreditsState,
  CreditTransferRequest,
} from "@openbot/contracts/credits";
import { classifyFailure } from "@openbot/telemetry";
import { createEffect, createSignal, createStore } from "solid-js";
import { currentText } from "../../text";
import { toast } from "../../toast";
import { createStripeReturnLoad } from "../billing/billing-store";

export interface CreditsCalls {
  getState: () => Promise<CreditsState>;
  getActivity: () => Promise<CreditActivity>;
  openCheckout: (request: CreditCheckoutRequest) => Promise<void>;
  transfer: (request: CreditTransferRequest) => Promise<CreditsState>;
  redeem: (request: CreditRedeemRequest) => Promise<CreditRedeemResult>;
}

export type CreditsAction = "checkout" | "transfer" | "redeem";

interface CreditsCheckout {
  serverId: string | null;
  balance: number;
}

interface CreditsStoreState {
  loading: boolean;
  error: string | null;
  pending: CreditsAction | null;
  credits: CreditsState | null;
  checkout: CreditsCheckout | null;
  added: { serverId: string | null; credits: number; nonce: number } | null;
  activity: CreditActivity | null;
  activityFailed: boolean;
}

export function creditsBalance(credits: CreditsState | null, serverId: string | null): number {
  if (!credits) return 0;
  if (serverId === null) return credits.balance;
  return credits.servers.find((server) => server.serverId === serverId)?.balance ?? 0;
}

export function creditsServer(credits: CreditsState | null, serverId: string | null): CreditServerWallet | null {
  if (!credits || serverId === null) return null;
  return credits.servers.find((server) => server.serverId === serverId) ?? null;
}

export function createCreditsStore(
  calls: () => CreditsCalls | undefined,
  isActive: () => boolean,
  onChange?: (credits: CreditsState) => void,
  options: { activity?: boolean } = {},
) {
  const [state, setState] = createStore<CreditsStoreState>({
    loading: false,
    error: null,
    pending: null,
    credits: null,
    checkout: null,
    added: null,
    activity: null,
    activityFailed: false,
  });
  let addedNonce = 0;

  function announceAdded(credits: CreditsState, serverId: string | null, added: number) {
    const text = currentText();
    const name = creditsServer(credits, serverId)?.name ?? text.t("billing.credits.yours");
    toast.success(text.t("billing.credits.added", { count: added, amount: text.format.number(added), name }));
  }

  function apply(credits: CreditsState) {
    const checkout = state.checkout;
    const balance = checkout ? creditsBalance(credits, checkout.serverId) : 0;
    const added = checkout && balance > checkout.balance ? balance - checkout.balance : 0;
    setState((draft) => {
      draft.credits = credits;
      if (!checkout || added === 0) return;
      addedNonce += 1;
      draft.added = { serverId: checkout.serverId, credits: added, nonce: addedNonce };
      draft.checkout = null;
    });
    if (checkout && added > 0) announceAdded(credits, checkout.serverId, added);
    onChange?.(credits);
  }

  async function loadActivity(api: CreditsCalls) {
    if (!options.activity) return;
    try {
      const activity = await api.getActivity();
      setState((draft) => {
        draft.activity = activity;
        draft.activityFailed = false;
      });
    } catch {
      setState((draft) => {
        draft.activityFailed = true;
      });
    }
  }

  const load = createStripeReturnLoad({
    available: () => calls() !== undefined,
    isActive,
    setLoading: (loading) =>
      setState((draft) => {
        draft.loading = loading;
        if (loading) draft.error = null;
      }),
    loadOnce: async () => {
      try {
        const api = calls();
        if (!api) return;
        const [credits] = await Promise.all([api.getState(), loadActivity(api)]);
        apply(credits);
      } catch (error) {
        setState((draft) => {
          const text = currentText();
          draft.error = text.errorMessage(error, text.t("billing.credits.loadFailed"));
        });
      }
    },
  });

  async function run(action: CreditsAction, call: (api: CreditsCalls) => Promise<CreditsState | undefined>) {
    const api = calls();
    if (!api || state.pending) return false;
    setState((draft) => {
      draft.pending = action;
    });
    try {
      const credits = await call(api);
      if (credits) {
        apply(credits);
        void loadActivity(api);
      }
      return true;
    } catch (error) {
      const text = currentText();
      const fallback = action === "checkout" ? "billing.credits.checkoutFailed" : "billing.credits.moveFailed";
      toast.error(text.errorMessage(error, text.t(fallback)), {
        error,
        report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
      });
      return false;
    } finally {
      setState((draft) => {
        draft.pending = null;
      });
    }
  }

  async function redeem(request: CreditRedeemRequest): Promise<CreditRedeemResult | null> {
    const api = calls();
    if (!api || state.pending) return null;
    setState((draft) => {
      draft.pending = "redeem";
    });
    try {
      const result = await api.redeem(request);
      apply(result.state);
      void loadActivity(api);
      return result;
    } finally {
      setState((draft) => {
        draft.pending = null;
      });
    }
  }

  return {
    state,
    load,
    redeem,
    openCheckout: (request: CreditCheckoutRequest) => {
      const serverId = request.serverId ?? null;
      setState((draft) => {
        draft.checkout = { serverId, balance: creditsBalance(draft.credits, serverId) };
      });
      return run("checkout", async (api) => {
        await api.openCheckout(request);
        return undefined;
      }).then((opened) => {
        if (!opened)
          setState((draft) => {
            draft.checkout = null;
          });
        return opened;
      });
    },
    transfer: (request: CreditTransferRequest) => run("transfer", (api) => api.transfer(request)),
  };
}

export type CreditsStore = ReturnType<typeof createCreditsStore>;

export interface CreditsSummary {
  state: () => CreditsState | null;
  available: () => boolean;
  refresh: () => void;
  adopt: (credits: CreditsState) => void;
}

export interface CreditsMenu {
  state: CreditsState | null;
  localServerId?: string | null | undefined;
  onOpen: (serverId: string | null) => void;
  onRefresh: () => void;
}

export function createCreditsSummary(
  calls: () => CreditsCalls | undefined,
  account: () => string | null,
): CreditsSummary {
  const [result, setResult] = createSignal<{ account: string; state: CreditsState | null } | null>(null);
  const [refreshes, setRefreshes] = createSignal(0);
  let request = 0;
  createEffect(
    () => {
      refreshes();
      const api = calls();
      const key = account();
      return api && key !== null ? { api, key } : null;
    },
    (target) => {
      request += 1;
      if (!target) return;
      const current = request;
      target.api.getState().then(
        (state) => {
          if (current === request) setResult({ account: target.key, state });
        },
        () => {
          if (current !== request) return;
          setResult((previous) => (previous?.account === target.key ? previous : { account: target.key, state: null }));
        },
      );
    },
  );
  const state = () => {
    const loaded = result();
    return loaded !== null && loaded.account === account() ? loaded.state : null;
  };
  return {
    state,
    available: () => state()?.available === true,
    refresh: () => setRefreshes((count) => count + 1),
    adopt: (credits: CreditsState) => {
      const key = account();
      if (key === null) return;
      request += 1;
      setResult({ account: key, state: credits });
    },
  };
}
