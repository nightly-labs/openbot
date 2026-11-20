import { AppLogo } from "@openbot/brand";
import type { BillingInterval } from "@openbot/contracts/billing";
import { LICENSE_YEAR_DISCOUNT_PERCENT, licensePlanPrice } from "@openbot/contracts/license";
import { REFERRAL_SHARE_PERCENT } from "@openbot/contracts/referral";
import { yearlyDiscountPercent } from "@openbot/ui/features/billing/OrderForm";
import { createSignal, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import type { PricingOffer } from "../../lib/pricing-page";
import type { ReferralInvite } from "../../lib/referral-landing";
import type { ReferralPageText } from "../../lib/referral-page-text";
import { slotted } from "../../lib/text-slots";
import { ButtonLink } from "../ui/button";
import { LandingFooter } from "./LandingFooter";
import { LandingGlow } from "./LandingGlow";
import { LandingIcon, type LandingIconName } from "./LandingIcon";
import { SiteHeader } from "./SiteHeader";
import { useSitePath } from "./SiteText";
import "./ReferralPage.css";

const INTERVALS: readonly BillingInterval[] = ["month", "year"];

const SPARKLES = [
  { x: "-4%", y: "8%", size: "22px", delay: "0s" },
  { x: "96%", y: "-6%", size: "16px", delay: "1.1s" },
  { x: "102%", y: "58%", size: "26px", delay: "2.3s" },
  { x: "-3%", y: "97%", size: "14px", delay: "0.6s" },
  { x: "54%", y: "-10%", size: "12px", delay: "1.7s" },
] as const;

const TILT_PROPERTIES = ["--referral-card-mx", "--referral-card-my", "--referral-card-rx", "--referral-card-ry"];

interface ReferralFormat {
  money: (minor: number) => string;
  percent: (value: number) => string;
}

interface OfferRow {
  id: string;
  name: string;
  detail: string;
  price: (interval: BillingInterval) => number;
}

interface OfferGroup {
  id: string;
  icon: LandingIconName;
  title: string;
  body: string;
  rows: readonly OfferRow[];
}

function referralFormat(lang: string): ReferralFormat {
  const money = (minor: number) => {
    const whole = minor % 100 === 0;
    return new Intl.NumberFormat(lang, {
      style: "currency",
      currency: "EUR",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(minor / 100);
  };
  const percent = (value: number) => new Intl.NumberFormat(lang, { style: "percent" }).format(value / 100);
  return { money, percent };
}

function saving(minor: number): number {
  return Math.round((minor * REFERRAL_SHARE_PERCENT) / 100);
}

function initial(name: string): string {
  return (Array.from(name)[0] ?? "").toLocaleUpperCase();
}

function fill(text: string, values: Readonly<Record<string, string>>): string {
  return slotted(text, values).join("");
}

function offerGroups(text: ReferralPageText, offer: PricingOffer, format: ReferralFormat): OfferGroup[] {
  const license = (tier: "starter" | "team", interval: BillingInterval) =>
    licensePlanPrice({ tier, interval, bundle: false }, "eur");
  return [
    {
      id: "server",
      icon: "cloud",
      title: text.server.title,
      body: text.server.body,
      rows: offer.plans
        .filter((plan) => !plan.soldOut)
        .map((plan) => ({
          id: plan.id,
          name: text.server.plans[plan.id].name,
          detail: `${text.server.plans[plan.id].members} · ${fill(text.server.storage, { size: `${plan.diskGb}` })}`,
          price: (interval: BillingInterval) => plan.prices.eur[interval],
        })),
    },
    {
      id: "license",
      icon: "key",
      title: text.license.title,
      body: text.license.body,
      rows: [
        {
          id: "license-starter",
          name: text.license.starter,
          detail: text.license.starterDetail,
          price: (interval) => license("starter", interval).base,
        },
        {
          id: "license-team",
          name: text.license.team,
          detail: fill(text.license.teamDetail, { price: format.money(license("team", "month").extraUser) }),
          price: (interval) => license("team", interval).base,
        },
      ],
    },
  ];
}

function InviterMark(props: { name: string }) {
  return <span class="referral-pair-initial">{initial(props.name)}</span>;
}

function InviterAvatar(props: { name: string | null }) {
  return (
    <span class="referral-pair" aria-hidden="true">
      <Show when={props.name}>{(name) => <InviterMark name={name()} />}</Show>
      <span class="referral-pair-logo" data-alone={`${props.name === null}`}>
        <AppLogo variant="production" animation="blink" />
      </span>
    </span>
  );
}

function InvitedBy(props: { text: ReferralPageText; name: string | null }) {
  return (
    <Show when={props.name} fallback={props.text.invited}>
      {(name) => (
        <For each={slotted(props.text.invitedBy, { name: { name: name() } })}>
          {(part) => (
            <Show when={typeof part === "string" ? undefined : part} fallback={`${part}`}>
              {(strong) => <strong>{strong().name}</strong>}
            </Show>
          )}
        </For>
      )}
    </Show>
  );
}

function OfferHeadline(props: { text: ReferralPageText; format: ReferralFormat }) {
  const parts = () => slotted(props.text.offer, { percent: { percent: props.format.percent(REFERRAL_SHARE_PERCENT) } });
  return (
    <span class="referral-offer-big">
      <For each={parts()}>
        {(part) => (
          <Show
            when={typeof part === "string" ? undefined : part}
            fallback={<span class="referral-offer-off">{`${part}`.trim()}</span>}
          >
            {(number) => <span class="referral-offer-number">{number().percent}</span>}
          </Show>
        )}
      </For>
    </span>
  );
}

function Sparkles() {
  return (
    <For each={SPARKLES}>
      {(sparkle) => (
        <svg
          class="referral-sparkle"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{
            "--referral-sparkle-x": sparkle.x,
            "--referral-sparkle-y": sparkle.y,
            "--referral-sparkle-size": sparkle.size,
            "--referral-sparkle-delay": sparkle.delay,
          }}
        >
          <path d="M12 0C12 7 17 12 24 12C17 12 12 17 12 24C12 17 7 12 0 12C7 12 12 7 12 0Z" />
        </svg>
      )}
    </For>
  );
}

function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" />
    </svg>
  );
}

