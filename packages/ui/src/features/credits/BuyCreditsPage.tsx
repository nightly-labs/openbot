import type { BillingCurrency } from "@openbot/contracts/billing";
import {
  CREDIT_PACK_INDEXES,
  CREDIT_POPULAR_INDEX,
  CREDIT_STOP_COUNT,
  CREDIT_TIER_START_INDEX,
  type CreditCheckoutRequest,
  type CreditModelCost,
  type CreditStop,
  type CreditsState,
  type CreditTier,
  creditEstimateModels,
  creditModelCharge,
  creditRegularPrice,
  creditStopAt,
  creditStopPrice,
  creditStops,
  creditTenths,
  creditTier,
} from "@openbot/contracts/credits";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  Check,
  Confetti,
  Gift,
  SliderField,
  Text,
  TriangleAlert,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, untrack } from "solid-js";
import { RollingPrice } from "../../rolling-price";
import { useText } from "../../text";
import type { BillingDetailsCalls } from "../billing/BillingDetailsFields";
import { formatMinorMoney } from "../billing/money";
import {
  guessHostedCurrency,
  HOSTED_BILLING_CURRENCY,
  HOSTED_CURRENCIES,
  type HostedCurrency,
  HostedCurrencySelect,
} from "../servers/HostedServerPricing";
import { PageHeader, type PageHeaderFrame } from "../window/PageHeader";
import { CreditIcon } from "./CreditIcon";
import { type CreditTarget, CreditTargetSelect, creditTargets } from "./CreditTargetSelect";
import { type CreditsStore, creditsServer } from "./credits-store";
import { MoveCreditsDialog } from "./MoveCreditsDialog";
import { type CreditConsent, PayCreditsDialog } from "./PayCreditsDialog";
import { RedeemCreditsDialog } from "./RedeemCreditsDialog";

const TIER_LABEL = {
  basic: "billing.credits.tier.basic",
  plus: "billing.credits.tier.plus",
  max: "billing.credits.tier.max",
} as const satisfies Record<CreditTier, AppTextKey>;

export interface BuyCreditsPageProps {
  store: CreditsStore;
  initialServerId?: string | null | undefined;
  headerFrame?: PageHeaderFrame | undefined;
  billingDetails?: BillingDetailsCalls | undefined;
  onClose: () => void;
}

function position(index: number): string {
  return `${(index / Math.max(1, CREDIT_STOP_COUNT - 1)) * 100}%`;
}

function creditsPerUnit(stop: CreditStop, currency: BillingCurrency): number {
  const rate = (stop.credits * 100) / creditStopPrice(stop, currency);
  if (rate >= 10) return Math.round(rate);
  return Math.round(rate * 10) / 10;
}

function hostedCurrency(currency: BillingCurrency): HostedCurrency {
  return HOSTED_CURRENCIES.find((option) => HOSTED_BILLING_CURRENCY[option] === currency) ?? "EUR";
}

function checkoutRequest(
  stop: CreditStop,
  currency: BillingCurrency,
  target: CreditTarget,
  consent: CreditConsent,
): CreditCheckoutRequest {
  const request: CreditCheckoutRequest = { credits: stop.credits, currency };
  if (target.serverId !== null) request.serverId = target.serverId;
  if (consent.earlyStart) request.earlyStart = true;
  return request;
}

interface Purchase {
  credits: CreditsState;
  target: CreditTarget;
  pending: boolean;
  onPay: (stop: CreditStop, button: HTMLElement | undefined) => void;
}

function useCreditFormat() {
  const { t, format } = useText();
  return {
    count: (value: number) => format.number(value, { maximumFractionDigits: 1 }),
    short: (value: number) => format.compact(value),
    money: (minor: number, currency: BillingCurrency) => formatMinorMoney(format, minor, currency),
    credits: (value: number) => t("billing.credits.amount", { count: value, amount: format.number(Math.round(value)) }),
  };
}

function PayButton(props: { purchase: Purchase; stop: CreditStop; class: string }) {
  const { t } = useText();
  const credit = useCreditFormat();
  let button: HTMLButtonElement | undefined;
  return (
    <Button
      class={`hosted-pricing-pill credit-pay ${props.class}`}
      ref={(element: HTMLButtonElement) => {
        button = element;
      }}
      disabled={props.purchase.pending}
      onClick={() => props.purchase.onPay(props.stop, button)}
    >
      <RollingPrice
        class="credit-roll"
        value={creditStopPrice(props.stop, props.purchase.credits.currency)}
        format={(minor) => t("billing.credits.pay", { amount: credit.money(minor, props.purchase.credits.currency) })}
      />
    </Button>
  );
}

