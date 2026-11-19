import type {
  LicenseCheckoutRequest,
  LicensePlanRequest,
  LicenseRenewalRequest,
  LicenseState,
  LicenseUsersRequest,
} from "@openbot/contracts/license";
import { classifyFailure } from "@openbot/telemetry";
import { createStore } from "solid-js";
import { currentText } from "../../text";
import { toast } from "../../toast";
import { createStripeReturnLoad } from "./billing-store";

export interface LicenseCalls {
  getState: () => Promise<LicenseState>;
  openCheckout: (request: LicenseCheckoutRequest) => Promise<void>;
  setUsers: (request: LicenseUsersRequest) => Promise<LicenseState>;
  changePlan: (request: LicensePlanRequest) => Promise<LicenseState>;
  setRenewal: (request: LicenseRenewalRequest) => Promise<LicenseState>;
}

export type LicenseAction = "checkout" | "users" | "plan" | "renewal";

export interface LicenseStoreEvent {
  action:
    | "buy_opened"
    | "checkout_opened"
    | "users_change_requested"
    | "plan_change_requested"
    | "cancel_requested"
    | "cancel_kept"
    | "renewal_resumed"
    | "over_limit_shown";
  result?: "succeeded" | "failed";
  direction?: "up" | "down";
}

interface LicenseStoreState {
  loading: boolean;
  error: string | null;
  actionError: string | null;
  pending: LicenseAction | null;
  license: LicenseState | null;
}

export function createLicenseStore(
  calls: () => LicenseCalls | undefined,
  isActive: () => boolean,
  track?: (event: LicenseStoreEvent) => void,
) {
  const [state, setState] = createStore<LicenseStoreState>({
    loading: false,
    error: null,
    actionError: null,
    pending: null,
    license: null,
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
        const license = await api.getState();
        setState((draft) => {
          draft.license = license;
        });
      } catch (error) {
        setState((draft) => {
          const text = currentText();
          draft.error = text.errorMessage(error, text.t("billing.license.loadFailed"));
        });
      }
    },
  });

  async function run(
    action: LicenseAction,
    event: Omit<LicenseStoreEvent, "result">,
    call: (api: LicenseCalls) => Promise<LicenseState | undefined>,
  ) {
    const api = calls();
    if (!api || state.pending) return false;
    setState((draft) => {
      draft.pending = action;
      draft.actionError = null;
    });
    try {
      const license = await call(api);
      if (license) {
        setState((draft) => {
          draft.license = license;
        });
      } else {
        void load();
      }
      track?.({ ...event, result: "succeeded" });
      return true;
    } catch (error) {
      track?.({ ...event, result: "failed" });
      const text = currentText();
      const message = text.errorMessage(error, text.t("billing.license.actionFailed"));
      if (action === "checkout")
        toast.error(message, {
          description: text.t("billing.license.contactSales"),
          error,
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
      else
        setState((draft) => {
          draft.actionError = message;
        });
      return false;
    } finally {
      setState((draft) => {
        draft.pending = null;
      });
    }
  }

  return {
    state,
    load,
    openCheckout: (request: LicenseCheckoutRequest) =>
      run("checkout", { action: "checkout_opened" }, async (api) => {
        await api.openCheckout(request);
        return undefined;
      }),
    setUsers: (users: number) => {
      const current = state.license?.license?.users;
      const event: Omit<LicenseStoreEvent, "result"> = { action: "users_change_requested" };
      if (current !== undefined && users !== current) event.direction = users > current ? "up" : "down";
      return run("users", event, (api) => api.setUsers({ users }));
    },
    changePlan: (request: LicensePlanRequest) =>
      run("plan", { action: "plan_change_requested", direction: "up" }, (api) => api.changePlan(request)),
    setRenewal: (cancel: boolean) =>
      run("renewal", { action: cancel ? "cancel_requested" : "renewal_resumed" }, (api) => api.setRenewal({ cancel })),
    track: (action: "buy_opened" | "cancel_kept" | "over_limit_shown") => track?.({ action }),
    clearActionError: () =>
      setState((draft) => {
        draft.actionError = null;
      }),
  };
}

export type LicenseStore = ReturnType<typeof createLicenseStore>;
