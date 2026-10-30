import type { BillingCurrency, BillingInterval, BillingPlanId } from "@openbot/contracts/billing";
import type { HostedServerCatalog } from "@openbot/contracts/hosted-servers";
import {
  LICENSE_BUNDLE_DISCOUNT_PERCENT,
  LICENSE_INCLUDED_USERS,
  LICENSE_MAX_USERS,
  LICENSE_TRIAL_DATE_FORMAT,
  licenseListMonthly,
  licenseOrderFor,
  licenseOrderMonthly,
  stepLicenseUsers,
} from "@openbot/contracts/license";
import type { AppFormat, AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  Clock3,
  Gauge,
  HardDrive,
  IconButton,
  Minus,
  Plus,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Server,
  ShieldCheck,
  toast,
  UsersRound,
} from "@openbot/ui";
import { RollingPrice } from "@openbot/ui/rolling-price";
import { createSignal, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";

export type HostedServerPlanId = BillingPlanId;
export type HostedServerBilling = "monthly" | "yearly";

export const HOSTED_CURRENCIES = ["EUR", "USD", "PLN"] as const;
export type HostedCurrency = (typeof HOSTED_CURRENCIES)[number];

/** The Stripe currency of each shown currency. */
export const HOSTED_BILLING_CURRENCY = {
  EUR: "eur",
  USD: "usd",
  PLN: "pln",
} as const satisfies Record<HostedCurrency, BillingCurrency>;

/**
 * A first guess of the currency from the computer's time zone, for when the consumer does not know
 * the user's country. It reads only local settings and sends nothing.
 */
export function guessHostedCurrency(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): HostedCurrency {
  if (timeZone === "Europe/Warsaw") return "PLN";
  if (timeZone.startsWith("Europe/")) return "EUR";
  return "USD";
}

export interface HostedServerPlan {
  id: HostedServerPlanId;
  /**
   * The price for one month on monthly billing, in each currency. These are set prices, not
   * conversions, so each one is a round number.
   */
  monthlyPrice: Record<HostedCurrency, number>;
  /** The price for one year on yearly billing, in each currency. */
  yearlyPrice: Record<HostedCurrency, number>;
  diskGb: number;
  /** The most active members of the server, the owner included. */
  memberLimit: number;
  /** The speed compared with the smallest plan. 1 is the base speed. */
  relativeSpeed: number;
  /** No new server can take this plan. */
  soldOut: boolean;
}

/**
 * How much less yearly billing costs than twelve monthly payments, in whole percent, from the prices of
 * the catalog. It is the smallest discount of the plans, so the text is true for each plan. 0 means no discount.
 */
export function hostedYearlyDiscountPercent(plans: readonly HostedServerPlan[], currency: HostedCurrency): number {
  const discounts = plans.map((plan) => {
    // In cents, so that the division does not get a floating point error such as 19.999.
    const twelveMonths = Math.round(plan.monthlyPrice[currency] * 100) * 12;
    const year = Math.round(plan.yearlyPrice[currency] * 100);
    return twelveMonths > 0 ? Math.floor(((twelveMonths - year) * 100) / twelveMonths) : 0;
  });
  return discounts.length === 0 ? 0 : Math.max(0, Math.min(...discounts));
}

/** The price for one month. On yearly billing this is the yearly price divided by 12. */
export function hostedPlanMonthlyPrice(
  plan: HostedServerPlan,
  billing: HostedServerBilling,
  currency: HostedCurrency,
): number {
  return billing === "yearly" ? plan.yearlyPrice[currency] / 12 : plan.monthlyPrice[currency];
}

const BILLING_INTERVAL = { monthly: "month", yearly: "year" } as const satisfies Record<
  HostedServerBilling,
  BillingInterval
>;

/** A price for one month: `regular` has no discount, `monthly` has the yearly and bundle discounts. */
export interface HostedOrderPrice {
  regular: number;
  monthly: number;
}

/**
 * The price for one month of a server and, for the people at work, its license at the bundle price. 0
 * people is personal use: the server alone.
 */
export function hostedOrderMonthlyPrice(
  plan: HostedServerPlan,
  billing: HostedServerBilling,
  currency: HostedCurrency,
  people: number,
): HostedOrderPrice {
  const regular = plan.monthlyPrice[currency];
  const monthly = hostedPlanMonthlyPrice(plan, billing, currency);
  if (people === 0) return { regular, monthly };
  const license = licenseOrderFor(people);
  const stripe = HOSTED_BILLING_CURRENCY[currency];
  const bundle = { tier: license.tier, interval: BILLING_INTERVAL[billing], bundle: true };
  return {
    regular: regular + licenseListMonthly(license.tier, license.users, stripe) / 100,
    monthly: monthly + licenseOrderMonthly(bundle, license.users, stripe) / 100,
  };
}

/** The counts of people at work that the dialog sells a license for. */
const WORK_PEOPLE = Array.from({ length: LICENSE_MAX_USERS }, (_, index) => index + 1);

/**
 * The smallest yearly discount of a server with its license, in whole percent, for each count of people
 * and each plan that fits them. The license has a smaller discount than the server, so the text is true
 * for each order, and it does not change with the count.
 */
export function hostedWorkYearlyDiscountPercent(plans: readonly HostedServerPlan[], currency: HostedCurrency): number {
  const discounts = WORK_PEOPLE.flatMap((people) =>
    plans
      .filter((plan) => plan.memberLimit >= people)
      .map((plan) => {
        // In cents, so that the division does not get a floating point error.
        const month = Math.round(hostedOrderMonthlyPrice(plan, "monthly", currency, people).monthly * 100);
        const year = Math.round(hostedOrderMonthlyPrice(plan, "yearly", currency, people).monthly * 100);
        return month > 0 ? Math.floor(((month - year) * 100) / month) : 0;
      }),
  );
  return discounts.length === 0 ? 0 : Math.max(0, Math.min(...discounts));
}

/**
 * The longest old and new price texts of all orders that the plans can show: each billing, personal use,
 * and each count of people at work on each plan that fits them.
 */
export function hostedLongestOrderPrice(
  plans: readonly HostedServerPlan[],
  currency: HostedCurrency,
  format: AppFormat,
): { was: string; now: string } {
  const longest = { was: "", now: "" };
  for (const billing of BILLING_OPTIONS)
    for (const people of [0, ...WORK_PEOPLE])
      for (const plan of plans) {
        if (plan.memberLimit < people) continue;
        const price = hostedOrderMonthlyPrice(plan, billing, currency, people);
        const was = formatHostedPrice(format, price.regular, currency);
        const now = formatHostedPrice(format, price.monthly, currency);
        if (was.length > longest.was.length) longest.was = was;
        if (now.length > longest.now.length) longest.now = now;
      }
  return longest;
}

/** The plans of the Stripe catalog. The catalog has amounts in cents; the plans show whole units. */
export function hostedServerPlansFromCatalog(catalog: HostedServerCatalog): HostedServerPlan[] {
  const amounts = (
    prices: HostedServerCatalog["plans"][number]["prices"],
    interval: "month" | "year",
  ): Record<HostedCurrency, number> => ({
    EUR: prices.eur[interval] / 100,
    USD: prices.usd[interval] / 100,
    PLN: prices.pln[interval] / 100,
  });
  return catalog.plans.map((plan) => ({
    id: plan.id,
    monthlyPrice: amounts(plan.prices, "month"),
    yearlyPrice: amounts(plan.prices, "year"),
    diskGb: plan.diskGb,
    memberLimit: plan.memberLimit,
    relativeSpeed: plan.relativeSpeed,
    soldOut: plan.soldOut === true,
  }));
}

const PLAN_TEXT = {
  starter: { name: "settings.hostedServers.plan.starter.name", summary: "settings.hostedServers.plan.starter.summary" },
  standard: {
    name: "settings.hostedServers.plan.standard.name",
    summary: "settings.hostedServers.plan.standard.summary",
  },
  pro: { name: "settings.hostedServers.plan.pro.name", summary: "settings.hostedServers.plan.pro.summary" },
} as const satisfies Record<HostedServerPlanId, { name: AppTextKey; summary: AppTextKey }>;

const BILLING_OPTIONS: readonly HostedServerBilling[] = ["monthly", "yearly"];

interface HostedBillingSwitchProps {
  billing: HostedServerBilling;
  /** The yearly discount in whole percent. The switch does not show a discount of 0. */
  discountPercent: number;
  onChange: (billing: HostedServerBilling) => void;
  disabled?: boolean | undefined;
}

/** Monthly or yearly billing. The yearly option shows the discount. */
export function HostedBillingSwitch(props: HostedBillingSwitchProps) {
  const { t } = useText();
  return (
    <RadioGroup.Root
      class="hosted-billing"
      data-billing={props.billing}
      aria-label={t("server.add.billing.label")}
      value={props.billing}
      disabled={props.disabled ?? false}
      onChange={(value) => {
        const billing = BILLING_OPTIONS.find((option) => option === value);
        if (billing) props.onChange(billing);
      }}
    >
      <RadioGroup.Item class="hosted-billing-option" value="monthly">
        <RadioGroup.ItemInput />
        <RadioGroup.ItemControl class="hosted-billing-control">
          <RadioGroup.ItemLabel>{t("server.add.billing.monthly")}</RadioGroup.ItemLabel>
        </RadioGroup.ItemControl>
      </RadioGroup.Item>
      <RadioGroup.Item class="hosted-billing-option" value="yearly">
        <RadioGroup.ItemInput />
        <RadioGroup.ItemControl class="hosted-billing-control">
          <RadioGroup.ItemLabel>{t("server.add.billing.yearly")}</RadioGroup.ItemLabel>
          <Show when={props.discountPercent > 0}>
            <span class="hosted-billing-save">{t("server.add.billing.save", { percent: props.discountPercent })}</span>
          </Show>
        </RadioGroup.ItemControl>
      </RadioGroup.Item>
    </RadioGroup.Root>
  );
}

/** Kobalte takes a mutable array. */
const CURRENCY_OPTIONS: HostedCurrency[] = [...HOSTED_CURRENCIES];

interface HostedCurrencySelectProps {
  currency: HostedCurrency;
  onChange: (currency: HostedCurrency) => void;
  disabled?: boolean | undefined;
  /** The account pays its plans in this currency, so it shows as text, not as a choice. */
  locked?: boolean | undefined;
  /** The dialog element the popover portals into, so that it stays inside the dialog's focus trap. */
  mount?: HTMLElement | undefined;
}

/** The currency of the prices. The ISO code is the same in each language. */
export function HostedCurrencySelect(props: HostedCurrencySelectProps) {
  const { t } = useText();
  return (
    <Show when={!props.locked} fallback={<span class="hosted-currency hosted-currency-locked">{props.currency}</span>}>
      <Select<HostedCurrency>
        class="hosted-currency"
        options={CURRENCY_OPTIONS}
        value={props.currency}
        disabled={props.disabled ?? false}
        onChange={(currency) => currency && props.onChange(currency)}
        placement="bottom-start"
        sameWidth={false}
        itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>}
      >
        <SelectTrigger size="sm" aria-label={t("server.add.currency.label")}>
          <SelectValue<HostedCurrency>>{(state) => state.selectedOption()}</SelectValue>
        </SelectTrigger>
        <SelectContent mount={props.mount} />
      </Select>
    </Show>
  );
}

