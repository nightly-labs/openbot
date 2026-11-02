import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
} from "@openbot/contracts/billing";
import type { HostedServerCatalogPlan } from "@openbot/contracts/hosted-servers";
import {
  LICENSE_BUNDLE_DISCOUNT_PERCENT,
  LICENSE_INCLUDED_USERS,
  LICENSE_MAX_USERS,
  LICENSE_TRIAL_DATE_FORMAT,
  LICENSE_YEAR_DISCOUNT_PERCENT,
  type LicensePlan,
  type LicenseTier,
  licenseListMonthly,
  licenseMonthlyPrice,
  licenseOrderMonthly,
  type PricingOrder,
} from "@openbot/contracts/license";
import type { AppTextKey } from "@openbot/i18n";
import { Button } from "@openbot/ui/button";
import { RadioGroup } from "@openbot/ui/complex";
import type { JSX } from "@solidjs/web";
import { type Accessor, createEffect, createMemo, createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { RollingPrice } from "../../rolling-price";
import { useText } from "../../text";
import { cx } from "../../utils";
import { formatMinorMoney } from "./money";
import "./order-form.css";

/** What the order form buys. A null server or license is not bought. */
export type OrderFormOrder = PricingOrder;

type LicenseChoice = LicenseTier | "none";
type ServerChoice = BillingPlanId | "none";

export interface OrderFormProps {
  /** The server plans with their prices. With none, the form sells only the license. */
  plans: readonly HostedServerCatalogPlan[];
  /** The first currency. */
  currency?: BillingCurrency | undefined;
  /** A Stripe customer pays in one currency, so an account with open subscriptions cannot change it. */
  currencyLocked?: boolean | undefined;
  /** The account pays for a server already, so a license gets the bundle price without a new server. */
  ownedServer?: boolean | undefined;
  /** The people who use the account's servers now. A license must be for at least this many users. */
  used?: number | undefined;
  /** A visitor in the EU sees "excl. VAT" beside the total. */
  inEu?: boolean | undefined;
  /** A license bought now is free until this time, in milliseconds since the epoch. */
  licenseTrialEnd?: number | undefined;
  initialServer?: BillingPlanId | null | undefined;
  initialLicense?: LicenseTier | null | undefined;
  /** Shows left of the switches, such as the heading of the page. */
  heading?: (() => JSX.Element) | undefined;
  /** The buttons beside the total. They read the order when the user acts. */
  action: (order: Accessor<OrderFormOrder>) => JSX.Element;
  /**
   * Replaces the action when the Team license passes `LICENSE_MAX_USERS` users. Without it, the members stepper
   * stops at the maximum.
   */
  contact?: (() => JSX.Element) | undefined;
  onOrderChange?: ((order: OrderFormOrder) => void) | undefined;
  class?: string | undefined;
}

const BEST_FOR = {
  starter: "billing.order.server.bestFor.starter",
  standard: "billing.order.server.bestFor.standard",
  pro: "billing.order.server.bestFor.pro",
} as const satisfies Record<BillingPlanId, AppTextKey>;

const PLAN_NAME = {
  starter: "settings.hostedServers.plan.starter.name",
  standard: "settings.hostedServers.plan.standard.name",
  pro: "settings.hostedServers.plan.pro.name",
} as const satisfies Record<BillingPlanId, AppTextKey>;

/** Keeps "50 GB storage" and "2× speed" on one line on a phone. */
function noBreak(text: string): string {
  return text.replaceAll(" ", " ");
}

/** The price for one month of a plan, in minor units. On yearly billing it is the yearly price divided by 12. */
export function planMonthlyPrice(
  plan: HostedServerCatalogPlan,
  interval: BillingInterval,
  currency: BillingCurrency,
): number {
  const prices = plan.prices[currency];
  return interval === "month" ? prices.month : Math.round(prices.year / 12);
}

/**
 * How much less yearly billing costs than twelve monthly payments, in whole percent. It is the smallest
 * discount of the plans, so the text is true for each plan.
 */
export function yearlyDiscountPercent(plans: readonly HostedServerCatalogPlan[], currency: BillingCurrency): number {
  const discounts = plans.map((plan) => {
    const twelveMonths = plan.prices[currency].month * 12;
    return twelveMonths > 0 ? Math.floor(((twelveMonths - plan.prices[currency].year) * 100) / twelveMonths) : 0;
  });
  return discounts.length === 0 ? 0 : Math.max(0, Math.min(...discounts));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function Price(props: { value: number; currency: BillingCurrency; unit?: string | undefined }) {
  const { format } = useText();
  return (
    <p class="order-form-price">
      <RollingPrice
        class="order-form-price-amount"
        value={props.value}
        format={(value) => formatMinorMoney(format, value, props.currency)}
      />
      <Show when={props.unit}>{(unit) => <span class="order-form-price-unit">{unit()}</span>}</Show>
    </p>
  );
}

/** A pill switch. The pill slides to the chosen option; every column has the same width. */
function Segment<T extends string>(props: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  disabled?: boolean | undefined;
  onChange: (value: T) => void;
}) {
  const index = () =>
    Math.max(
      0,
      props.options.findIndex((option) => option.id === props.value),
    );
  return (
    <RadioGroup.Root
      class="order-form-segment"
      style={{ "--order-count": props.options.length, "--order-index": index() }}
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled ?? false}
      onChange={(value) => {
        const option = props.options.find((entry) => entry.id === value);
        if (option) props.onChange(option.id);
      }}
    >
      <For each={props.options}>
        {(option) => (
          <RadioGroup.Item class="order-form-segment-option" value={option.id}>
            <RadioGroup.ItemInput />
            <RadioGroup.ItemLabel class="order-form-segment-label">{option.label}</RadioGroup.ItemLabel>
          </RadioGroup.Item>
        )}
      </For>
    </RadioGroup.Root>
  );
}

