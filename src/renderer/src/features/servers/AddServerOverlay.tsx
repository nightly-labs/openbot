import {
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isOpenBillingStatus,
} from "@openbot/contracts/billing";
import type { HostedServerEntryPoint, HostedServerList, HostedServerSummary } from "@openbot/contracts/hosted-servers";
import type { HostedServersDesktopApi, LicenseDesktopApi, ServerSummary } from "@openbot/contracts/ipc";
import type { LicenseOrder, LicenseState, PricingOrder } from "@openbot/contracts/license";
import { classifyFailure } from "@openbot/telemetry";
import type {
  CreatedHostedServer,
  CreateHostedServerInput,
  HostedServerSetupStatus,
} from "@openbot/ui/features/servers/AddServerDialog";
import {
  HOSTED_BILLING_CURRENCY,
  HOSTED_CURRENCIES,
  type HostedCurrency,
  type HostedServerPlan,
  hostedServerPlansFromCatalog,
} from "@openbot/ui/features/servers/HostedServerPricing";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, Loading, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import { AddServerDialog } from "../../lazy-views";

type PlansEvent = DesktopAnalyticsProperties<"hosted_server_plans_action">;

/** How often the dialog reads the new server while it waits for the payment and the setup. */
const SETUP_POLL_INTERVAL_MS = 3_000;

type AddServerCalls = Pick<HostedServersDesktopApi, "list" | "plans" | "create" | "openCheckout" | "wake">;

/** A server that the user created before the dialog opened, such as on a return from the payment page. */
export interface AddServerResume {
  serverId: string;
  /** True when Stripe returned after a payment. The setup then shows before the payment webhook. */
  paid: boolean;
}

interface AddServerOverlayProps {
  open: boolean;
  /** Where the user opened the plans. Analytics only. */
  entryPoint?: HostedServerEntryPoint | undefined;
  calls: AddServerCalls;
  /** The servers on the rail. The new server is ready when it shows here. */
  servers: readonly ServerSummary[];
  /**
   * Reads the rail servers again, while the new server runs but is not on the rail yet. Without it,
   * the consumer's own events must add the server.
   */
  onRefreshServers?: (() => Promise<void>) | undefined;
  resume?: AddServerResume | null | undefined;
  /** The order from the pricing page. The dialog fills it in and goes on to the payment page. */
  order?: PricingOrder | null | undefined;
  /** Reads the account's license. When the account has none, the dialog sells one with the server for work use. */
  license?: Pick<LicenseDesktopApi, "getState"> | undefined;
  onClose: () => void;
  onOpenServer: (serverId: string) => void;
  onContactUs?: (() => void) | undefined;
  onJoinWithInvite?: (() => void) | undefined;
  /** Opens the dialog that creates a server on this computer. The web client has no such server. */
  onCreateLocal?: (() => void) | undefined;
  /** Opens the list of the account's hosted servers, so that the user can delete one at the limit. */
  onManageServers?: (() => void) | undefined;
}

interface AddServerState {
  plans: HostedServerPlan[] | null;
  /** The number of hosted servers of the account, for the name of the next one. */
  serverCount: number;
  /** The servers that block a new one. The account server replaces an unpaid server at the limit. */
  paidCount: number;
  /** Null when the account server does not send it. */
  maxServers: number | null;
  server: HostedServerSummary | null;
  paid: boolean;
  /** Set when the account has no open license, so the dialog offers one. */
  licenseOffer: { used: number; trialEnd?: number } | null;
  /** The currency of the account's open subscriptions. A Stripe customer pays in one currency. */
  currency: HostedCurrency | null;
  /** The pricing page order, as the dialog's choices. */
  order: CreateHostedServerInput | null;
}

/** The license offer of an account with no open license. A failed read offers no license. */
function licenseOfferOf(state: LicenseState | null): { used: number; trialEnd?: number } | null {
  if (!state?.available) return null;
  if (state.license && isOpenBillingStatus(state.license.status)) return null;
  return { used: state.used, ...(state.trialEnd === undefined ? {} : { trialEnd: state.trialEnd }) };
}

