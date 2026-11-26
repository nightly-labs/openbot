import {
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  siteLimitForPlan,
} from "@openbot/contracts/billing";
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
  Globe2,
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

export const HOSTED_CURRENCIES = ["EUR", "USD", "PLN", "BRL"] as const;
export type HostedCurrency = (typeof HOSTED_CURRENCIES)[number];
type HostedBaseCurrency = Exclude<HostedCurrency, "BRL">;
const HOSTED_BASE_CURRENCIES: readonly HostedBaseCurrency[] = ["EUR", "USD", "PLN"];

export const HOSTED_BILLING_CURRENCY = {
  EUR: "eur",
  USD: "usd",
  PLN: "pln",
  BRL: "brl",
} as const satisfies Record<HostedCurrency, BillingCurrency>;

const BRAZIL_TIME_ZONES = new Set([
  "America/Araguaina",
  "America/Bahia",
  "America/Belem",
  "America/Boa_Vista",
  "America/Campo_Grande",
  "America/Cuiaba",
  "America/Eirunepe",
  "America/Fortaleza",
  "America/Maceio",
  "America/Manaus",
  "America/Noronha",
  "America/Porto_Velho",
  "America/Recife",
  "America/Rio_Branco",
  "America/Santarem",
  "America/Sao_Paulo",
  "Brazil/Acre",
  "Brazil/DeNoronha",
  "Brazil/East",
  "Brazil/West",
]);

export function guessHostedCurrency(
  offered: readonly HostedCurrency[] = HOSTED_BASE_CURRENCIES,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): HostedCurrency {
  if (timeZone === "Europe/Warsaw") return "PLN";
  if (timeZone.startsWith("Europe/")) return "EUR";
  if (BRAZIL_TIME_ZONES.has(timeZone) && offered.includes("BRL")) return "BRL";
  return "USD";
}

export function hostedCurrencies(plans: readonly HostedServerPlan[]): HostedCurrency[] {
  const brl = plans.length > 0 && plans.every((plan) => plan.monthlyPrice.BRL !== undefined);
  return HOSTED_CURRENCIES.filter((currency) => currency !== "BRL" || brl);
}

function hostedPrice(plan: HostedServerPlan, interval: "month" | "year", currency: HostedCurrency): number {
  return (interval === "month" ? plan.monthlyPrice[currency] : plan.yearlyPrice[currency]) ?? 0;
}

type HostedPrices = Record<HostedBaseCurrency, number> & Partial<Record<HostedCurrency, number>>;

export interface HostedServerPlan {
  id: HostedServerPlanId;
  monthlyPrice: HostedPrices;
  yearlyPrice: HostedPrices;
  diskGb: number;
  memberLimit: number;
  siteLimit: number;
  relativeSpeed: number;
  soldOut: boolean;
}

export function hostedYearlyDiscountPercent(plans: readonly HostedServerPlan[], currency: HostedCurrency): number {
  const discounts = plans.map((plan) => {
    const twelveMonths = Math.round(hostedPrice(plan, "month", currency) * 100) * 12;
    const year = Math.round(hostedPrice(plan, "year", currency) * 100);
    return twelveMonths > 0 ? Math.floor(((twelveMonths - year) * 100) / twelveMonths) : 0;
  });
  return discounts.length === 0 ? 0 : Math.max(0, Math.min(...discounts));
}

export function hostedPlanMonthlyPrice(
  plan: HostedServerPlan,
  billing: HostedServerBilling,
  currency: HostedCurrency,
): number {
  return billing === "yearly" ? hostedPrice(plan, "year", currency) / 12 : hostedPrice(plan, "month", currency);
}

const BILLING_INTERVAL = { monthly: "month", yearly: "year" } as const satisfies Record<
  HostedServerBilling,
  BillingInterval
>;

export interface HostedOrderPrice {
  regular: number;
  monthly: number;
}

