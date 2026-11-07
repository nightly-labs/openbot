import {
  type BillingCurrency,
  type BillingInterval,
  type BillingSubscriptionStatus,
  isOpenBillingStatus,
} from "@openbot/contracts/billing";
import {
  LICENSE_INCLUDED_USERS,
  LICENSE_MAX_USERS,
  LICENSE_TRIAL_DATE_FORMAT,
  LICENSE_YEAR_DISCOUNT_PERCENT,
  type License,
  type LicenseCheckoutRequest,
  type LicensePlan,
  type LicenseState,
  type LicenseTier,
  type LicenseUser,
  licenseIncludedUsers,
  licenseListMonthly,
  licenseOrderFor,
  licenseOrderMonthly,
  licensePeriodAmount,
  licensePlanOf,
  licensePlanPrice,
  type PricingOrder,
} from "@openbot/contracts/license";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Badge,
  BriefcaseBusiness,
  Button,
  buttonVariants,
  ConfirmDialog,
  CreditCard,
  DropdownMenu,
  Ellipsis,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  OctagonX,
  RotateCcw,
  SettingsSection,
  ShieldCheck,
  SliderField,
  SlidersHorizontal,
  Spinner,
  Text,
  TriangleAlert,
  UsersRound,
  Zap,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, Match, onSettled, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import { guessHostedCurrency, HOSTED_BILLING_CURRENCY, HostedBillingSwitch } from "../servers/HostedServerPricing";
import type { LicenseStore } from "./license-store";
import { formatMinorMoney } from "./money";

export interface LicenseSectionProps {
  store: LicenseStore;
  /** Opens the Stripe Customer Portal of the account, where the owner changes the payment method. */
  onManagePayment?: (() => void) | undefined;
  /** Opens the sales contact, for a team with more than `LICENSE_MAX_USERS` users. */
  onContactUs?: (() => void) | undefined;
  /** Opens the license dialog at once, as `/app?start=license` does. */
  startBuying?: boolean | undefined;
  /** The order from the pricing page. The license dialog fills it in and goes on to Checkout. */
  startOrder?: PricingOrder | undefined;
}

export { formatMinorMoney } from "./money";

/** The fewest users that the owner can set: the included users, or the people who use the license now. */
export function licenseMinimumUsers(state: LicenseState): number {
  return Math.min(LICENSE_MAX_USERS, Math.max(LICENSE_INCLUDED_USERS, state.used));
}

/** The statuses that show a badge. An active license shows none. */
const STATUS_BADGE: Partial<
  Record<BillingSubscriptionStatus, { text: AppTextKey; variant: "info-light" | "destructive-light" | "warning-light" }>
> = {
  trialing: { text: "billing.status.trialing", variant: "info-light" },
  past_due: { text: "billing.status.paymentFailed", variant: "destructive-light" },
  unpaid: { text: "billing.status.paymentFailed", variant: "destructive-light" },
  paused: { text: "billing.status.paused", variant: "warning-light" },
};

function paymentFailed(license: License): boolean {
  return license.status === "past_due" || license.status === "unpaid";
}

/** True for the Starter tier at either price: 1 user, and no users to change. */
function isOneUser(license: License): boolean {
  return licensePlanOf(license).tier !== "team";
}

const TIER_TITLE = {
  starter: "billing.license.tier.starter.title",
  team: "billing.license.tier.team.title",
} as const satisfies Record<LicenseTier, AppTextKey>;

/**
 * The License part of Billing: the commercial license of the account, above the server plans. It
 * shows nothing until the account server says that it sells licenses, so an older account server, or
 * one with no license price, shows the Billing panel as before.
 */
