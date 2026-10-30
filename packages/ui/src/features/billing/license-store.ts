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

/** The license calls of one surface: desktop IPC or the web client's account server requests. */
export interface LicenseCalls {
  getState: () => Promise<LicenseState>;
  /** Opens the Stripe Checkout page for a new license. */
  openCheckout: (request: LicenseCheckoutRequest) => Promise<void>;
  setUsers: (request: LicenseUsersRequest) => Promise<LicenseState>;
  /** Moves the license to Team, or a monthly Team license to yearly. */
  changePlan: (request: LicensePlanRequest) => Promise<LicenseState>;
  setRenewal: (request: LicenseRenewalRequest) => Promise<LicenseState>;
}

export type LicenseAction = "checkout" | "users" | "plan" | "renewal";

/** One license step, for the consumer's analytics. The store sends nothing itself. */
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
  /** The last load failure. The section keeps the last state that loaded. */
  error: string | null;
  /** The last failure of an action. */
  actionError: string | null;
  pending: LicenseAction | null;
  license: LicenseState | null;
}

/**
 * The license of the account: its state, the load loop, and the actions. Like the billing store, it
 * loads when the panel shows, and again on window focus, because Checkout is in another window or tab.
 */
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

  /** Runs one action. Returns false when it did not run or failed; a toast or `actionError` then has the reason. */
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
        // The state can change while the Stripe page is open.
        void load();
      }
      track?.({ ...event, result: "succeeded" });
      return true;
    } catch (error) {
      track?.({ ...event, result: "failed" });
      const text = currentText();
      const message = text.errorMessage(error, text.t("billing.license.actionFailed"));
      // A checkout failure shows as a toast with the sales address. The address is catalog text: an
      // error message loses it to redaction.
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
    /** Reports a step that has no call, such as an opened form. */
    track: (action: "buy_opened" | "cancel_kept" | "over_limit_shown") => track?.({ action }),
    clearActionError: () =>
      setState((draft) => {
        draft.actionError = null;
      }),
  };
}

export type LicenseStore = ReturnType<typeof createLicenseStore>;
