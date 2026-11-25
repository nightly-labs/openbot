import {
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isOpenBillingStatus,
} from "@openbot/contracts/billing";
import { type BillingDetails, isWithdrawalConsumer } from "@openbot/contracts/billing-details";
import type {
  HostedServerCatalog,
  HostedServerCatalogPlan,
  HostedServerEntryPoint,
  HostedServerList,
  HostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import type { HostedServersDesktopApi, LicenseDesktopApi, ServerSummary } from "@openbot/contracts/ipc";
import type { LicenseOrder, LicenseState, PricingOrder } from "@openbot/contracts/license";
import { classifyFailure } from "@openbot/telemetry";
import {
  type BillingDetailsCalls,
  type BillingDetailsDraft,
  billingDetailsDraft,
  saveBillingDetails,
} from "@openbot/ui/features/billing/BillingDetailsFields";
import type {
  CreatedHostedServer,
  CreateHostedServerInput,
  HostedServerSetupStatus,
} from "@openbot/ui/features/servers/AddServerDialog";
import type { OrderConsent } from "@openbot/ui/features/servers/HostedPricingPage";
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
import { createEffect, createSignal, createStore, Loading, onSettled, type ParentProps, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import { AddServerDialog, HostedPricingPage } from "../../lazy-views";
import { holdHostRestartNotice } from "../updates/host-restart-toast";
import { createPageHeaderFrame } from "../window/page-header-frame";
import type { PricingPagePlacement } from "../window/window-page-context";

type PlansEvent = DesktopAnalyticsProperties<"hosted_server_plans_action">;

const PRIVACY_URL = "https://openbot.run/privacy";
const TERMS_URL = "https://openbot.run/terms";

const SETUP_POLL_INTERVAL_MS = 3_000;
const RAIL_ANSWER_WAIT_MS = 60_000;

type AddServerCalls = Pick<HostedServersDesktopApi, "list" | "plans" | "create" | "openCheckout" | "wake">;

interface AddServerRead {
  catalog: HostedServerCatalog;
  list: HostedServerList;
  licenseState: LicenseState | null;
  details: BillingDetails | null;
}

export interface AddServerResume {
  serverId: string;
  paid: boolean;
}

interface AddServerOverlayProps {
  open: boolean;
  entryPoint?: HostedServerEntryPoint | undefined;
  calls: AddServerCalls;
  servers: readonly ServerSummary[];
  onRefreshServers?: (() => Promise<void>) | undefined;
  resume?: AddServerResume | null | undefined;
  order?: PricingOrder | null | undefined;
  license?: Pick<LicenseDesktopApi, "getState" | "openCheckout"> | undefined;
  billingDetails?: BillingDetailsCalls | undefined;
  thisComputer?: boolean | undefined;
  pricingPage?: PricingPagePlacement | undefined;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
  onOpenServer: (serverId: string) => void;
  onContactUs?: (() => void) | undefined;
  onJoinWithInvite?: (() => void) | undefined;
  onCreateLocal?: (() => void) | undefined;
  onInstallServer?: (() => void) | undefined;
  onManageServers?: (() => void) | undefined;
}

interface AddServerState {
  plans: HostedServerPlan[] | null;
  serverCount: number;
  paidCount: number;
  maxServers: number | null;
  server: HostedServerSummary | null;
  paid: boolean;
  licenseOffer: { used: number; trialEnd?: number } | null;
  currency: HostedCurrency | null;
  order: CreateHostedServerInput | null;
  pageOrder: PricingOrder | null;
  catalog: HostedServerCatalogPlan[];
  ownLicense: boolean;
  ordering: boolean;
  orderedFromPage: boolean;
  orderError: UserErrorDetails | null;
  orderErrorTitle: string;
  details: BillingDetails | null;
  detailsDraft: BillingDetailsDraft;
  detailsEdited: boolean;
}

function licenseOfferOf(state: LicenseState | null): { used: number; trialEnd?: number } | null {
  if (!state?.available) return null;
  if (state.license && isOpenBillingStatus(state.license.status)) return null;
  return { used: state.used, ...(state.trialEnd === undefined ? {} : { trialEnd: state.trialEnd }) };
}

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

export function AddServerOverlay(props: AddServerOverlayProps) {
  const requestIds = new Map<string, RequestKey>();
  let pendingResume: AddServerResume | null = null;
  let lastRead: AddServerRead | null = null;
  onSettled(() => {
    void HostedPricingPage.preload();
    void AddServerDialog.preload();
  });
  return (
    <Show when={props.open}>
      <AddServerSession
        {...props}
        resume={props.resume ?? pendingResume}
        requestIds={requestIds}
        lastRead={lastRead}
        onRead={(read) => {
          lastRead = read;
        }}
        onPendingResume={(resume) => {
          pendingResume = resume;
        }}
      />
    </Show>
  );
}

interface RequestKey {
  requestId: string;
  serverId: string | null;
}

function AddServerSession(
  props: AddServerOverlayProps & {
    requestIds: Map<string, RequestKey>;
    lastRead: AddServerRead | null;
    onRead: (read: AddServerRead | null) => void;
    onPendingResume: (resume: AddServerResume | null) => void;
  },
) {
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
  let refreshing = false;

  const lastRead = untrack(() =>
    resume || props.order || !props.lastRead || newestInSetup(props.lastRead.list.servers, props.servers)
      ? null
      : props.lastRead,
  );
  const initial: AddServerState = {
    plans: null,
    serverCount: 0,
    paidCount: 0,
    maxServers: null,
    server: null,
    paid: false,
    licenseOffer: null,
    currency: null,
    order: null,
    pageOrder: null,
    catalog: [],
    ownLicense: false,
    ordering: false,
    orderedFromPage: false,
    orderError: null,
    orderErrorTitle: "",
    details: null,
    detailsDraft: billingDetailsDraft(null),
    detailsEdited: false,
  };
  if (lastRead) {
    applyRead(initial, lastRead);
    trackPlans("viewed");
  }
  const [state, setState] = createStore<AddServerState>(initial);
  const loaded = load();

  function applyRead(draft: AddServerState, read: AddServerRead): void {
    const { catalog, list, licenseState, details } = read;
    draft.plans = hostedServerPlansFromCatalog(catalog);
    draft.serverCount = list.servers.length;
    draft.paidCount = paidCount(list);
    draft.maxServers = list.maxServers;
    const resumed = resume
      ? list.servers.find((server) => server.serverId === resume.serverId)
      : newestInSetup(
          list.servers,
          untrack(() => props.servers),
        );
    draft.server = resumed ?? null;
    draft.paid = resume?.paid ?? false;
    const needsCountry = untrack(() => props.billingDetails) !== undefined && !details?.country;
    const order = resume ? null : (untrack(() => props.order) ?? null);
    const needsPage = needsCountry || (isWithdrawalConsumer(details) && order?.server != null);
    draft.order = needsPage ? null : dialogOrderOf(order, licenseState);
    draft.pageOrder = needsPage ? order : null;
    draft.licenseOffer = licenseOfferOf(licenseState);
    draft.currency =
      HOSTED_CURRENCIES.find((currency) => HOSTED_BILLING_CURRENCY[currency] === licenseState?.currency) ?? null;
    draft.catalog = [...catalog.plans];
    draft.ownLicense = licenseState?.license ? isOpenBillingStatus(licenseState.license.status) : false;
    draft.details = details;
    if (!draft.detailsEdited) draft.detailsDraft = billingDetailsDraft(details);
  }

  async function load(): Promise<boolean> {
    try {
      const license = untrack(() => props.license);
      const billingDetails = untrack(() => props.billingDetails);
      const [catalog, list, licenseState, details] = await Promise.all([
        props.calls.plans(),
        props.calls.list(),
        license ? license.getState().catch(() => null) : Promise.resolve(null),
        billingDetails ? billingDetails.getDetails().catch(() => null) : Promise.resolve(null),
      ]);
      for (const [choice, key] of requestIds) {
        const unpaid = list.servers.some(
          (server) => server.serverId === key.serverId && server.state === "awaiting_payment",
        );
        if (key.serverId && !unpaid) requestIds.delete(choice);
      }
      props.onPendingResume(null);
      const read = { catalog, list, licenseState, details };
      props.onRead(read);
      setState((draft) => applyRead(draft, read));
      if (!lastRead) trackPlans("viewed");
      if (serverLimit() !== null) analytics.track("limit_reached", { kind: "servers", action: "shown" });
      return true;
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
      return false;
    }
  }

  const onRail = (serverId: string) => props.servers.find((entry) => entry.id === serverId);
  const [railWaitOver, setRailWaitOver] = createSignal(false);
  createEffect(
    () => state.server?.state === "running" && Boolean(onRail(state.server.serverId)),
    (running) => {
      if (!running) return;
      const timer = window.setTimeout(() => setRailWaitOver(true), RAIL_ANSWER_WAIT_MS);
      return () => window.clearTimeout(timer);
    },
  );

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
      case "stopping":
      case "stopped":
        return state.paid && (server.error === null || server.error === "plan_ended") ? "starting" : "error";
      case "running": {
        const entry = onRail(server.serverId);
        if (!entry) return "connecting";
        return entry.state === "online" || entry.state === "incompatible" || railWaitOver() ? "ready" : "connecting";
      }
      default:
        return "error";
    }
  };

  createEffect(
    () => state.server?.serverId ?? null,
    (serverId) => (serverId ? holdHostRestartNotice(serverId) : undefined),
  );

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
        setupStatus() === "connecting" && !onRail(serverId)
          ? props.onRefreshServers?.().catch(() => undefined)
          : undefined,
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
    return createPlan(input.plan, interval, HOSTED_BILLING_CURRENCY[input.currency], input.license ?? null, false);
  }

  async function createPlan(
    plan: BillingPlanId,
    interval: BillingInterval,
    currency: BillingCurrency,
    license: LicenseOrder | null,
    earlyStart: boolean,
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
        ...(earlyStart ? { earlyStart: true } : {}),
      })
      .catch(async (error: unknown) => {
        await refreshCount();
        trackPlans("create_failed", { plan, interval, currency, failure_code: "create_failed" });
        if (serverLimit() !== null) analytics.track("limit_reached", { kind: "servers", action: "shown" });
        throw error;
      });
    key.serverId = server.serverId;
    props.onRead(null);
    setState((draft) => {
      draft.server = server;
      draft.paid = false;
    });
    return { serverId: server.serverId, name: server.name };
  }

  async function saveDetails(): Promise<boolean> {
    const calls = props.billingDetails;
    if (!calls) return true;
    try {
      const saved = await saveBillingDetails(calls, state.details, state.detailsDraft);
      setState((draft) => {
        draft.details = saved;
      });
      return true;
    } catch (error) {
      setState((draft) => {
        const title = t("billing.details.saveFailed");
        draft.orderError = errorDetails(error, title);
        draft.orderErrorTitle = title;
        draft.orderedFromPage = false;
      });
      return false;
    }
  }

  async function submitOrder(order: PricingOrder, consent: OrderConsent): Promise<void> {
    if (state.ordering) return;
    setState((draft) => {
      draft.ordering = true;
      if (order.server) draft.orderedFromPage = true;
      draft.orderError = null;
    });
    try {
      const shownKey = state.plans && pageKey(state.plans);
      if (!(await loaded) || state.server !== null || (state.plans && pageKey(state.plans)) !== shownKey) {
        setState((draft) => {
          draft.orderedFromPage = false;
        });
        return;
      }
      if (!(await saveDetails())) return;
      if (order.server) {
        await createPlan(
          order.server,
          order.interval,
          order.currency,
          state.ownLicense ? null : order.license,
          consent.earlyStart,
        );
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
        draft.orderedFromPage = false;
      });
    } finally {
      setState((draft) => {
        draft.ordering = false;
      });
    }
  }

  const pageOpen = () => state.server === null && state.order === null;
  const pageShown = () => pageOpen() || state.orderedFromPage;
  const pageCurrency = (plans: HostedServerPlan[]) =>
    state.currency
      ? HOSTED_BILLING_CURRENCY[state.currency]
      : (state.pageOrder?.currency ?? HOSTED_BILLING_CURRENCY[guessHostedCurrency(hostedCurrencies(plans))]);
  const offerLicense = () => !state.ownLicense && props.license !== undefined;
  const pageKey = (plans: HostedServerPlan[]) =>
    `${pageCurrency(plans)}:${state.currency !== null}:${offerLicense()}:${state.licenseOffer?.used ?? ""}:${state.pageOrder !== null}`;
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
              <Show when={pageKey(plans())} keyed>
                <HostedPricingPage
                  overlay={props.pricingPage === undefined}
                  headerFrame={props.pricingPage ? headerFrame() : undefined}
                  plans={state.catalog}
                  currency={pageCurrency(plans())}
                  currencyLocked={state.currency !== null}
                  used={state.licenseOffer?.used}
                  licenseTrialEnd={state.licenseOffer?.trialEnd}
                  offerLicense={offerLicense()}
                  thisComputer={props.thisComputer === true}
                  serverLimit={serverLimit()}
                  busy={state.ordering}
                  error={state.orderError}
                  errorTitle={state.orderErrorTitle}
                  billingDetails={props.billingDetails ? state.detailsDraft : undefined}
                  initialOrder={state.pageOrder ?? undefined}
                  onBillingDetailsChange={(next) =>
                    setState((draft) => {
                      draft.detailsDraft = next;
                      draft.detailsEdited = true;
                    })
                  }
                  onSubmit={(order, consent) => void submitOrder(order, consent)}
                  onClose={close}
                  onOpenPrivacy={() => props.onOpenUrl(PRIVACY_URL)}
                  onOpenTerms={() => props.onOpenUrl(TERMS_URL)}
                  onContactUs={contactUs()}
                  onManageServers={manageServers()}
                  onCreateLocal={props.onCreateLocal}
                  onInstallServer={props.onInstallServer}
                  onJoinWithInvite={joinWithInvite()}
                />
              </Show>
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