export function LicenseSection(props: LicenseSectionProps): JSX.Element {
  const { t } = useText();
  const [changing, setChanging] = createSignal(false);
  const [planning, setPlanning] = createSignal(false);
  const [listing, setListing] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);
  const state = () => props.store.state.license;
  const open = () => {
    const license = state()?.license;
    return license && isOpenBillingStatus(license.status) ? license : null;
  };

  return (
    <Show when={state()?.available ? state() : null}>
      {(current) => (
        <>
          <SettingsSection title={t("billing.license.title")} description={t("billing.license.description")}>
            <div class="billing-license">
              <Show when={props.store.state.actionError}>
                {(message) => (
                  <Alert tone="danger" role="alert">
                    <AlertIcon>
                      <TriangleAlert aria-hidden="true" />
                    </AlertIcon>
                    <AlertContent>
                      <AlertDescription>{message()}</AlertDescription>
                    </AlertContent>
                  </Alert>
                )}
              </Show>
              <Show when={open()}>
                {(license) => (
                  <LicenseAlerts
                    license={license()}
                    used={current().used}
                    store={props.store}
                    onChangeUsers={() => (isOneUser(license()) ? setPlanning(true) : setChanging(true))}
                    onManagePayment={props.onManagePayment}
                  />
                )}
              </Show>
              <Show
                when={open()}
                fallback={
                  <LicenseOffer
                    state={current()}
                    store={props.store}
                    startBuying={props.startBuying ?? false}
                    startOrder={props.startOrder}
                    onContactUs={props.onContactUs}
                  />
                }
              >
                {(license) => (
                  <ActiveLicenseRow
                    license={license()}
                    used={current().used}
                    pending={props.store.state.pending}
                    onShowUsers={() => setListing(true)}
                    onChangeUsers={() => setChanging(true)}
                    onChangePlan={() => setPlanning(true)}
                    onManagePayment={props.onManagePayment}
                    onCancel={() => setCancelling(true)}
                    onRenew={() => void props.store.setRenewal(false)}
                  />
                )}
              </Show>
            </div>
          </SettingsSection>
          <hr class="billing-license-divider" />
          <Show when={changing() ? open() : null}>
            {(license) => (
              <ChangeUsersDialog
                license={license()}
                minimum={licenseMinimumUsers(current())}
                used={current().used}
                store={props.store}
                onContactUs={props.onContactUs}
                onClose={() => setChanging(false)}
              />
            )}
          </Show>
          <Show when={planning() ? open() : null}>
            {(license) => (
              <ChangePlanDialog
                license={license()}
                minimum={licenseMinimumUsers(current())}
                store={props.store}
                onClose={() => setPlanning(false)}
              />
            )}
          </Show>
          <Show when={listing() ? open() : null}>
            {(license) => (
              <LicenseUsersDialog users={current().users} license={license()} onClose={() => setListing(false)} />
            )}
          </Show>
          <Show when={open()}>
            {(license) => (
              <ConfirmDialog
                open={cancelling()}
                onCancel={() => {
                  setCancelling(false);
                  props.store.track("cancel_kept");
                }}
                title={t("billing.license.cancel.title")}
                description={<CancelDescription license={license()} />}
                confirmLabel={t("billing.license.action.cancel")}
                cancelLabel={t("billing.license.cancel.keep")}
                pending={props.store.state.pending === "renewal"}
                onConfirm={async () => {
                  if (await props.store.setRenewal(true)) setCancelling(false);
                }}
              />
            )}
          </Show>
        </>
      )}
    </Show>
  );
}

function CancelDescription(props: { license: License }): JSX.Element {
  const { t, format } = useText();
  return (
    <Show when={props.license.currentPeriodEnd} fallback={t("billing.license.cancel.descriptionNow")}>
      {(end) => t("billing.license.cancel.description", { date: format.date(end(), { dateStyle: "long" }) })}
    </Show>
  );
}