/**
 * The pricing page order as the dialog's choices. An account with its own license buys the server alone. When the
 * license read failed, the dialog cannot sell the license, so it gets no order and the user chooses again.
 */
function dialogOrderOf(order: PricingOrder | null, state: LicenseState | null): CreateHostedServerInput | null {
  if (!order?.server) return null;
  const currency = HOSTED_CURRENCIES.find((entry) => HOSTED_BILLING_CURRENCY[entry] === order.currency);
  if (!currency) return null;
  const ownLicense = state?.license ? isOpenBillingStatus(state.license.status) : false;
  if (order.license && !ownLicense && !licenseOfferOf(state)) return null;
  return {
    plan: order.server,
    billing: order.interval === "year" ? "yearly" : "monthly",
    currency,
    license: ownLicense ? undefined : (order.license ?? undefined),
  };
}

/**
 * The plus button on the server rail, when the account can create hosted servers. A plan opens
 * the Stripe Checkout page; the account server creates the machine after Stripe confirms the payment.
 * The desktop main process and the web client open the page, so this view never gets its URL.
 */
export function AddServerOverlay(props: AddServerOverlayProps) {
  /**
   * One key for each choice, kept while its server waits for the payment. A second click on the same
   * plan, also after the dialog closed, then opens the same server and not a second one.
   */
  const requestIds = new Map<string, RequestKey>();
  /** A return from the payment page whose first read failed. The next opening shows its setup. */
  let pendingResume: AddServerResume | null = null;
  return (
    <Show when={props.open}>
      <AddServerSession
        {...props}
        resume={props.resume ?? pendingResume}
        requestIds={requestIds}
        onPendingResume={(resume) => {
          pendingResume = resume;
        }}
      />
    </Show>
  );
}

interface RequestKey {
  requestId: string;
  /** Null until the account server answers. */
  serverId: string | null;
}