function CopyButton(props: { code: string; text: ReferralPageText["card"] }) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" class="referral-card-copy" data-copied={`${copied()}`} onClick={copy}>
      <Show when={copied()} fallback={<CopyGlyph />}>
        <LandingIcon name="check" />
      </Show>
      <span aria-live="polite">
        <Show when={copied()} fallback={props.text.copy}>
          {props.text.copied}
        </Show>
      </span>
    </button>
  );
}

function GiftCard(props: { text: ReferralPageText; invite: ReferralInvite; format: ReferralFormat }) {
  let card: HTMLDivElement | undefined;
  const tilt = (event: PointerEvent) => {
    if (!card || event.pointerType !== "mouse") return;
    const box = card.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    card.dataset.tilting = "true";
    card.style.setProperty("--referral-card-mx", `${x * 100}%`);
    card.style.setProperty("--referral-card-my", `${y * 100}%`);
    card.style.setProperty("--referral-card-rx", `${(0.5 - y) * 14}deg`);
    card.style.setProperty("--referral-card-ry", `${(x - 0.5) * 18}deg`);
  };
  const rest = () => {
    if (!card) return;
    card.dataset.tilting = "false";
    for (const name of TILT_PROPERTIES) card.style.removeProperty(name);
  };
  return (
    <div class="referral-card-stage" onPointerMove={tilt} onPointerLeave={rest}>
      <Sparkles />
      <div ref={card} class="referral-card" data-tilting="false">
        <div class="referral-card-foil" aria-hidden="true" />
        <div class="referral-card-lines" aria-hidden="true" />
        <div class="referral-card-glare" aria-hidden="true" />
        <div class="referral-card-top">
          <span class="referral-card-brand">
            <AppLogo variant="production" animation="blink" />
            OpenBot
          </span>
          <Show
            when={props.invite.inviterName}
            fallback={<span class="referral-card-from">{props.text.card.invite}</span>}
          >
            {(name) => (
              <span class="referral-card-from" data-inviter="true">
                <span class="referral-pair" aria-hidden="true">
                  <InviterMark name={name()} />
                </span>
                {fill(props.text.card.from, { name: name() })}
              </span>
            )}
          </Show>
        </div>
        <p class="referral-card-value">
          <span class="referral-card-number">{props.format.percent(REFERRAL_SHARE_PERCENT)}</span>
          <span class="referral-card-off">{props.text.card.offer}</span>
        </p>
        <div class="referral-card-bottom">
          <div class="referral-card-code">
            <span>{props.text.card.code}</span>
            <code>{props.invite.code}</code>
          </div>
          <CopyButton code={props.invite.code} text={props.text.card} />
        </div>
      </div>
    </div>
  );
}

function CodeFacts(props: { text: ReferralPageText }) {
  return (
    <ul class="referral-facts">
      <li>
        <LandingIcon name="check" />
        {props.text.keep}
      </li>
      <li>
        <LandingIcon name="check" />
        {props.text.desktop}
      </li>
    </ul>
  );
}

function PriceValue(props: {
  text: ReferralPageText["prices"];
  format: ReferralFormat;
  full: number;
  interval: BillingInterval;
}) {
  const save = () => saving(props.full);
  const label = () => (props.interval === "month" ? props.text.firstMonth : props.text.firstYear);
  return (
    <p class="referral-price-value">
      <s>{props.format.money(props.full)}</s>
      <strong>{props.format.money(props.full - save())}</strong>
      <span>{fill(label(), { amount: props.format.money(save()) })}</span>
    </p>
  );
}