/** The failed payment and the over-limit warnings of an open license. */
function LicenseAlerts(props: {
  license: License;
  used: number;
  store: LicenseStore;
  onChangeUsers: () => void;
  onManagePayment: (() => void) | undefined;
}): JSX.Element {
  const { t } = useText();
  createEffect(
    () => props.used > props.license.users,
    (overLimit) => {
      if (overLimit) props.store.track("over_limit_shown");
    },
  );
  return (
    <>
      <Show when={paymentFailed(props.license)}>
        <Alert tone="warning">
          <AlertIcon>
            <TriangleAlert aria-hidden="true" />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>{t("billing.license.paymentFailed")}</AlertDescription>
          </AlertContent>
          <Show when={props.onManagePayment}>
            {(manage) => (
              <AlertActions>
                <Button type="button" size="sm" onClick={() => manage()()}>
                  {t("billing.action.updatePayment")}
                </Button>
              </AlertActions>
            )}
          </Show>
        </Alert>
      </Show>
      <Show when={props.used > props.license.users}>
        <Alert tone="warning">
          <AlertIcon>
            <TriangleAlert aria-hidden="true" />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>
              {isOneUser(props.license)
                ? t("billing.license.overLimitOneUser", { used: props.used })
                : t("billing.license.overLimit", { used: props.used, users: props.license.users })}
            </AlertDescription>
          </AlertContent>
          <AlertActions>
            <Button
              type="button"
              size="sm"
              disabled={props.store.state.pending !== null}
              onClick={() => props.onChangeUsers()}
            >
              {isOneUser(props.license)
                ? t("billing.license.action.changeToTeam")
                : t("billing.license.action.changeUsers")}
            </Button>
          </AlertActions>
        </Alert>
      </Show>
    </>
  );
}

function LicenseIcon(props: { offer?: boolean }): JSX.Element {
  return (
    <ItemMedia>
      <span class="billing-license-icon">
        <Show when={props.offer} fallback={<ShieldCheck aria-hidden="true" />}>
          <BriefcaseBusiness aria-hidden="true" />
        </Show>
      </span>
    </ItemMedia>
  );
}

