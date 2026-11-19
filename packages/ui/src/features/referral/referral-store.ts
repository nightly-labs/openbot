import type { ReferralFilter, ReferralPageRequest, ReferralState } from "@openbot/contracts/referral";
import { createStore } from "solid-js";
import { currentText } from "../../text";
import { createStripeReturnLoad } from "../billing/billing-store";

export interface ReferralCalls {
  getState: (request: ReferralPageRequest) => Promise<ReferralState>;
}

interface ReferralPanelState {
  loading: boolean;
  error: string | null;
  request: ReferralPageRequest;
  referral: ReferralState | null;
}

export function createReferralStore(calls: () => ReferralCalls | undefined, isActive: () => boolean) {
  const [state, setState] = createStore<ReferralPanelState>({
    loading: false,
    error: null,
    request: { filter: "all", page: 0 },
    referral: null,
  });
  const load = createStripeReturnLoad({
    available: () => calls() !== undefined,
    isActive,
    setLoading: (loading) =>
      setState((draft) => {
        draft.loading = loading;
        if (loading) draft.error = null;
      }),
    loadOnce: async () => {
      const api = calls();
      if (!api) return;
      const request = { ...state.request };
      try {
        const referral = await api.getState(request);
        if (state.request.filter !== request.filter || state.request.page !== request.page) return;
        setState((draft) => {
          draft.referral = referral;
          draft.request.page = referral.page;
        });
      } catch (error) {
        setState((draft) => {
          const text = currentText();
          draft.error = text.errorMessage(error, text.t("billing.referral.loadFailed"));
        });
      }
    },
  });

  function choose(filter: ReferralFilter): void {
    if (state.request.filter === filter) return;
    setState((draft) => {
      draft.request = { filter, page: 0 };
    });
    void load();
  }

  function turnPage(page: number): void {
    if (page < 0 || state.request.page === page) return;
    setState((draft) => {
      draft.request.page = page;
    });
    void load();
  }

  return { state, load, choose, turnPage };
}

export type ReferralStore = ReturnType<typeof createReferralStore>;