interface MemberStepperProps {
  value: number;
  label: string;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

/**
 * One row of a radio group. The members stepper goes under the label. The row takes the stepper as data, not as
 * JSX children: children here render on the server but are lost when the client hydrates.
 */
function ChoiceRow(props: {
  value: string;
  title: string;
  badge?: string | undefined;
  /** A green pill by the title, such as the bundle discount. */
  saving?: string | undefined;
  detail: string;
  disabled?: boolean | undefined;
  price: number;
  /** The price without the discounts. When it is higher, it shows struck through. */
  fullPrice?: number | undefined;
  currency: BillingCurrency;
  unit?: string | undefined;
  /** Shows in place of the price, for an order with a price that we agree with the buyer. */
  custom?: string | undefined;
  stepper?: MemberStepperProps | undefined;
}) {
  const { format } = useText();
  return (
    <RadioGroup.Item class="order-form-choice" value={props.value} disabled={props.disabled ?? false}>
      <RadioGroup.ItemInput />
      <RadioGroup.ItemLabel class="order-form-choice-label">
        <span class="order-form-choice-dot" aria-hidden="true" />
        <span class="order-form-row-name">
          <strong>{props.title}</strong>
          <Show when={props.badge}>{(badge) => <span class="order-form-badge">{badge()}</span>}</Show>
          <Show when={props.saving}>
            {(saving) => (
              <span class="order-form-yearly order-form-saving" data-active="">
                {saving()}
              </span>
            )}
          </Show>
          <span>{props.detail}</span>
        </span>
        <Show when={props.custom}>
          {(custom) => (
            <span class="order-form-choice-price">
              <span class="order-form-choice-amount">{custom()}</span>
            </span>
          )}
        </Show>
        <Show when={!props.custom}>
          <span class="order-form-choice-price">
            <span class="order-form-choice-amount">
              <Show when={props.fullPrice}>
                {(full) => (
                  <span class="order-form-was" data-shown={full() > props.price ? "" : undefined} aria-hidden="true">
                    <span>
                      <s>{formatMinorMoney(format, full(), props.currency)}</s>
                    </span>
                  </span>
                )}
              </Show>
              <RollingPrice
                class="order-form-digits"
                value={props.price}
                format={(value) => formatMinorMoney(format, value, props.currency)}
              />
            </span>
            <Show when={props.unit}>{(unit) => <span class="order-form-price-unit">{unit()}</span>}</Show>
          </span>
        </Show>
      </RadioGroup.ItemLabel>
      <Show when={props.stepper}>
        {(stepper) => (
          <MemberStepper
            value={stepper().value}
            label={stepper().label}
            min={stepper().min}
            max={stepper().max}
            disabled={stepper().disabled}
            onChange={stepper().onChange}
          />
        )}
      </Show>
    </RadioGroup.Item>
  );
}

/**
 * The steps are text, not icons: the pricing page renders this form on the server, and an element child of
 * `Button` does not hydrate there.
 */
function MemberStepper(props: MemberStepperProps) {
  const { t } = useText();
  return (
    <fieldset class="order-form-stepper">
      <legend class="sr-only">{t("billing.order.license.members")}</legend>
      <Button
        class="order-form-step"
        variant="outline"
        size="icon-sm"
        aria-label={t("billing.order.license.fewer")}
        disabled={props.disabled || props.value <= props.min}
        onClick={() => props.onChange(props.value - 1)}
      >
        −
      </Button>
      <span aria-live="polite">{props.label}</span>
      <Button
        class="order-form-step"
        variant="outline"
        size="icon-sm"
        aria-label={t("billing.order.license.more")}
        disabled={props.disabled || props.value >= props.max}
        onClick={() => props.onChange(props.value + 1)}
      >
        +
      </Button>
    </fieldset>
  );
}

/** A summary line that opens and closes. While it closes, it keeps the text that it had when it was open. */
function SummaryLine(props: {
  open: boolean;
  label: string;
  value: number;
  currency: BillingCurrency;
  minus?: boolean;
}) {
  const { format } = useText();
  let last = untrack(() => ({ label: props.label, value: props.value }));
  const shown = createMemo(() => {
    if (props.open) last = { label: props.label, value: props.value };
    return last;
  });
  return (
    <li
      class="order-form-summary-line"
      data-open={props.open ? "" : undefined}
      data-minus={props.minus ? "" : undefined}
      aria-hidden={props.open ? undefined : "true"}
    >
      <div>
        <div>
          <span>{shown().label}</span>
          <span>
            {props.minus ? "−" : ""}
            <RollingPrice
              class="order-form-digits"
              value={shown().value}
              format={(value) => formatMinorMoney(format, value, props.currency)}
            />
          </span>
        </div>
      </div>
    </li>
  );
}

/**
 * One order: a hosted server on the left, the license on the right, one summary under both, and the
 * consumer's buttons beside the total. The pricing page and Billing show it.
 */
export function OrderForm(props: OrderFormProps) {
  const { t, format } = useText();
  const id = createUniqueId();
  const serverTitleId = `order-form-servers-${id}`;
  const licenseTitleId = `order-form-license-${id}`;
  const [interval, setInterval] = createSignal<BillingInterval>("year");
  const [currency, setCurrency] = createSignal<BillingCurrency>(untrack(() => props.currency) ?? "eur");
  const plans = () => props.plans;
  const minTeam = () => clamp(props.used ?? 0, LICENSE_INCLUDED_USERS, LICENSE_MAX_USERS);
  const starterFits = () => (props.used ?? 0) <= 1;
  const [serverId, setServerId] = createSignal<ServerChoice>(untrack(() => props.initialServer) ?? "none");
  const [license, setLicense] = createSignal<LicenseChoice>(untrack(() => props.initialLicense) ?? "none");
  // Users and server members are the same people, so the Team license starts with every member of the server.
  const [members, setMembers] = createSignal(
    untrack(() => {
      const plan = props.plans.find((item) => item.id === props.initialServer);
      return clamp(Math.max(plan?.memberLimit ?? 0, props.used ?? 0), LICENSE_INCLUDED_USERS, LICENSE_MAX_USERS);
    }),
  );

  const server = (): HostedServerCatalogPlan | undefined => plans().find((plan) => plan.id === serverId());
  const isYearly = () => interval() === "year";
  const licensed = () => license() !== "none";
  const serverCost = () => {
    const plan = server();
    return plan ? planMonthlyPrice(plan, interval(), currency()) : 0;
  };
  /** The monthly price of the chosen server. In yearly billing the summary takes the discount off as its own line. */
  const serverFull = () => {
    const plan = server();
    return plan ? planMonthlyPrice(plan, "month", currency()) : 0;
  };
  /** The monthly list price of a license. In yearly billing the summary takes the discount off as its own line. */
  const licenseList = (choice: LicenseTier) =>
    licenseListMonthly(choice, choice === "team" ? members() : 1, currency());
  /** The Team license has more users than the app sells, so the buyer contacts us for the price. */
  const contact = () => props.contact !== undefined && license() === "team" && members() > LICENSE_MAX_USERS;
  const priced = () => licensed() && !contact();
  const licenseFull = () => {
    const choice = license();
    return choice === "none" || contact() ? 0 : licenseList(choice);
  };
  const licenseCost = () => licenseMonthlyPrice(licenseFull(), interval());
  /** A license costs less with any server: one in this order, or one that the account pays for. */
  const bundled = () => server() !== undefined || props.ownedServer === true;
  const licensePlan = (tier: LicenseTier): LicensePlan => ({ tier, interval: interval(), bundle: bundled() });
  /** The monthly price of a license after the yearly and bundle discounts: the amount that Stripe charges. */
  const licensePrice = (choice: LicenseTier) =>
    licenseOrderMonthly(licensePlan(choice), choice === "team" ? members() : 1, currency());
  const bundleSaving = () =>
    bundled() ? t("billing.order.license.bundleSaving", { percent: LICENSE_BUNDLE_DISCOUNT_PERCENT }) : undefined;
  const discount = () => {
    const choice = license();
    return choice === "none" || contact() ? 0 : licenseCost() - licensePrice(choice);
  };
  const total = () => serverCost() + licenseCost() - discount();
  const buying = () => server() !== undefined || licensed();
  const unit = () => (isYearly() ? t("billing.order.unit.monthBilledYearly") : t("billing.order.unit.month"));
  /** A license cannot pay for more members than the server holds, so the Team license does not fit a small server. */
  const teamMax = () => Math.min(LICENSE_MAX_USERS, server()?.memberLimit ?? LICENSE_MAX_USERS);
  const teamFits = () => teamMax() >= minTeam();
  /** With a contact action, one step after `LICENSE_MAX_USERS` means "more than the maximum". */
  const teamStepMax = () => (props.contact && teamMax() === LICENSE_MAX_USERS ? LICENSE_MAX_USERS + 1 : teamMax());
  const memberLabel = () =>
    members() > LICENSE_MAX_USERS
      ? t("billing.license.change.more", { count: LICENSE_MAX_USERS })
      : t("billing.order.memberCount", { count: members() });
  const teamCustom = () => (contact() ? t("billing.license.change.custom") : undefined);
  const teamSaving = () => (contact() ? undefined : bundleSaving());
  const yearlyPercent = () => yearlyDiscountPercent(plans(), currency());
  // A conditional in a component prop or in children compiles to a memo on the client but not on the server. That
  // moves the hydration keys of everything after it, so each such conditional is a named function here.
  const teamDetail = () => {
    if (contact()) return t("billing.license.change.customDescription", { count: LICENSE_MAX_USERS });
    return teamFits()
      ? t("billing.order.license.teamDetail", {
          included: LICENSE_INCLUDED_USERS,
          price: formatMinorMoney(
            format,
            licenseOrderMonthly(licensePlan("team"), LICENSE_INCLUDED_USERS + 1, currency()) -
              licenseOrderMonthly(licensePlan("team"), LICENSE_INCLUDED_USERS, currency()),
            currency(),
          ),
        })
      : t("billing.order.license.serverMembers", { count: teamMax() });
  };
  const starterDetail = () =>
    starterFits()
      ? t("billing.order.memberCount", { count: 1 })
      : t("billing.license.starter.inUse", { used: props.used ?? 0 });
  const licenseLine = () =>
    license() === "starter"
      ? t("billing.order.summary.starterLicense")
      : t("billing.order.summary.license", { count: members() });
  const serverName = (plan: HostedServerCatalogPlan) => t(PLAN_NAME[plan.id]);
  const serverDetail = (plan: HostedServerCatalogPlan) => {
    const detail = [t(BEST_FOR[plan.id]), noBreak(t("billing.order.server.storage", { size: plan.diskGb }))];
    if (plan.relativeSpeed > 1) detail.push(noBreak(t("billing.order.server.speed", { speed: plan.relativeSpeed })));
    return detail.join(" · ");
  };
  const serverLine = () => {
    const plan = server();
    return plan ? t("billing.order.summary.server", { plan: serverName(plan), count: plan.memberLimit }) : "";
  };
  /** The total is the price a visitor pays, so in the EU its unit says that VAT is not included. */
  const totalUnit = () => {
    if (!buying()) return t("billing.order.unit.free");
    if (!props.inEu) return unit();
    return isYearly() ? t("billing.order.unit.monthBilledYearlyExclVat") : t("billing.order.unit.monthExclVat");
  };
  /** A sold-out plan says so and cannot be chosen, as in Add server. */
  const planBadge = (plan: HostedServerCatalogPlan) => {
    if (plan.soldOut) return t("settings.hostedServers.plan.soldOut");
    return plan.id === "standard" ? t("billing.order.server.bestValue") : undefined;
  };
  const pickServer = (choice: ServerChoice) => {
    setServerId(choice);
    const plan = plans().find((item) => item.id === choice);
    if (!plan) return;
    if (!teamFits()) {
      if (license() === "team") setLicense(starterFits() ? "starter" : "none");
      return;
    }
    setMembers(clamp(Math.max(plan.memberLimit, minTeam()), LICENSE_INCLUDED_USERS, teamMax()));
  };
  const pickLicense = (choice: LicenseChoice) => setLicense(choice);
  const hasServers = () => plans().length > 0;
  const heading = () => props.heading?.();

  const order = createMemo<OrderFormOrder>(() => {
    const choice = license();
    return {
      interval: interval(),
      currency: currency(),
      server: server()?.id ?? null,
      license:
        choice === "none"
          ? null
          : { tier: choice, users: choice === "team" ? Math.min(members(), LICENSE_MAX_USERS) : 1 },
    };
  });
  // A block body: a signal setter as `onOrderChange` returns its value, and an effect must not return one.
  createEffect(order, (next) => {
    props.onOrderChange?.(next);
  });

  return (
    <div class={cx("order-form", props.class)} data-servers={hasServers() ? "" : undefined}>
      <div class="order-form-top">
        {heading()}
        <div class="order-form-controls">
          <Segment
            label={t("billing.order.billing")}
            options={BILLING_INTERVALS.map((option) => ({
              id: option,
              label: option === "month" ? t("billing.order.monthly") : t("billing.order.yearly"),
            }))}
            value={interval()}
            onChange={setInterval}
          />
          <Segment
            label={t("billing.order.currency")}
            options={BILLING_CURRENCIES.map((option) => ({ id: option, label: option.toUpperCase() }))}
            value={currency()}
            disabled={props.currencyLocked}
            onChange={setCurrency}
          />
        </div>
      </div>

      <div class="order-form-frame">
        <Show when={hasServers()}>
          <section class="order-form-half" aria-labelledby={serverTitleId}>
            <div class="order-form-half-title">
              <h2 id={serverTitleId}>{t("billing.order.server.title")}</h2>
              <span class="order-form-yearly" data-active={isYearly() ? "" : undefined}>
                {t("billing.order.yearlySaving", { percent: yearlyPercent() })}
              </span>
            </div>
            <p class="order-form-half-summary">{t("billing.order.server.summary")}</p>
            <RadioGroup.Root
              class="order-form-choices"
              aria-labelledby={serverTitleId}
              value={serverId()}
              onChange={(value) => {
                const choice = value === "none" ? "none" : plans().find((plan) => plan.id === value)?.id;
                if (choice) pickServer(choice);
              }}
            >
              <ChoiceRow
                value="none"
                title={t("billing.order.server.none")}
                detail={t("billing.order.server.noneDetail")}
                price={0}
                currency={currency()}
              />
              <For each={plans()}>
                {(plan) => (
                  <ChoiceRow
                    value={plan.id}
                    title={serverName(plan)}
                    badge={planBadge(plan)}
                    detail={serverDetail(plan)}
                    disabled={plan.soldOut === true}
                    price={planMonthlyPrice(plan, interval(), currency())}
                    fullPrice={planMonthlyPrice(plan, "month", currency())}
                    currency={currency()}
                    unit={unit()}
                  />
                )}
              </For>
            </RadioGroup.Root>
          </section>
        </Show>

        <section class="order-form-half" aria-labelledby={licenseTitleId}>
          <div class="order-form-half-title">
            <h2 id={licenseTitleId}>{t("billing.order.license.title")}</h2>
            <span class="order-form-yearly" data-active={isYearly() ? "" : undefined}>
              {t("billing.order.yearlySaving", { percent: LICENSE_YEAR_DISCOUNT_PERCENT })}
            </span>
            <Show when={props.licenseTrialEnd}>
              {(end) => (
                <span class="order-form-trial">
                  {t("billing.license.trial.until", { date: format.date(end(), LICENSE_TRIAL_DATE_FORMAT) })}
                </span>
              )}
            </Show>
          </div>
          <p class="order-form-half-summary">{t("billing.order.license.summary")}</p>
          <RadioGroup.Root
            class="order-form-choices"
            aria-labelledby={licenseTitleId}
            value={license()}
            onChange={(value) => {
              if (value === "none" || value === "starter" || value === "team") pickLicense(value);
            }}
          >
            <ChoiceRow
              value="none"
              title={t("billing.order.license.none")}
              detail={t("billing.order.license.noneDetail")}
              price={0}
              currency={currency()}
            />
            <ChoiceRow
              value="starter"
              title={t("billing.order.license.starter")}
              saving={bundleSaving()}
              detail={starterDetail()}
              disabled={!starterFits()}
              price={licensePrice("starter")}
              fullPrice={licenseList("starter")}
              currency={currency()}
              unit={unit()}
            />
            <ChoiceRow
              value="team"
              title={t("billing.order.license.team")}
              saving={teamSaving()}
              detail={teamDetail()}
              disabled={!teamFits()}
              price={licensePrice("team")}
              fullPrice={licenseList("team")}
              currency={currency()}
              unit={unit()}
              custom={teamCustom()}
              stepper={{
                value: members(),
                label: memberLabel(),
                min: minTeam(),
                max: teamStepMax(),
                disabled: !teamFits(),
                onChange: (value) => {
                  setMembers(value);
                  setLicense("team");
                },
              }}
            />
          </RadioGroup.Root>
        </section>

        <section class="order-form-summary">
          <h2 class="sr-only">{t("billing.order.summary.title")}</h2>
          {/* Each part sits under its own half: the server on the left, the license on the right. */}
          <ul class="order-form-summary-lines order-form-summary-server">
            <SummaryLine
              open={server() !== undefined}
              label={serverLine()}
              value={serverFull()}
              currency={currency()}
            />
            <SummaryLine
              open={server() !== undefined && isYearly()}
              label={t("billing.order.summary.yearlyDiscount", { percent: yearlyPercent() })}
              value={serverFull() - serverCost()}
              currency={currency()}
              minus
            />
          </ul>
          <ul class="order-form-summary-lines order-form-summary-license">
            <SummaryLine open={priced()} label={licenseLine()} value={licenseFull()} currency={currency()} />
            <SummaryLine
              open={priced() && isYearly()}
              label={t("billing.order.summary.yearlyDiscount", { percent: LICENSE_YEAR_DISCOUNT_PERCENT })}
              value={licenseFull() - licenseCost()}
              currency={currency()}
              minus
            />
            <SummaryLine
              open={discount() > 0}
              label={t("billing.order.summary.bundleDiscount")}
              value={discount()}
              currency={currency()}
              minus
            />
          </ul>
          <ul class="order-form-summary-lines order-form-summary-personal">
            <SummaryLine open={!buying()} label={t("billing.order.summary.personal")} value={0} currency={currency()} />
          </ul>
          <div class="order-form-total">
            <span class="order-form-total-label">{t("billing.order.summary.total")}</span>
            <Show when={contact()}>
              <p class="order-form-price">
                <span class="order-form-price-amount">{t("billing.license.change.custom")}</span>
              </p>
              <div class="order-form-action">{props.contact?.()}</div>
            </Show>
            <Show when={!contact()}>
              <Price value={total()} currency={currency()} unit={totalUnit()} />
              <div class="order-form-action">{props.action(order)}</div>
            </Show>
          </div>
        </section>
      </div>
    </div>
  );
}