interface HostedServerPlansProps {
  plans: readonly HostedServerPlan[];
  billing: HostedServerBilling;
  currency: HostedCurrency;
  onChoose: (plan: HostedServerPlanId) => void;
  /** The plan that shows the "Best value" badge and the primary button. */
  recommended?: HostedServerPlanId | undefined;
  /** The plan whose button shows the loading state. All buttons are disabled while it is set. */
  pendingPlan?: HostedServerPlanId | null | undefined;
  /** Disables all buttons, such as when the account has the maximum number of servers. */
  disabled?: boolean | undefined;
  /**
   * The people at work, when the plans also sell a license. 0 is personal use: the server alone. Each
   * plan that fits the people shows the server and its license together; the other plans are disabled.
   */
  people?: number | undefined;
  /**
   * The longest old and new price that the plans can show, from `hostedLongestOrderPrice`. When it does
   * not fit on one line, each plan puts the old price on its own line, so the plans keep their shape
   * when the people or the billing change.
   */
  longestPrice?: { was: string; now: string } | undefined;
  /** The license that the plans sell is free until this time, in milliseconds since the epoch. */
  licenseTrialEnd?: number | undefined;
}

/** A plan price: "zł 90" in place of "PLN 90", so that the old and the new price fit in a column. */
export function formatHostedPrice(format: AppFormat, value: number, currency: HostedCurrency): string {
  // "€103.50", not "€103.5": a price with cents shows two digits.
  const whole = Math.round(value * 100) % 100 === 0;
  return format.number(value, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The most characters that the old and the new yearly price of one plan have together, for example
 * 12 for "zł 440" and "zł 352". The dialog uses it to make the columns wide enough, so that the
 * price line does not break. It uses the yearly prices on both billings, so the width does not
 * change when the billing changes.
 */
export function hostedPriceLength(
  plans: readonly HostedServerPlan[],
  currency: HostedCurrency,
  format: AppFormat,
): number {
  return Math.max(
    0,
    ...plans.map(
      (plan) =>
        formatHostedPrice(format, plan.monthlyPrice[currency], currency).length +
        formatHostedPrice(format, hostedPlanMonthlyPrice(plan, "yearly", currency), currency).length,
    ),
  );
}

/** One column for each plan, in one panel. Each column has its own button, so one click creates the server. */
export function HostedServerPlans(props: HostedServerPlansProps) {
  const { t, format } = useText();
  const price = (value: number) => formatHostedPrice(format, value, props.currency);
  const people = () => props.people ?? 0;
  const [stacked, setStacked] = createSignal(false);
  /** The license of the order, as the summary of a plan says it. */
  const licenseLine = () => {
    const license = licenseOrderFor(people());
    return license.tier === "team"
      ? t("billing.order.summary.license", { count: license.users })
      : t("billing.order.summary.starterLicense");
  };
  const licenseIncluded = () => {
    const end = props.licenseTrialEnd;
    if (end === undefined) return t("server.add.license.included", { license: licenseLine() });
    return t("server.add.license.includedTrial", {
      license: licenseLine(),
      date: format.date(end, LICENSE_TRIAL_DATE_FORMAT),
    });
  };

  return (
    <ul
      class="hosted-plans"
      aria-label={t("settings.hostedServers.plan.label")}
      data-license={props.people === undefined ? undefined : ""}
      data-stacked={stacked() ? "" : undefined}
    >
      <For each={props.plans}>
        {(plan, index) => {
          const recommended = () => plan.id === props.recommended;
          const fits = () => plan.memberLimit >= people();
          const work = () => people() > 0 && fits();
          const order = () => hostedOrderMonthlyPrice(plan, props.billing, props.currency, fits() ? people() : 0);
          const regular = () => order().regular;
          const monthly = () => order().monthly;
          const discounted = () => monthly() < regular();
          return (
            <li
              class="hosted-plan"
              data-recommended={recommended() ? "" : undefined}
              data-dimmed={
                plan.soldOut || (props.pendingPlan != null && props.pendingPlan !== plan.id) || !fits() ? "" : undefined
              }
              style={{ "--plan-index": index() }}
            >
              <div class="hosted-plan-head">
                <h3 class="hosted-plan-name">{t(PLAN_TEXT[plan.id].name)}</h3>
                <Show
                  when={!plan.soldOut}
                  fallback={<Badge variant="outline">{t("settings.hostedServers.plan.soldOut")}</Badge>}
                >
                  <Show
                    when={work()}
                    fallback={
                      <Show when={recommended()}>
                        <Badge class="hosted-plan-badge" variant="outline">
                          {t("settings.hostedServers.plan.recommended")}
                        </Badge>
                      </Show>
                    }
                  >
                    <span class="hosted-plan-bundle">
                      {t("server.add.license.bundle", { percent: LICENSE_BUNDLE_DISCOUNT_PERCENT })}
                    </span>
                  </Show>
                </Show>
              </div>
              <p class="hosted-plan-price">
                <Show when={index() === 0 ? props.longestPrice : undefined}>
                  {(longest) => <LongestPrice was={longest().was} now={longest().now} onStackedChange={setStacked} />}
                </Show>
                {/* Always in the layout, so that it can grow in when a discount shows. */}
                <span
                  class="hosted-plan-was"
                  data-shown={discounted() ? "" : undefined}
                  aria-hidden={discounted() ? undefined : "true"}
                >
                  <span class="hosted-plan-was-inner">
                    <span class="sr-only">{t("server.add.regularPrice", { price: price(regular()) })}</span>
                    <s aria-hidden="true">{price(regular())}</s>
                  </span>
                </span>
                {/* The new price and "/ month" stay on one line. */}
                <span class="hosted-plan-now">
                  <RollingPrice value={monthly()} format={price} />
                  <span class="hosted-plan-period">{t("settings.hostedServers.plan.perMonth")}</span>
                </span>
              </p>
              {/* A new line for each billing period, so that it fades in again. */}
              <Show when={props.billing} keyed>
                {(billing) => (
                  <p class="hosted-plan-billed">
                    <Show when={billing === "yearly"} fallback={t("server.add.billedMonthly")}>
                      <span class="hosted-plan-billed-total">
                        {t("server.add.billedYearly", { price: price(monthly() * 12) })}
                      </span>
                      <span class="hosted-plan-saving">
                        {t("server.add.yearlySaving", { amount: price((regular() - monthly()) * 12) })}
                      </span>
                    </Show>
                  </p>
                )}
              </Show>
              {/* For work, the summary says that the price includes the license. */}
              <p class="hosted-plan-summary" data-license={work() ? "" : undefined}>
                <Show when={work()} fallback={t(PLAN_TEXT[plan.id].summary)}>
                  <ShieldCheck aria-hidden="true" />
                  {licenseIncluded()}
                </Show>
              </p>
              <Button
                class="hosted-plan-choose"
                variant={recommended() ? "default" : "secondary"}
                fullWidth
                loading={props.pendingPlan === plan.id}
                loadingLabel={t("settings.hostedServers.creating")}
                disabled={props.disabled || plan.soldOut || props.pendingPlan != null || !fits()}
                onClick={() => props.onChoose(plan.id)}
              >
                {t("server.add.choosePlan", { plan: t(PLAN_TEXT[plan.id].name) })}
              </Button>
              <ul class="hosted-plan-facts">
                <li>
                  <Server aria-hidden="true" />
                  {t("settings.hostedServers.plan.linux")}
                </li>
                <li>
                  <Clock3 aria-hidden="true" />
                  {t("settings.hostedServers.plan.startsOnUse")}
                </li>
                <li>
                  <UsersRound aria-hidden="true" />
                  {t("settings.hostedServers.plan.members", { count: plan.memberLimit })}
                </li>
                <li>
                  <HardDrive aria-hidden="true" />
                  {t("settings.hostedServers.plan.disk", { count: plan.diskGb })}
                </li>
                {/* For work, the summary already names the license of the order. An account with a license buys no license. */}
                <Show when={props.people !== undefined && !work()}>
                  <li>
                    <ShieldCheck aria-hidden="true" />
                    {/* A server too small for the Team license sells the Starter license, at the bundle price of the period. */}
                    <Show
                      when={plan.memberLimit < LICENSE_INCLUDED_USERS}
                      fallback={t("settings.hostedServers.plan.license.team")}
                    >
                      {t("settings.hostedServers.plan.license.starter", {
                        price: price(
                          licenseOrderMonthly(
                            { tier: "starter", interval: BILLING_INTERVAL[props.billing], bundle: true },
                            1,
                            HOSTED_BILLING_CURRENCY[props.currency],
                          ) / 100,
                        ),
                      })}
                    </Show>
                  </li>
                </Show>
                <li>
                  <Gauge aria-hidden="true" />
                  {plan.relativeSpeed === 1
                    ? t("settings.hostedServers.plan.speed.base")
                    : t("settings.hostedServers.plan.speed.faster", { factor: plan.relativeSpeed })}
                </li>
              </ul>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

/**
 * A hidden copy of the longest price, as wide as the price line of the first plan. When it does not fit on
 * one line, all plans put the old price on its own line.
 */
function LongestPrice(props: { was: string; now: string; onStackedChange: (stacked: boolean) => void }) {
  const { t } = useText();
  let line: HTMLSpanElement | undefined;
  let now: HTMLSpanElement | undefined;
  onSettled(() => {
    const resize = new ResizeObserver(() => props.onStackedChange((now?.offsetTop ?? 0) > 0));
    if (line) resize.observe(line);
    return () => resize.disconnect();
  });
  return (
    <span ref={line} class="hosted-plan-longest" aria-hidden="true">
      <span class="hosted-plan-was" data-shown="">
        <span class="hosted-plan-was-inner">
          <s>{props.was}</s>
        </span>
      </span>
      <span ref={now} class="hosted-plan-now">
        <span class="hosted-plan-amount">{props.now}</span>
        <span class="hosted-plan-period">{t("settings.hostedServers.plan.perMonth")}</span>
      </span>
    </span>
  );
}

/** Personal use buys the server alone. Work adds a license to the server. */
export function HostedUseSwitch(props: {
  work: boolean;
  onChange: (work: boolean) => void;
  disabled?: boolean | undefined;
}) {
  const { t } = useText();
  return (
    <RadioGroup.Root
      class="hosted-billing hosted-use"
      data-use={props.work ? "work" : "personal"}
      aria-label={t("server.add.use.label")}
      value={props.work ? "work" : "personal"}
      disabled={props.disabled ?? false}
      onChange={(value) => props.onChange(value === "work")}
    >
      <RadioGroup.Item class="hosted-billing-option" value="personal">
        <RadioGroup.ItemInput />
        <RadioGroup.ItemControl class="hosted-billing-control">
          <RadioGroup.ItemLabel>{t("server.add.use.personal")}</RadioGroup.ItemLabel>
        </RadioGroup.ItemControl>
      </RadioGroup.Item>
      <RadioGroup.Item class="hosted-billing-option" value="work">
        <RadioGroup.ItemInput />
        <RadioGroup.ItemControl class="hosted-billing-control">
          <RadioGroup.ItemLabel>{t("server.add.use.work")}</RadioGroup.ItemLabel>
        </RadioGroup.ItemControl>
      </RadioGroup.Item>
    </RadioGroup.Root>
  );
}

const LICENSE_MINIMUM_TOAST = "hosted-license-minimum";

/**
 * The people at work, under the plans. It stays in place for personal use, disabled, so that the dialog
 * does not change size.
 */
export function HostedLicensePeople(props: {
  value: number;
  /** The fewest people to choose. */
  min: number;
  /** The people who use the account's servers now. They set the minimum; "Fewer" there tells why. */
  used: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const { t } = useText();
  function fewer(): void {
    if (props.value > props.min) props.onChange(stepLicenseUsers(props.value, -1));
    else toast(t("server.add.license.minimum", { count: props.used }), { id: LICENSE_MINIMUM_TOAST });
  }
  return (
    <div class="hosted-license-people" data-disabled={props.disabled ? "" : undefined}>
      <span>{t("server.add.license.people")}</span>
      <fieldset class="hosted-license-stepper">
        <legend class="sr-only">{t("billing.order.license.members")}</legend>
        <IconButton
          label={t("billing.order.license.fewer")}
          variant="outline"
          size="icon-sm"
          disabled={props.disabled || props.value <= 1}
          onClick={fewer}
        >
          <Minus aria-hidden="true" />
        </IconButton>
        <span aria-live="polite">{t("billing.order.memberCount", { count: props.value })}</span>
        <IconButton
          label={t("billing.order.license.more")}
          variant="outline"
          size="icon-sm"
          disabled={props.disabled || props.value >= LICENSE_MAX_USERS}
          onClick={() => props.onChange(stepLicenseUsers(props.value, 1))}
        >
          <Plus aria-hidden="true" />
        </IconButton>
      </fieldset>
    </div>
  );
}