export function hostedOrderMonthlyPrice(
  plan: HostedServerPlan,
  billing: HostedServerBilling,
  currency: HostedCurrency,
  people: number,
): HostedOrderPrice {
  const regular = hostedPrice(plan, "month", currency);
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

const WORK_PEOPLE = Array.from({ length: LICENSE_MAX_USERS }, (_, index) => index + 1);

export function hostedWorkYearlyDiscountPercent(plans: readonly HostedServerPlan[], currency: HostedCurrency): number {
  const discounts = WORK_PEOPLE.flatMap((people) =>
    plans
      .filter((plan) => plan.memberLimit >= people)
      .map((plan) => {
        const month = Math.round(hostedOrderMonthlyPrice(plan, "monthly", currency, people).monthly * 100);
        const year = Math.round(hostedOrderMonthlyPrice(plan, "yearly", currency, people).monthly * 100);
        return month > 0 ? Math.floor(((month - year) * 100) / month) : 0;
      }),
  );
  return discounts.length === 0 ? 0 : Math.max(0, Math.min(...discounts));
}

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

export function hostedServerPlansFromCatalog(catalog: HostedServerCatalog): HostedServerPlan[] {
  const amounts = (
    prices: HostedServerCatalog["plans"][number]["prices"],
    interval: "month" | "year",
  ): HostedPrices => {
    const result: HostedPrices = {
      EUR: prices.eur[interval] / 100,
      USD: prices.usd[interval] / 100,
      PLN: prices.pln[interval] / 100,
    };
    if (prices.brl) result.BRL = prices.brl[interval] / 100;
    return result;
  };
  return catalog.plans.map((plan) => ({
    id: plan.id,
    monthlyPrice: amounts(plan.prices, "month"),
    yearlyPrice: amounts(plan.prices, "year"),
    diskGb: plan.diskGb,
    memberLimit: plan.memberLimit,
    siteLimit: siteLimitForPlan(plan.id),
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
  discountPercent: number;
  onChange: (billing: HostedServerBilling) => void;
  disabled?: boolean | undefined;
}

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

interface HostedCurrencySelectProps {
  options: HostedCurrency[];
  currency: HostedCurrency;
  onChange: (currency: HostedCurrency) => void;
  disabled?: boolean | undefined;
  locked?: boolean | undefined;
  mount?: HTMLElement | undefined;
}

export function HostedCurrencySelect(props: HostedCurrencySelectProps) {
  const { t } = useText();
  return (
    <Show when={!props.locked} fallback={<span class="hosted-currency hosted-currency-locked">{props.currency}</span>}>
      <Select<HostedCurrency>
        class="hosted-currency"
        options={props.options}
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
  recommended?: HostedServerPlanId | undefined;
  pendingPlan?: HostedServerPlanId | null | undefined;
  disabled?: boolean | undefined;
  people?: number | undefined;
  longestPrice?: { was: string; now: string } | undefined;
  licenseTrialEnd?: number | undefined;
}

export function formatHostedPrice(format: AppFormat, value: number, currency: HostedCurrency): string {
  const whole = Math.round(value * 100) % 100 === 0;
  return format.number(value, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

const NARROW_PRICE_CHARACTERS = /[\s.,'ł]/gu;

function priceTextWidth(text: string): number {
  return text.length - (text.match(NARROW_PRICE_CHARACTERS)?.length ?? 0) / 2;
}

export function hostedPriceLength(
  plans: readonly HostedServerPlan[],
  currency: HostedCurrency,
  format: AppFormat,
): number {
  return Math.ceil(
    Math.max(
      0,
      ...plans.map(
        (plan) =>
          priceTextWidth(formatHostedPrice(format, hostedPrice(plan, "month", currency), currency)) +
          priceTextWidth(formatHostedPrice(format, hostedPlanMonthlyPrice(plan, "yearly", currency), currency)),
      ),
    ),
  );
}

export function HostedServerPlans(props: HostedServerPlansProps) {
  const { t, format } = useText();
  const price = (value: number) => formatHostedPrice(format, value, props.currency);
  const people = () => props.people ?? 0;
  const [stacked, setStacked] = createSignal(false);
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
                <span class="hosted-plan-now">
                  <RollingPrice value={monthly()} format={price} />
                  <span class="hosted-plan-period">{t("settings.hostedServers.plan.perMonth")}</span>
                </span>
              </p>
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
                <li>
                  <Globe2 aria-hidden="true" />
                  {t("settings.hostedServers.plan.sites", { count: plan.siteLimit })}
                </li>
                <Show when={props.people !== undefined && !work()}>
                  <li>
                    <ShieldCheck aria-hidden="true" />
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

export function HostedLicensePeople(props: {
  value: number;
  min: number;
  max: number;
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
          disabled={props.disabled || props.value >= props.max}
          onClick={() => props.onChange(stepLicenseUsers(props.value, 1))}
        >
          <Plus aria-hidden="true" />
        </IconButton>
      </fieldset>
    </div>
  );
}