/** The open license of the account: tier, users, renewal date, price, and the actions menu. */
function ActiveLicenseRow(props: {
  license: License;
  used: number;
  pending: string | null;
  onShowUsers: () => void;
  onChangeUsers: () => void;
  onChangePlan: () => void;
  onManagePayment: (() => void) | undefined;
  onCancel: () => void;
  onRenew: () => void;
}): JSX.Element {
  const { t, format } = useText();
  const badge = () => STATUS_BADGE[props.license.status];
  const plan = () => licensePlanOf(props.license);
  const price = () => {
    if (plan().interval === "month") {
      return t("billing.server.price.month", {
        amount: formatMinorMoney(format, props.license.amount, props.license.currency),
      });
    }
    const amount = licensePeriodAmount(plan(), props.license.users, props.license.currency);
    return t("billing.server.price.year", { amount: formatMinorMoney(format, amount, props.license.currency) });
  };
  const periodEnd = () => {
    const end = props.license.currentPeriodEnd;
    if (end === null) return null;
    if (props.license.status === "trialing" && !props.license.cancelAtPeriodEnd)
      return t("billing.license.trial.until", { date: format.date(end, LICENSE_TRIAL_DATE_FORMAT) });
    const date = format.date(end, { dateStyle: "long" });
    return props.license.cancelAtPeriodEnd ? t("billing.server.ends", { date }) : t("billing.server.renews", { date });
  };
  return (
    <ItemGroup class="billing-license-row">
      <Item>
        <LicenseIcon />
        <ItemContent>
          <div class="billing-server-title">
            <ItemTitle>{t(TIER_TITLE[plan().tier])}</ItemTitle>
            <Show when={badge()}>{(item) => <Badge variant={item().variant}>{t(item().text)}</Badge>}</Show>
          </div>
          <ItemDescription>
            {t("billing.license.work.used", {
              used: format.number(props.used),
              users: format.number(props.license.users),
            })}
          </ItemDescription>
          <Show when={periodEnd()}>{(line) => <ItemDescription>{line()}</ItemDescription>}</Show>
        </ItemContent>
        <ItemActions>
          <Text as="span" variant="label" class="billing-server-price">
            {price()}
          </Text>
          <Show when={props.pending}>
            <Spinner size="sm" label={t("billing.license.saving")} />
          </Show>
          <DropdownMenu.Root placement="bottom-end" gutter={4}>
            <DropdownMenu.Trigger
              class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              aria-label={t("billing.license.action.menu")}
              disabled={props.pending !== null}
            >
              <Ellipsis aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="billing-license-menu">
                <DropdownMenu.Item onSelect={() => props.onShowUsers()}>
                  <UsersRound aria-hidden="true" />
                  {t("billing.license.action.users")}
                </DropdownMenu.Item>
                <Show when={plan().tier === "team"}>
                  <DropdownMenu.Item onSelect={() => props.onChangeUsers()}>
                    <SlidersHorizontal aria-hidden="true" />
                    {t("billing.license.action.changeUsers")}
                  </DropdownMenu.Item>
                </Show>
                <Show when={plan().tier !== "team" || plan().interval === "month"}>
                  <DropdownMenu.Item onSelect={() => props.onChangePlan()}>
                    <Zap aria-hidden="true" />
                    {plan().tier === "team"
                      ? t("billing.license.action.changeToYear")
                      : t("billing.license.action.changeToTeam")}
                  </DropdownMenu.Item>
                </Show>
                <Show when={props.onManagePayment}>
                  {(manage) => (
                    <DropdownMenu.Item onSelect={() => manage()()}>
                      <CreditCard aria-hidden="true" />
                      {t("billing.action.updatePayment")}
                    </DropdownMenu.Item>
                  )}
                </Show>
                <Show
                  when={!props.license.cancelAtPeriodEnd}
                  fallback={
                    <DropdownMenu.Item onSelect={() => props.onRenew()}>
                      <RotateCcw aria-hidden="true" />
                      {t("billing.license.action.renew")}
                    </DropdownMenu.Item>
                  }
                >
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => props.onCancel()}>
                    <OctagonX aria-hidden="true" />
                    {t("billing.license.action.cancel")}
                  </DropdownMenu.Item>
                </Show>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}

/**
 * The rows of an account with no open license. The first row is what the account has now: personal
 * use, an ended license, or the license of a server owner that covers this account. The second row
 * sells the work license, so that "Buy a license" does not look like it buys the first row.
 */
