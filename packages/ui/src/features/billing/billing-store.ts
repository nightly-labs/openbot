import type { BillingPortalRequest, BillingState, BillingStorageRequest } from "@openbot/contracts/billing";
import { createEffect, createStore, untrack } from "solid-js";
import { currentText } from "../../text";

export interface BillingCalls {
  getState: () => Promise<BillingState>;
  openPortal: (request: BillingPortalRequest) => Promise<void>;
  buyStorage: (request: BillingStorageRequest) => Promise<BillingState>;
}

interface BillingPanelState {
  loading: boolean;
  error: string | null;
  actionError: string | null;
  pending: string | null;
  billing: BillingState | null;
}

export function billingActionKey(request: BillingPortalRequest): string {
  return request.flow === "manage" ? "manage" : `${request.flow}:${request.subscriptionId}`;
}

export function createBillingStore(calls: () => BillingCalls | undefined, isActive: () => boolean) {
  const [state, setState] = createStore<BillingPanelState>({
    loading: false,
    error: null,
    actionError: null,
    pending: null,
    billing: null,
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
      try {
        const api = calls();
        if (!api) return;
        const billing = await api.getState();
        setState((draft) => {
          draft.billing = billing;
        });
      } catch (error) {
        setState((draft) => {
          const text = currentText();
          draft.error = text.errorMessage(error, text.t("billing.loadFailed"));
        });
      }
    },
  });

  async function openPortal(request: BillingPortalRequest): Promise<void> {
    const api = calls();
    if (!api || state.pending) return;
    setState((draft) => {
      draft.pending = billingActionKey(request);
      draft.actionError = null;
    });
    try {
      await api.openPortal(request);
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

  async function buyStorage(request: BillingStorageRequest): Promise<void> {
    const api = calls();
    if (!api) throw new TypeError("The billing calls are not available.");
    try {
      const billing = await api.buyStorage(request);
      setState((draft) => {
        draft.billing = billing;
      });
      void load();
    } catch (error) {
      void load();
      throw error;
    }
  }

  return { state, load, openPortal, buyStorage };
}

export type BillingStore = ReturnType<typeof createBillingStore>;

export function createStripeReturnLoad(options: {
  available: () => boolean;
  isActive: () => boolean;
  setLoading: (loading: boolean) => void;
  loadOnce: () => Promise<void>;
}): () => Promise<void> {
  let reloadRequested = false;
  let loadPromise: Promise<void> | null = null;

  function load(): Promise<void> {
    if (!options.available()) return Promise.resolve();
    reloadRequested = true;
    if (loadPromise) return loadPromise;
    loadPromise = Promise.resolve().then(async () => {
      try {
        while (reloadRequested) {
          reloadRequested = false;
          options.setLoading(true);
          await options.loadOnce();
        }
      } finally {
        loadPromise = null;
        options.setLoading(false);
      }
    });
    return loadPromise;
  }

  createEffect(
    () => options.isActive() && options.available(),
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

  return load;
}
