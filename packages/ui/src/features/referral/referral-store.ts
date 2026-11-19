import type { ReferralFilter, ReferralPageRequest, ReferralState } from "@openbot/contracts/referral";
import { createStore } from "solid-js";
import { currentText } from "../../text";
import { createStripeReturnLoad } from "../billing/billing-store";

/** The invite calls of one surface: desktop IPC or the web client's account server requests. */
export interface ReferralCalls {
  /** The link, the credit, the friend counts, and one page of friends. */
  getState: (request: ReferralPageRequest) => Promise<ReferralState>;
}

interface ReferralPanelState {
  loading: boolean;
  /** The last load failure. The panel keeps the last state that loaded. */
  error: string | null;
  /** The filter and page that the reader chose. `referral` can still show the one before. */
  request: ReferralPageRequest;
  referral: ReferralState | null;
}

/**
 * The Invite friends panel: its state and the load loop. It loads when the panel shows, and again on
 * window focus, because a friend can pay and a credit can arrive while the panel is open in another window.
 */
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
        // A newer choice runs one more load; this result is for an older one.
        if (state.request.filter !== request.filter || state.request.page !== request.page) return;
        setState((draft) => {
          draft.referral = referral;
          // The list got shorter since the last load: the account server sends its last page.
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

  /** Shows one status, from its first page. */
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
