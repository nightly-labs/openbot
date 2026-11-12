import {
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isOpenBillingStatus,
} from "@openbot/contracts/billing";
import type {
  HostedServerCatalogPlan,
  HostedServerEntryPoint,
  HostedServerList,
  HostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import type { HostedServersDesktopApi, LicenseDesktopApi, ServerSummary } from "@openbot/contracts/ipc";
import type { LicenseOrder, LicenseState, PricingOrder } from "@openbot/contracts/license";
import { classifyFailure } from "@openbot/telemetry";
import type {
  CreatedHostedServer,
  CreateHostedServerInput,
  HostedServerSetupStatus,
} from "@openbot/ui/features/servers/AddServerDialog";
import {
  guessHostedCurrency,
  HOSTED_BILLING_CURRENCY,
  HOSTED_CURRENCIES,
  type HostedCurrency,
  type HostedServerPlan,
  hostedCurrencies,
  hostedServerPlansFromCatalog,
} from "@openbot/ui/features/servers/HostedServerPricing";
import { currentText, useText } from "@openbot/ui/text";
import type { UserErrorDetails } from "@openbot/user-errors";
import { Portal } from "@solidjs/web";
import { createEffect, createStore, Loading, onSettled, type ParentProps, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import { AddServerDialog, HostedPricingPage } from "../../lazy-views";
import { createPageHeaderFrame } from "../window/page-header-frame";
import type { PricingPagePlacement } from "../window/window-page-context";

type PlansEvent = DesktopAnalyticsProperties<"hosted_server_plans_action">;

/** The pages that the consent of the pricing page links to. */
const PRIVACY_URL = "https://openbot.run/privacy";
const TERMS_URL = "https://openbot.run/terms";

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
  /**
   * Reads the account's license. When the account has none, the pricing page sells one with the server, or alone:
   * a license alone goes to its own payment page.
   */
  license?: Pick<LicenseDesktopApi, "getState" | "openCheckout"> | undefined;
  /** True in the desktop app, which runs on the user's computer. The pricing page then names this computer. */
  thisComputer?: boolean | undefined;
  /**
   * Shows the pricing page as a page of the desktop window. Without it, as in the web client, the page covers the
   * app frame.
   */
  pricingPage?: PricingPagePlacement | undefined;
  /** Opens a web page of openbot.run, such as the privacy policy, in the browser. */
  onOpenUrl: (url: string) => void;
  onClose: () => void;
  onOpenServer: (serverId: string) => void;
  onContactUs?: (() => void) | undefined;
  onJoinWithInvite?: (() => void) | undefined;
  /** Opens the dialog that creates a server on this computer. The web client has no such server. */
  onCreateLocal?: (() => void) | undefined;
  /** Opens the dialog with the command that installs a server on another computer. */
  onInstallServer?: (() => void) | undefined;
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
  /** The plans with their prices, for the order form of the pricing page. */
  catalog: HostedServerCatalogPlan[];
  /** True when the account has an open license. A server order then buys the server alone. */
  ownLicense: boolean;
  /** True while an order of the pricing page goes to the payment page. */
  ordering: boolean;
  /** True after the pricing page ordered a server. The page then stays under the setup dialog until it closes. */
  orderedFromPage: boolean;
  orderError: UserErrorDetails | null;
  /** The title of `orderError`: an order of only a license makes no server. */
  orderErrorTitle: string;
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
    catalog: [],
    ownLicense: false,
    ordering: false,
    orderedFromPage: false,
    orderError: null,
    orderErrorTitle: "",
  });
  const { t, errorDetails } = useText();
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
        draft.catalog = [...catalog.plans];
        draft.ownLicense = licenseState?.license ? isOpenBillingStatus(licenseState.license.status) : false;
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

  /**
   * The order of the pricing page. A server goes to the payment page, and the dialog then shows its setup. A license
   * alone goes to the payment page of the license.
   */
  async function submitOrder(order: PricingOrder): Promise<void> {
    if (state.ordering) return;
    setState((draft) => {
      draft.ordering = true;
      if (order.server) draft.orderedFromPage = true;
      draft.orderError = null;
    });
    try {
      if (order.server) {
        await createPlan(order.server, order.interval, order.currency, state.ownLicense ? null : order.license);
      } else if (order.license) {
        const license = props.license;
        if (!license) return;
        await license.openCheckout({
          users: order.license.users,
          currency: order.currency,
          tier: order.license.tier,
          interval: order.interval,
        });
        props.onClose();
      }
    } catch (error) {
      setState((draft) => {
        const title = order.server
          ? t("settings.hostedServers.createFailed")
          : t("settings.hostedServers.checkoutFailed");
        draft.orderError = errorDetails(error, title);
        draft.orderErrorTitle = title;
        // No server was made, so the page stays open, and a new window page closes the flow.
        draft.orderedFromPage = false;
      });
    } finally {
      setState((draft) => {
        draft.ordering = false;
      });
    }
  }

  /** The pricing page shows until the user orders. A server in setup, or an order from the web page, opens the dialog. */
  const pageOpen = () => state.server === null && state.order === null;
  /**
   * The setup dialog of a server that the pricing page ordered shows over the page. The window then stays on the page
   * and does not go back to the page below it.
   */
  const pageShown = () => pageOpen() || state.orderedFromPage;
  /** The web client has no window page, so the page covers the app frame there. */
  const overlayMount = () => document.querySelector(".app-window > .app-frame") ?? document.body;
  const headerFrame = createPageHeaderFrame();
  const contactUs = () =>
    props.onContactUs &&
    (() => {
      analytics.track("sales_contact_clicked", { entry_point: "add_server" });
      props.onContactUs?.();
    });
  const manageServers = () =>
    props.onManageServers &&
    (() => {
      analytics.track("limit_reached", { kind: "servers", action: "manage_clicked" });
      props.onManageServers?.();
    });
  const joinWithInvite = () =>
    props.onJoinWithInvite &&
    (() => {
      trackPlans("join_opened");
      props.onJoinWithInvite?.();
    });
  const close = () => {
    trackPlans("closed");
    props.onClose();
  };
  /** Another window page opened. The setup dialog of an ordered server stays; only the page under it goes. */
  const leavePage = () => {
    if (!state.orderedFromPage) {
      close();
      return;
    }
    setState((draft) => {
      draft.orderedFromPage = false;
    });
  };

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
          <Show when={pageShown()}>
            <PricingPagePortal placement={props.pricingPage} overlayMount={overlayMount} onLeave={leavePage}>
              <HostedPricingPage
                overlay={props.pricingPage === undefined}
                headerFrame={props.pricingPage ? headerFrame() : undefined}
                plans={state.catalog}
                currency={HOSTED_BILLING_CURRENCY[state.currency ?? guessHostedCurrency(hostedCurrencies(plans()))]}
                currencyLocked={state.currency !== null}
                used={state.licenseOffer?.used}
                licenseTrialEnd={state.licenseOffer?.trialEnd}
                offerLicense={!state.ownLicense && props.license !== undefined}
                thisComputer={props.thisComputer === true}
                serverLimit={serverLimit()}
                busy={state.ordering}
                error={state.orderError}
                errorTitle={state.orderErrorTitle}
                onSubmit={(order) => void submitOrder(order)}
                onClose={close}
                onOpenPrivacy={() => props.onOpenUrl(PRIVACY_URL)}
                onOpenTerms={() => props.onOpenUrl(TERMS_URL)}
                onContactUs={contactUs()}
                onManageServers={manageServers()}
                onCreateLocal={props.onCreateLocal}
                onInstallServer={props.onInstallServer}
                onJoinWithInvite={joinWithInvite()}
              />
            </PricingPagePortal>
          </Show>
          <Show when={!pageOpen()}>
            <AddServerDialog
              plans={plans()}
              recommendedPlan="standard"
              licenseOffer={state.licenseOffer ?? undefined}
              currency={state.currency ?? undefined}
              currencyLocked={state.currency !== null}
              order={state.order ?? undefined}
              setupStatus={setupStatus()}
              serverLimit={serverLimit()}
              onManageServers={manageServers()}
              resume={state.server ? { serverId: state.server.serverId, name: state.server.name } : undefined}
              onClose={close}
              onContactUs={contactUs()}
              onJoinWithInvite={joinWithInvite()}
              onCreateLocal={props.onCreateLocal}
              onInstallServer={props.onInstallServer}
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
          </Show>
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

/**
 * Puts the pricing page in the card of the desktop window while it shows, or over the app frame without a window
 * page. Another page of the window closes the add-server flow.
 */
function PricingPagePortal(
  props: ParentProps<{
    placement: PricingPagePlacement | undefined;
    overlayMount: () => Element;
    onLeave: () => void;
  }>,
) {
  onSettled(() => {
    const placement = untrack(() => props.placement);
    placement?.open(() => untrack(() => props.onLeave()));
    return () => placement?.close();
  });
  return (
    <Show when={props.placement} fallback={<Portal mount={props.overlayMount()}>{props.children}</Portal>}>
      {(placement) => (
        <Show when={placement().mount()}>{(mount) => <Portal mount={mount()}>{props.children}</Portal>}</Show>
      )}
    </Show>
  );
}