function IntervalToggle(props: {
  text: ReferralPageText["prices"];
  format: ReferralFormat;
  yearlyPercent: number;
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
}) {
  const label = (value: BillingInterval) => (value === "month" ? props.text.monthly : props.text.yearly);
  return (
    <fieldset class="referral-interval">
      <legend class="landing-visually-hidden">{props.text.billing}</legend>
      <For each={INTERVALS}>
        {(value) => (
          <button
            type="button"
            aria-pressed={`${props.value === value}`}
            class="referral-interval-option"
            onClick={() => props.onChange(value)}
          >
            {label(value)}
            <Show when={value === "year" && props.yearlyPercent > 0}>
              <span class="referral-interval-chip">{props.format.percent(-props.yearlyPercent)}</span>
            </Show>
          </button>
        )}
      </For>
    </fieldset>
  );
}

export function ReferralPage(props: {
  text: ReferralPageText;
  invite: ReferralInvite;
  offer: PricingOffer;
  lang: string;
}) {
  const [interval, setInterval] = createSignal<BillingInterval>("month");
  const path = useSitePath();
  const format = () => referralFormat(props.lang);
  const groups = () => offerGroups(props.text, props.offer, format());
  const yearlyPercent = () => Math.min(yearlyDiscountPercent(props.offer.plans, "eur"), LICENSE_YEAR_DISCOUNT_PERCENT);
  const percent = () => format().percent(REFERRAL_SHARE_PERCENT);

  onSettled(() => landingAnalytics.start(document, window.location.hostname));

  return (
    <div class="landing-page referral-page" lang={props.lang}>
      <SiteHeader page="landing" />
      <main>
        <section class="referral-hero" aria-labelledby="referral-title">
          <div class="landing-hero-grid" aria-hidden="true" />
          <div class="referral-aura" aria-hidden="true" />
          <div class="referral-hero-copy">
            <p class="referral-from">
              <InviterAvatar name={props.invite.inviterName} />
              <span>
                <InvitedBy text={props.text} name={props.invite.inviterName} />
              </span>
            </p>
            <h1 id="referral-title" class="referral-offer-title">
              <OfferHeadline text={props.text} format={format()} />
              <span class="referral-offer-sub">{props.text.offerDetail}</span>
            </h1>
            <p class="referral-lead">{props.text.lead}</p>
            <div class="referral-actions">
              <ButtonLink to={path("/download")} variant="primary" size="lg" icon="download">
                {props.text.download}
              </ButtonLink>
              <ButtonLink to="/app" variant="secondary" size="lg" icon="arrow-right" class="landing-button-glass">
                {props.text.browser}
              </ButtonLink>
            </div>
          </div>
          <div class="referral-hero-card">
            <GiftCard text={props.text} invite={props.invite} format={format()} />
            <CodeFacts text={props.text} />
          </div>
        </section>

        <section class="referral-prices" aria-labelledby="referral-prices-title">
          <div class="referral-prices-head">
            <div>
              <h2 id="referral-prices-title">{fill(props.text.prices.title, { percent: percent() })}</h2>
              <p>{props.text.prices.description}</p>
            </div>
            <IntervalToggle
              text={props.text.prices}
              format={format()}
              yearlyPercent={yearlyPercent()}
              value={interval()}
              onChange={setInterval}
            />
          </div>
          <div class="referral-groups">
            <For each={groups()}>
              {(group) => (
                <article class="referral-group" aria-labelledby={`referral-group-${group.id}`}>
                  <header class="referral-group-head">
                    <span class="referral-group-icon">
                      <LandingIcon name={group.icon} />
                    </span>
                    <div>
                      <h3 id={`referral-group-${group.id}`}>{group.title}</h3>
                      <p>{group.body}</p>
                    </div>
                  </header>
                  <ul class="referral-price-list">
                    <For each={group.rows}>
                      {(row) => (
                        <li class="referral-price-row">
                          <div>
                            <p class="referral-price-name">{row.name}</p>
                            <p class="referral-price-detail">{row.detail}</p>
                          </div>
                          <Show when={interval()} keyed>
                            {(period) => (
                              <PriceValue
                                text={props.text.prices}
                                format={format()}
                                full={row.price(period)}
                                interval={period}
                              />
                            )}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </article>
              )}
            </For>
          </div>
          <p class="referral-prices-note">{props.text.prices.note}</p>
          <div class="referral-prices-cta">
            <ButtonLink
              to={path("/pricing")}
              variant="secondary"
              size="md"
              icon="arrow-right"
              class="landing-button-glass"
            >
              {props.text.prices.all}
            </ButtonLink>
          </div>
        </section>
      </main>
      <LandingFooter />
      <LandingGlow />
    </div>
  );
}