function PriceTag(props: { stop: CreditStop; currency: BillingCurrency; class: string }) {
  const { t } = useText();
  const credit = useCreditFormat();
  return (
    <p class={`credit-price ${props.class}`}>
      <Show when={props.stop.discount > 0}>
        <s class="credit-price-was">
          <span class="sr-only">{t("billing.credits.regularPrice")}</span>
          <RollingPrice
            class="credit-roll"
            value={creditRegularPrice(props.stop, props.currency)}
            format={(minor) => credit.money(minor, props.currency)}
          />
        </s>
      </Show>
      <RollingPrice
        class="credit-price-now"
        value={creditStopPrice(props.stop, props.currency)}
        format={(minor) => credit.money(minor, props.currency)}
      />
    </p>
  );
}

function RateChip(props: { stop: CreditStop; currency: BillingCurrency }) {
  const { t, format } = useText();
  const credit = useCreditFormat();
  return (
    <span class="credit-chip">
      <RollingPrice
        class="credit-roll"
        value={creditsPerUnit(props.stop, props.currency)}
        format={(credits) =>
          t("billing.credits.rate", { price: credit.money(100, props.currency), credits: format.number(credits) })
        }
      />
      <CreditIcon />
    </span>
  );
}

function SaveChip(props: { stop: CreditStop }) {
  const { t, format } = useText();
  return (
    <Show when={props.stop.discount > 0}>
      <span class="credit-chip credit-chip-save">
        <RollingPrice
          class="credit-roll"
          value={props.stop.discount}
          format={(percent) => t("billing.credits.save", { percent: format.percent(percent / 100) })}
        />
      </span>
    </Show>
  );
}

const ESTIMATE_MODELS = creditEstimateModels();

function Facts(props: { credits: number }) {
  const { t } = useText();
  const credit = useCreditFormat();
  const estimate = (model: CreditModelCost) => {
    const count = Math.floor(creditTenths(props.credits) / creditTenths(creditModelCharge(model)));
    const params = { count, amount: credit.count(count), model: model.name };
    if (model.kind === "image") return t("billing.credits.images", params);
    return t("billing.credits.videos", params);
  };
  return (
    <ul class="credit-facts">
      <For each={ESTIMATE_MODELS}>
        {(model) => (
          <li>
            <Check aria-hidden="true" />
            <span>{estimate(model)}</span>
          </li>
        )}
      </For>
    </ul>
  );
}

function BalanceAfter(props: { target: CreditTarget; stop: CreditStop }) {
  const { t } = useText();
  const credit = useCreditFormat();
  return (
    <p class="credit-after">
      <span class="credit-after-name">{props.target.name}</span>
      <span class="credit-after-numbers">
        <CreditIcon />
        <RollingPrice
          class="credit-roll"
          value={props.target.balance + props.stop.credits}
          format={(to) =>
            t("billing.credits.balanceChange", { from: credit.count(props.target.balance), to: credit.count(to) })
          }
        />
      </span>
    </p>
  );
}

function StopSlider(props: { index: number; currency: BillingCurrency; onChange: (index: number) => void }) {
  const { t } = useText();
  const credit = useCreditFormat();
  return (
    <div
      class="credit-slider"
      style={{
        "--credit-pos": position(props.index),
        "--credit-plus-at": position(CREDIT_TIER_START_INDEX.plus),
        "--credit-max-at": position(CREDIT_TIER_START_INDEX.max),
      }}
    >
      <div class="credit-stops" aria-hidden="true">
        <For each={creditStops(props.currency)}>
          {(stop, index) => (
            <Button
              variant="ghost"
              size="sm"
              tabindex={-1}
              class="credit-stop"
              data-tier={creditTier(stop)}
              data-active={index() === props.index ? "" : undefined}
              data-passed={index() < props.index ? "" : undefined}
              style={{ left: position(index()) }}
              onClick={() => props.onChange(index())}
            >
              {credit.short(stop.credits)}
            </Button>
          )}
        </For>
      </div>
      <SliderField
        class="credit-slider-field"
        label={t("billing.credits.amountLabel")}
        value={props.index}
        minValue={0}
        maxValue={CREDIT_STOP_COUNT - 1}
        formatValue={(value) => credit.credits(creditStopAt(value, props.currency).credits)}
        onChange={props.onChange}
      />
    </div>
  );
}

function PopularBadge(props: { index: number }) {
  const { t } = useText();
  return (
    <Show when={props.index === CREDIT_POPULAR_INDEX}>
      <span class="credit-popular">{t("billing.credits.popular")}</span>
    </Show>
  );
}

