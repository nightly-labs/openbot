import type { BillingPortalRequest, BillingState } from "@openbot/contracts/billing";
import { createEffect, createStore, untrack } from "solid-js";
import { currentText } from "../../text";

/** The billing calls of one surface: desktop IPC or the web client's account server requests. */
export interface BillingCalls {
  getState: () => Promise<BillingState>;
  /** Opens the Stripe Customer Portal for the account, or on the plan change or cancel page of one plan. */
  openPortal: (request: BillingPortalRequest) => Promise<void>;
}

interface BillingPanelState {
  loading: boolean;
  /** The last load failure. The panel keeps the last state that loaded. */
  error: string | null;
  /** The last Portal failure. */
  actionError: string | null;
  /** The `billingActionKey` of the Portal page that is opening. */
  pending: string | null;
  billing: BillingState | null;
}

/** `manage`, or the flow and subscription id of one plan. */
export function billingActionKey(request: BillingPortalRequest): string {
  return request.flow === "manage" ? "manage" : `${request.flow}:${request.subscriptionId}`;
}

/**
 * The Billing panel: its state, the load loop, and the Portal actions. It loads when the panel
 * shows, and again on window focus while it shows, because the Stripe page is in another window or
 * tab and the webhook can arrive after the reader comes back.
 */
export function createBillingStore(calls: () => BillingCalls | undefined, isActive: () => boolean) {
  const [state, setState] = createStore<BillingPanelState>({
    loading: false,
    error: null,
    actionError: null,
    pending: null,
    billing: null,
  });
  let reloadRequested = false;
  let loadPromise: Promise<void> | null = null;

  function load(): Promise<void> {
    if (!calls()) return Promise.resolve();
    reloadRequested = true;
    if (loadPromise) return loadPromise;
    loadPromise = Promise.resolve().then(async () => {
      try {
        while (reloadRequested) {
          reloadRequested = false;
          setState((draft) => {
            draft.loading = true;
            draft.error = null;
          });
          try {
            const api = calls();
            if (api) {
              const billing = await api.getState();
              setState((draft) => {
                draft.billing = billing;
              });
            }
          } catch (error) {
            setState((draft) => {
              const text = currentText();
              draft.error = text.errorMessage(error, text.t("billing.loadFailed"));
            });
          }
        }
      } finally {
        loadPromise = null;
        setState((draft) => {
          draft.loading = false;
        });
      }
    });
    return loadPromise;
  }

  createEffect(
    () => isActive() && calls() !== undefined,
    (shouldLoad) => {
      if (!shouldLoad) return;
      untrack(() => void load());
      const reload = () => {
        if (document.visibilityState !== "hidden") void load();
      };
      window.addEventListener("focus", reload);
      document.addEventListener("visibilitychange", reload);
      return () => {
        window.removeEventListener("focus", reload);
        document.removeEventListener("visibilitychange", reload);
      };
    },
  );

  async function openPortal(request: BillingPortalRequest): Promise<void> {
    const api = calls();
    if (!api || state.pending) return;
    setState((draft) => {
      draft.pending = billingActionKey(request);
      draft.actionError = null;
    });
    try {
      await api.openPortal(request);
      // The state can change while the Stripe page is open.
      void load();
    } catch (error) {
      setState((draft) => {
        const text = currentText();
        draft.actionError = text.errorMessage(error, text.t("billing.portalFailed"));
      });
    } finally {
      setState((draft) => {
        draft.pending = null;
      });
    }
  }

  return { state, load, openPortal };
}

export type BillingStore = ReturnType<typeof createBillingStore>;