function LicenseOffer(props: {
  state: LicenseState;
  store: LicenseStore;
  startBuying: boolean;
  startOrder: PricingOrder | undefined;
  onContactUs: (() => void) | undefined;
}): JSX.Element {
  const { t, format } = useText();
  const [buying, setBuying] = createSignal(untrack(() => props.startBuying));
  const endedLicense = () => {
    const license = props.state.license;
    return license?.currentPeriodEnd ? { license, end: license.currentPeriodEnd } : null;
  };
  const owners = () => props.state.coveredBy.map((coverage) => coverage.ownerName ?? coverage.ownerEmail);
  if (untrack(() => props.startBuying)) props.store.track("buy_opened");
  return (
    <ItemGroup class="billing-license-row">
      <Item>
        <LicenseIcon />
        <Switch>
          <Match when={owners().length > 0}>
            <ItemContent>
              <div class="billing-server-title">
                <ItemTitle>{t("billing.license.covered.title")}</ItemTitle>
                <Badge variant="outline">{t("billing.license.current")}</Badge>
              </div>
              <ItemDescription>
                {t("billing.license.covered.description", { owners: format.list(owners()) })}
              </ItemDescription>
            </ItemContent>
          </Match>
          <Match when={endedLicense()}>
            {(ended) => (
              <ItemContent>
                <div class="billing-server-title">
                  <ItemTitle>{t(TIER_TITLE[licensePlanOf(ended().license).tier])}</ItemTitle>
                  <Badge variant="secondary">{t("billing.license.status.ended")}</Badge>
                </div>
                <ItemDescription>
                  {t("billing.license.ended", { date: format.date(ended().end, { dateStyle: "long" }) })}
                </ItemDescription>
              </ItemContent>
            )}
          </Match>
          <Match when>
            <ItemContent>
              <div class="billing-server-title">
                <ItemTitle>{t("billing.license.personal.title")}</ItemTitle>
                <Badge variant="outline">{t("billing.license.current")}</Badge>
              </div>
              <ItemDescription>{t("billing.license.personal.description")}</ItemDescription>
            </ItemContent>
          </Match>
        </Switch>
      </Item>
      <Item>
        <LicenseIcon offer />
        <ItemContent>
          <div class="billing-server-title">
            <ItemTitle>{t("billing.license.offer.title")}</ItemTitle>
            <Show when={props.state.trialEnd}>
              {(end) => (
                <Badge variant="secondary">
                  {t("billing.license.trial.until", { date: format.date(end(), LICENSE_TRIAL_DATE_FORMAT) })}
                </Badge>
              )}
            </Show>
          </div>
          <ItemDescription>
            {t("billing.license.offer.description", { count: format.number(LICENSE_INCLUDED_USERS) })}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            size="sm"
            variant={owners().length > 0 ? "outline" : "default"}
            aria-haspopup="dialog"
            onClick={() => {
              setBuying(true);
              props.store.track("buy_opened");
            }}
          >
            {t("billing.license.buy")}
          </Button>
        </ItemActions>
      </Item>
      <Show when={buying()}>
        <BuyLicenseDialog
          state={props.state}
          store={props.store}
          order={props.startOrder}
          onContactUs={props.onContactUs}
          onClose={() => setBuying(false)}
        />
      </Show>
    </ItemGroup>
  );
}

/**
 * Buys a license without a server. The slider sets the people at work; after the maximum, the dialog
 * sends the team to the sales contact. A server with its license is sold in the add server dialog.
 */