function PackRow(props: { purchase: Purchase; index: number; order: number }) {
  const { t } = useText();
  const credit = useCreditFormat();
  const currency = () => props.purchase.credits.currency;
  const stop = () => creditStopAt(props.index, currency());
  const tier = () => creditTier(stop());
  return (
    <article
      class="credit-pack"
      data-tier={tier()}
      data-popular={props.index === CREDIT_POPULAR_INDEX ? "" : undefined}
      style={{ "--credit-order": props.order + 1 }}
      aria-label={t("billing.credits.packLabel", {
        tier: t(TIER_LABEL[tier()]),
        credits: credit.credits(stop().credits),
      })}
    >
      <PopularBadge index={props.index} />
      <div class="credit-pack-main">
        <div class="credit-head">
          <span class="credit-tier-tag">{t(TIER_LABEL[tier()])}</span>
          <p class="credit-pack-amount">
            <CreditIcon />
            {credit.credits(stop().credits)}
          </p>
          <RateChip stop={stop()} currency={currency()} />
          <SaveChip stop={stop()} />
        </div>
        <Facts credits={stop().credits} />
      </div>
      <div class="credit-pack-side">
        <PriceTag stop={stop()} currency={currency()} class="credit-pack-price" />
        <PayButton purchase={props.purchase} stop={stop()} class="credit-pack-pay" />
      </div>
    </article>
  );
}

function AmountAndPacks(props: { purchase: Purchase; index: number; onIndex: (index: number) => void }) {
  const { t } = useText();
  const credit = useCreditFormat();
  const currency = () => props.purchase.credits.currency;
  const stop = () => creditStopAt(props.index, currency());
  return (
    <div class="credit-packs">
      <section class="credit-split" data-tier={creditTier(stop())} aria-label={t("billing.credits.custom")}>
        <div class="credit-split-main">
          <div class="credit-head">
            <p class="credit-split-amount">
              <CreditIcon class="credit-icon-hero" />
              <RollingPrice class="credit-split-number" value={stop().credits} format={credit.count} />
              <span class="credit-split-unit">{t("billing.credits.unit")}</span>
            </p>
            <RateChip stop={stop()} currency={currency()} />
            <SaveChip stop={stop()} />
          </div>
          <StopSlider index={props.index} currency={currency()} onChange={props.onIndex} />
        </div>
        <div class="credit-split-side">
          <PriceTag stop={stop()} currency={currency()} class="credit-split-price" />
          <PayButton purchase={props.purchase} stop={stop()} class="credit-split-pay" />
          <BalanceAfter target={props.purchase.target} stop={stop()} />
        </div>
      </section>
      <For each={CREDIT_PACK_INDEXES}>
        {(index, order) => <PackRow purchase={props.purchase} index={index} order={order()} />}
      </For>
    </div>
  );
}

function CreditsLoadError(props: { store: CreditsStore; message: string }) {
  const { t } = useText();
  return (
    <Alert tone="danger" role="alert">
      <AlertIcon>
        <TriangleAlert aria-hidden="true" />
      </AlertIcon>
      <AlertContent>
        <AlertDescription>{props.message}</AlertDescription>
      </AlertContent>
      <AlertActions>
        <Button type="button" size="sm" variant="outline" onClick={() => void props.store.load()}>
          {t("common.retry")}
        </Button>
      </AlertActions>
    </Alert>
  );
}