function AddServerSession(
  props: AddServerOverlayProps & {
    requestIds: Map<string, RequestKey>;
    onPendingResume: (resume: AddServerResume | null) => void;
  },
) {
  const [state, setState] = createStore<AddServerState>({
    plans: null,
    serverCount: 0,
    paidCount: 0,
    maxServers: null,
    server: null,
    paid: false,
    licenseOffer: null,
    currency: null,
    order: null,
  });
  const requestIds = untrack(() => props.requestIds);
  const resume = untrack(() => props.resume) ?? null;
  const entryPoint = untrack(() => props.entryPoint) ?? (resume ? "checkout_resume" : undefined);
  const analytics = desktopAnalytics.scope();
  const trackPlans = (action: PlansEvent["action"], properties: Omit<PlansEvent, "action" | "entry_point"> = {}) =>
    analytics.track("hosted_server_plans_action", {
      action,
      ...properties,
      ...(entryPoint ? { entry_point: entryPoint } : {}),
    });
  /** A read can take longer than the poll interval. The next tick then skips, so reads do not overlap. */
  let refreshing = false;

  void load();

  async function load(): Promise<void> {
    try {
      const license = untrack(() => props.license);
      const [catalog, list, licenseState] = await Promise.all([
        props.calls.plans(),
        props.calls.list(),
        license ? license.getState().catch(() => null) : Promise.resolve(null),
      ]);
      const resumed = resume
        ? list.servers.find((server) => server.serverId === resume.serverId)
        : newestInSetup(
            list.servers,
            untrack(() => props.servers),
          );
      for (const [choice, key] of requestIds) {
        const unpaid = list.servers.some(
          (server) => server.serverId === key.serverId && server.state === "awaiting_payment",
        );
        if (key.serverId && !unpaid) requestIds.delete(choice);
      }
      props.onPendingResume(null);
      setState((draft) => {
        draft.plans = hostedServerPlansFromCatalog(catalog);
        draft.serverCount = list.servers.length;
        draft.paidCount = paidCount(list);
        draft.maxServers = list.maxServers;
        draft.server = resumed ?? null;
        draft.paid = resume?.paid ?? false;
        draft.licenseOffer = licenseOfferOf(licenseState);
        draft.currency =
          HOSTED_CURRENCIES.find((currency) => HOSTED_BILLING_CURRENCY[currency] === licenseState?.currency) ?? null;
        draft.order = resume ? null : dialogOrderOf(untrack(() => props.order) ?? null, licenseState);
      });
      trackPlans("viewed");
      if (serverLimit() !== null) analytics.track("limit_reached", { kind: "servers", action: "shown" });
    } catch (error) {
      const text = currentText();
      const title = text.t("settings.hostedServers.loadFailed");
      actionToast.error(title, {
        error,
        fallback: title,
        report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
      });
      if (resume) props.onPendingResume(resume);
      props.onClose();
    }
  }

  const setupStatus = (): HostedServerSetupStatus | null => {
    const server = state.server;
    if (!server) return null;
    switch (server.state) {
      case "awaiting_payment":
        return state.paid ? "creating" : "payment";
      case "creating":
        return "creating";
      case "starting":
      case "waking":
        return "starting";
      case "running":
        return props.servers.some((entry) => entry.id === server.serverId) ? "ready" : "connecting";
      default:
        return "error";
    }
  };

  createEffect(
    () => {
      const status = setupStatus();
      return status !== null && status !== "ready" && status !== "error";
    },
    (shouldPoll) => {
      if (!shouldPoll) return;
      const timer = window.setInterval(() => void refresh(), SETUP_POLL_INTERVAL_MS);
      return () => window.clearInterval(timer);
    },
  );

  async function refresh(): Promise<void> {
    const serverId = state.server?.serverId;
    if (!serverId || refreshing) return;
    refreshing = true;
    try {
      const [list] = await Promise.all([
        props.calls.list().catch(() => null),
        setupStatus() === "connecting" ? props.onRefreshServers?.().catch(() => undefined) : undefined,
      ]);
      const server = list?.servers.find((entry) => entry.serverId === serverId);
      if (server && state.server?.serverId === serverId) {
        setState((draft) => {
          draft.server = server;
        });
      }
    } finally {
      refreshing = false;
    }
  }

  const serverLimit = (): number | null =>
    state.maxServers !== null && state.paidCount >= state.maxServers ? state.maxServers : null;

  /**
   * Reads the server count again after a create failed. When the account reached its limit in
   * another window, the dialog then shows the limit and not the error text of the account server.
   */
  async function refreshCount(): Promise<void> {
    const list = await props.calls.list().catch(() => null);
    if (!list) return;
    setState((draft) => {
      draft.serverCount = list.servers.length;
      draft.paidCount = paidCount(list);
      draft.maxServers = list.maxServers;
    });
  }

  function nextName(): string {
    const text = currentText();
    return state.serverCount === 0
      ? text.t("server.hosted.defaultName")
      : text.t("server.hosted.defaultNameNumbered", { number: state.serverCount + 1 });
  }

  function create(input: CreateHostedServerInput): Promise<CreatedHostedServer> {
    const interval: BillingInterval = input.billing === "yearly" ? "year" : "month";
    return createPlan(input.plan, interval, HOSTED_BILLING_CURRENCY[input.currency], input.license ?? null);
  }

  async function createPlan(
    plan: BillingPlanId,
    interval: BillingInterval,
    currency: BillingCurrency,
    license: LicenseOrder | null,
  ): Promise<CreatedHostedServer> {
    const choice = license
      ? `${plan}:${interval}:${currency}:${license.tier}:${license.users}`
      : `${plan}:${interval}:${currency}`;
    const key = requestIds.get(choice) ?? { requestId: crypto.randomUUID(), serverId: null };
    requestIds.set(choice, key);
    trackPlans("plan_selected", { plan, interval, currency });
    const server = await props.calls
      .create({
        name: nextName(),
        plan,
        interval,
        currency,
        requestId: key.requestId,
        ...(entryPoint ? { entryPoint } : {}),
        ...(license ? { license } : {}),
      })
      .catch(async (error: unknown) => {
        await refreshCount();
        trackPlans("create_failed", { plan, interval, currency, failure_code: "create_failed" });
        if (serverLimit() !== null) analytics.track("limit_reached", { kind: "servers", action: "shown" });
        throw error;
      });
    key.serverId = server.serverId;
    setState((draft) => {
      draft.server = server;
      draft.paid = false;
    });
    return { serverId: server.serverId, name: server.name };
  }

  async function openPayment(): Promise<void> {
    const serverId = state.server?.serverId;
    if (!serverId) return;
    const server = await props.calls.openCheckout(serverId).catch((error: unknown) => {
      trackPlans("payment_open_failed", { failure_code: "payment_open_failed" });
      throw error;
    });
    setState((draft) => {
      draft.server = server;
    });
  }

  async function retry(): Promise<void> {
    const serverId = state.server?.serverId;
    if (!serverId) return;
    trackPlans("retried");
    try {
      const server = await props.calls.wake(serverId);
      setState((draft) => {
        draft.server = server;
      });
    } catch (error) {
      const text = currentText();
      const title = text.t("settings.hostedServers.wakeFailed");
      actionToast.error(title, {
        error,
        fallback: title,
        report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
      });
    }
  }

  return (
    <Show when={state.plans}>
      {(plans) => (
        <Loading>
          <AddServerDialog
            plans={plans()}
            recommendedPlan="standard"
            licenseOffer={state.licenseOffer ?? undefined}
            currency={state.currency ?? undefined}
            currencyLocked={state.currency !== null}
            order={state.order ?? undefined}
            setupStatus={setupStatus()}
            serverLimit={serverLimit()}
            onManageServers={
              props.onManageServers &&
              (() => {
                analytics.track("limit_reached", { kind: "servers", action: "manage_clicked" });
                props.onManageServers?.();
              })
            }
            resume={state.server ? { serverId: state.server.serverId, name: state.server.name } : undefined}
            onClose={() => {
              trackPlans("closed");
              props.onClose();
            }}
            onContactUs={
              props.onContactUs &&
              (() => {
                analytics.track("sales_contact_clicked", { entry_point: "add_server" });
                props.onContactUs?.();
              })
            }
            onJoinWithInvite={
              props.onJoinWithInvite &&
              (() => {
                trackPlans("join_opened");
                props.onJoinWithInvite?.();
              })
            }
            onCreateLocal={props.onCreateLocal}
            onCurrencyChange={(next) => trackPlans("currency_changed", { currency: HOSTED_BILLING_CURRENCY[next] })}
            onBillingChange={(next) =>
              trackPlans("interval_changed", { interval: next === "yearly" ? "year" : "month" })
            }
            onCreate={create}
            onRetry={() => void retry()}
            onOpenServer={() => {
              const serverId = state.server?.serverId;
              if (serverId) props.onOpenServer(serverId);
            }}
            onOpenPayment={openPayment}
          />
        </Loading>
      )}
    </Show>
  );
}

/**
 * A paid server that is not on the rail yet, so a new opening of the dialog shows its setup and not
 * the plans again. A server on the rail that wakes is not a new server.
 */
function newestInSetup(
  servers: readonly HostedServerSummary[],
  rail: readonly ServerSummary[],
): HostedServerSummary | undefined {
  let newest: HostedServerSummary | undefined;
  for (const server of servers) {
    if (server.state !== "creating" && server.state !== "starting" && server.state !== "waking") continue;
    if (rail.some((entry) => entry.id === server.serverId)) continue;
    if (!newest || server.createdAt > newest.createdAt) newest = server;
  }
  return newest;
}

function paidCount(list: HostedServerList): number {
  return list.servers.filter((server) => server.state !== "awaiting_payment").length;
}