function BuyLicenseDialog(props: {
  state: LicenseState;
  store: LicenseStore;
  /** The pricing page order. The dialog shows it and opens Checkout at once when it fits the account. */
  order: PricingOrder | undefined;
  onContactUs: (() => void) | undefined;
  onClose: () => void;
}): JSX.Element {
  const { t, format } = useText();
  const start = untrack(() => props.order);
  const minimum = untrack(() => Math.min(SLIDER_MAX, licenseOrderFor(Math.max(1, props.state.used)).users));
  const [people, setPeople] = createSignal(Math.max(minimum, start?.license?.users ?? minimum));
  const [interval, setInterval] = createSignal<BillingInterval>(start?.interval ?? "year");
  // A Stripe customer pays all its subscriptions in one currency.
  const currency = untrack(
    () => props.state.currency ?? start?.currency ?? HOSTED_BILLING_CURRENCY[guessHostedCurrency()],
  );
  const contact = () => people() > LICENSE_MAX_USERS;
  const order = () => licenseOrderFor(people());
  const plan = (): LicensePlan => ({ tier: order().tier, interval: interval(), bundle: props.state.bundle ?? false });
  const list = () => licenseListMonthly(order().tier, order().users, currency);
  const monthly = () => licenseOrderMonthly(plan(), order().users, currency);
  const money = (amount: number) => formatMinorMoney(format, amount, currency);
  const trialEnd = () => props.state.trialEnd;
  async function confirm(): Promise<void> {
    if (contact()) {
      props.onContactUs?.();
      return;
    }
    const request: LicenseCheckoutRequest = {
      users: order().users,
      currency,
      tier: order().tier,
      interval: interval(),
    };
    if (await props.store.openCheckout(request)) props.onClose();
  }
  // The order goes on to Checkout when it fits: the same currency, enough users, and no license of an owner.
  onSettled(() => {
    const license = start?.license;
    if (!license || start.currency !== currency || license.users < minimum) return;
    if (untrack(() => props.state.coveredBy.length) === 0) void confirm();
  });
  const confirmLabel = () => {
    if (contact()) return t("billing.license.contact.action");
    return trialEnd() ? t("billing.license.trial.confirm") : t("billing.license.buy.confirm");
  };
  return (
    <ConfirmDialog
      open
      tone="default"
      icon={<ShieldCheck />}
      title={t("billing.license.buy")}
      description={t("billing.license.buy.description")}
      confirmLabel={confirmLabel()}
      pendingLabel={t("billing.opening")}
      pending={props.store.state.pending === "checkout"}
      error={props.store.state.actionError ?? undefined}
      onCancel={() => {
        props.store.clearActionError();
        props.onClose();
      }}
      onConfirm={confirm}
    >
      <div class="billing-license-change">
        <HostedBillingSwitch
          billing={interval() === "year" ? "yearly" : "monthly"}
          discountPercent={LICENSE_YEAR_DISCOUNT_PERCENT}
          disabled={props.store.state.pending !== null}
          onChange={(billing) => setInterval(billing === "yearly" ? "year" : "month")}
        />
        <SliderField
          label={t("billing.license.users.label")}
          value={people()}
          minValue={minimum}
          maxValue={SLIDER_MAX}
          disabled={props.store.state.pending !== null}
          formatValue={(value) =>
            value > LICENSE_MAX_USERS
              ? t("billing.license.change.more", { count: LICENSE_MAX_USERS })
              : format.number(value)
          }
          onChange={setPeople}
        />
        <div class="billing-license-quote">
          <Show
            when={!contact()}
            fallback={
              <p class="billing-license-total">
                <span class="billing-license-total-amount">{t("billing.license.change.custom")}</span>
              </p>
            }
          >
            <dl class="billing-license-lines">
              <div>
                {/* The slider above shows the users, so the line names the license only. */}
                <dt>
                  <Show when={order().tier === "team"} fallback={t("billing.license.tier.starter.title")}>
                    {t("billing.license.tier.team.title")}
                  </Show>
                </dt>
                <dd>
                  <Show when={list() !== monthly()}>
                    <s>{money(list())}</s>
                  </Show>
                </dd>
              </div>
              <Show when={trialEnd()}>
                {(end) => (
                  <div>
                    <dt>{t("billing.license.trial.until", { date: format.date(end(), LICENSE_TRIAL_DATE_FORMAT) })}</dt>
                    <dd>{money(0)}</dd>
                  </div>
                )}
              </Show>
            </dl>
            <p class="billing-license-total">
              <span class="billing-license-total-amount">{money(monthly())}</span>
              <Text as="span" variant="caption" tone="muted">
                {interval() === "year" ? t("billing.order.unit.monthBilledYearly") : t("billing.order.unit.month")}
              </Text>
            </p>
          </Show>
        </div>
      </div>
    </ConfirmDialog>
  );
}

/** The price lines of a plan for a number of users, and the total of one period. */
function Quote(props: { plan: LicensePlan; users: number; currency: BillingCurrency }): JSX.Element {
  const { t, format } = useText();
  const included = () => licenseIncludedUsers(props.plan.tier);
  const extra = () => props.users - included();
  const price = () => licensePlanPrice(props.plan, props.currency);
  const money = (amount: number) => formatMinorMoney(format, amount, props.currency);
  return (
    <div class="billing-license-quote">
      <dl class="billing-license-lines">
        <div>
          <dt>{t("billing.license.line.base", { count: included() })}</dt>
          <dd>{money(price().base)}</dd>
        </div>
        <Show when={extra() > 0}>
          <div>
            <dt>
              {t("billing.license.line.extra", { extra: format.number(extra()), price: money(price().extraUser) })}
            </dt>
            <dd>{money(extra() * price().extraUser)}</dd>
          </div>
        </Show>
      </dl>
      <p class="billing-license-total">
        <span class="billing-license-total-amount">
          {money(licensePeriodAmount(props.plan, props.users, props.currency))}
        </span>
        <Text as="span" variant="caption" tone="muted">
          {props.plan.interval === "year"
            ? t("billing.license.total.year", { currency: props.currency.toUpperCase() })
            : t("billing.license.total.month", { currency: props.currency.toUpperCase() })}
        </Text>
      </p>
    </div>
  );
}