export function BuyCreditsPage(props: BuyCreditsPageProps): JSX.Element {
  const { t } = useText();
  const [serverId, setServerId] = createSignal<string | null>(untrack(() => props.initialServerId ?? null));
  const [index, setIndex] = createSignal(CREDIT_POPULAR_INDEX);
  const [payButton, setPayButton] = createSignal<HTMLElement | undefined>();
  const [bursts, setBursts] = createSignal<readonly number[]>([]);
  const [confirming, setConfirming] = createSignal<{ stop: CreditStop; button: HTMLElement | undefined } | null>(null);
  const [moving, setMoving] = createSignal(false);
  const [redeeming, setRedeeming] = createSignal(false);
  const credits = () => props.store.state.credits;
  const targets = createMemo(() => creditTargets(credits(), t("billing.credits.you")));
  const target = createMemo(
    (): CreditTarget | undefined => targets().find((item) => item.serverId === serverId()) ?? targets()[0],
  );
  const ownedServer = () => {
    const wallet = creditsServer(credits(), target()?.serverId ?? null);
    return wallet?.role === "owner" ? wallet : null;
  };
  const [pickedCurrency, setPickedCurrency] = createSignal<BillingCurrency | null>(null);
  const currencyOptions = createMemo((): HostedCurrency[] =>
    HOSTED_CURRENCIES.filter((option) => credits()?.currencies.includes(HOSTED_BILLING_CURRENCY[option]) ?? false),
  );
  const currency = (): BillingCurrency | null => {
    const state = credits();
    if (!state?.available) return null;
    const picked = pickedCurrency();
    if (picked !== null && state.currencies.includes(picked)) return picked;
    const guess = HOSTED_BILLING_CURRENCY[guessHostedCurrency(currencyOptions())];
    return state.currencies.includes(guess) ? guess : state.currency;
  };
  const ready = createMemo((): CreditsState | null => {
    const state = credits();
    const chosen = currency();
    return state?.available && chosen !== null ? { ...state, currency: chosen } : null;
  });
  const pickCurrency = (next: HostedCurrency) => {
    const chosen = HOSTED_BILLING_CURRENCY[next];
    if (chosen !== currency()) setPickedCurrency(chosen);
  };

  createEffect(
    () => props.store.state.added,
    (added) => {
      if (!added) return;
      setBursts((current) => [...current, added.nonce]);
    },
  );

  const pay = (stop: CreditStop, button: HTMLElement | undefined) => {
    if (!ready() || !target()) return;
    setConfirming({ stop, button });
  };

  const confirm = async (consent: CreditConsent) => {
    const state = ready();
    const where = target();
    const chosen = confirming();
    if (!state || !where || !chosen) return;
    setPayButton(chosen.button);
    const opened = await props.store.openCheckout(checkoutRequest(chosen.stop, state.currency, where, consent));
    if (opened) setConfirming(null);
  };

  return (
    <section
      class="hosted-pricing-page credit-page"
      data-tier={creditTier({ index: index() })}
      aria-labelledby="credit-page-title"
      aria-busy={props.store.state.loading ? "true" : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        event.preventDefault();
        props.onClose();
      }}
    >
      <PageHeader
        class="hosted-pricing-header"
        title={t("billing.credits.buy")}
        headingId="credit-page-title"
        frame={props.headerFrame}
        onBack={() => props.onClose()}
      >
        <div class="credit-header-actions">
          <Show when={ready()}>
            <Button
              variant="outline"
              size="sm"
              class="credit-redeem-trigger"
              disabled={props.store.state.pending !== null}
              onClick={() => setRedeeming(true)}
            >
              <Gift aria-hidden="true" />
              {t("billing.credits.redeem")}
            </Button>
          </Show>
          <Show when={ready() ? ownedServer() : null}>
            <Button
              variant="outline"
              size="sm"
              disabled={(credits()?.balance ?? 0) <= 0 || props.store.state.pending !== null}
              onClick={() => setMoving(true)}
            >
              {t("billing.credits.moveIn")}
            </Button>
          </Show>
          <Show when={ready()}>
            {(state) => (
              <HostedCurrencySelect
                options={currencyOptions()}
                currency={hostedCurrency(state().currency)}
                onChange={pickCurrency}
                disabled={props.store.state.pending !== null}
                locked={currencyOptions().length < 2}
              />
            )}
          </Show>
          <Show when={ready() ? target() : undefined}>
            {(selected) => (
              <CreditTargetSelect
                targets={targets()}
                value={selected()}
                onChange={(next) => {
                  setMoving(false);
                  setRedeeming(false);
                  setServerId(next.serverId);
                }}
              />
            )}
          </Show>
        </div>
      </PageHeader>
      <div class="hosted-pricing-scroll">
        <div class="credit-page-body">
          <Switch>
            <Match when={ready()}>
              {(state) => (
                <Show when={target()}>
                  {(selected) => (
                    <AmountAndPacks
                      purchase={{
                        credits: state(),
                        target: selected(),
                        pending: props.store.state.pending !== null,
                        onPay: pay,
                      }}
                      index={index()}
                      onIndex={setIndex}
                    />
                  )}
                </Show>
              )}
            </Match>
            <Match when={credits()?.available === false}>
              <Text tone="muted">{t("billing.credits.unavailable")}</Text>
            </Match>
            <Match when={props.store.state.error}>
              {(message) => <CreditsLoadError store={props.store} message={message()} />}
            </Match>
          </Switch>
        </div>
      </div>
      <Show when={confirming()}>
        {(chosen) => (
          <Show when={ready()}>
            {(state) => (
              <Show when={target()}>
                {(where) => (
                  <PayCreditsDialog
                    stop={chosen().stop}
                    currency={state().currency}
                    target={where()}
                    pending={props.store.state.pending === "checkout"}
                    billingDetails={props.billingDetails}
                    onConfirm={(consent) => void confirm(consent)}
                    onClose={() => setConfirming(null)}
                  />
                )}
              </Show>
            )}
          </Show>
        )}
      </Show>
      <Show when={moving() && ready() ? ownedServer() : null}>
        {(server) => (
          <MoveCreditsDialog
            store={props.store}
            server={server()}
            direction="to_server"
            onClose={() => setMoving(false)}
          />
        )}
      </Show>
      <Show when={redeeming() && ready() ? target() : undefined}>
        {(where) => <RedeemCreditsDialog store={props.store} target={where()} onClose={() => setRedeeming(false)} />}
      </Show>
      <For each={bursts()}>{() => <Confetti origin={payButton()} />}</For>
    </section>
  );
}