/** The value after the maximum means "more than `LICENSE_MAX_USERS` users". */
const SLIDER_MAX = LICENSE_MAX_USERS + 1;

/**
 * Changes the users of the open license. The minimum is the people who use it now. More users bill
 * the difference for the rest of the period now; fewer users take effect on the next invoice.
 */
function ChangeUsersDialog(props: {
  license: License;
  minimum: number;
  used: number;
  store: LicenseStore;
  onContactUs: (() => void) | undefined;
  onClose: () => void;
}): JSX.Element {
  const { t, format } = useText();
  const [users, setUsers] = createSignal(untrack(() => Math.max(props.license.users, props.minimum)));
  const contact = () => users() > LICENSE_MAX_USERS;
  const money = (amount: number) => formatMinorMoney(format, amount, props.license.currency);
  return (
    <ConfirmDialog
      open
      tone="default"
      icon={<UsersRound />}
      title={t("billing.license.change.title")}
      description={t("billing.license.change.description", {
        users: format.number(props.license.users),
        amount: money(props.license.amount),
      })}
      confirmLabel={contact() ? t("billing.license.contact.action") : t("common.save")}
      pendingLabel={t("billing.license.saving")}
      pending={props.store.state.pending === "users"}
      error={props.store.state.actionError ?? undefined}
      onCancel={() => {
        props.store.clearActionError();
        props.onClose();
      }}
      onConfirm={async () => {
        if (contact()) {
          props.onContactUs?.();
          return;
        }
        if (users() === props.license.users || (await props.store.setUsers(users()))) props.onClose();
      }}
    >
      <div class="billing-license-change">
        <SliderField
          label={t("billing.license.users.label")}
          value={users()}
          minValue={props.minimum}
          maxValue={SLIDER_MAX}
          disabled={props.store.state.pending !== null}
          formatValue={(value) =>
            value > LICENSE_MAX_USERS
              ? t("billing.license.change.more", { count: LICENSE_MAX_USERS })
              : format.number(value)
          }
          onChange={setUsers}
        />
        <Show when={props.used > LICENSE_INCLUDED_USERS}>
          <Text variant="caption" tone="muted">
            {t("billing.license.change.minimum", { used: format.number(props.used) })}
          </Text>
        </Show>
        <Show
          when={!contact()}
          fallback={
            <div class="billing-license-quote">
              <p class="billing-license-total">
                <span class="billing-license-total-amount">{t("billing.license.change.custom")}</span>
              </p>
              <Text variant="caption" tone="muted">
                {t("billing.license.change.customDescription", { count: LICENSE_MAX_USERS })}
              </Text>
            </div>
          }
        >
          <Quote plan={licensePlanOf(props.license)} users={users()} currency={props.license.currency} />
          <Show when={users() !== props.license.users}>
            <Text variant="caption" tone="muted">
              <Switch>
                <Match when={users() < props.license.users}>{t("billing.license.change.decrease")}</Match>
                <Match when={licensePlanOf(props.license).interval === "year"}>
                  {t("billing.license.change.increaseYear")}
                </Match>
                <Match when>{t("billing.license.change.increase")}</Match>
              </Switch>
            </Text>
          </Show>
        </Show>
      </div>
    </ConfirmDialog>
  );
}

/**
 * Moves a Starter license to Team, or a monthly Team license to yearly. A yearly Starter license stays
 * yearly. The account server bills the
 * difference now. It sells no other change: to go down, the owner cancels and buys again.
 */
function ChangePlanDialog(props: {
  license: License;
  minimum: number;
  store: LicenseStore;
  onClose: () => void;
}): JSX.Element {
  const { t, format } = useText();
  const toTeam = () => isOneUser(props.license);
  const [interval, setInterval] = createSignal<BillingInterval>(
    untrack(() => (toTeam() ? licensePlanOf(props.license).interval : "year")),
  );
  const [users, setUsers] = createSignal(untrack(() => Math.max(props.license.users, props.minimum)));
  const plan = (): LicensePlan => ({ tier: "team", interval: interval(), bundle: licensePlanOf(props.license).bundle });
  return (
    <ConfirmDialog
      open
      tone="default"
      icon={<Zap />}
      title={toTeam() ? t("billing.license.action.changeToTeam") : t("billing.license.action.changeToYear")}
      description={
        toTeam()
          ? t("billing.license.plan.teamDescription", { min: LICENSE_INCLUDED_USERS, max: LICENSE_MAX_USERS })
          : t("billing.license.plan.yearDescription", { percent: LICENSE_YEAR_DISCOUNT_PERCENT })
      }
      confirmLabel={t("billing.license.plan.confirm")}
      pendingLabel={t("billing.license.saving")}
      pending={props.store.state.pending === "plan"}
      error={props.store.state.actionError ?? undefined}
      onCancel={() => {
        props.store.clearActionError();
        props.onClose();
      }}
      onConfirm={async () => {
        if (await props.store.changePlan({ interval: interval(), users: users() })) props.onClose();
      }}
    >
      <div class="billing-license-change">
        <Show when={toTeam() && licensePlanOf(props.license).interval === "month"}>
          <HostedBillingSwitch
            billing={interval() === "year" ? "yearly" : "monthly"}
            discountPercent={LICENSE_YEAR_DISCOUNT_PERCENT}
            disabled={props.store.state.pending !== null}
            onChange={(billing) => setInterval(billing === "yearly" ? "year" : "month")}
          />
        </Show>
        <SliderField
          label={t("billing.license.users.label")}
          value={users()}
          minValue={props.minimum}
          maxValue={LICENSE_MAX_USERS}
          disabled={props.store.state.pending !== null}
          formatValue={(value) => format.number(value)}
          onChange={setUsers}
        />
        <Quote plan={plan()} users={users()} currency={props.license.currency} />
        <Text variant="caption" tone="muted">
          {t("billing.license.plan.charge")}
        </Text>
      </div>
    </ConfirmDialog>
  );
}

/** Who uses the license: the owner and each member of the owner's servers. */
function LicenseUsersDialog(props: { users: LicenseUser[]; license: License; onClose: () => void }): JSX.Element {
  const { t, format } = useText();
  return (
    <ConfirmDialog
      open
      tone="default"
      hideCancel
      icon={<UsersRound />}
      title={t("billing.license.users.title")}
      description={t("billing.license.users.description", {
        used: format.number(props.users.length),
        users: format.number(props.license.users),
      })}
      confirmLabel={t("common.close")}
      onCancel={() => props.onClose()}
      onConfirm={() => props.onClose()}
    >
      <ItemGroup class="billing-license-users" role="list">
        <For each={props.users}>
          {(user) => (
            <Item role="listitem" size="compact">
              <ItemContent>
                <div class="billing-server-title">
                  <ItemTitle>{user.name ?? user.email}</ItemTitle>
                  <Show when={user.owner}>
                    <Badge variant="secondary">{t("billing.license.users.owner")}</Badge>
                  </Show>
                </div>
                <Show when={user.name}>
                  <ItemDescription>{user.email}</ItemDescription>
                </Show>
                <Show when={user.servers.length > 0}>
                  <ItemDescription>{format.list(user.servers)}</ItemDescription>
                </Show>
              </ItemContent>
            </Item>
          )}
        </For>
      </ItemGroup>
    </ConfirmDialog>
  );
}
